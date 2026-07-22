/**
 * Map-first placement: picking positions off the scene, and the two camera framings.
 *
 * THE PLASTER MODEL IS THE MAP. There is no external tile provider, no second
 * rendering library and no third-party request — MAP mode is simply a top-down view of
 * the same 924-tile Berlin model the occlusion and silhouette maths already use, so
 * what you click is exactly what the solver reasons about.
 *
 * Cesium-touching adapter code (Constitution Principle I): the geometry it depends on
 * lives in pure modules under src/lib.
 */
import type * as CesiumType from 'cesium';
import { greatCircleBearing } from '../lib/sceneMath.js';

const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

const DEG = 180 / Math.PI;

export interface PickedPosition {
  lat: number;
  lon: number;
}

/**
 * Convert a screen click into a geographic position.
 *
 * Tries scene.pickPosition first (real depth against buildings and terrain), then
 * falls back to the ellipsoid. Returns undefined when the ray hits nothing — the
 * caller must treat that as "no pick", never as a coordinate, because an unchecked
 * miss yields NaN or a point on the far side of the globe.
 */
export function pickGeographic(
  viewer: CesiumType.Viewer,
  windowPosition: CesiumType.Cartesian2,
): PickedPosition | undefined {
  const scene = viewer.scene;
  let cartesian: CesiumType.Cartesian3 | undefined;

  // pickPosition needs a depth texture; guard rather than throw on weak GPUs.
  if (scene.pickPositionSupported) {
    cartesian = scene.pickPosition(windowPosition);
  }

  if (!Cesium.defined(cartesian)) {
    cartesian = viewer.camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84);
  }

  if (!Cesium.defined(cartesian)) return undefined;

  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  if (!Cesium.defined(carto)) return undefined;

  const lat = carto.latitude * DEG;
  const lon = carto.longitude * DEG;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;

  return { lat, lon };
}

/**
 * MAP framing: look straight down, centred between observer and target, high enough
 * that both are comfortably in view.
 *
 * Altitude is derived from their separation rather than fixed, so the framing works
 * for a 500 m shot and a 15 km one alike.
 */
export function flyToMapView(
  viewer: CesiumType.Viewer,
  observer: PickedPosition,
  target: PickedPosition,
  durationSec = 1.2,
): void {
  const midLat = (observer.lat + target.lat) / 2;
  const midLon = (observer.lon + target.lon) / 2;

  // Rough metres between the two points (equirectangular is ample for framing).
  const dLat = (target.lat - observer.lat) * 111_320;
  const dLon =
    (target.lon - observer.lon) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const separation = Math.hypot(dLat, dLon);

  // 1.6x the separation gives margin around both markers; floor keeps a degenerate
  // (observer == target) case from putting the camera on the ground.
  const altitude = Math.max(1500, separation * 1.6);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(midLon, midLat, altitude),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90), // straight down
      roll: 0,
    },
    duration: durationSec,
  });
}

/**
 * PREVIEW framing: stand at the observer's eye and look at the target — the actual
 * photograph, with whatever telephoto FOV the camera profile has set.
 *
 * Heading uses the shared greatCircleBearing so the map, the solver and the preview
 * cannot drift apart. Pitch is the true elevation angle to the aim point, which for a
 * 368 m tower at 6 km is only ~3 degrees — getting this wrong points the camera at the sky.
 */
export function flyToPreview(
  viewer: CesiumType.Viewer,
  observer: { lat: number; lon: number; ellipsoidalHeight: number },
  target: { lat: number; lon: number; ellipsoidalHeight: number },
  durationSec = 1.2,
): void {
  const headingRad = greatCircleBearing(observer.lat, observer.lon, target.lat, target.lon);

  const from = Cesium.Cartesian3.fromDegrees(
    observer.lon,
    observer.lat,
    observer.ellipsoidalHeight,
  );
  const to = Cesium.Cartesian3.fromDegrees(target.lon, target.lat, target.ellipsoidalHeight);

  // Elevation angle in the observer's local ENU frame.
  const enuFromFixed = Cesium.Matrix4.inverseTransformation(
    Cesium.Transforms.eastNorthUpToFixedFrame(from, Cesium.Ellipsoid.WGS84, new Cesium.Matrix4()),
    new Cesium.Matrix4(),
  );
  const delta = Cesium.Cartesian3.subtract(to, from, new Cesium.Cartesian3());
  const enu = Cesium.Matrix4.multiplyByPointAsVector(enuFromFixed, delta, new Cesium.Cartesian3());
  const pitchRad = Math.atan2(enu.z, Math.hypot(enu.x, enu.y));

  viewer.camera.flyTo({
    destination: from,
    orientation: { heading: headingRad, pitch: pitchRad, roll: 0 },
    duration: durationSec,
  });
}

/** Marker entity ids, so they can be updated in place rather than duplicated. */
export const OBSERVER_MARKER_ID = 'pv-observer-marker';
export const TARGET_MARKER_ID = 'pv-target-marker';

/**
 * Draw or move a placement marker.
 *
 * Uses a ground-anchored vertical line plus a point rather than a billboard: no image
 * asset, it reads correctly from directly overhead in MAP mode (where a flat pin would
 * be invisible), and it stays legible against white plaster.
 */
export function upsertMarker(
  viewer: CesiumType.Viewer,
  id: string,
  lat: number,
  lon: number,
  groundEllipsoidalHeight: number,
  eyeEllipsoidalHeight: number,
  color: CesiumType.Color,
  label: string,
): void {
  const existing = viewer.entities.getById(id);
  if (existing) viewer.entities.remove(existing);

  viewer.entities.add({
    id,
    position: Cesium.Cartesian3.fromDegrees(lon, lat, eyeEllipsoidalHeight),
    point: {
      pixelSize: 9,
      color,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    polyline: {
      positions: [
        Cesium.Cartesian3.fromDegrees(lon, lat, groundEllipsoidalHeight),
        Cesium.Cartesian3.fromDegrees(lon, lat, eyeEllipsoidalHeight),
      ],
      width: 1.5,
      material: color,
      clampToGround: false,
    },
    label: {
      text: label,
      font: '11px ui-sans-serif, system-ui, sans-serif',
      fillColor: Cesium.Color.BLACK,
      showBackground: true,
      backgroundColor: Cesium.Color.WHITE.withAlpha(0.85),
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}
