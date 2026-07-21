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
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { solverState, dateTime } from '../../store.js';
import { OBSERVER_DEFAULT, TARGET_DEFAULT } from '../../lib/berlin.js';
import { greatCircleBearing } from '../../lib/sceneMath.js';

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  zIndex: 10,
  padding: '12px 14px',
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 8,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 12,
  color: '#111',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  pointerEvents: 'auto',
  minWidth: 220,
  maxWidth: 280,
  maxHeight: '60vh',
  overflow: 'auto',
};

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

export default function SolverSearch(): JSX.Element {
  const solver = useStore(solverState);
  const dt = useStore(dateTime);
  const workerRef = useRef<Worker | null>(null);
  // useState drives the visible list; the matching ref holds the SAME accumulator the
  // worker callbacks mutate without re-renders (the closure inside onmessage captures
  // the ref, not a stale `accumulated` snapshot).
  const [visible, setVisible] = useState<Date[]>([]);
  const accumulatedRef = useRef<Date[]>([]);

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
    solverState.set({ status: 'running', progress: 0, matches: [] });

    const worker = new Worker(
      new URL('../../workers/solver.worker.ts', import.meta.url),
      { type: 'module' },
    );
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
          error: msg.message ?? 'unknown error',
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
        error: e.message || 'worker error',
      });
      worker.terminate();
      workerRef.current = null;
    };

    const target = computeTargetAzAlt();
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    worker.postMessage({
      kind: 'start',
      start: now,
      end,
      body: 'moon',
      target,
      toleranceDeg: 0.5,
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

  return (
    <div style={PANEL_STYLE} data-testid="solver-search">
      <div style={{ fontWeight: 700, letterSpacing: 0.4, marginBottom: 4 }}>
        MOON ALIGNMENT SEARCH
      </div>
      <div style={{ opacity: 0.75, marginBottom: 6, lineHeight: 1.4 }}>
        Target: Fernsehturm from observer
        <br />
        az {target.az.toFixed(1)}°, alt {target.alt.toFixed(2)}° · ±0.5°
        <br />
        Window: now → +30d, 1-min steps
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={start}
          disabled={status === 'running'}
          style={{
            flex: 1,
            padding: '6px 8px',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 4,
            background: status === 'running' ? '#eee' : '#111',
            color: status === 'running' ? '#888' : '#fff',
            cursor: status === 'running' ? 'default' : 'pointer',
            fontWeight: 600,
          }}
        >
          {status === 'running' ? 'SEARCHING…' : 'SEARCH'}
        </button>
        {status === 'running' && (
          <button
            type="button"
            onClick={cancel}
            style={{
              padding: '6px 8px',
              border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              background: '#fff',
              color: '#a02020',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            CANCEL
          </button>
        )}
      </div>

      {status === 'running' && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              height: 6,
              background: '#e5e7eb',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: '#111',
                transition: 'width 120ms linear',
              }}
            />
          </div>
          <div style={{ fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
            {progressPct}%
          </div>
        </div>
      )}

      {status === 'error' && (
        <div
          style={{
            marginTop: 8,
            padding: '6px 8px',
            borderRadius: 4,
            background: 'rgba(220,60,60,0.15)',
            color: '#a02020',
          }}
        >
          ERROR: {solver.error ?? 'unknown'}
        </div>
      )}

      {(status === 'done' || (status === 'running' && list.length > 0)) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {status === 'done' ? `${solver.matches.length} matches` : `${list.length} so far`}
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              maxHeight: 180,
              overflowY: 'auto',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 4,
            }}
          >
            {list.map((d, i) => {
              const active = d.getTime() === dt.getTime();
              return (
                <li
                  key={`${d.getTime()}-${i}`}
                  style={{
                    padding: '3px 6px',
                    cursor: 'pointer',
                    background: active ? '#fef3c7' : i % 2 ? '#fafafa' : '#fff',
                    fontVariantNumeric: 'tabular-nums',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                  }}
                  onClick={() => chooseMatch(d)}
                >
                  {d.toISOString().replace('T', ' ').slice(0, 16)}Z
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
