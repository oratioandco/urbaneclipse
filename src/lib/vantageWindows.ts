/**
 * Vantage windows — the calendar of a fixed standing point. Pure math, NO Cesium.
 *
 * WHAT THIS ADDS TO areaSolver
 * ----------------------------
 * findOccultationsAtPosition answers "classify THIS instant at THIS observer". A
 * photographer wants the inverse view of the same computation: the YEAR's list of
 * windows from their pinned spot — "16. Mai, 19:28, Sonnenscheibe auf der Spitze" —
 * plus the honest "never" entries (mid-Oct to late Feb the sun never reaches the
 * Lichtenberger line at all).
 *
 * So this module wraps the fixed-position sweep, restores CHRONOLOGY (the sweep ranks
 * by quality and slices), merges consecutive hits into windows, and tags each window
 * with which band of the structure the disc crosses (spire / sphere / shaft / base) —
 * the difference between "sun setting on the tip" and "sun behind the concrete".
 */
import { findOccultationsAtPosition, type BodySample, type FixedCandidate } from './areaSolver.js';
import { resolveEyeEllipsoidalHeight } from './elevation.js';
import { landmarkHeight, type RevolutionLandmark } from './landmarks.js';
import type { OccultationKind } from './occultation.js';
import type { StandingPoint } from './vantages.js';

export type CelestialBody = 'sun' | 'moon';

/** Which horizontal band of the structure the disc sits in at the window's peak. */
export type StructureBand = 'spire' | 'sphere' | 'shaft' | 'base';

export interface VantageWindow {
  body: CelestialBody;
  /** First and last classified instant of the transit (scan resolution, not exact). */
  start: Date;
  end: Date;
  /** Instant of maximum coveredFraction within the window. */
  peak: Date;
  kind: OccultationKind;
  coveredFraction: number;
  /** Where on the structure the disc sat at peak. */
  band: StructureBand;
}

export interface WindowScanRequest {
  point: StandingPoint;
  landmark: RevolutionLandmark;
  /** Ephemeris adapter, body-parameterised (real: bodyPosition.sampleBody). */
  bodyAt: (t: Date, body: CelestialBody) => BodySample;
  bodies?: CelestialBody[];
  start: Date;
  end: Date;
  stepMinutes: number;
  /** Hits closer than this merge into one window. Default 30 min (transits are minutes). */
  gapMinutes?: number;
  /**
   * Default -1, NOT 0: the money shot is often the disc kissing the horizon while
   * still refracted above it (the Apr 4-7 horizon sunsets behind the shaft run at
   * apparent altitudes just above 0, geometric slightly below). suncalc's altitude is
   * already refraction-corrected, so -1 admits exactly the photographable horizon band.
   * The silhouette bounds do the real gating; nothing below the structure can overlap.
   */
  minAltitudeDeg?: number;
}

/** Altitude (deg) of a height above the landmark base as seen from the standing point. */
function altitudeOfHeightAgl(hAglM: number, landmark: RevolutionLandmark, point: StandingPoint): number {
  const eyeOrthometric = point.surfaceOrthometric + point.eyeHeightM;
  const aboveEye = hAglM + landmark.baseOrthometric - eyeOrthometric;
  return (Math.atan(aboveEye / point.distanceToLandmarkM) * 180) / Math.PI;
}

/** Which band of the landmark's profile the given apparent altitude crosses. */
export function bandAtAltitude(altDeg: number, landmark: RevolutionLandmark, point: StandingPoint): StructureBand {
  const bands: Array<[StructureBand, number, number]> = [
    // AGL metre ranges of the parametric profile: antenna tip .. Eisteller is the spire,
    // the sphere drum .. its console is the sphere, the foot flare is the base.
    ['spire', 250, landmarkHeight(landmark)],
    ['sphere', 196, 250],
    ['shaft', 20, 196],
    ['base', 0, 20],
  ];
  for (const [band, lo, hi] of bands) {
    const loAlt = altitudeOfHeightAgl(lo, landmark, point);
    const hiAlt = altitudeOfHeightAgl(hi, landmark, point);
    if (altDeg >= loAlt && altDeg <= hiAlt) return band;
  }
  // Above the tip or (numerically) below the foot: call it by nearest band edge.
  const spireTop = altitudeOfHeightAgl(landmarkHeight(landmark), landmark, point);
  return altDeg > spireTop ? 'spire' : 'base';
}

/**
 * Enumerate the alignment windows of one standing point over a time range, per body,
 * in chronological order.
 *
 * The sweep runs at `stepMinutes` resolution, so window edges and `peak` are quantised
 * to it; callers wanting minute-true peaks refine afterwards (the bisection in the
 * solver layer). Throws through to resolveEyeEllipsoidalHeight on bad surface data —
 * an unsurveyed deck must not silently scan from the wrong eye height.
 */
export function enumerateVantageWindows(req: WindowScanRequest): VantageWindow[] {
  const {
    point,
    landmark,
    bodyAt,
    bodies = ['sun', 'moon'],
    start,
    end,
    stepMinutes,
    gapMinutes = 30,
    minAltitudeDeg = -1,
  } = req;

  const observer = {
    lat: point.lat,
    lon: point.lon,
    ellipsoidalHeight: resolveEyeEllipsoidalHeight({
      surfaceOrthometric: point.surfaceOrthometric,
      eyeHeight: point.eyeHeightM,
    }),
  };

  const windows: VantageWindow[] = [];
  for (const body of bodies) {
    // limit: a year at coarse resolution cannot exhaust this; we re-sort by time below.
    const hits = findOccultationsAtPosition({
      observer,
      landmark,
      start,
      end,
      stepMinutes,
      bodyAt: (t) => bodyAt(t, body),
      wanted: ['full', 'partial'],
      minAltitudeDeg,
      limit: Number.MAX_SAFE_INTEGER,
    });
    hits.sort((a, b) => a.when.getTime() - b.when.getTime());

    let current: { list: FixedCandidate[]; last: Date } | null = null;
    const gapMs = gapMinutes * 60_000;
    for (const hit of hits) {
      if (current && hit.when.getTime() - current.last.getTime() <= gapMs) {
        current.list.push(hit);
        current.last = hit.when;
      } else {
        if (current) windows.push(finishWindow(current.list, body, landmark, point));
        current = { list: [hit], last: hit.when };
      }
    }
    if (current) windows.push(finishWindow(current.list, body, landmark, point));
  }

  return windows.sort((a, b) => a.peak.getTime() - b.peak.getTime());
}

function finishWindow(
  list: FixedCandidate[],
  body: CelestialBody,
  landmark: RevolutionLandmark,
  point: StandingPoint,
): VantageWindow {
  let best = list[0];
  for (const hit of list) {
    if (hit.coveredFraction > best.coveredFraction) best = hit;
  }
  return {
    body,
    start: list[0].when,
    end: list[list.length - 1].when,
    peak: best.when,
    kind: best.kind,
    coveredFraction: best.coveredFraction,
    band: bandAtAltitude(best.bodyAlt, landmark, point),
  };
}
