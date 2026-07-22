/**
 * SolverSearch — US5 — spawns the solver worker and shows progress + matches.
 *
 * HARDCODED search parameters (per spec — UI for tweaking them is a later story):
 *   body      : 'moon'
 *   target    : Fernsehturm azimuth/altitude AS SEEN FROM the observer
 *               - azimuth   = greatCircleBearing(observer,target)  // already 0=N cw
 *               - altitude  = atan2(targetH - observerH, surfaceDistance) in degrees
 *   start     : now
 *   end       : now + 30 days
 *   tolerance : 0.5 deg
 *
 * The worker is constructed via the canonical Vite ESM pattern
 *   new Worker(new URL('../workers/solver.worker.ts', import.meta.url), {type:'module'})
 * so Vite bundles it as a separate chunk at build time and serves it in dev. The
 * `import.meta.url`-relative URL must be statically analyzable (it is — a single
 * string literal with no interpolation), otherwise Vite warns at build.
 *
 * Worker handshake (see src/workers/solver.worker.ts):
 *   start  -> {progress}* -> {result}* -> {done|error}
 *   cancel -> silent teardown (no ack)
 *
 * T059 (FR-013): four terminal conditions each get explicit on-screen copy —
 * worker construction failure, worker runtime error, a completed search with ZERO
 * matches, and a cancelled search. None of them may leave the panel blank.
 *
 * HARD CONTRACT: data-testid="solver-search" and a real <button> whose trimmed
 * textContent starts with "SEARCH" are consumed by scripts/diagnose.mjs.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { solverState, dateTime } from '../../store.js';
import { OBSERVER_DEFAULT, TARGET_DEFAULT } from '../../lib/berlin.js';
import { greatCircleBearing } from '../../lib/sceneMath.js';

/** Haversine great-circle distance in metres between two lat/lon points (R=6371000m). */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLam = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Compute the (az, alt) of TARGET_DEFAULT as seen from OBSERVER_DEFAULT, in degrees. */
function computeTargetAzAlt(): { az: number; alt: number } {
  const distance = haversineMeters(
    OBSERVER_DEFAULT.lat,
    OBSERVER_DEFAULT.lon,
    TARGET_DEFAULT.lat,
    TARGET_DEFAULT.lon,
  );
  // greatCircleBearing returns radians, 0=N clockwise (matches suncalc's north-referenced
  // convention). Convert to degrees so the worker feeds a consistent (deg, north) pair.
  const azRad = greatCircleBearing(
    OBSERVER_DEFAULT.lat,
    OBSERVER_DEFAULT.lon,
    TARGET_DEFAULT.lat,
    TARGET_DEFAULT.lon,
  );
  const azDeg = (azRad * 180) / Math.PI;
  const heightDiff =
    TARGET_DEFAULT.heightAboveGround - OBSERVER_DEFAULT.heightAboveGround;
  const altRad = Math.atan2(heightDiff, distance);
  const altDeg = (altRad * 180) / Math.PI;
  return { az: azDeg, alt: altDeg };
}

interface WorkerOut {
  kind: 'progress' | 'result' | 'done' | 'error';
  progress?: number;
  matches?: Date[];
  message?: string;
}

const TOLERANCE_DEG = 0.5;
const WINDOW_DAYS = 30;

