/**
 * Celestial-disc STATE for the preview — pure, NO Cesium.
 *
 * The sun/moon is drawn by the studio post-process shader (see
 * src/cesium/shaders/studioEnvironment.ts §"THE DISC LIVES IN THE SHADER"), not as a
 * billboard entity: a billboard at the occultation-correct 50 km sits beyond the fog
 * ramp and would be hazed to invisibility, while a nearer one breaks occultation for
 * far targets. In the shader the disc is painted only on background pixels, so city
 * geometry occults it per-pixel at any range.
 *
 * This module answers "where is the body and how big does it look" from the SAME
 * suncalc ephemeris the solver uses — never Cesium's own sun, which falls back to the
 * TEME frame without network EOP data and sits ~0.37 deg (three quarters of a solar
 * diameter) off the prediction (see tests/unit/sun-agreement.test.ts).
 */
import { sampleBody, type Body } from '../lib/bodyPosition.js';
import { angularRadiusDeg } from '../lib/occultation.js';

export interface DiscState {
  /** Degrees above the horizon; negative means below and the disc is hidden. */
  altitude: number;
  azimuth: number;
  /** Apparent angular DIAMETER, degrees. */
  angularDiameterDeg: number;
  visible: boolean;
}

/**
 * The body's position and apparent size for the given instant.
 *
 * `visible` stays true while any of the disc is still above the horizon, so the UI
 * can distinguish "below the horizon" from "something broke" instead of showing
 * nothing silently.
 */
export function computeDiscState(body: Body, date: Date, lat: number, lon: number): DiscState {
  const sample = sampleBody(body, date, lat, lon);
  const angularRadius = angularRadiusDeg(sample.radiusKm, sample.distanceKm);
  return {
    altitude: sample.alt,
    azimuth: sample.az,
    angularDiameterDeg: angularRadius * 2,
    visible: sample.alt > -angularRadius, // still partly up while setting
  };
}
