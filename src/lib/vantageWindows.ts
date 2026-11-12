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
import {
  classifyAtInstant,
  findOccultationsAtPosition,
  type BodySample,
  type FixedCandidate,
} from './areaSolver.js';
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
  /**
   * Refine each window's peak past the scan's stepMinutes with a golden-section search
   * on coveredFraction (classifyAtInstant, ~2 dozen evals per window). Costs a few
   * hundred single-instant classifications per year — noise next to the sweep itself —
   * and buys minute-true shot times. Default false: the coarse sweep's contract is
   * unchanged for existing callers.
   */
  refinePeaks?: boolean;
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
 * The sweep runs at `stepMinutes` resolution, so window edges stay quantised to it;
 * set `refinePeaks` for minute-true `peak` instants (golden-section search via
 * classifyAtInstant). Throws through to resolveEyeEllipsoidalHeight on bad surface
 * data — an unsurveyed deck must not silently scan from the wrong eye height.
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
    refinePeaks = false,
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

    const before = windows.length;
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

    if (refinePeaks) {
      const classify = (t: Date): FixedCandidate | null =>
        classifyAtInstant(
          {
            observer,
            landmark,
            bodyAt: (t2) => bodyAt(t2, body),
            wanted: ['full', 'partial'],
            minAltitudeDeg,
          },
          t,
        );
      for (let i = before; i < windows.length; i++) {
        windows[i] = refineWindowPeak(windows[i]!, classify, landmark, point, stepMinutes);
      }
    }
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

/**
 * Sharpen a scan-quantised window peak to a true coveredFraction maximum.
 *
 * Golden-section search within ±stepMinutes of the coarse peak. The coverage curve of a
 * transit is smooth and single-humped between the sweep's samples, but the classifier
 * returns null (read as 0) at instants with no composition, so the search is guarded:
 * the best REAL candidate seen anywhere — the sweep's own hit included — is what gets
 * returned. A plateau of zeros can wander the bracket; it can never worsen the result.
 */
function refineWindowPeak(
  win: VantageWindow,
  classify: (t: Date) => FixedCandidate | null,
  landmark: RevolutionLandmark,
  point: StandingPoint,
  stepMinutes: number,
): VantageWindow {
  const bracketMs = stepMinutes * 60_000;
  const PHI = (Math.sqrt(5) - 1) / 2;

  let best = { t: win.peak.getTime(), candidate: null as FixedCandidate | null };
  const probe = (tMs: number): number => {
    const candidate = classify(new Date(tMs));
    if (candidate && candidate.coveredFraction > (best.candidate?.coveredFraction ?? win.coveredFraction)) {
      best = { t: tMs, candidate };
    }
    return candidate?.coveredFraction ?? 0;
  };

  let lo = win.peak.getTime() - bracketMs;
  let hi = win.peak.getTime() + bracketMs;
  let a = hi - PHI * (hi - lo);
  let b = lo + PHI * (hi - lo);
  let fa = probe(a);
  let fb = probe(b);
  for (let i = 0; i < 24; i++) {
    if (fa >= fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - PHI * (hi - lo);
      fa = probe(a);
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + PHI * (hi - lo);
      fb = probe(b);
    }
  }

  if (!best.candidate) return win; // No classifier hit anywhere probed: keep the sweep's own.
  const candidate = best.candidate;
  return {
    ...win,
    peak: new Date(best.t),
    kind: candidate.kind,
    coveredFraction: candidate.coveredFraction,
    band: bandAtAltitude(candidate.bodyAlt, landmark, point),
  };
}
