/** Street preview: looking down a street at the sun or moon, with its dates this year. */
import { useEffect, useMemo, useState } from 'react';
import { formatLongDay, formatTime } from '../../../lib/berlinTime.js';
import { sampleBody } from '../../../lib/bodyPosition.js';
import { LIGHT_PHASE_NAMES, lightBands, lightPhaseOf } from '../../../lib/lightPhases.js';
import { MOON_VISIBILITY_LABELS, moonLighting, moonVisibilityAt, phaseLabel } from '../../../lib/moonPhase.js';
import { compassPoint } from '../../../lib/dailyPaths.js';
import { inStreetGap, type StreetPass } from '../../../lib/streets.js';
import type { SceneStatus } from '../CesiumViewer.js';
import AdjustPanel from './AdjustPanel.js';
import LightRibbon from './LightRibbon.js';
import MoonGlyph from './MoonGlyph.js';
import type { SpotTarget } from './shared.js';
import { useBuildingCheck } from './useBuildingCheck.js';

interface Props {
  spot: SpotTarget & { street: NonNullable<SpotTarget['street']> };
  status: SceneStatus | null;
  onBack: () => void;
  onChange: (next: Partial<SpotTarget>) => void;
}

const YEAR_MS = 365 * 86_400_000;
const MAX_ROWS = 40;
const SCRUB_MS = 30 * 60_000;
/** Far enough to take in the street and the buildings beyond its end. */
const CHECK_RANGE_M = 8000;

