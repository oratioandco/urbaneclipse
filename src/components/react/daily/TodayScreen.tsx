/** Home screen: where the sun and moon line up behind the tower on a given day. */
import { useEffect, useMemo, useState } from 'react';
import {
  berlinDayBounds,
  berlinDayOf,
  formatDay,
  formatTime,
  shiftDay,
  type BerlinDay,
} from '../../../lib/berlinTime.js';
import {
  compassPoint,
  computeDayPath,
  dayHighlights,
  pointAtTime,
  type DayPath,
  type PathPoint,
} from '../../../lib/dailyPaths.js';
import { FERNSEHTURM } from '../../../lib/landmarks.js';
import type { Viewpoint } from '../../../lib/viewpoints.js';
import type { Body } from '../../../lib/bodyPosition.js';
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
  const [expanded, setExpanded] = useState(false);

  const bounds = useMemo(() => berlinDayBounds(day), [day]);
  const allPaths = useMemo(
    () =>
      (['sun', 'moon'] as const).map((body) =>
        computeDayPath({ body, start: bounds.start, end: bounds.end, landmark: FERNSEHTURM }),
      ),
    [bounds],
  );
  const paths = useMemo(() => allPaths.filter((p) => shown[p.body]), [allPaths, shown]);
  const [time, setTime] = useState(() => openingTime(day, allPaths, Date.now()));
  useEffect(() => {
    setTime(openingTime(day, allPaths, Date.now()));
    setFree(null);
  }, [day, allPaths]);

  const highlights = useMemo(
    () =>
      paths
        .flatMap((path) => dayHighlights(path).map((point) => ({ body: path.body, point })))
        .sort((a, b) => a.point.t - b.point.t),
    [paths],
  );

  const span = bounds.end.getTime() - bounds.start.getTime();
  const pct = (t: number) => `${((t - bounds.start.getTime()) / span) * 100}%`;
  const isToday = day === berlinDayOf(new Date());

  const openPoint = (body: Body, p: PathPoint): void =>
    onOpenSpot({ lat: p.lat, lon: p.lon, t: p.t, body, label: placeLabel(p) });

  return (
    <div className="ue-screen ue-today" hidden={!active}>
      <TodayMap
        paths={paths}
        time={time}
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
            <output>{formatTime(new Date(time))}</output>
            <div className="ue-chips">
              {(['sun', 'moon'] as const).map((body) => (
                <button
                  key={body}
                  type="button"
                  className={`ue-chip ue-chip--${body}`}
                  aria-pressed={shown[body]}
                  onClick={() => setShown((s) => ({ ...s, [body]: !s[body] }))}
                >
                  <i />
                  {BODY_NAME[body]}
                </button>
              ))}
            </div>
          </div>
          <div className="ue-tracks" aria-hidden="true">
            {paths.map((path) => (
              <div key={path.body} className={`ue-track ue-track--${path.body}`}>
                {path.segments.map((segment) => (
                  <span
                    key={segment[0].t}
                    style={{
                      left: pct(segment[0].t),
                      width: `calc(${pct(segment[segment.length - 1].t)} - ${pct(segment[0].t)})`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <input
            className="ue-range"
            type="range"
            aria-label="Time of day"
            min={bounds.start.getTime()}
            max={bounds.end.getTime() - 180_000}
            step={180_000}
            value={time}
            onChange={(e) => {
              setFree(null);
              setTime(Number(e.currentTarget.value));
            }}
          />
          <div className="ue-scale" aria-hidden="true">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
          </div>
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
                <small>{free.lat.toFixed(4)}, {free.lon.toFixed(4)} · calculated</small>
              </span>
              <span className="ue-row__go">Check dates</span>
            </button>
          </section>
        ) : (
          <section className="ue-now" aria-label="Where to stand at this time">
            {paths.map((path) => {
              const p = pointAtTime(path, time);
              const thin = path.body === 'moon' && path.illumination < 0.25;
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
                      {thin ? ' · thin moon, hard to see' : ''}
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

        <section className="ue-list" data-testid="highlights">
          <h2 className="ue-eyebrow">Best light</h2>
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
                  <small>{coverageLabel(point.kind, point.coveredFraction)}</small>
                </span>
              </button>
            ))
          )}
          <p className="ue-note">
            Paths are calculated from geometry. Buildings may block parts of them, so check the
            preview before you travel.
          </p>
        </section>
      </aside>
    </div>
  );
}
