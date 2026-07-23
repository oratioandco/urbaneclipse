/**
 * Renders a parametric landmark (src/lib/landmarks.ts) as a real 3D solid in the scene.
 *
 * WHY: the LoD2 tile geometry of the Fernsehturm is unusable — a prism with no sphere,
 * no taper, and the whole 114 m antenna missing (see landmarks.ts). It renders as a
 * short white stub that, backlit and hazed, vanishes into the sun bloom. The solver
 * already models the tower accurately as a solid of revolution; this draws THAT model,
 * so the preview shows the iconic silhouette — tapered shaft, sphere, antenna — exactly
 * where the occultation maths says it is, and it actually occludes the celestial disc
 * (the disc sits at 50 km, the tower at ~6 km), which is the "urban eclipse" itself.
 *
 * The model is a stack of cylinder frustums between consecutive profile samples, so the
 * sphere's finely-sampled radii reproduce its bulge. Lit (not flat), so at a transit
 * the sun behind the tower leaves the camera-facing side in shadow — a natural
 * clay-model silhouette with form, matching the plaster aesthetic.
 */
import type * as CesiumType from 'cesium';
import { orthometricToEllipsoidal } from '../lib/elevation.js';
import { radiusAtHeight, landmarkHeight, type RevolutionLandmark } from '../lib/landmarks.js';

const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

/**
 * Build a Primitive for a solid-of-revolution landmark.
 *
 * @param verticalSamples How finely to slice the profile. The default resolves the
 *   sphere and taper smoothly at the small on-screen size a telephoto view produces.
 */
export function buildLandmarkPrimitive(
  landmark: RevolutionLandmark,
  verticalSamples = 64,
): CesiumType.Primitive {
  const total = landmarkHeight(landmark);
  const base = orthometricToEllipsoidal(landmark.baseOrthometric);

  // Matte clay grey, a touch dark so it reads as a silhouette against the sun bloom.
  const color = Cesium.Color.fromCssColorString('#6c6c70');

  const instances: CesiumType.GeometryInstance[] = [];
  let prevH = 0;
  let prevR = radiusAtHeight(landmark, 0);

  for (let i = 1; i <= verticalSamples; i++) {
    const h = (total * i) / verticalSamples;
    const r = radiusAtHeight(landmark, h);

    const length = h - prevH;
    // Skip a degenerate slice (two coincident samples) but keep going up the tower.
    if (length > 1e-3 && (prevR > 1e-3 || r > 1e-3)) {
      const midHeight = base + (prevH + h) / 2;
      const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(landmark.lon, landmark.lat, midHeight),
      );
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.CylinderGeometry({
            length,
            topRadius: Math.max(r, 0.01),
            bottomRadius: Math.max(prevR, 0.01),
            slices: 24,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          modelMatrix,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
      );
    }

    prevH = h;
    prevR = r;
  }

  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: false, // lit — the sun behind the tower shades it into a silhouette
      translucent: false,
    }),
    // The tower is a fixed landmark; skip per-frame model-matrix updates.
    asynchronous: false,
  });
}
