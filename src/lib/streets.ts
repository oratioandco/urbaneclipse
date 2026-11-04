/**
 * Streets that frame the sun or moon along their axis. Pure, no Cesium.
 *
 * Built offline by scripts/build_streets.py. Each entry is one viewing direction: stand at
 * `from` and look toward `to`. The match is against the street's direction and its skyline,
 * so it knows nothing about trees.
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody, type Body } from './bodyPosition.js';
import { MIN_MOON_ILLUMINATION } from './dailyPaths.js';

export interface StreetView {
  name: string;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  lengthM: number;
  bearingDeg: number;
  /** How high the skyline stands along the street, degrees. */
  skylineDeg: number;
  /** How far the disc can sit off the axis and still be in the street's gap, degrees. */
  toleranceDeg: number;
}

/** The disc has to clear the skyline fully. */
const MIN_ABOVE_SKYLINE_DEG = 0.3;
/** Higher than this and it stops reading as a sun at the end of the street. */
const MAX_ABOVE_SKYLINE_DEG = 4;
/** Above any street's possible range, so most of the day can be skipped. */
const MAX_LOW_ALTITUDE_DEG = 12;

export interface StreetsDocument {
  format: string;
  version: number;
  views: Array<[string, number, number, number, number, number, number, number, number]>;
}

export function decodeStreets(doc: StreetsDocument): StreetView[] {
  if (doc.format !== 'urban-eclipse-streets' || doc.version !== 1) {
    throw new Error(`unexpected streets format ${doc.format} v${doc.version}`);
  }
  return doc.views.map(([name, fromLat, fromLon, toLat, toLon, lengthM, bearingDeg, skylineDeg, toleranceDeg]) => ({
    name,
    from: { lat: fromLat, lon: fromLon },
    to: { lat: toLat, lon: toLon },
    lengthM,
    bearingDeg,
    skylineDeg,
    toleranceDeg,
  }));
}

let loading: Promise<StreetView[]> | null = null;

/** Fetch once and share. A failure clears the cache so a later attempt can succeed. */
export function loadStreets(): Promise<StreetView[]> {
  loading ??= (async () => {
    const response = await fetch('/streets/berlin.json');
    if (!response.ok) throw new Error(`streets: HTTP ${response.status}`);
    return decodeStreets((await response.json()) as StreetsDocument);
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

function offAxis(view: Pick<StreetView, 'bearingDeg'>, az: number): number {
  const d = Math.abs(az - view.bearingDeg) % 360;
  return d > 180 ? 360 - d : d;
}

/** Whether a body at this direction sits in the street's gap, just above its skyline. */
export function inStreetGap(
  view: Pick<StreetView, 'bearingDeg' | 'skylineDeg' | 'toleranceDeg'>,
  az: number,
  alt: number,
): boolean {
  return (
    offAxis(view, az) <= view.toleranceDeg &&
    alt >= view.skylineDeg + MIN_ABOVE_SKYLINE_DEG &&
    alt <= view.skylineDeg + MAX_ABOVE_SKYLINE_DEG
  );
}

export interface StreetMoment {
  view: StreetView;
  body: Body;
  from: number;
  to: number;
  /** When the disc is closest to the street's axis. */
  peak: number;
  bodyAz: number;
  bodyAlt: number;
}

const litEnough = (body: Body, t: number): boolean =>
  body === 'sun' || getMoonIllumination(new Date(t)).fraction >= MIN_MOON_ILLUMINATION;

/**
 * Each street's moment on one day, for one body. Directions barely change across the city
 * at these distances, so one position stands in for all of them.
 */
export function streetMoments(
  views: readonly StreetView[],
  body: Body,
  start: number,
  end: number,
  lat: number,
  lon: number,
  stepMs = 60_000,
): StreetMoment[] {
  const open = new Map<StreetView, StreetMoment>();
  const closest = new Map<StreetView, number>();
  for (let t = start; t < end; t += stepMs) {
    const { az, alt } = sampleBody(body, new Date(t), lat, lon);
    if (alt < 0 || alt > MAX_LOW_ALTITUDE_DEG || !litEnough(body, t)) continue;
    for (const view of views) {
      if (!inStreetGap(view, az, alt)) continue;
      const off = offAxis(view, az);
      const moment = open.get(view);
      if (!moment) {
        open.set(view, { view, body, from: t, to: t, peak: t, bodyAz: az, bodyAlt: alt });
        closest.set(view, off);
      } else {
        moment.to = t;
        if (off < (closest.get(view) as number)) {
          closest.set(view, off);
          moment.peak = t;
          moment.bodyAz = az;
          moment.bodyAlt = alt;
        }
      }
    }
  }
  return [...open.values()];
}

export interface StreetPass {
  body: Body;
  peak: number;
  bodyAz: number;
  bodyAlt: number;
  offAxisDeg: number;
}

/** Coarse scan interval, with the margin the body can move within it. */
const SCAN_STEP_MS = 10 * 60_000;
const SCAN_MARGIN_DEG = 3.5;
const DAY_MS = 86_400_000;

/** One street direction's passes across a stretch of time, soonest first, at most one a day. */
export function findStreetPasses(
  view: Pick<StreetView, 'bearingDeg' | 'skylineDeg' | 'toleranceDeg' | 'from'>,
  body: Body,
  start: number,
  end: number,
): StreetPass[] {
  const { lat, lon } = view.from;
  const best = new Map<number, StreetPass>();
  for (let t = start; t < end; t += SCAN_STEP_MS) {
    const coarse = sampleBody(body, new Date(t), lat, lon);
    if (coarse.alt < -2 || coarse.alt > MAX_LOW_ALTITUDE_DEG + 2) continue;
    if (offAxis(view, coarse.az) > view.toleranceDeg + SCAN_MARGIN_DEG) continue;
    for (let u = t - SCAN_STEP_MS; u <= t + SCAN_STEP_MS; u += 60_000) {
      if (u < start || u >= end) continue;
      const { az, alt } = sampleBody(body, new Date(u), lat, lon);
      if (!inStreetGap(view, az, alt) || !litEnough(body, u)) continue;
      const off = offAxis(view, az);
      const day = Math.floor(u / DAY_MS);
      const current = best.get(day);
      if (!current || off < current.offAxisDeg) {
        best.set(day, { body, peak: u, bodyAz: az, bodyAlt: alt, offAxisDeg: off });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.peak - b.peak);
}
