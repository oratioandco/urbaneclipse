/**
 * SolverSearch — finds URBAN ECLIPSES: instants when the sun or moon passes behind
 * the Fernsehturm's silhouette as seen from the observer.
 *
 * Search parameters:
 *   body      : sun or moon (toggle)
 *   landmark  : Fernsehturm (parametric model — the LoD2 tile geometry is unusable,
 *               see src/lib/landmarks.ts)
 *   window    : now -> +12 months
 *
 * WHY 12 MONTHS, NOT 30 DAYS: from the Lichtenberger Brücke the tower's tip is only
 * ~3.2 deg above the horizon, so a sun transit needs the sun at the tower's bearing while
 * very low — which happens only near the equinoxes. The 2026 windows are 4-11 April
 * and 31 Aug-7 Sep. A 30-day window would usually report "no alignments" for a shot
 * that is simply seasonal. A full year at 1-minute resolution costs ~300 ms.
 *
 * WHY NOT A BEARING TOLERANCE: the old sweep matched "within +/-0.5 deg of the target
 * bearing", which at the moon's 0.52 deg width only means "within about one lunar
 * diameter" — near misses, not compositions, and no way to tell fully-behind from
 * beside-the-tower. It now measures the disc's covered AREA against the real silhouette.
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
import {
  solverState,
  dateTime,
  observerHeight,
  observerPosition,
  targetPosition,
  solverBody,
  viewMode,
} from '../../store.js';
import { FERNSEHTURM } from '../../lib/landmarks.js';
import { findViewpoint } from '../../lib/viewpoints.js';
import { resolveObserverHeight } from '../../lib/sceneHeights.js';
import { azAltTo } from '../../lib/silhouette.js';
import { feasibility, type FixedCandidate } from '../../lib/areaSolver.js';
import { MOON_RADIUS_KM, SUN_RADIUS_KM } from '../../lib/occultation.js';
import { orthometricToEllipsoidal } from '../../lib/elevation.js';

/**
 * Observer at the PLACED position (map-first), with its eye height resolved.
 *
 * Ground sampling is not available in this component — the heightmap lives in the
 * Cesium island — so a freely placed observer falls back to the Berlin mean. That is
 * a few metres of error in the solved altitude, well under the ~0.05 deg tolerance at
 * these ranges, whereas a curated viewpoint's surveyed deck is exact.
 */
function currentObserver(
  pos: { lat: number; lon: number; viewpointId?: string },
  eyeHeight: number,
) {
  const viewpoint = pos.viewpointId ? findViewpoint(pos.viewpointId) : undefined;
  const r = resolveObserverHeight(pos.lat, pos.lon, eyeHeight, () => undefined, viewpoint);
  return { lat: pos.lat, lon: pos.lon, ellipsoidalHeight: r.ellipsoidalHeight };
}

interface WorkerOut {
  kind: 'progress' | 'result' | 'done' | 'error';
  progress?: number;
  matches?: FixedCandidate[];
  message?: string;
}

const WINDOW_MONTHS = 12;
/** Sphere centre — the iconic occulter, and what "behind the tower" usually means. */
const SPHERE_AGL = 213;