export default function SolverSearch(): JSX.Element {
  const solver = useStore(solverState);
  const dt = useStore(dateTime);
  const workerRef = useRef<Worker | null>(null);
  // useState drives the visible list; the matching ref holds the SAME accumulator the
  // worker callbacks mutate without re-renders (the closure inside onmessage captures
  // the ref, not a stale `accumulated` snapshot).
  const [visible, setVisible] = useState<Date[]>([]);
  const accumulatedRef = useRef<Date[]>([]);
  // Distinguishes "never searched" from "searched, cancelled" so the idle panel can
  // say which one it is (T059 — no ambiguous blank state).
  const [cancelled, setCancelled] = useState(false);

  const resetAccumulator = () => {
    accumulatedRef.current = [];
    setVisible([]);
  };

  // Clean up the worker on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const start = (): void => {
    // Tear down any in-flight worker before starting a new one.
    workerRef.current?.terminate();
    resetAccumulator();
    setCancelled(false);
    solverState.set({ status: 'running', progress: 0, matches: [] });

    // T059: worker CONSTRUCTION itself can throw (blocked by CSP, module worker
    // unsupported, chunk 404). Without this the panel would sit at 0% forever.
    let worker: Worker;
    try {
      worker = new Worker(new URL('../../workers/solver.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      solverState.set({
        status: 'error',
        progress: 0,
        matches: [],
        error: `Could not start the solver worker: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'progress') {
        const p = typeof msg.progress === 'number' ? msg.progress : 0;
        solverState.set({
          status: 'running',
          progress: p,
          matches: accumulatedRef.current,
        });
      } else if (msg.kind === 'result') {
        const next = accumulatedRef.current.concat(msg.matches ?? []);
        accumulatedRef.current = next;
        setVisible(next);
        solverState.set({
          status: 'running',
          progress: solver.progress,
          matches: next,
        });
      } else if (msg.kind === 'done') {
        const final = msg.matches ?? accumulatedRef.current;
        accumulatedRef.current = final;
        setVisible(final);
        solverState.set({
          status: 'done',
          progress: 1,
          matches: final,
        });
        worker.terminate();
        workerRef.current = null;
      } else if (msg.kind === 'error') {
        solverState.set({
          status: 'error',
          progress: 0,
          matches: [],
          error: msg.message ?? 'The solver worker reported an unspecified failure.',
        });
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      solverState.set({
        status: 'error',
        progress: 0,
        matches: [],
        error:
          e.message ||
          'The solver worker crashed before reporting a reason (see the browser console).',
      });
      worker.terminate();
      workerRef.current = null;
    };
    // A module worker that fails to *resolve* its script emits messageerror/error on
    // the worker; a failed import surfaces here rather than as onerror in some engines.
    worker.onmessageerror = () => {
      solverState.set({
        status: 'error',
        progress: 0,
        matches: [],
        error: 'The solver worker sent a message that could not be deserialised.',
      });
      worker.terminate();
      workerRef.current = null;
    };

    const target = computeTargetAzAlt();
    const now = new Date();
    const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
    worker.postMessage({
      kind: 'start',
      start: now,
      end,
      body: 'moon',
      target,
      toleranceDeg: TOLERANCE_DEG,
      lat: OBSERVER_DEFAULT.lat,
      lon: OBSERVER_DEFAULT.lon,
      stepMin: 1,
    });
  };

  const cancel = (): void => {
    workerRef.current?.postMessage({ kind: 'cancel' });
    workerRef.current?.terminate();
    workerRef.current = null;
    solverState.set({ status: 'idle', progress: 0, matches: [] });
    resetAccumulator();
    setCancelled(true);
  };

  // Click a result: scrub dateTime to that instant (Strategy B: drives the Cesium
  // clock and the timeline marker via the existing dateTime store listener).
  const chooseMatch = (d: Date): void => {
    dateTime.set(d);
  };

  const target = computeTargetAzAlt();
  const status = solver.status;
  const progressPct = Math.round((solver.progress ?? 0) * 100);
  const list = status === 'done' ? solver.matches : visible;
  const noMatches = status === 'done' && list.length === 0;

  const headMeta =
    status === 'running'
      ? `${progressPct}%`
      : status === 'done'
        ? `${list.length} hit${list.length === 1 ? '' : 's'}`
        : status === 'error'
          ? 'failed'
          : 'idle';

  return (
    <section className="pv-panel" data-testid="solver-search">
      <header className="pv-panel__head">
        <h2 className="pv-panel__title">
          <span className="pv-panel__index">03</span>Lunar alignment
        </h2>
        <span className="pv-panel__meta">{headMeta}</span>
      </header>

      <dl className="pv-readout" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
        <div className="pv-readout__row">
          <dt className="pv-label">Azimuth</dt>
          <dd className="pv-value">{target.az.toFixed(1)}°</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Altitude</dt>
          <dd className="pv-value">{target.alt.toFixed(2)}°</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Tolerance</dt>
          <dd className="pv-value">± {TOLERANCE_DEG.toFixed(1)}°</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Window</dt>
          <dd className="pv-value">now → +{WINDOW_DAYS} d</dd>
        </div>
      </dl>

      <div className="pv-btn-row">
        <button
          type="button"
          onClick={start}
          disabled={status === 'running'}
          className="pv-btn pv-btn--primary"
        >
          {status === 'running' ? 'SEARCHING' : 'SEARCH'}
        </button>
        {status === 'running' && (
          <button type="button" onClick={cancel} className="pv-btn pv-btn--quiet">
            Cancel
          </button>
        )}
      </div>

      {status === 'running' && (
        <div className="pv-meter">
          <div className="pv-meter__track">
            <div className="pv-meter__fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="pv-meter__line">
            <span>Sweeping 1-min steps</span>
            <span>{progressPct}%</span>
          </div>
        </div>
      )}

      {status === 'idle' && (
        <div className="pv-msg" role="status">
          <strong className="pv-msg__title">
            {cancelled ? 'Search cancelled' : 'No search run yet'}
          </strong>
          {cancelled
            ? 'The sweep was stopped before completion, so any partial results were discarded. Run it again to get a full list.'
            : `Run the sweep to list every instant in the next ${WINDOW_DAYS} days when the moon sits within ±${TOLERANCE_DEG}° of the target bearing.`}
        </div>
      )}

      {status === 'error' && (
        <div className="pv-msg pv-msg--error" role="alert">
          <strong className="pv-msg__title">Solver failed</strong>
          The alignment sweep stopped before it finished, so the result list is not
          trustworthy. Reload the page and search again.
          <span className="pv-msg__detail">
            {solver.error ?? 'No reason was reported by the worker.'}
          </span>
        </div>
      )}

      {noMatches && (
        <div className="pv-msg pv-msg--warn" role="status">
          <strong className="pv-msg__title">No alignments found</strong>
          The sweep completed successfully but the moon never came within ±
          {TOLERANCE_DEG}° of azimuth {target.az.toFixed(1)}° / altitude{' '}
          {target.alt.toFixed(2)}° during the next {WINDOW_DAYS} days. This is a real
          result, not an error — try a different target or a later window.
        </div>
      )}

      {list.length > 0 && (
        <>
          <div className="pv-meter__line" style={{ marginTop: 12 }}>
            <span>{status === 'done' ? 'Matches' : 'Matches so far'}</span>
            <span>{list.length}</span>
          </div>
          <ul className="pv-list">
            {list.map((d, i) => {
              const active = d.getTime() === dt.getTime();
              return (
                <li key={`${d.getTime()}-${i}`}>
                  <button
                    type="button"
                    className="pv-list__item"
                    aria-current={active}
                    onClick={() => chooseMatch(d)}
                  >
                    <span className="pv-list__ord">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {d.toISOString().replace('T', ' ').slice(0, 16)}Z
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
