/**
 * US5 solver worker — Vite ESM module worker.
 *
 * Spawned from src/components/react/SolverSearch.tsx via
 *   new Worker(new URL('../workers/solver.worker.ts', import.meta.url), {type:'module'})
 *
 * Lives OUTSIDE the SSR graph (Constitution Principle I) — workers never load on the
 * server. The worker is the only place outside tests where suncalc is allowed to be
 * called from a hot loop: it cannot block the React render thread, and a chunked
 * iteration with setTimeout(0) yields between chunks keeps the worker responsive to
 * `cancel` messages and posts progress updates without freezing the page.
 *
 * Input message shape (see SolverSearch.tsx for the message builder):
 *   { kind:'start', start:Date, end:Date, body:'sun'|'moon',
 *     target:{az:number, alt:number},  // degrees, az north-referenced clockwise
 *     toleranceDeg:number, lat:number, lon:number, stepMin?:number }
 *   { kind:'cancel' }
 *
 * Output message shape:
 *   { kind:'progress', progress:number }               // 0..1
 *   { kind:'result', matches:Date[] }                  // incremental alignment list
 *   { kind:'done', matches:Date[] }                    // final list + terminal signal
 *   { kind:'error', message:string }
 *
 * Angle convention (suncalc 2.0.1): getPosition/getMoonPosition return DEGREES with
 * azimuth north-referenced clockwise (0=N, 90=E, 180=S, 270=W) and altitude in degrees.
 * `target` is in the same convention. findAlignments/angularDistanceDeg treat both
 * arguments consistently, so the spherical distance is well-defined regardless of
 * which azimuth reference is used — but feeding the SAME convention (degrees, north)
 * on both sides guarantees the angular tolerance is interpreted correctly.
 */
import { getPosition, getMoonPosition } from 'suncalc';
import {
  generateMinuteSteps,
  findAlignments,
  type CelestialBody,
  type PositionProvider,
} from '../lib/solver.js';

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface StartMessage {
  kind: 'start';
  start: Date;
  end: Date;
  body: CelestialBody;
  target: { az: number; alt: number };
  toleranceDeg: number;
  lat: number;
  lon: number;
  stepMin?: number;
}
interface CancelMessage {
  kind: 'cancel';
}
type Inbox = StartMessage | CancelMessage;

// Chunk size: each chunk processes this many steps synchronously, then yields via
// setTimeout(0). 5_000 minute-steps per chunk ≈ 5ms of suncalc calls on a modern
// machine — well under a frame, keeps the worker's message queue drained.
const CHUNK_SIZE = 5000;

let cancelled = false;

/** suncalc adapter: returns the body's horizontal direction in (degrees, north). */
function makeProvider(lat: number, lon: number): PositionProvider {
  return (date: Date, body: CelestialBody) => {
    if (body === 'moon') {
      const p = getMoonPosition(date, lat, lon);
      return { az: p.azimuth, alt: p.altitude };
    }
    const p = getPosition(date, lat, lon);
    return { az: p.azimuth, alt: p.altitude };
  };
}

async function runSearch(msg: StartMessage): Promise<void> {
  cancelled = false;
  const { start, end, body, target, toleranceDeg, lat, lon, stepMin } = msg;
  const provider = makeProvider(lat, lon);

  // Generate ALL minute steps up front (cheap: pure integer iteration, no suncalc yet).
  // For a 30-day window at 1min resolution this is 43_200 Date objects (~1.4 MB) — fine.
  const steps = generateMinuteSteps(start, end, stepMin ?? 1);
  const total = steps.length;
  if (total === 0) {
    self.postMessage({ kind: 'done', matches: [] });
    return;
  }

  const allMatches: Date[] = [];
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    if (cancelled) return; // silent teardown; SolverSearch handles UI state
    const chunk = steps.slice(i, i + CHUNK_SIZE);
    const found = findAlignments(chunk, body, target, toleranceDeg, provider);
    for (const a of found) allMatches.push(a.date);

    const progress = Math.min(1, (i + chunk.length) / total);
    self.postMessage({ kind: 'progress', progress });
    // Incremental result: lets the UI show matches as they stream in. Cheap because
    // we only emit the NEW slice; SolverSearch concatenates.
    self.postMessage({ kind: 'result', matches: found.map((a) => a.date) });

    // Yield to the event loop so cancel messages can interleave and the main thread
    // gets a turn. setTimeout(0) is the portable ESM-worker yield (no requestIdleCallback
    // inside a classic DedicatedWorkerGlobalScope).
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (cancelled) return;
  self.postMessage({ kind: 'done', matches: allMatches });
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
