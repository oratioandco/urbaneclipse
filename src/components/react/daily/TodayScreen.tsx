/** Home screen: where the sun and moon line up behind the tower on a given day. */
import { useEffect, useMemo, useState } from 'react';
import {
  berlinDayBounds,
  berlinInstant,
  berlinDayOf,
  formatDay,
  formatTime,
  shiftDay,
  type BerlinDay,
} from '../../../lib/berlinTime.js';
import {
  applyView,
  compassPoint,
  computeDayPath,
  dayHighlights,
  nextClearPoint,
  pointAtTime,
  type DayPath,
  type PathPoint,
} from '../../../lib/dailyPaths.js';
import { FERNSEHTURM } from '../../../lib/landmarks.js';
import { MOON_VISIBILITY_LABELS, moonLighting, moonVisibilityAt, phaseLabel } from '../../../lib/moonPhase.js';
import { LIGHT_PHASE_NAMES, bandAt, lightBands, lightPhaseOf } from '../../../lib/lightPhases.js';
import {
  VIEW_BUILDING,
  VIEW_VISIBLE,
  loadViewshed,
  sampleViewshed,
  type Viewshed,
} from '../../../lib/viewshed.js';
import type { Viewpoint } from '../../../lib/viewpoints.js';
import { loadStreets, streetMoments, type StreetMoment, type StreetView } from '../../../lib/streets.js';
import type { Body } from '../../../lib/bodyPosition.js';
import LightRibbon, { LightLegend } from './LightRibbon.js';
import MoonGlyph from './MoonGlyph.js';
import TodayMap from './TodayMap.js';
import { coverageLabel, type SpotTarget } from './shared.js';

interface Props {
  day: BerlinDay;
  onDay: (day: BerlinDay) => void;
  onOpenSpot: (spot: SpotTarget) => void;
  active: boolean;
}

const BODY_NAME: Record<Body, string> = { sun: 'Sun', moon: 'Moon' };

function placeLabel(p: { distanceM: number; bearingDeg: number }): string {
  return `${(p.distanceM / 1000).toFixed(1)} km ${compassPoint(p.bearingDeg)} of the tower`;
}

/** The stretches of the day with a usable view, for the bars above the time slider. */
function clearRuns(path: DayPath): Array<{ from: number; to: number }> {
  const runs: Array<{ from: number; to: number }> = [];
  for (const segment of path.segments) {
    let open: { from: number; to: number } | null = null;
    for (const p of segment) {
      if (p.clear === false) {
        open = null;
      } else if (open) {
        open.to = p.t;
      } else {
        open = { from: p.t, to: p.t };
        runs.push(open);
      }
    }
  }
  return runs;
}

function openingTime(day: BerlinDay, paths: DayPath[], now: number): number {
  const picks = paths.flatMap(dayHighlights).sort((a, b) => a.t - b.t);
  if (berlinDayOf(new Date(now)) === day) {
    const next = picks.find((p) => p.t >= now);
    return next ? next.t : now;
  }
  return picks[0]?.t ?? (berlinDayBounds(day).start.getTime() + berlinDayBounds(day).end.getTime()) / 2;
}