export default function SolverSearch(): JSX.Element {
  const solver = useStore(solverState);
  const dt = useStore(dateTime);
  const eyeHeight = useStore(observerHeight);
  const body = useStore(solverBody);
  const obsPos = useStore(observerPosition);
  const tgtPos = useStore(targetPosition);
  const workerRef = useRef<Worker | null>(null);
  // useState drives the visible list; the matching ref holds the SAME accumulator the
  // worker callbacks mutate without re-renders (the closure inside onmessage captures
  // the ref, not a stale `accumulated` snapshot).
  const [visible, setVisible] = useState<FixedCandidate[]>([]);
  const accumulatedRef = useRef<FixedCandidate[]>([]);

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
          matches: accumulatedRef.current.map((c) => c.when),
        });
      } else if (msg.kind === 'result') {
        const next = accumulatedRef.current.concat(msg.matches ?? []);
        accumulatedRef.current = next;
        setVisible(next);
        solverState.set({
          status: 'running',
          progress: solver.progress,
          matches: next.map((c) => c.when),
        });
      } else if (msg.kind === 'done') {
        const final = msg.matches ?? accumulatedRef.current;
        accumulatedRef.current = final;
        setVisible(final);
        solverState.set({
          status: 'done',
          progress: 1,
          matches: final.map((c) => c.when),
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

    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + WINDOW_MONTHS);
    worker.postMessage({
      kind: 'start',
      body,
      start: now,
      end,
      stepMin: 1,
      observer: currentObserver(obsPos, eyeHeight),
      landmarkId: 'fernsehturm',
      wanted: ['full', 'partial'],
      minAltitudeDeg: 0,
      limit: 200,
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
    // Scrub to the instant AND switch to the preview, so picking a result shows the
    // actual composition rather than only moving a clock the user cannot see.
    dateTime.set(d);
    viewMode.set('preview');
  };

  const observer = currentObserver(obsPos, eyeHeight);
  // The tower's sphere as actually seen from here — drives both the readout and the
  // feasibility verdict.
  const sphere = azAltTo(
    observer,
    FERNSEHTURM.lat,
    FERNSEHTURM.lon,
    orthometricToEllipsoidal(FERNSEHTURM.baseOrthometric) + SPHERE_AGL,
  );
  // Mean-distance disc: a supermoon is slightly worse, the sun very slightly better.
  const feas = feasibility(
    FERNSEHTURM,
    body === 'moon'
      ? { distanceKm: 384400, radiusKm: MOON_RADIUS_KM }
      : { distanceKm: 149.6e6, radiusKm: SUN_RADIUS_KM },
    sphere.rangeM,
  );
  // Only the Fernsehturm has a parametric silhouette model (the LoD2 tile geometry is
  // unusable for this — see lib/landmarks.ts). If the target has been placed elsewhere
  // the sweep is still about the tower, and saying so beats a confidently wrong answer.
  const targetOffsetM = Math.hypot(
    (tgtPos.lat - FERNSEHTURM.lat) * 111_320,
    (tgtPos.lon - FERNSEHTURM.lon) * 111_320 * Math.cos((tgtPos.lat * Math.PI) / 180),
  );
  const targetIsTower = targetOffsetM < 250;

  const status = solver.status;
  const progressPct = Math.round((solver.progress ?? 0) * 100);
  // ALWAYS the rich accumulator, never solver.matches. The store deliberately keeps
  // `matches` as Date[] (its contract is fixed), but this list renders coverage and
  // altitude — reading the store's Date[] here made every row's c.kind/.coveredFraction
  // undefined and crashed the panel on completion.
  const list = visible;
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
          <span className="pv-panel__index">03</span>Urban eclipse
        </h2>
        <span className="pv-panel__meta">{headMeta}</span>
      </header>

      <dl className="pv-readout" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
        <div className="pv-readout__row">
          <dt className="pv-label">Azimuth</dt>
          <dd className="pv-value">{sphere.az.toFixed(1)}°</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Altitude</dt>
          <dd className="pv-value">{sphere.alt.toFixed(2)}°</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Range</dt>
          <dd className="pv-value">{(sphere.rangeM / 1000).toFixed(2)} km</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Tower width</dt>
          <dd className="pv-value">{feas.landmarkWidthDeg.toFixed(3)}°</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Window</dt>
          <dd className="pv-value">now → +{WINDOW_MONTHS} mo</dd>
        </div>
      </dl>

      <div className="pv-btn-row">
        <button
          type="button"
          onClick={() => solverBody.set('sun')}
          disabled={status === 'running'}
          className={`pv-btn ${body === 'sun' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={body === 'sun'}
        >
          Sun
        </button>
        <button
          type="button"
          onClick={() => solverBody.set('moon')}
          disabled={status === 'running'}
          className={`pv-btn ${body === 'moon' ? 'pv-btn--primary' : 'pv-btn--quiet'}`}
          aria-pressed={body === 'moon'}
        >
          Moon
        </button>
      </div>

      {!targetIsTower && (
        <div className="pv-msg pv-msg--warn" role="status">
          <strong className="pv-msg__title">Search still targets the Fernsehturm</strong>
          Your target is placed {(targetOffsetM / 1000).toFixed(2)} km from the
          Fernsehturm, but only that tower has a parametric silhouette model — the LoD2
          building data is too coarse for occultation work. These results describe the
          tower, not your placed target.
        </div>
      )}

      {/* THE headline planning fact, stated before any search runs: from this bridge
          the tower is narrower than the disc, so a FULL cover is impossible at any
          date or time. Better to say so than to let the user hunt for it forever. */}
      {!feas.fullPossible && (
        <div className="pv-msg pv-msg--warn" role="status">
          <strong className="pv-msg__title">Full eclipse impossible from here</strong>
          The tower spans {feas.landmarkWidthDeg.toFixed(3)}° at{' '}
          {(sphere.rangeM / 1000).toFixed(2)} km, but the {body} is about{' '}
          {body === 'moon' ? '0.52' : '0.53'}° wide — so it can never be fully hidden.
          Partial transits are still possible. For a full cover you would need to be
          within {(feas.maxRangeForFullM / 1000).toFixed(2)} km of the tower.
        </div>
      )}

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
            : `Run the sweep to find every instant in the next ${WINDOW_MONTHS} months when the ${body} passes behind the Fernsehturm, ranked by how much of the disc is covered.`}
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
          <strong className="pv-msg__title">No transits found</strong>
          The sweep completed successfully but the {body} never passed behind the tower
          during the next {WINDOW_MONTHS} months. This is a real result, not an error.
          From this bridge the tower's tip sits only ~{sphere.alt.toFixed(1)}° above the
          horizon at bearing {sphere.az.toFixed(1)}°, so the {body} has to be very low
          at exactly that bearing — a narrow, seasonal alignment.
        </div>
      )}

      {list.length > 0 && (
        <>
          <div className="pv-meter__line" style={{ marginTop: 12 }}>
            <span>{status === 'done' ? 'Matches' : 'Matches so far'}</span>
            <span>{list.length}</span>
          </div>
          <ul className="pv-list">
            {list.map((c, i) => {
              const d = c.when instanceof Date ? c.when : new Date(c.when);
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
                    <span className="pv-list__meta">
                      {c.kind === 'full'
                        ? 'FULL'
                        : `${Math.round(c.coveredFraction * 100)}%`}
                      {' · '}
                      {c.bodyAlt.toFixed(1)}°
                    </span>
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
