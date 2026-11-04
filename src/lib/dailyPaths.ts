/**
 * Daily eclipse paths: where to stand, through one day, so a landmark covers the sun or
 * moon. Pure math, no Cesium.
 *
 * At any instant there is one ground position from which the landmark's sphere sits on
 * the body's direction (see areaSolver.ts). Swept through a day those positions form a
 * continuous path, so the daily view draws paths rather than isolated spots.
 *
 * These paths are geometry only. They do not know what buildings stand in the way; the
 * 3D preview is what checks the view from a chosen point.
 */
import { getMoonIllumination } from 'suncalc';
import {
  evaluateCandidate,
  findOccultationsAtPosition,
  type BodySample,
  type GroundProvider,
} from './areaSolver.js';
import { sampleBody, type Body } from './bodyPosition.js';
import type { RevolutionLandmark } from './landmarks.js';
import type { OccultationKind } from './occultation.js';
import { buildSilhouetteDirections, type ObserverGeodetic } from './silhouette.js';

/** Height of the Fernsehturm sphere's centre, metres above its base. */
export const SPHERE_CENTRE_AGL = 213;
/** Below this the body sits in horizon murk and refraction dominates. */
const MIN_ALTITUDE_DEG = 1;
/** Closer than this you are looking steeply up at the tower's foot, not composing a shot. */
const MIN_DISTANCE_M = 250;
/** The edge of the terrain and building data the preview can show. */
const MAX_DISTANCE_M = 9000;
/** A moon thinner than this is too faint to read behind a tower. */
export const MIN_MOON_ILLUMINATION = 0.25;
/** A jump larger than this between samples means the path has been interrupted. */
const SEGMENT_BREAK_MS = 1.5;

export interface PathPoint {
  t: number;
  lat: number;
  lon: number;
  distanceM: number;
  /** Bearing from the landmark to this point, degrees clockwise from north. */
  bearingDeg: number;
  bodyAlt: number;
  kind: OccultationKind;
  coveredFraction: number;
  /** False when buildings hide the landmark from here. Unset until checked. */
  clear?: boolean;
}

export interface DayPath {
  body: Body;
  /** Lit fraction of the moon at midday; always 1 for the sun. */
  illumination: number;
  /** Continuous runs of points. A day can have more than one (the moon especially). */
  segments: PathPoint[][];
}

export interface DayPathRequest {
  body: Body;
  start: Date;
  end: Date;
  landmark: RevolutionLandmark;
  eyeHeight?: number;
  stepMinutes?: number;
  ground?: GroundProvider;
  featureHeightAgl?: number;
}

export function computeDayPath(req: DayPathRequest): DayPath {
  const { body, start, end, landmark } = req;
  const stepMinutes = req.stepMinutes ?? 3;
  if (!(stepMinutes > 0)) {
    throw new RangeError(`stepMinutes must be positive, received ${stepMinutes}`);
  }
  const stepMs = stepMinutes * 60_000;
  const opts = {
    landmark,
    featureHeightAgl: req.featureHeightAgl ?? SPHERE_CENTRE_AGL,
    eyeHeight: req.eyeHeight ?? 1.5,
    ground: req.ground ?? (() => undefined),
  };

  const segments: PathPoint[][] = [];
  let current: PathPoint[] | null = null;
  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    const when = new Date(t);
    const sample = sampleBody(body, when, landmark.lat, landmark.lon);
    const c = sample.alt >= MIN_ALTITUDE_DEG ? evaluateCandidate(when, sample, opts) : null;
    if (!c || c.distanceM < MIN_DISTANCE_M || c.distanceM > MAX_DISTANCE_M) {
      current = null;
      continue;
    }
    const point: PathPoint = {
      t,
      lat: c.position.lat,
      lon: c.position.lon,
      distanceM: c.distanceM,
      bearingDeg: (sample.az + 180) % 360,
      bodyAlt: sample.alt,
      kind: c.kind,
      coveredFraction: c.coveredFraction,
    };
    if (current && t - current[current.length - 1].t <= stepMs * SEGMENT_BREAK_MS) {
      current.push(point);
    } else {
      current = [point];
      segments.push(current);
    }
  }

  const midday = new Date((start.getTime() + end.getTime()) / 2);
  return {
    body,
    illumination: body === 'moon' ? getMoonIllumination(midday).fraction : 1,
    segments,
  };
}

/** The path point nearest a given instant, or undefined if the path is not active then. */
export function pointAtTime(path: DayPath, t: number, toleranceMs = 3 * 60_000): PathPoint | undefined {
  let best: PathPoint | undefined;
  let bestDelta = Infinity;
  for (const segment of path.segments) {
    for (const p of segment) {
      const delta = Math.abs(p.t - t);
      if (delta < bestDelta) {
        best = p;
        bestDelta = delta;
      }
    }
  }
  return bestDelta <= toleranceMs ? best : undefined;
}

