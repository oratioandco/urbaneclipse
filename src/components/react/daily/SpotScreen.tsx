/** Spot preview: the shot itself, its time, and what else is coming from this place. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { findOccultationsAtPosition } from '../../../lib/areaSolver.js';
import { formatLongDay, formatTime } from '../../../lib/berlinTime.js';
import { sampleBody } from '../../../lib/bodyPosition.js';
import type { SpotEvent } from '../../../lib/dailyPaths.js';
import { FERNSEHTURM } from '../../../lib/landmarks.js';
import { resolveObserverHeight } from '../../../lib/sceneHeights.js';
import { findViewpoint } from '../../../lib/viewpoints.js';
import {
  cameraProfile,
  lensAutoFit,
  observerHeight,
  setCameraProfile,
} from '../../../store.js';
import type { SceneStatus } from '../CesiumViewer.js';
import { coverageLabel, type SpotTarget } from './shared.js';

interface Props {
  spot: SpotTarget;
  status: SceneStatus | null;
  onBack: () => void;
  onChange: (next: Partial<SpotTarget>) => void;
}

const YEAR_MS = 365 * 86_400_000;
const LENSES = [150, 300, 600];
/** The list stays readable; a year from a good spot can hold hundreds of passes. */
const MAX_ROWS = 40;
/** Scrub range either side of the chosen moment. */
const SCRUB_MS = 30 * 60_000;

const SIGHT_COPY: Record<SceneStatus['sphereSightline'], string> = {
  clear: 'Clear view of the tower',
  blocked: 'Buildings block the tower from here',
  unknown: 'Checking the view…',
};