export default function TodayScreen({ day, onDay, onOpenSpot, active }: Props): JSX.Element {
  const [shown, setShown] = useState<Record<Body, boolean>>({ sun: true, moon: true });
  const [free, setFree] = useState<{ lat: number; lon: number } | null>(null);
  const [layers, setLayers] = useState({ tower: true, streets: true });
  const [streetViews, setStreetViews] = useState<StreetView[] | null>(null);
  const [streetsFailed, setStreetsFailed] = useState(false);
  useEffect(() => {
    let current = true;
    loadStreets().then(
      (loaded) => current && setStreetViews(loaded),
      (err: unknown) => {
        console.error('[TodayScreen] street data failed', err);
        if (current) setStreetsFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const [expanded, setExpanded] = useState(false);

  const bounds = useMemo(() => berlinDayBounds(day), [day]);
  const [view, setView] = useState<Viewshed | null>(null);
  const [viewFailed, setViewFailed] = useState(false);
  useEffect(() => {
    let current = true;
    loadViewshed().then(
      (loaded) => current && setView(loaded),
      (err: unknown) => {
        console.error('[TodayScreen] visibility data failed', err);
        if (current) setViewFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const allPaths = useMemo(
    () =>
      (['sun', 'moon'] as const).map((body) => {
        const path = computeDayPath({ body, start: bounds.start, end: bounds.end, landmark: FERNSEHTURM });
        return view
          ? applyView(path, (lat, lon) => sampleViewshed(view, lat, lon) === VIEW_VISIBLE)
          : path;
      }),
    [bounds, view],
  );
  const paths = useMemo(() => allPaths.filter((p) => shown[p.body]), [allPaths, shown]);
  const allMoments = useMemo(() => {
    if (!streetViews) return [];
    return (['sun', 'moon'] as const).flatMap((body) =>
      streetMoments(streetViews, body, bounds.start.getTime(), bounds.end.getTime(), FERNSEHTURM.lat, FERNSEHTURM.lon),
    );
  }, [streetViews, bounds]);
  const moments = useMemo(
    () => (layers.streets ? allMoments.filter((m) => shown[m.body]) : []),
    [allMoments, layers.streets, shown],
  );
  const [time, setTime] = useState(() => openingTime(day, allPaths, Date.now()));
  useEffect(() => {
    setTime(openingTime(day, allPaths, Date.now()));
    setFree(null);
  }, [day, allPaths]);

  const freeState = free && view ? sampleViewshed(view, free.lat, free.lon) : null;

  const liveStreets = useMemo(
    () =>
      moments
        .filter((m) => time >= m.from - 60_000 && time <= m.to + 60_000)
        .sort((a, b) => b.view.lengthM - a.view.lengthM),
    [moments, time],
  );
  // Longest first, then in time order, so the list reads like the day.
  const topStreets = useMemo(
    () =>
      [...moments]
        .sort((a, b) => b.view.lengthM - a.view.lengthM)
        .slice(0, 6)
        .sort((a, b) => a.peak - b.peak),
    [moments],
  );
  const nextStreet = useMemo(
    () => [...moments].filter((m) => m.from > time).sort((a, b) => a.from - b.from)[0],
    [moments, time],
  );
  const openStreet = (m: StreetMoment): void =>
    onOpenSpot({
      lat: m.view.from.lat,
      lon: m.view.from.lon,
      t: m.peak,
      body: m.body,
      label: m.view.name,
      street: {
        bearingDeg: m.view.bearingDeg,
        skylineDeg: m.view.skylineDeg,
        toleranceDeg: m.view.toleranceDeg,
        lengthM: m.view.lengthM,
      },
    });
  const towerPaths = layers.tower ? paths : [];

  const highlights = useMemo(
    () =>
      towerPaths
        .flatMap((path) => dayHighlights(path).map((point) => ({ body: path.body, point })))
        .sort((a, b) => a.point.t - b.point.t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths, layers.tower],
  );

  // At midday, so the day's headline phase does not move with the slider.
  const moonToday = useMemo(
    () => moonLighting(new Date((bounds.start.getTime() + bounds.end.getTime()) / 2), FERNSEHTURM.lat, FERNSEHTURM.lon),
    [bounds],
  );

  const light = useMemo(
    () => lightBands(bounds.start.getTime(), bounds.end.getTime(), FERNSEHTURM.lat, FERNSEHTURM.lon),
    [bounds],
  );
  const lightNow = bandAt(light, time);

  const span = bounds.end.getTime() - bounds.start.getTime();
  const pct = (t: number) => `${((t - bounds.start.getTime()) / span) * 100}%`;
  const isToday = day === berlinDayOf(new Date());

  const moonRating = (p: PathPoint): string | null => {
    const rating = moonVisibilityAt(new Date(p.t), p.lat, p.lon);
    return rating && MOON_VISIBILITY_LABELS[rating];
  };

  const openPoint = (body: Body, p: PathPoint): void =>
    onOpenSpot({ lat: p.lat, lon: p.lon, t: p.t, body, label: placeLabel(p) });

  return (
    <div className="ue-screen ue-today" hidden={!active}>
      <TodayMap
        paths={towerPaths}
        time={time}
        streets={moments}
        moon={moonToday}
        onPickStreet={(m) => {
          setFree(null);
          setExpanded(true);
          openStreet(m);
        }}
        selected={free}
        onPickPath={({ point }) => {
          setFree(null);
          setTime(point.t);
        }}
        onPickFree={setFree}
        onPickViewpoint={(v: Viewpoint) =>
          onOpenSpot({ lat: v.lat, lon: v.lon, body: 'sun', label: v.name, viewpointId: v.id })
        }
      />

      <aside className="ue-sheet" data-expanded={expanded} aria-label="Eclipse paths for the day">
        <button
          type="button"
          className="ue-sheet__grip"
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        />
        <header className="ue-today__head">
          <div>
            <p className="ue-eyebrow">Urban Eclipse · Berlin</p>
            <h1 className="ue-title">{isToday ? 'Today' : formatDay(bounds.start)}</h1>
            {isToday ? <p className="ue-sub">{formatDay(bounds.start)}</p> : null}
          </div>
          <div className="ue-daynav">
            <button type="button" aria-label="Previous day" onClick={() => onDay(shiftDay(day, -1))}>‹</button>
            <label className="ue-daynav__pick">
              <span className="ue-visually-hidden">Choose a date</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="6" width="16" height="14" rx="2" />
                <path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4" />
              </svg>
              <input
                type="date"
                value={day}
                data-testid="date-picker"
                onChange={(e) => {
                  if (e.currentTarget.value) onDay(e.currentTarget.value);
                }}
              />
            </label>
            {!isToday && (
              <button type="button" className="ue-daynav__today" onClick={() => onDay(berlinDayOf(new Date()))}>
                Today
              </button>
            )}
            <button type="button" aria-label="Next day" onClick={() => onDay(shiftDay(day, 1))}>›</button>
          </div>
        </header>

        <div className="ue-time">
          <div className="ue-time__value">
            <div className="ue-time__now">
              <output>{formatTime(new Date(time))}</output>
              {lightNow && (
                <span className="ue-time__phase" data-testid="light-now">
                  <i className={`ue-light--${lightNow.phase}`} />
                  {LIGHT_PHASE_NAMES[lightNow.phase]}
                  <small>
                    {formatTime(new Date(lightNow.from))}–{formatTime(new Date(lightNow.to))}
                  </small>
                </span>
              )}
            </div>
            <div className="ue-chips">
              {(['tower', 'streets'] as const).map((layer) => (
                <button
                  key={layer}
                  type="button"
                  className="ue-chip"
                  aria-pressed={layers[layer]}
                  onClick={() => setLayers((l) => ({ ...l, [layer]: !l[layer] }))}
                >
                  {layer === 'tower' ? 'Tower' : 'Streets'}
                </button>
              ))}
              {(['sun', 'moon'] as const).map((body) => (
                <button
                  key={body}
                  type="button"
                  className={`ue-chip ue-chip--${body}`}
                  aria-pressed={shown[body]}
                  onClick={() => setShown((s) => ({ ...s, [body]: !s[body] }))}
                >
                  {body === 'moon' ? <MoonGlyph {...moonToday} /> : <i />}
                  {BODY_NAME[body]}
                </button>
              ))}
            </div>
          </div>
          <div className="ue-tracks" aria-hidden="true">
            {paths.map((path) => (
              <div key={path.body} className={`ue-track ue-track--${path.body}`} hidden={!layers.tower}>
                {clearRuns(path).map((run) => (
                  <span
                    key={run.from}
                    style={{ left: pct(run.from), width: `calc(${pct(run.to)} - ${pct(run.from)})` }}
                  />
                ))}
              </div>
            ))}
            {layers.streets && (
              <div className="ue-track ue-track--streets">
                {moments.map((m) => (
                  <span
                    key={`${m.body}-${m.view.bearingDeg}-${m.view.from.lat}`}
                    style={{ left: pct(m.from), width: `calc(${pct(m.to)} - ${pct(m.from)} + 2px)` }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="ue-rail">
          <LightRibbon bands={light} from={bounds.start.getTime()} to={bounds.end.getTime()} />
          <input
            className="ue-range ue-range--rail"
            type="range"
            aria-label="Time of day"
            aria-valuetext={`${formatTime(new Date(time))}, ${lightNow ? LIGHT_PHASE_NAMES[lightNow.phase] : ''}`}
            min={bounds.start.getTime()}
            max={bounds.end.getTime() - 180_000}
            step={180_000}
            value={time}
            onChange={(e) => {
              setFree(null);
              setTime(Number(e.currentTarget.value));
            }}
          />
          </div>
          <div className="ue-hours" aria-hidden="true">
            {[6, 12, 18].map((hour) => (
              <span key={hour} style={{ left: pct(berlinInstant(day, hour).getTime()) }}>
                {String(hour).padStart(2, '0')}
              </span>
            ))}
          </div>
          <LightLegend />
        </div>

        {free ? (
          <section className="ue-now">
            <button
              type="button"
              className="ue-row ue-row--cta"
              onClick={() => onOpenSpot({ ...free, body: 'sun', label: 'Your spot' })}
            >
              <span className="ue-row__main">
                <strong>Your spot</strong>
                <small>
                  {freeState === VIEW_VISIBLE
                    ? 'No buildings in the way'
                    : freeState === VIEW_BUILDING
                      ? 'This is inside a building'
                      : freeState === null
                        ? `${free.lat.toFixed(4)}, ${free.lon.toFixed(4)}`
                        : 'Buildings block the tower from here'}
                </small>
              </span>
              <span className="ue-row__go">Check dates</span>
            </button>
          </section>
        ) : (
          <section className="ue-now" aria-label="Where to stand at this time">
            {paths.map((path) => {
              const p = pointAtTime(path, time);
              if (p?.clear === false) {
                const next = nextClearPoint(path, p.t);
                return (
                  <div key={path.body} className="ue-row">
                    <i className={`ue-dot ue-dot--${path.body} ue-dot--off`} />
                    <span className="ue-row__main">
                      <strong>{placeLabel(p)}</strong>
                      <small>Buildings block the tower here</small>
                    </span>
                    {next && (
                      <button type="button" className="ue-row__go ue-row__go--quiet" onClick={() => setTime(next.t)}>
                        Clear at {formatTime(new Date(next.t))}
                      </button>
                    )}
                  </div>
                );
              }
              return p ? (
                <button
                  key={path.body}
                  type="button"
                  className="ue-row ue-row--cta"
                  onClick={() => openPoint(path.body, p)}
                >
                  <i className={`ue-dot ue-dot--${path.body}`} />
                  <span className="ue-row__main">
                    <strong>{placeLabel(p)}</strong>
                    <small>
                      {BODY_NAME[path.body]} {coverageLabel(p.kind, p.coveredFraction)}
                      {path.body === 'moon' ? ` · ${phaseLabel(moonToday.fraction, moonToday.waxing)}` : ''}
                      {path.body === 'moon' && moonRating(p) ? ` · ${moonRating(p)}` : ''}
                    </small>
                  </span>
                  <span className="ue-row__go">Preview</span>
                </button>
              ) : (
                <div key={path.body} className="ue-row ue-row--quiet">
                  <i className={`ue-dot ue-dot--${path.body}`} />
                  <span className="ue-row__main">
                    <small>No {path.body} shot at this time</small>
                  </span>
                </div>
              );
            })}
          </section>
        )}

        {layers.streets && liveStreets.length > 0 && (
          <section className="ue-now" aria-label="Streets lined up at this time" data-testid="streets-now">
            {liveStreets.slice(0, 3).map((m) => (
              <button
                key={`${m.body}-${m.view.bearingDeg}-${m.view.from.lat}`}
                type="button"
                className="ue-row ue-row--cta"
                onClick={() => openStreet(m)}
              >
                {m.body === 'moon' ? <MoonGlyph {...moonToday} /> : <i className="ue-dot ue-dot--sun" />}
                <span className="ue-row__main">
                  <strong>{m.view.name}</strong>
                  <small>
                    {BODY_NAME[m.body]} down the street, looking {compassPoint(m.view.bearingDeg)} ·{' '}
                    {(m.view.lengthM / 1000).toFixed(1)} km
                  </small>
                </span>
                <span className="ue-row__go">Preview</span>
              </button>
            ))}
            {liveStreets.length > 3 && <p className="ue-note">and {liveStreets.length - 3} more on the map</p>}
          </section>
        )}

        <section className="ue-list" data-testid="highlights">
          <h2 className="ue-eyebrow">Best shots</h2>
          {highlights.length === 0 ? (
            <p className="ue-empty">No low-light shots today. Try the next day.</p>
          ) : (
            highlights.map(({ body, point }) => (
              <button
                key={`${body}-${point.t}`}
                type="button"
                className="ue-row ue-row--cta"
                data-past={point.t < Date.now()}
                onClick={() => openPoint(body, point)}
              >
                <i className={`ue-dot ue-dot--${body}`} />
                <span className="ue-row__time">{formatTime(new Date(point.t))}</span>
                <span className="ue-row__main">
                  <strong>{placeLabel(point)}</strong>
                  <small>
                    {coverageLabel(point.kind, point.coveredFraction)} ·{' '}
                    {LIGHT_PHASE_NAMES[lightPhaseOf(point.t, point.lat, point.lon)]}
                  </small>
                </span>
              </button>
            ))
          )}
          {layers.streets && (
            <div className="ue-list" data-testid="streets-today">
              <h2 className="ue-eyebrow">
                Streets today{moments.length > 0 ? ` · ${moments.length}` : ''}
              </h2>
              {streetsFailed && <p className="ue-empty">Street data could not be loaded.</p>}
              {!streetsFailed && streetViews && moments.length === 0 && (
                <p className="ue-empty">No street lines up on this day.</p>
              )}
              {topStreets.map((m) => (
                <button
                  key={`${m.body}-${m.view.bearingDeg}-${m.view.from.lat}`}
                  type="button"
                  className="ue-row ue-row--cta"
                  data-past={m.peak < Date.now()}
                  onClick={() => openStreet(m)}
                >
                  {m.body === 'moon' ? <MoonGlyph {...moonToday} /> : <i className="ue-dot ue-dot--sun" />}
                  <span className="ue-row__time">{formatTime(new Date(m.peak))}</span>
                  <span className="ue-row__main">
                    <strong>{m.view.name}</strong>
                    <small>
                      looking {compassPoint(m.view.bearingDeg)} · {(m.view.lengthM / 1000).toFixed(1)} km ·{' '}
                      {LIGHT_PHASE_NAMES[lightPhaseOf(m.peak, m.view.from.lat, m.view.from.lon)]}
                    </small>
                  </span>
                </button>
              ))}
              {layers.streets && liveStreets.length === 0 && nextStreet && (
                <p className="ue-note">
                  Next street lines up at{' '}
                  <button type="button" className="ue-link" onClick={() => setTime(nextStreet.from)}>
                    {formatTime(new Date(nextStreet.from))}
                  </button>
                  .
                </p>
              )}
            </div>
          )}
          <p className="ue-note">
            {viewFailed
              ? 'Building data could not be loaded, so these paths may be blocked. Check the preview before you travel.'
              : view
                ? 'Coloured paths show where to stand, with bright stretches free of buildings (trees are not included). The straight line runs from the sun or moon through the tower: its brighter part is where the disc is behind some part of the tower. Highlighted streets line up with the sun or moon right now.'
                : 'Checking buildings along the paths…'}
          </p>
        </section>
      </aside>
    </div>
  );
}
