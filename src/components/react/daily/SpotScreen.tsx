/** Spot preview: the shot itself, its time, and what else is coming from this place. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { findOccultationsAtPosition } from '../../../lib/areaSolver.js';
import { formatLongDay, formatTime } from '../../../lib/berlinTime.js';
import { sampleBody } from '../../../lib/bodyPosition.js';
import { MOON_VISIBILITY_LABELS, moonLighting, moonVisibilityAt, phaseLabel } from '../../../lib/moonPhase.js';
import { LIGHT_PHASE_NAMES, lightBands, lightPhaseOf } from '../../../lib/lightPhases.js';
import type { SpotEvent } from '../../../lib/dailyPaths.js';
import { FERNSEHTURM } from '../../../lib/landmarks.js';
import { resolveObserverHeight } from '../../../lib/sceneHeights.js';
import { findViewpoint } from '../../../lib/viewpoints.js';
import { observerHeight } from '../../../store.js';
import type { SceneStatus } from '../CesiumViewer.js';
import AdjustPanel from './AdjustPanel.js';
import LightRibbon from './LightRibbon.js';
import MoonGlyph from './MoonGlyph.js';
import { coverageLabel, type SpotTarget } from './shared.js';
import { useBuildingCheck } from './useBuildingCheck.js';

interface Props {
  spot: SpotTarget;
  status: SceneStatus | null;
  onBack: () => void;
  onChange: (next: Partial<SpotTarget>) => void;
}

const YEAR_MS = 365 * 86_400_000;
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
      // A pass that only grazes the tower would read as "0% hidden".
      else setEvents((ev.data.events ?? []).filter((e) => e.coveredFraction >= 0.01));
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

  // The sweep only compares the body with the tower. Whether the city covers it first
  // takes the 3D scene, so check each pass there, a few per frame to keep scrubbing smooth.
  const api = status?.api ?? null;
  const sceneSettled = status?.sphereSightline !== 'unknown' && status?.sphereSightline !== undefined;
  const hiddenPeaks = useBuildingCheck(api, events, sceneSettled);

  const usableEvents = useMemo(
    () => (events && hiddenPeaks ? events.filter((e) => !hiddenPeaks.has(e.peak)) : null),
    [events, hiddenPeaks],
  );

  // A place picked without a time opens on its next pass the city does not hide.
  useEffect(() => {
    if (spot.t === undefined && usableEvents && usableEvents.length > 0) {
      const next = usableEvents[0];
      setAnchor(next.peak);
      onChange({ t: next.peak, body: next.body });
    }
  }, [usableEvents, spot.t, onChange]);

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
    const position = sampleBody(spot.body, when, spot.lat, spot.lon);
    return { hit, alt: position.alt, az: position.az };
  }, [t, observer, spot.body, spot.lat, spot.lon]);

  const scrubLight = useMemo(
    () => lightBands(anchor - SCRUB_MS, anchor + SCRUB_MS, spot.lat, spot.lon),
    [anchor, spot.lat, spot.lon],
  );

  const moonNow =
    spot.body === 'moon' && t !== undefined ? moonLighting(new Date(t), spot.lat, spot.lon) : null;

  const moonRatingNow = (() => {
    if (spot.body !== 'moon' || t === undefined) return null;
    const rating = moonVisibilityAt(new Date(t), spot.lat, spot.lon);
    return rating && MOON_VISIBILITY_LABELS[rating];
  })();

  // Checked live, since scrubbing lands between the passes checked above.
  const bodyName = spot.body === 'sun' ? 'Sun' : 'Moon';
  const hiddenNow =
    api && now && now.alt > 0 && sceneSettled ? api.bodyBlocked(now.az, now.alt) === 'blocked' : false;

  const verdict =
    hiddenNow
      ? `Buildings hide the ${spot.body} at this moment`
      : now === null
      ? events === null
        ? 'Finding the next date…'
        : 'No date selected'
      : now.alt <= 0
        ? `${bodyName} below the horizon`
        : `${bodyName} ${
            now.hit ? coverageLabel(now.hit.kind, now.hit.coveredFraction) : 'not behind the tower'
          }`;

  const jump = (e: SpotEvent): void => {
    setAnchor(e.peak);
    onChange({ t: e.peak, body: e.body });
  };

  const viewpoint = spot.viewpointId ? findViewpoint(spot.viewpointId) : undefined;
  const curated = viewpoint !== undefined && !viewpoint.needsSiteCheck;
  const noDates = events !== null && events.length === 0;
  const allHidden = usableEvents !== null && events !== null && events.length > 0 && usableEvents.length === 0;
  const hiddenCount = events && usableEvents ? events.length - usableEvents.length : 0;
  const listed = usableEvents ?? events;

  return (
    <div className="ue-spot-ui" data-testid="spot-screen">
      <button type="button" className="ue-back" onClick={onBack}>
        ‹ Map
      </button>
      {status?.restreaming && (
        <div className="ue-loader" role="status">Framing the shot…</div>
      )}

      <aside className="ue-sheet ue-sheet--spot" data-adjust={adjustOpen} aria-label="Shot details">
        <header className="ue-spot__head">
          <p className="ue-eyebrow">
            {spot.label}
            <span className="ue-tag">{curated ? 'Curated' : 'Calculated'}</span>
          </p>
          <div className="ue-spot__when">
            <output className="ue-title">{t === undefined ? '--:--' : formatTime(new Date(t))}</output>
            {t !== undefined && <span className="ue-sub">{formatLongDay(new Date(t))}</span>}
            {t !== undefined && (
              <span className="ue-time__phase" data-testid="light-now">
                <i className={`ue-light--${lightPhaseOf(t, spot.lat, spot.lon)}`} />
                {LIGHT_PHASE_NAMES[lightPhaseOf(t, spot.lat, spot.lon)]}
              </span>
            )}
          </div>
          <p className="ue-verdict">{verdict}</p>
          {moonNow && (
            <p className="ue-phase" data-testid="moon-phase">
              <MoonGlyph fraction={moonNow.fraction} waxing={moonNow.waxing} />
              {phaseLabel(moonNow.fraction, moonNow.waxing)}
              {moonRatingNow && ` · ${moonRatingNow} (estimate, clear sky)`}
            </p>
          )}
          <p className={`ue-sight ue-sight--${status?.sphereSightline ?? 'unknown'}`} role="status">
            {SIGHT_COPY[status?.sphereSightline ?? 'unknown']}
          </p>
        </header>

        {t !== undefined && (
          <div className="ue-time">
            <div className="ue-rail">
            <LightRibbon bands={scrubLight} from={anchor - SCRUB_MS} to={anchor + SCRUB_MS} />
            <input
              className="ue-range ue-range--rail"
              type="range"
              aria-label="Adjust time around this moment"
              min={anchor - SCRUB_MS}
              max={anchor + SCRUB_MS}
              step={30_000}
              value={t}
              onChange={(e) => onChange({ t: Number(e.currentTarget.value) })}
            />
            </div>
            <div className="ue-scale" aria-hidden="true">
              <span>−30 min</span><span>+30 min</span>
            </div>
          </div>
        )}

        <section className="ue-list" data-testid="spot-events" hidden={adjustOpen}>
          <h2 className="ue-eyebrow">Next from here</h2>
          {error && <p className="ue-empty" role="alert">Could not load dates: {error}</p>}
          {!error && events === null && <p className="ue-empty">Searching the next 12 months…</p>}
          {noDates && (
            <p className="ue-empty">
              Neither the sun nor a well-lit moon passes behind the tower from here in the next
              12 months. Go back to the map and pick a spot on a path.
            </p>
          )}
          {allHidden && (
            <p className="ue-empty">
              All {events?.length} passes in the next 12 months are hidden by buildings from this
              exact spot. Moving a few metres can change that, so try a point nearby on the map.
            </p>
          )}
          {listed?.slice(0, MAX_ROWS).map((e) => (
            <button
              key={`${e.body}-${e.peak}`}
              type="button"
              className="ue-row ue-row--cta"
              aria-current={e.peak === spot.t}
              onClick={() => jump(e)}
            >
              {e.body === 'moon' ? (
                <MoonGlyph {...moonLighting(new Date(e.peak), spot.lat, spot.lon)} />
              ) : (
                <i className="ue-dot ue-dot--sun" />
              )}
              <span className="ue-row__main">
                <strong>{formatLongDay(new Date(e.peak))}, {formatTime(new Date(e.peak))}</strong>
                <small>
                  {coverageLabel(e.kind, e.coveredFraction)} · {e.bodyAlt.toFixed(0)}° high
                  {e.body === 'moon'
                    ? ` · ${Math.round(moonLighting(new Date(e.peak), spot.lat, spot.lon).fraction * 100)}% lit`
                    : ''}
                  {` · ${LIGHT_PHASE_NAMES[lightPhaseOf(e.peak, spot.lat, spot.lon)]}`}
                  {e.body === 'moon' && moonVisibilityAt(new Date(e.peak), spot.lat, spot.lon) === 'hard'
                    ? ' · hard to spot'
                    : ''}
                </small>
              </span>
            </button>
          ))}
          {listed && listed.length > MAX_ROWS && (
            <p className="ue-note">Showing the next {MAX_ROWS} of {listed.length} passes this year.</p>
          )}
          {hiddenCount > 0 && !allHidden && (
            <p className="ue-note" data-testid="hidden-count">
              {hiddenCount} more {hiddenCount === 1 ? 'pass is' : 'passes are'} left out because
              buildings cover the {hiddenCount === 1 ? 'disc' : 'disc each time'}.
            </p>
          )}
          {!usableEvents && events && events.length > 0 && !error && (
            <p className="ue-note">Checking these against the buildings…</p>
          )}
        </section>

        {spot.body === 'moon' && (
          <p className="ue-credit">Lunar surface: NASA&rsquo;s Scientific Visualization Studio</p>
        )}

        <AdjustPanel fovDeg={status?.fovDeg} autoLabel="Auto: fit the tower" onOpenChange={setAdjustOpen} />
      </aside>
    </div>
  );
}
