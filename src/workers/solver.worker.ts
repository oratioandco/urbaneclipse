/**
 * Urban-eclipse solver worker.
 *
 * Sweeps time at a FIXED observer position and classifies how the landmark's silhouette
 * occults the sun/moon disc, streaming results back to SolverSearch.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This used to match on "body bearing within +/-0.5 deg of the target bearing". At the moon's
 * 0.52 deg angular width that only means "within roughly one lunar diameter" — it finds
 * near misses, not compositions, and cannot distinguish fully-behind from
 * beside-the-tower. It now builds the real silhouette and measures the disc's covered
 * AREA, classifying full / partial / adjacent.
 *
 * PERFORMANCE
 * -----------
 * The observer is fixed, so the landmark's absolute outline is constant over the whole
 * sweep; findOccultationsAtPosition computes the geodetic part once and pre-rejects
 * instants outside the landmark's angular bounds. A full YEAR at 1-minute resolution
 * (525 600 steps) runs in ~300 ms, so the search is chunked purely to keep the worker
 * responsive to cancellation, not because it is slow.
 *
 * ANGLE CONVENTION (suncalc 2.0.1, verified against its typings): DEGREES, azimuth
 * north-based clockwise, altitude refraction-corrected. Handled in lib/bodyPosition.ts.
 */
import { sampleBody, type Body } from '../lib/bodyPosition.js';
import {
  findOccultationsAtPosition,
  findCompositions,
  circleToPolygon,
  type FixedCandidate,
  type Candidate,
} from '../lib/areaSolver.js';
import {
  createHeightmap,
  sampleGroundOrthometric,
  type HeightmapHeader,
} from '../lib/heightmap.js';
import { FERNSEHTURM, type RevolutionLandmark } from '../lib/landmarks.js';
import type { ObserverGeodetic } from '../lib/silhouette.js';
import type { OccultationKind } from '../lib/occultation.js';

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface StartMessage {
  kind: 'start';
  /** 'fixed' sweeps time at the observer; 'area' also SOLVES where to stand. */
  mode?: 'fixed' | 'area';
  body: Body;
  start: Date | string;
  end: Date | string;
  stepMin?: number;
  observer: ObserverGeodetic;
  /** Landmark id; only the Fernsehturm is modelled parametrically so far. */
  landmarkId?: string;
  wanted?: OccultationKind[];
  minAltitudeDeg?: number;
  limit?: number;
  /** Area mode: reachable camera area, and the aim point up the landmark. */
  area?: { center: { lat: number; lon: number }; radiusM: number };
  featureHeightAgl?: number;
  eyeHeight?: number;
  /**
   * DGM1 grid, transferred from the main thread so solved positions use REAL ground.
   * Without it every solved position falls back to the Berlin mean, and at ~6 km a
   * few metres of elevation error is already comparable to the 0.05 deg tolerance.
   */
  heightmap?: { header: HeightmapHeader; samples: Int16Array };
}
interface CancelMessage {
  kind: 'cancel';
}
type Inbox = StartMessage | CancelMessage;

const LANDMARKS: Record<string, RevolutionLandmark> = {
  fernsehturm: FERNSEHTURM,
};

/** Days of the window handled per chunk before yielding to the message queue. */
const CHUNK_DAYS = 30;

let cancelled = false;

/** Structured-clone turns Dates into Dates, but a string survives postMessage too. */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

async function runSearch(msg: StartMessage): Promise<void> {
  cancelled = false;

  const landmark = LANDMARKS[msg.landmarkId ?? 'fernsehturm'];
  if (!landmark) {
    self.postMessage({ kind: 'error', message: `unknown landmark '${msg.landmarkId}'` });
    return;
  }

  const start = toDate(msg.start);
  const end = toDate(msg.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    self.postMessage({ kind: 'error', message: 'invalid search window' });
    return;
  }
  if (end.getTime() < start.getTime()) {
    self.postMessage({ kind: 'error', message: 'search window ends before it starts' });
    return;
  }

  const stepMinutes = msg.stepMin ?? 1;
  const totalMs = end.getTime() - start.getTime();
  const chunkMs = CHUNK_DAYS * 86_400_000;

  // Area mode solves a POSITION per instant, so it needs ground elevation there.
  let ground: (p: { lat: number; lon: number }) => number | undefined = () => undefined;
  if (msg.heightmap) {
    try {
      const map = createHeightmap(msg.heightmap.header, msg.heightmap.samples);
      ground = (p) => sampleGroundOrthometric(map, p.lat, p.lon);
    } catch (e) {
      // A bad grid must not silently degrade accuracy without saying so.
      self.postMessage({
        kind: 'error',
        message: `heightmap rejected: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
  }

  if (msg.mode === 'area') {
    if (!msg.area) {
      self.postMessage({ kind: 'error', message: 'area mode requires an area' });
      return;
    }
    const polygon = circleToPolygon(msg.area.center, msg.area.radiusM);
    const found: Candidate[] = findCompositions({
      landmark,
      featureHeightAgl: msg.featureHeightAgl ?? 213,
      eyeHeight: msg.eyeHeight ?? 1.5,
      ground,
      area: polygon,
      start,
      end,
      stepMinutes,
      bodyAt: (t) => sampleBody(msg.body, t, msg.area!.center.lat, msg.area!.center.lon),
      wanted: msg.wanted ?? ['full', 'partial'],
      // Report near misses too: "no position inside your area works, but here is where
      // it does" is far more useful than an empty list.
      requireWithinArea: false,
      limit: msg.limit ?? 200,
    });

    self.postMessage({ kind: 'progress', progress: 1 });
    self.postMessage({ kind: 'done', mode: 'area', matches: found });
    return;
  }

  const all: FixedCandidate[] = [];

  for (let from = start.getTime(); from <= end.getTime(); from += chunkMs) {
    if (cancelled) return; // silent teardown; SolverSearch owns the UI state

    const to = Math.min(from + chunkMs, end.getTime());

    let found: FixedCandidate[];
    try {
      found = findOccultationsAtPosition({
        observer: msg.observer,
        landmark,
        start: new Date(from),
        end: new Date(to),
        stepMinutes,
        bodyAt: (t) => sampleBody(msg.body, t, msg.observer.lat, msg.observer.lon),
        wanted: msg.wanted ?? ['full', 'partial'],
        minAltitudeDeg: msg.minAltitudeDeg ?? 0,
        limit: msg.limit ?? 200,
      });
    } catch (e: unknown) {
      self.postMessage({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    all.push(...found);

    self.postMessage({
      kind: 'progress',
      progress: totalMs === 0 ? 1 : Math.min(1, (to - start.getTime()) / totalMs),
    });
    // Incremental: let the UI show hits as they stream in.
    self.postMessage({ kind: 'result', matches: found });

    // Yield so a cancel message can interleave.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (cancelled) return;

  // Re-rank across chunks: each chunk ranked only within itself.
  const rank = (k: OccultationKind) => (k === 'full' ? 2 : k === 'partial' ? 1 : 0);
  all.sort((a, b) => {
    const d = rank(b.kind) - rank(a.kind);
    if (d !== 0) return d;
    if (b.coveredFraction !== a.coveredFraction) return b.coveredFraction - a.coveredFraction;
    return a.separationDeg - b.separationDeg;
  });

  self.postMessage({ kind: 'done', matches: all.slice(0, msg.limit ?? 200) });
}

self.onmessage = (ev: MessageEvent<Inbox>): void => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.kind === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.kind === 'start') {
    try {
      void runSearch(msg);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      self.postMessage({ kind: 'error', message });
    }
  }
};
