/**
 * Horizon-gated eclipse windows for a SECOND landmark — flag-gated, NOT shipped.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tower-shot rules answer "sun or moon behind the Fernsehturm" from a fixed spot.
 * A second target — the Siegessäule, a 67 m column against open sky — needs one thing
 * the tower case could ignore: the sun sets BEHIND TERRAIN, so an alignment that is
 * geometrically perfect can still be unphotographable because the disc is already
 * below the local horizon. This module samples the terrain horizon profile along the
 * sightline and gates the alignment windows on the disc actually clearing it.
 *
 * STATUS: behind `HORIZON_WINDOWS_FLAG`, default OFF. Nothing in the app imports this
 * module; it is a trial of the terrain-sampling + bearing maths, tested, not shipped.
 *
 * HONESTY ABOUT THE DATA
 * ----------------------
 * The committed DGM1 grid (public/heightmap/berlin-dgm1.bin) covers lon >= 13.3611,
 * and the Siegessäule stands at lon 13.3501 — OUTSIDE it. So the horizon towards the
 * column is only partly sampled. This module never invents ground for a gap: it
 * reports `coverage` and `maxDistanceM` so a caller can see how far the profile is
 * actually known, and `HorizonProfile.truncated` says the sightline left the grid.
 * A window gated on a truncated profile is marked `horizonConfident: false`.
 *
 * DGM1 is bare earth. It is the right model for a TERRAIN horizon (trees and buildings
 * are not in it), and the wrong model for a deck or roof height — see src/lib/vantages.ts.
 */
import { offsetGeodetic } from './silhouette.js';
import { resolveEyeEllipsoidalHeight, GEOID_UNDULATION_BERLIN } from './elevation.js';
import { landmarkHeight, type RevolutionLandmark } from './landmarks.js';
import { bearingDistanceTo } from './vantages.js';
import { enumerateVantageWindows } from './vantageWindows.js';
import type { StandingPoint } from './vantages.js';
import type { Heightmap } from './heightmap.js';
import { sampleGroundOrthometric } from './heightmap.js';

/**
 * The feature flag. OFF unless explicitly enabled, so nothing ships by accident.
 * Read through a guard: `import.meta.env` is a Vite/Astro build-time construct and is
 * absent under plain node, which is how the unit tests run.
 */
export const HORIZON_WINDOWS_FLAG = 'PUBLIC_HORIZON_WINDOWS';

