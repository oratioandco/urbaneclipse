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
import { createInstantClassifier, type BodySample, type FixedCandidate } from './areaSolver.js';
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
  /**
   * COARSE gate step. The sweep samples the body every `stepMinutes` only to find the
   * intervals where it could be near the landmark (azimuth crossing or inside the
   * silhouette's padded bounds, at a matching altitude); those intervals are then
   * classified at `fineStepSeconds`. A transit from 6 km lasts ~2-3 min, so the coarse
   * step alone would miss about half of them — it must never decide detection.
   */
  stepMinutes: number;
  /**
   * Detection resolution inside gated intervals. Default 30 s: a window shorter than
   * this can be missed, anything longer cannot. Both grids are anchored to the Unix
   * epoch, NOT to `start`, so the result does not depend on the second you press go.
   */
  fineStepSeconds?: number;
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
 * Detection runs at `fineStepSeconds` inside intervals gated by a `stepMinutes`
 * coarse sweep, so window edges are quantised to the fine step; set `refinePeaks`
 * for second-true `peak` instants (golden-section search on the same classifier). Throws through to resolveEyeEllipsoidalHeight on bad surface
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
    fineStepSeconds = 30,
    gapMinutes = 30,
    minAltitudeDeg = -1,
    refinePeaks = false,
  } = req;

  const observer = {
    lat: point.lat,
    lon: point.lon,
    ellipsoidalHeight: resolveEyeEllipsoidalHeight({
      groundOrthometric: undefined, // the surveyed deck overrides terrain
      surfaceOrthometric: point.surfaceOrthometric,
      eyeHeight: point.eyeHeightM,
    }),
  };

  const windows: VantageWindow[] = [];
  for (const body of bodies) {
    const classifier = createInstantClassifier({
      observer,
      landmark,
      bodyAt: (t) => bodyAt(t, body),
      wanted: ['full', 'partial'],
      minAltitudeDeg,
    });
    if (!classifier) continue;

    const hits = gatedSweep({
      classify: classifier.classify,
      bounds: classifier.bounds,
      sample: (t) => bodyAt(t, body),
      startMs: start.getTime(),
      endMs: end.getTime(),
      coarseMs: stepMinutes * 60_000,
      fineMs: fineStepSeconds * 1000,
      minAltitudeDeg,
    });

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
      for (let i = before; i < windows.length; i++) {
        windows[i] = refineWindowPeak(windows[i]!, classifier.classify, landmark, point, fineStepSeconds * 1000);
      }
    }
  }

  return windows.sort((a, b) => a.peak.getTime() - b.peak.getTime());
}

/**
 * Coarse-gated fine sweep. Samples the body on an epoch-anchored coarse grid; for every
 * coarse interval in which the body could touch the silhouette's padded bounds, it
 * classifies the interval on an epoch-anchored fine grid. Returns hits in time order.
 *
 * Gate: azimuth relative to the bounds' centre either changes sign across the interval
 * (a crossing, however fast) or comes within the padded half-width at an endpoint; and
 * the endpoints' altitude span, padded for curvature of the track within one interval,
 * overlaps the padded altitude bounds. The padding (2 deg, matching the classifier's own
 * reject margin, plus 1 deg) is far wider than any disc, so the gate can only add work,
 * never drop a window the fine grid would find.
 */
function gatedSweep(o: {
  classify: (t: Date) => FixedCandidate | null;
  bounds: { azMin: number; azMax: number; altMin: number; altMax: number };
  sample: (t: Date) => BodySample;
  startMs: number;
  endMs: number;
  coarseMs: number;
  fineMs: number;
  minAltitudeDeg: number;
}): FixedCandidate[] {
  const { classify, bounds, sample, startMs, endMs, coarseMs, fineMs, minAltitudeDeg } = o;
  if (!(coarseMs > 0)) throw new RangeError(`stepMinutes must be positive, received ${coarseMs / 60_000}`);
  if (!(fineMs > 0)) throw new RangeError(`fineStepSeconds must be positive, received ${fineMs / 1000}`);
  if (endMs < startMs) throw new RangeError('end must not precede start');

  const PAD_DEG = 3;
  const azCentre = (bounds.azMin + bounds.azMax) / 2;
  const azHalf = (bounds.azMax - bounds.azMin) / 2 + PAD_DEG;
  const altLo = Math.max(bounds.altMin - PAD_DEG, minAltitudeDeg - PAD_DEG);
  const altHi = bounds.altMax + PAD_DEG;
  const dAz = (az: number): number => {
    let d = (az - azCentre) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
  };

  const out: FixedCandidate[] = [];
  let lastFine = -Infinity; // fine instants already classified (intervals share edges)
  const scanFine = (fromMs: number, toMs: number): void => {
    const lo = Math.max(fromMs, startMs);
    const hi = Math.min(toMs, endMs);
    for (let t = Math.ceil(lo / fineMs) * fineMs; t <= hi; t += fineMs) {
      if (t <= lastFine) continue;
      lastFine = t;
      const c = classify(new Date(t));
      if (c) out.push(c);
    }
  };

  let tPrev = Math.floor(startMs / coarseMs) * coarseMs;
  let sPrev = sample(new Date(tPrev));
  while (tPrev < endMs) {
    const t = tPrev + coarseMs;
    const s = sample(new Date(t));
    const d0 = dAz(sPrev.az);
    const d1 = dAz(s.az);
    const crosses = Math.sign(d0) !== Math.sign(d1) && Math.abs(d0) + Math.abs(d1) < 180;
    const near = Math.abs(d0) <= azHalf || Math.abs(d1) <= azHalf;
    const altOk = Math.max(sPrev.alt, s.alt) >= altLo && Math.min(sPrev.alt, s.alt) <= altHi;
    if ((crosses || near) && altOk) scanFine(tPrev, t);
    tPrev = t;
    sPrev = s;
  }
  return out;
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
 * Golden-section search within ±one fine step of the scanned peak. The coverage curve of a
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
  bracketMs: number,
): VantageWindow {
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