export default function SpotScreen({ spot, status, onBack, onChange }: Props): JSX.Element {
  const eye = useStore(observerHeight);
  const auto = useStore(lensAutoFit);
  const camera = useStore(cameraProfile);
  const [events, setEvents] = useState<SpotEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [anchor, setAnchor] = useState(spot.t ?? Date.now());

  const observer = useMemo(() => {
    const viewpoint = spot.viewpointId ? findViewpoint(spot.viewpointId) : undefined;
    const r = resolveObserverHeight(spot.lat, spot.lon, eye, () => undefined, viewpoint);
    return { lat: spot.lat, lon: spot.lon, ellipsoidalHeight: r.ellipsoidalHeight };
  }, [spot.lat, spot.lon, spot.viewpointId, eye]);

  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    setEvents(null);
    setError(null);
    const worker = new Worker(new URL('../../../workers/spotEvents.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const now = Date.now();
    worker.onmessage = (ev: MessageEvent<{ events?: SpotEvent[]; error?: string }>) => {
      if (ev.data.error) setError(ev.data.error);
      else setEvents(ev.data.events ?? []);
      worker.terminate();
    };
    worker.onerror = (e) => {
      setError(e.message || 'The date search stopped unexpectedly.');
      worker.terminate();
    };
    worker.postMessage({ id: 1, observer, start: now, end: now + YEAR_MS });
    return () => worker.terminate();
    // Eye height barely moves these dates, so only a new position re-runs the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.lat, spot.lon]);

  // A place picked without a time opens on its next pass.
  useEffect(() => {
    if (spot.t === undefined && events && events.length > 0) {
      const next = events[0];
      setAnchor(next.peak);
      onChange({ t: next.peak, body: next.body });
    }
  }, [events, spot.t, onChange]);

  const t = spot.t;
  const now = useMemo(() => {
    if (t === undefined) return null;
    const when = new Date(t);
    const [hit] = findOccultationsAtPosition({
      observer,
      landmark: FERNSEHTURM,
      start: when,
      end: when,
      stepMinutes: 1,
      bodyAt: (d: Date) => sampleBody(spot.body, d, spot.lat, spot.lon),
      wanted: ['full', 'partial', 'adjacent'],
    });
    return { hit, alt: sampleBody(spot.body, when, spot.lat, spot.lon).alt };
  }, [t, observer, spot.body, spot.lat, spot.lon]);

  const verdict =
    now === null
      ? events === null
        ? 'Finding the next date…'
        : 'No date selected'
      : now.alt <= 0
        ? `${spot.body === 'sun' ? 'Sun' : 'Moon'} below the horizon`
        : `${spot.body === 'sun' ? 'Sun' : 'Moon'} ${
            now.hit ? coverageLabel(now.hit.kind, now.hit.coveredFraction) : 'not behind the tower'
          }`;

  const jump = (e: SpotEvent): void => {
    setAnchor(e.peak);
    onChange({ t: e.peak, body: e.body });
  };

  const noDates = events !== null && events.length === 0;

  return (
    <div className="ue-spot-ui" data-testid="spot-screen">
      <button type="button" className="ue-back" onClick={onBack}>
        ‹ Map
      </button>
      {status?.restreaming && (
        <div className="ue-loader" role="status">Framing the shot…</div>
      )}

      <aside className="ue-sheet ue-sheet--spot" aria-label="Shot details">
        <header className="ue-spot__head">
          <p className="ue-eyebrow">
            {spot.label}
            <span className="ue-tag">{spot.viewpointId ? 'Curated' : 'Calculated'}</span>
          </p>
          <div className="ue-spot__when">
            <output className="ue-title">{t === undefined ? '--:--' : formatTime(new Date(t))}</output>
            {t !== undefined && <span className="ue-sub">{formatLongDay(new Date(t))}</span>}
          </div>
          <p className="ue-verdict">{verdict}</p>
          <p className={`ue-sight ue-sight--${status?.sphereSightline ?? 'unknown'}`} role="status">
            {SIGHT_COPY[status?.sphereSightline ?? 'unknown']}
          </p>
        </header>

        {t !== undefined && (
          <div className="ue-time">
            <input
              className="ue-range"
              type="range"
              aria-label="Adjust time around this moment"
              min={anchor - SCRUB_MS}
              max={anchor + SCRUB_MS}
              step={30_000}
              value={t}
              onChange={(e) => onChange({ t: Number(e.currentTarget.value) })}
            />
            <div className="ue-scale" aria-hidden="true">
              <span>−30 min</span><span>+30 min</span>
            </div>
          </div>
        )}

        <section className="ue-list" data-testid="spot-events">
          <h2 className="ue-eyebrow">Next from here</h2>
          {error && <p className="ue-empty" role="alert">Could not load dates: {error}</p>}
          {!error && events === null && <p className="ue-empty">Searching the next 12 months…</p>}
          {noDates && (
            <p className="ue-empty">
              Neither the sun nor a well-lit moon passes behind the tower from here in the next
              12 months. Go back to the map and pick a spot on a path.
            </p>
          )}
          {events?.slice(0, MAX_ROWS).map((e) => (
            <button
              key={`${e.body}-${e.peak}`}
              type="button"
              className="ue-row ue-row--cta"
              aria-current={e.peak === spot.t}
              onClick={() => jump(e)}
            >
              <i className={`ue-dot ue-dot--${e.body}`} />
              <span className="ue-row__main">
                <strong>{formatLongDay(new Date(e.peak))}, {formatTime(new Date(e.peak))}</strong>
                <small>{coverageLabel(e.kind, e.coveredFraction)} · {e.bodyAlt.toFixed(0)}° high</small>
              </span>
            </button>
          ))}
          {events && events.length > MAX_ROWS && (
            <p className="ue-note">Showing the next {MAX_ROWS} of {events.length} passes this year.</p>
          )}
        </section>

        <section className="ue-adjust">
          <button
            type="button"
            className="ue-adjust__toggle"
            aria-expanded={adjustOpen}
            onClick={() => setAdjustOpen((v) => !v)}
          >
            Adjust
            <span>{auto ? 'Auto lens' : `${camera.focalLength} mm`} · eye {eye.toFixed(1)} m</span>
          </button>
          {adjustOpen && (
            <div className="ue-adjust__body">
              <div className="ue-chips" role="group" aria-label="Lens">
                <button type="button" className="ue-chip" aria-pressed={auto} onClick={() => lensAutoFit.set(true)}>
                  Auto
                </button>
                {LENSES.map((mm) => (
                  <button
                    key={mm}
                    type="button"
                    className="ue-chip"
                    aria-pressed={!auto && camera.focalLength === mm}
                    onClick={() => setCameraProfile({ ...camera, focalLength: mm, zoom: 1 })}
                  >
                    {mm}
                  </button>
                ))}
              </div>
              <label className="ue-field">
                Eye height
                <input
                  className="ue-range"
                  type="range"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={eye}
                  onChange={(e) => observerHeight.set(Number(e.currentTarget.value))}
                />
              </label>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