/** True only when the flag is explicitly set to a truthy string. Default: false. */
export function horizonWindowsEnabled(env?: Record<string, string | undefined>): boolean {
  const source =
    env ??
    (() => {
      try {
        return (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
      } catch {
        return undefined;
      }
    })();
  const raw = source?.[HORIZON_WINDOWS_FLAG];
  return raw === '1' || raw === 'true' || raw === 'on';
}

/** One terrain sample along a sightline. */
export interface HorizonSample {
  /** Ground distance from the observer, metres. */
  distanceM: number;
  /** Apparent altitude of that ground point from the observer's eye, degrees. */
  altitudeDeg: number;
}

export interface HorizonProfile {
  /** Azimuth this profile was sampled along, degrees true. */
  azimuthDeg: number;
  /** Running maximum of altitude — the skyline an observer actually sees. */
  samples: HorizonSample[];
  /** Highest apparent altitude found: the horizon in this direction, degrees. */
  horizonAltitudeDeg: number;
  /** Distance at which that maximum occurs, metres. */
  horizonDistanceM: number;
  /** How far the profile is actually backed by terrain data, metres. */
  maxDistanceM: number;
  /** Fraction of requested samples that had terrain data, 0..1. */
  coverage: number;
  /** True when the sightline ran past the edge of the heightmap (or had gaps). */
  truncated: boolean;
}

export interface HorizonRequest {
  point: StandingPoint;
  /** Direction to sample, degrees true. */
  azimuthDeg: number;
  /** How far to walk the sightline, metres. */
  maxDistanceM: number;
  /** Spacing between samples, metres. Must be > 0. */
  stepM: number;
  map: Heightmap;
}

/**
 * Apparent altitude of a ground point at `distanceM`, seen from an eye at
 * `eyeOrthometricM`, with Earth curvature and standard refraction applied.
 *
 * The drop over distance d on a sphere of radius R is d^2/(2R); standard atmospheric
 * refraction bends the ray back by about 1/7 of that, so the effective drop is
 * (1 - k) * d^2 / (2R) with k = 0.13. Ignoring it would overstate the horizon by
 * ~0.02 deg at 2 km — small, but the whole point of this module is honest angles.
 */
export function groundAltitudeDeg(
  groundOrthometricM: number,
  eyeOrthometricM: number,
  distanceM: number,
): number {
  const R = 6_371_000;
  const k = 0.13;
  const drop = ((1 - k) * distanceM * distanceM) / (2 * R);
  const rise = groundOrthometricM - eyeOrthometricM - drop;
  return (Math.atan2(rise, distanceM) * 180) / Math.PI;
}

/**
 * Sample the terrain skyline along one azimuth from a standing point.
 *
 * The returned `samples` are the RUNNING MAXIMUM, not raw ground: a nearer ridge hides
 * a taller far one, and it is the skyline that gates a sunset, not the tallest hill.
 */
export function sampleHorizonProfile(req: HorizonRequest): HorizonProfile {
  const { point, azimuthDeg, maxDistanceM, stepM, map } = req;
  if (!(stepM > 0)) throw new RangeError(`stepM must be positive, received ${stepM}`);
  if (!(maxDistanceM > 0)) throw new RangeError(`maxDistanceM must be positive, received ${maxDistanceM}`);

  const eye = point.surfaceOrthometric + point.eyeHeightM;
  const samples: HorizonSample[] = [];
  let best = -90;
  let bestDistance = 0;
  let known = 0;
  let requested = 0;
  let lastKnown = 0;
  let gaps = false;

  for (let d = stepM; d <= maxDistanceM + 1e-9; d += stepM) {
    requested++;
    const p = offsetGeodetic(point.lat, point.lon, 0, azimuthDeg, d);
    const ground = sampleGroundOrthometric(map, p.lat, p.lon);
    if (ground === undefined) {
      gaps = true;
      continue;
    }
    known++;
    lastKnown = d;
    const alt = groundAltitudeDeg(ground, eye, d);
    if (alt > best) {
      best = alt;
      bestDistance = d;
    }
    samples.push({ distanceM: d, altitudeDeg: best });
  }

  return {
    azimuthDeg,
    samples,
    horizonAltitudeDeg: known > 0 ? best : Number.NaN,
    horizonDistanceM: bestDistance,
    maxDistanceM: lastKnown,
    coverage: requested > 0 ? known / requested : 0,
    truncated: gaps || known === 0,
  };
}

/** Azimuth from a standing point to a landmark's axis, degrees true. */
export function azimuthToLandmark(point: StandingPoint, landmark: RevolutionLandmark): number {
  return bearingDistanceTo(point, { lat: landmark.lat, lon: landmark.lon }).bearingDeg;
}

/**
 * Apparent altitude of the landmark's tip from the standing point, degrees — the top
 * of the azimuth/altitude window this target can ever occupy.
 */
export function landmarkTipAltitudeDeg(point: StandingPoint, landmark: RevolutionLandmark): number {
  const { distanceM } = bearingDistanceTo(point, { lat: landmark.lat, lon: landmark.lon });
  const eye = point.surfaceOrthometric + point.eyeHeightM;
  const tip = landmark.baseOrthometric + landmarkHeight(landmark);
  return groundAltitudeDeg(tip, eye, distanceM);
}

/** The azimuth/altitude window a target occupies from a standing point. */
export interface TargetWindow {
  /** Azimuth of the axis, degrees true. */
  azimuthDeg: number;
  /** Half-width in azimuth of the structure at its widest, degrees. */
  azimuthHalfWidthDeg: number;
  /** Altitude of the base and of the tip, degrees. */
  altitudeMinDeg: number;
  altitudeMaxDeg: number;
}

/** Azimuth/altitude extent of a landmark from a standing point, by spherical trig. */
export function targetWindow(point: StandingPoint, landmark: RevolutionLandmark): TargetWindow {
  const { distanceM } = bearingDistanceTo(point, { lat: landmark.lat, lon: landmark.lon });
  const eye = point.surfaceOrthometric + point.eyeHeightM;
  const widest = landmark.profile.reduce((m, [, r]) => Math.max(m, r), 0);
  return {
    azimuthDeg: azimuthToLandmark(point, landmark),
    azimuthHalfWidthDeg: (Math.atan2(widest, distanceM) * 180) / Math.PI,
    altitudeMinDeg: groundAltitudeDeg(landmark.baseOrthometric, eye, distanceM),
    altitudeMaxDeg: landmarkTipAltitudeDeg(point, landmark),
  };
}

export interface HorizonGatedWindow {
  /** The body's direction at the instant considered. */
  azimuthDeg: number;
  altitudeDeg: number;
  /** True when the disc centre is above the sampled terrain skyline. */
  clearsHorizon: boolean;
  /** True when it is also within the target's azimuth/altitude window. */
  alignedWithTarget: boolean;
  /** False when the skyline towards the target is not fully backed by terrain data. */
  horizonConfident: boolean;
  /** The skyline altitude used for the decision, degrees (NaN when nothing sampled). */
  horizonAltitudeDeg: number;
}

/**
 * Gate one body direction on BOTH the terrain horizon and the target's window.
 *
 * `discRadiusDeg` lets a caller require the whole disc to clear, not just its centre.
 */
export function gateDirection(
  body: { azimuthDeg: number; altitudeDeg: number },
  target: TargetWindow,
  horizon: HorizonProfile,
  discRadiusDeg = 0,
): HorizonGatedWindow {
  const clears = body.altitudeDeg - discRadiusDeg > horizon.horizonAltitudeDeg;
  let dAz = Math.abs(body.azimuthDeg - target.azimuthDeg) % 360;
  if (dAz > 180) dAz = 360 - dAz;
  const aligned =
    dAz <= target.azimuthHalfWidthDeg + discRadiusDeg &&
    body.altitudeDeg + discRadiusDeg >= target.altitudeMinDeg &&
    body.altitudeDeg - discRadiusDeg <= target.altitudeMaxDeg;
  return {
    azimuthDeg: body.azimuthDeg,
    altitudeDeg: body.altitudeDeg,
    clearsHorizon: clears,
    alignedWithTarget: aligned,
    horizonConfident: !horizon.truncated,
    horizonAltitudeDeg: horizon.horizonAltitudeDeg,
  };
}

/**
 * Convenience: the horizon towards a landmark, sampled out to the landmark's own
 * distance (never past it — ground behind the target cannot hide it).
 */
export function horizonTowardsLandmark(
  point: StandingPoint,
  landmark: RevolutionLandmark,
  map: Heightmap,
  stepM = 25,
): HorizonProfile {
  const { distanceM } = bearingDistanceTo(point, { lat: landmark.lat, lon: landmark.lon });
  return sampleHorizonProfile({
    point,
    azimuthDeg: azimuthToLandmark(point, landmark),
    maxDistanceM: distanceM,
    stepM,
    map,
  });
}

/** Ellipsoidal eye height for a standing point, via the repo's single resolver. */
export function eyeEllipsoidal(point: StandingPoint): number {
  return resolveEyeEllipsoidalHeight({
    // The deck/platform value is known, so no terrain sample is needed; DGM1 under a
    // structure returns the ground BELOW it (see src/lib/elevation.ts).
    groundOrthometric: undefined,
    surfaceOrthometric: point.surfaceOrthometric,
    eyeHeight: point.eyeHeightM,
  });
}

/** Re-exported so a caller converting orthometric samples has one datum constant. */
export const BERLIN_GEOID_UNDULATION_M = GEOID_UNDULATION_BERLIN;

/** A window of the second target, gated on the sampled terrain skyline. */
export interface HorizonGatedVantageWindow {
  body: 'sun' | 'moon';
  start: Date;
  end: Date;
  peak: Date;
  coveredFraction: number;
  /** Body direction at the peak. */
  peakAzimuthDeg: number;
  peakAltitudeDeg: number;
  /** The skyline altitude towards the target, degrees. */
  horizonAltitudeDeg: number;
  /** True when the disc centre cleared that skyline at the peak. */
  clearsHorizon: boolean;
  /** False when the skyline towards the target is not fully backed by terrain data. */
  horizonConfident: boolean;
  /** True only when BOTH the alignment and the horizon test pass. */
  photographable: boolean;
}

export interface HorizonWindowRequest {
  point: StandingPoint;
  landmark: RevolutionLandmark;
  map: Heightmap;
  bodyAt: (t: Date, body: 'sun' | 'moon') => BodySampleLike;
  bodies?: Array<'sun' | 'moon'>;
  start: Date;
  end: Date;
  stepMinutes: number;
  /** Terrain sampling spacing along the sightline, metres. Default 25. */
  horizonStepM?: number;
  /** Angular radius of the disc to require fully clear, degrees. Default 0 (centre). */
  discRadiusDeg?: number;
  /** Explicit override; when omitted the module's own flag is consulted. */
  enabled?: boolean;
}

/** The shape the ephemeris adapter must return (structurally BodySample). */
export interface BodySampleLike {
  az: number;
  alt: number;
  distanceKm: number;
  radiusKm: number;
}

/** Thrown when a caller asks for windows while the feature flag is off. */
export class HorizonWindowsDisabledError extends Error {}

/**
 * Enumerate the alignment windows of a SECOND landmark from a standing point, and
 * gate each on the sampled terrain horizon.
 *
 * This is the generalisation the handoff asked for: the tower rules only knew the
 * Fernsehturm, where the sightline runs over open city; a column against the western
 * sky sets INTO the terrain, so "aligned" is not yet "photographable".
 *
 * Flag-gated: throws unless enabled, so no caller can ship this by accident.
 */
export function enumerateHorizonGatedWindows(
  req: HorizonWindowRequest,
): HorizonGatedVantageWindow[] {
  const enabled = req.enabled ?? horizonWindowsEnabled();
  if (!enabled) {
    throw new HorizonWindowsDisabledError(
      `horizon windows are flag-gated and off; set ${HORIZON_WINDOWS_FLAG}=1 to enable`,
    );
  }
  const {
    point,
    landmark,
    map,
    bodyAt,
    bodies = ['sun', 'moon'],
    start,
    end,
    stepMinutes,
    horizonStepM = 25,
    discRadiusDeg = 0,
  } = req;

  const horizon = horizonTowardsLandmark(point, landmark, map, horizonStepM);
  const target = targetWindow(point, landmark);

  const raw = enumerateVantageWindows({
    point,
    landmark,
    bodyAt: (t, body) => bodyAt(t, body) as never,
    bodies,
    start,
    end,
    stepMinutes,
  });

  return raw.map((w) => {
    const sample = bodyAt(w.peak, w.body);
    const gate = gateDirection(
      { azimuthDeg: sample.az, altitudeDeg: sample.alt },
      target,
      horizon,
      discRadiusDeg,
    );
    return {
      body: w.body,
      start: w.start,
      end: w.end,
      peak: w.peak,
      coveredFraction: w.coveredFraction,
      peakAzimuthDeg: sample.az,
      peakAltitudeDeg: sample.alt,
      horizonAltitudeDeg: horizon.horizonAltitudeDeg,
      clearsHorizon: gate.clearsHorizon,
      horizonConfident: gate.horizonConfident,
      photographable: gate.clearsHorizon && w.coveredFraction > 0,
    };
  });
}
