/**
 * Draws the sun or moon in the preview, so a predicted composition can be SEEN rather
 * than taken on faith.
 *
 * WHY NOT CESIUM'S OWN SUN/MOON
 * -----------------------------
 * Two reasons, and the second is the important one:
 *
 * 1. `scene.sun.show` / `scene.moon.show` are deliberately false — the plaster void has
 *    no sky, and Cesium's sun is a lens-flare glow, not a disc with a true angular size.
 *
 * 2. Cesium's internal sun position disagrees with suncalc by a near-constant ~0.37 deg —
 *    about three quarters of a solar diameter. It falls back to the TEME frame because
 *    `computeIcrfToFixedMatrix` needs Earth-orientation data fetched from Ion, so it
 *    omits precession since J2000 (see tests/unit/sun-agreement.test.ts). The SOLVER
 *    predicts with suncalc, so drawing Cesium's sun would show the disc three quarters
 *    of a diameter away from where the tool just said it would be — the preview would
 *    contradict the prediction it exists to illustrate.
 *
 * So the disc is drawn from the SAME ephemeris the solver uses.
 *
 * PLACEMENT
 * ---------
 * A billboard at a fixed 50 km along the body's true topocentric direction, sized to
 * subtend the correct angle. Distance is arbitrary for apparent size (a disc at the
 * right angular size looks identical at any range) but NOT arbitrary for occlusion:
 * placing it far beyond the city means the depth buffer lets buildings hide it, which
 * is the entire point. `sizeInMeters` keeps it correctly scaled under the telephoto
 * frustum.
 */
import type * as CesiumType from 'cesium';
import { sampleBody, type Body } from '../lib/bodyPosition.js';
import {
  directionOffsetECEF,
  discRadiusMetres,
  type ObserverGeodetic,
} from '../lib/silhouette.js';
import { angularRadiusDeg } from '../lib/occultation.js';

const Cesium = (window as unknown as { Cesium: typeof CesiumType }).Cesium;

export const CELESTIAL_DISC_ID = 'pv-celestial-disc';

/** Far enough to sit beyond all city geometry, near enough to stay well inside the
 *  depth range. The Fernsehturm is ~6 km from the default observer. */
const DISC_DISTANCE_M = 50_000;

/** Cached disc textures, keyed by body — regenerating per frame would be wasteful. */
const textureCache = new Map<Body, string>();

/**
 * A soft-edged filled circle as a data URI.
 *
 * Drawn rather than shipped as an asset so there is no extra request and no binary in
 * the repo. The slight edge falloff avoids the hard aliased rim a plain arc gives at
 * the small on-screen sizes a telephoto view produces.
 */
function discTexture(body: Body): string {
  const cached = textureCache.get(body);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  if (body === 'sun') {
    grad.addColorStop(0, 'rgba(255,247,230,1)');
    grad.addColorStop(0.82, 'rgba(255,236,196,1)');
    grad.addColorStop(0.97, 'rgba(255,224,163,0.95)');
    grad.addColorStop(1, 'rgba(255,224,163,0)');
  } else {
    grad.addColorStop(0, 'rgba(248,248,246,1)');
    grad.addColorStop(0.85, 'rgba(232,232,228,1)');
    grad.addColorStop(0.97, 'rgba(214,214,210,0.95)');
    grad.addColorStop(1, 'rgba(214,214,210,0)');
  }

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  const uri = canvas.toDataURL('image/png');
  textureCache.set(body, uri);
  return uri;
}

export interface DiscState {
  /** Degrees above the horizon; negative means below and the disc is hidden. */
  altitude: number;
  azimuth: number;
  /** Apparent angular DIAMETER, degrees. */
  angularDiameterDeg: number;
  visible: boolean;
}

/**
 * Place (or move) the celestial disc for the given instant.
 *
 * Returns the resulting state so the UI can report it — notably when the body is below
 * the horizon, where drawing nothing would otherwise be indistinguishable from a bug.
 */
export function upsertCelestialDisc(
  viewer: CesiumType.Viewer,
  observer: ObserverGeodetic,
  body: Body,
  date: Date,
): DiscState {
  const sample = sampleBody(body, date, observer.lat, observer.lon);
  const angularRadius = angularRadiusDeg(sample.radiusKm, sample.distanceKm);

  const existing = viewer.entities.getById(CELESTIAL_DISC_ID);
  if (existing) viewer.entities.remove(existing);

  const state: DiscState = {
    altitude: sample.alt,
    azimuth: sample.az,
    angularDiameterDeg: angularRadius * 2,
    visible: sample.alt > -angularRadius, // still partly up while setting
  };

  if (!state.visible) return state;

  const [x, y, z] = directionOffsetECEF(observer, sample.az, sample.alt, DISC_DISTANCE_M);
  const radiusM = discRadiusMetres(angularRadius, DISC_DISTANCE_M);

  viewer.entities.add({
    id: CELESTIAL_DISC_ID,
    position: new Cesium.Cartesian3(x, y, z),
    billboard: {
      image: discTexture(body),
      // Metres, not pixels: the disc must keep its true angular size as the telephoto
      // FOV changes, and must shrink correctly if the camera pulls back.
      sizeInMeters: true,
      width: radiusM * 2,
      height: radiusM * 2,
      // NO disableDepthTestDistance here — depth testing is exactly what lets the
      // tower occult the disc, which is the whole feature.
    },
  });

  return state;
}

/** Remove the disc (e.g. on leaving preview mode). */
export function removeCelestialDisc(viewer: CesiumType.Viewer): void {
  const e = viewer.entities.getById(CELESTIAL_DISC_ID);
  if (e) viewer.entities.remove(e);
}