export default function StreetSpotScreen({ spot, status, onBack, onChange }: Props): JSX.Element {
  const { street } = spot;
  const [passes, setPasses] = useState<StreetPass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [anchor, setAnchor] = useState(spot.t ?? Date.now());

  useEffect(() => {
    const worker = new Worker(new URL('../../../workers/streetPasses.worker.ts', import.meta.url), {
      type: 'module',
    });
    const now = Date.now();
    worker.onmessage = (ev: MessageEvent<{ passes?: StreetPass[]; error?: string }>) => {
      if (ev.data.error) setError(ev.data.error);
      else setPasses(ev.data.passes ?? []);
      worker.terminate();
    };
    worker.onerror = (e) => {
      setError(e.message || 'The date search stopped unexpectedly.');
      worker.terminate();
    };
    worker.postMessage({
      view: {
        bearingDeg: street.bearingDeg,
        skylineDeg: street.skylineDeg,
        toleranceDeg: street.toleranceDeg,
        from: { lat: spot.lat, lon: spot.lon },
      },
      start: now,
      end: now + YEAR_MS,
    });
    return () => worker.terminate();
    // A street's direction and position do not change while this screen is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = status?.api ?? null;
  const settled = status?.sphereSightline !== 'unknown' && status?.sphereSightline !== undefined;
  const hidden = useBuildingCheck(api, passes, settled, CHECK_RANGE_M);
  const usable = useMemo(
    () => (passes && hidden ? passes.filter((p) => !hidden.has(p.peak)) : null),
    [passes, hidden],
  );
  const listed = usable ?? passes;

  const t = spot.t;
  useEffect(() => {
    if (t === undefined && usable && usable.length > 0) {
      setAnchor(usable[0].peak);
      onChange({ t: usable[0].peak, body: usable[0].body });
    }
  }, [usable, t, onChange]);

  const now = t === undefined ? null : sampleBody(spot.body, new Date(t), spot.lat, spot.lon);
  const bodyName = spot.body === 'sun' ? 'Sun' : 'Moon';
  const scrubLight = useMemo(
    () => lightBands(anchor - SCRUB_MS, anchor + SCRUB_MS, spot.lat, spot.lon),
    [anchor, spot.lat, spot.lon],
  );
  const blockedNow =
    api && now && now.alt > 0 && settled ? api.bodyBlocked(now.az, now.alt, CHECK_RANGE_M) === 'blocked' : false;

  const verdict = (() => {
    if (!now) return passes === null ? 'Finding the next date…' : 'No date selected';
    if (now.alt <= 0) return `${bodyName} below the horizon`;
    if (blockedNow) return `Buildings hide the ${spot.body} at this moment`;
    if (inStreetGap(street, now.az, now.alt)) return `${bodyName} in the street's gap`;
    return `${bodyName} not lined up with the street right now`;
  })();

  const moonNow = spot.body === 'moon' && t !== undefined ? moonLighting(new Date(t), spot.lat, spot.lon) : null;
  const moonRating =
    spot.body === 'moon' && t !== undefined ? moonVisibilityAt(new Date(t), spot.lat, spot.lon) : null;
  const phase = t === undefined ? null : lightPhaseOf(t, spot.lat, spot.lon);
  const hiddenCount = passes && usable ? passes.length - usable.length : 0;

  return (
    <div className="ue-spot-ui" data-testid="street-screen">
      <button type="button" className="ue-back" onClick={onBack}>
        ‹ Map
      </button>
      {status?.restreaming && (
        <div className="ue-loader" role="status">Framing the shot…</div>
      )}

      <aside className="ue-sheet ue-sheet--spot" data-adjust={adjustOpen} aria-label="Shot details">
        <header className="ue-spot__head">
          <p className="ue-eyebrow">
            {spot.label}, looking {compassPoint(street.bearingDeg)}
            <span className="ue-tag">Calculated</span>
          </p>
          <div className="ue-spot__when">
            <output className="ue-title">{t === undefined ? '--:--' : formatTime(new Date(t))}</output>
            {t !== undefined && <span className="ue-sub">{formatLongDay(new Date(t))}</span>}
            {phase && (
              <span className="ue-time__phase" data-testid="light-now">
                <i className={`ue-light--${phase}`} />
                {LIGHT_PHASE_NAMES[phase]}
              </span>
            )}
          </div>
          <p className="ue-verdict" data-testid="street-verdict">{verdict}</p>
          {moonNow && (
            <p className="ue-phase" data-testid="moon-phase">
              <MoonGlyph fraction={moonNow.fraction} waxing={moonNow.waxing} />
              {phaseLabel(moonNow.fraction, moonNow.waxing)}
              {moonRating && ` · ${MOON_VISIBILITY_LABELS[moonRating]} (estimate, clear sky)`}
            </p>
          )}
          <p className="ue-sight">
            {(street.lengthM / 1000).toFixed(1)} km of street. This view stands on the road&rsquo;s
            centre line, so find a safe spot nearby. Trees are not included.
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

        <section className="ue-list" data-testid="street-passes" hidden={adjustOpen}>
          <h2 className="ue-eyebrow">Next down this street</h2>
          {error && <p className="ue-empty" role="alert">Could not load dates: {error}</p>}
          {!error && passes === null && <p className="ue-empty">Searching the next 12 months…</p>}
          {passes !== null && passes.length === 0 && (
            <p className="ue-empty">
              Neither the sun nor a well-lit moon lines up with this direction of the street in the
              next 12 months. Try the opposite direction.
            </p>
          )}
          {listed?.slice(0, MAX_ROWS).map((p) => {
            const moon = p.body === 'moon' ? moonLighting(new Date(p.peak), spot.lat, spot.lon) : null;
            return (
              <button
                key={`${p.body}-${p.peak}`}
                type="button"
                className="ue-row ue-row--cta"
                aria-current={p.peak === spot.t}
                onClick={() => {
                  setAnchor(p.peak);
                  onChange({ t: p.peak, body: p.body });
                }}
              >
                {moon ? <MoonGlyph {...moon} /> : <i className="ue-dot ue-dot--sun" />}
                <span className="ue-row__main">
                  <strong>{formatLongDay(new Date(p.peak))}, {formatTime(new Date(p.peak))}</strong>
                  <small>
                    {p.bodyAlt.toFixed(0)}° high
                    {moon ? ` · ${Math.round(moon.fraction * 100)}% lit` : ''}
                    {` · ${LIGHT_PHASE_NAMES[lightPhaseOf(p.peak, spot.lat, spot.lon)]}`}
                  </small>
                </span>
              </button>
            );
          })}
          {hiddenCount > 0 && (
            <p className="ue-note" data-testid="hidden-count">
              {hiddenCount} more {hiddenCount === 1 ? 'pass is' : 'passes are'} left out because
              buildings cover the disc.
            </p>
          )}
          {!usable && passes && passes.length > 0 && !error && (
            <p className="ue-note">Checking these against the buildings…</p>
          )}
        </section>

        {spot.body === 'moon' && (
          <p className="ue-credit">Lunar surface: NASA&rsquo;s Scientific Visualization Studio</p>
        )}

        <AdjustPanel fovDeg={status?.fovDeg} autoLabel="Auto: frame the street" onOpenChange={setAdjustOpen} />
      </aside>
    </div>
  );
}