/**
 * The shots worth surfacing for a day: where each run of the path meets the horizon end
 * of its arc. A low body gives the long, photogenic light and the longest reach from the
 * tower. The moon is left out when it is too thin to read.
 */
export function dayHighlights(path: DayPath, maxAltitudeDeg = 12): PathPoint[] {
  if (path.body === 'moon' && path.illumination < MIN_MOON_ILLUMINATION) return [];
  const usable = (p: PathPoint) => p.bodyAlt >= 2 && p.bodyAlt <= maxAltitudeDeg && p.clear !== false;
  const out: PathPoint[] = [];
  for (const segment of path.segments) {
    const midpoint = segment[Math.floor(segment.length / 2)]?.t ?? 0;
    for (const half of [segment.filter((p) => p.t <= midpoint), segment.filter((p) => p.t > midpoint)]) {
      const low = half.filter(usable);
      if (low.length === 0) continue;
      // Lowest usable light first; among those, the most covered disc.
      const pick = low.reduce((a, b) => {
        const score = (p: PathPoint) => p.coveredFraction * 40 - p.bodyAlt;
        return score(b) > score(a) ? b : a;
      });
      out.push(pick);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface SpotEvent {
  body: Body;
  start: number;
  end: number;
  /** Instant of greatest coverage. */
  peak: number;
  kind: OccultationKind;
  coveredFraction: number;
  bodyAlt: number;
  bodyAz: number;
}

/** Fine enough to catch a gap between buildings: about 10 m of path near the tower. */
const VIEW_STEP_MS = 15_000;
/** A clear stretch shorter than this is a chink between buildings, not a place to shoot. */
const MIN_CLEAR_MS = 45_000;

function interpolate(a: PathPoint, b: PathPoint, f: number): PathPoint {
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    t: Math.round(mix(a.t, b.t)),
    lat: mix(a.lat, b.lat),
    lon: mix(a.lon, b.lon),
    distanceM: mix(a.distanceM, b.distanceM),
    bearingDeg: mix(a.bearingDeg, b.bearingDeg),
    bodyAlt: mix(a.bodyAlt, b.bodyAlt),
    kind: f < 0.5 ? a.kind : b.kind,
    coveredFraction: mix(a.coveredFraction, b.coveredFraction),
  };
}

/**
 * Check a path against what can be seen from it. Samples more finely than the solved
 * points, since a street crossing the path can be narrower than a solved step, then marks
 * each point clear or not. `isClear` is a function so this stays free of the data format.
 */
export function applyView(path: DayPath, isClear: (lat: number, lon: number) => boolean): DayPath {
  const segments = path.segments.map((segment) => {
    const dense: PathPoint[] = [];
    segment.forEach((point, i) => {
      const next = segment[i + 1];
      const steps = next ? Math.max(1, Math.round((next.t - point.t) / VIEW_STEP_MS)) : 1;
      for (let k = 0; k < steps; k++) {
        const p = next ? interpolate(point, next, k / steps) : { ...point };
        p.clear = isClear(p.lat, p.lon);
        dense.push(p);
      }
    });
    // Too short to use: treat as blocked, so a chink is never offered as a shot.
    let start = 0;
    while (start < dense.length) {
      let end = start;
      while (end + 1 < dense.length && dense[end + 1].clear === dense[start].clear) end++;
      if (dense[start].clear && dense[end].t - dense[start].t < MIN_CLEAR_MS) {
        for (let i = start; i <= end; i++) dense[i].clear = false;
      }
      start = end + 1;
    }
    return dense;
  });
  return { ...path, segments };
}

/** The next moment at or after `t` with a clear view, or undefined if none remains today. */
export function nextClearPoint(path: DayPath, t: number): PathPoint | undefined {
  let best: PathPoint | undefined;
  for (const segment of path.segments) {
    for (const p of segment) {
      if (p.clear !== false && p.t >= t && (!best || p.t < best.t)) best = p;
    }
  }
  return best;
}

/** Separate passes are hours apart; anything closer is one pass with a gap in sampling. */
const EVENT_GAP_MS = 30 * 60_000;

/** Full cover can last under a minute, so the sweep's own samples can step right over it. */
const PEAK_SEARCH_MS = 90_000;
const PEAK_STEP_SECONDS = 5;

function refinePeak(
  event: SpotEvent,
  observer: ObserverGeodetic,
  landmark: RevolutionLandmark,
  bodyAt: (t: Date) => BodySample,
): void {
  const [best] = findOccultationsAtPosition({
    observer,
    landmark,
    start: new Date(event.peak - PEAK_SEARCH_MS),
    end: new Date(event.peak + PEAK_SEARCH_MS),
    stepMinutes: PEAK_STEP_SECONDS / 60,
    bodyAt,
    wanted: ['full', 'partial'],
    minAltitudeDeg: MIN_ALTITUDE_DEG,
  });
  if (!best) return;
  const t = best.when.getTime();
  // Results come back ranked: full cover first, then by coverage.
  event.peak = t;
  event.kind = best.kind;
  event.coveredFraction = best.coveredFraction;
  event.bodyAlt = best.bodyAlt;
  event.bodyAz = best.bodyAz;
}

/** Coarse scan interval. The body moves at most ~5 deg of azimuth and ~2 deg of altitude in this time. */
const SCAN_STEP_MS = 10 * 60_000;
const SCAN_MARGIN_AZ_DEG = 6;
const SCAN_MARGIN_ALT_DEG = 3;

/**
 * Stretches of time when the body is anywhere near the landmark. Sampling the body is
 * the expensive part of a year-long sweep, and it is nowhere near the landmark almost
 * all of the time, so only these stretches get examined minute by minute.
 */
function candidateWindows(
  observer: ObserverGeodetic,
  landmark: RevolutionLandmark,
  bodyAt: (t: Date) => BodySample,
  start: Date,
  end: Date,
): Array<[Date, Date]> {
  const { outline, bounds } = buildSilhouetteDirections(observer, landmark);
  if (outline.length < 3) return [];
  const azMid = (bounds.azMin + bounds.azMax) / 2;
  const azHalf = (bounds.azMax - bounds.azMin) / 2 + SCAN_MARGIN_AZ_DEG;

  const windows: Array<[number, number]> = [];
  for (let t = start.getTime(); t <= end.getTime(); t += SCAN_STEP_MS) {
    const { az, alt } = bodyAt(new Date(t));
    let dAz = Math.abs(az - azMid);
    if (dAz > 180) dAz = 360 - dAz;
    const near =
      dAz <= azHalf &&
      alt >= bounds.altMin - SCAN_MARGIN_ALT_DEG &&
      alt <= bounds.altMax + SCAN_MARGIN_ALT_DEG;
    if (!near) continue;
    const from = Math.max(start.getTime(), t - SCAN_STEP_MS);
    const to = Math.min(end.getTime(), t + SCAN_STEP_MS);
    const last = windows[windows.length - 1];
    if (last && from <= last[1]) last[1] = to;
    else windows.push([from, to]);
  }
  return windows.map(([a, b]) => [new Date(a), new Date(b)]);
}

/** Every pass of a body behind the landmark from a fixed position, soonest first. */
export function findSpotEvents(req: {
  observer: ObserverGeodetic;
  landmark: RevolutionLandmark;
  body: Body;
  start: Date;
  end: Date;
  stepMinutes?: number;
}): SpotEvent[] {
  const { observer, landmark, body, start, end } = req;
  const stepMinutes = req.stepMinutes ?? 1;
  const bodyAt = (t: Date) => sampleBody(body, t, observer.lat, observer.lon);
  const hits = candidateWindows(observer, landmark, bodyAt, start, end)
    .flatMap(([from, to]) =>
      findOccultationsAtPosition({
        observer,
        landmark,
        start: from,
        end: to,
        stepMinutes,
        bodyAt,
        wanted: ['full', 'partial'],
        minAltitudeDeg: MIN_ALTITUDE_DEG,
        limit: Number.MAX_SAFE_INTEGER,
      }),
    )
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  const events: SpotEvent[] = [];
  for (const hit of hits) {
    const t = hit.when.getTime();
    const last = events[events.length - 1];
    if (last && t - last.end <= EVENT_GAP_MS) {
      last.end = t;
      const better = hit.kind === 'full' && last.kind !== 'full';
      if (better || hit.coveredFraction > last.coveredFraction) {
        last.peak = t;
        last.coveredFraction = hit.coveredFraction;
        last.bodyAlt = hit.bodyAlt;
        last.bodyAz = hit.bodyAz;
        last.kind = hit.kind === 'full' ? 'full' : last.kind;
      }
    } else {
      events.push({
        body,
        start: t,
        end: t,
        peak: t,
        kind: hit.kind,
        coveredFraction: hit.coveredFraction,
        bodyAlt: hit.bodyAlt,
        bodyAz: hit.bodyAz,
      });
    }
  }
  for (const event of events) refinePeak(event, observer, landmark, bodyAt);
  if (body !== 'moon') return events;
  return events.filter((e) => getMoonIllumination(new Date(e.peak)).fraction >= MIN_MOON_ILLUMINATION);
}

/** Compass point for a bearing, e.g. 112 -> "ESE". */
export function compassPoint(bearingDeg: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16;
  return points[i];
}
