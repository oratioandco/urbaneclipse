/**
 * HourTimeline — US4 — colour-coded solar-day band bar with a "now" marker.
 *
 * Pure presentation + nanostores wiring. Reads `dateTime` from the store, computes
 * suncalc.getTimes for that date at OBSERVER_DEFAULT, classifies the day into
 * golden/blue/day/night bands via buildTimelineBands, and renders a horizontal bar
 * plus a marker at the current dateTime position.
 *
 * Rendered INSIDE the CesiumViewer island so it shares the client:only lifecycle.
 * Imports suncalc directly — fine, suncalc is pure JS (no WebGL) and the island is
 * client:only (suncalc never loads in the SSR graph).
 *
 * T059: suncalc returns Invalid Dates at extreme latitudes / for a malformed instant,
 * and buildTimelineBands can legitimately return nothing. Both cases render an explicit
 * message instead of an empty grey bar.
 *
 * HARD CONTRACT: data-testid="hour-timeline" and data-testid="hour-timeline-marker"
 * are consumed by scripts/diagnose.mjs — do not rename or conditionally remove them.
 */
import { useStore } from '@nanostores/react';
import { getTimes } from 'suncalc';
import { dateTime } from '../../store.js';
import { buildTimelineBands, type Band, type BandKind } from '../../lib/timeline.js';
import { OBSERVER_DEFAULT } from '../../lib/berlin.js';

/** Flat gouache pigments; mirrored as CSS custom properties in global.css. */
const BAND_COLOR: Record<BandKind, string> = {
  golden: 'var(--pv-band-golden)',
  blue: 'var(--pv-band-blue)',
  day: 'var(--pv-band-day)',
  night: 'var(--pv-band-night)',
};

const BAND_LABEL: Record<BandKind, string> = {
  golden: 'Golden',
  blue: 'Blue',
  day: 'Day',
  night: 'Night',
};

/** Project a Date onto the [0,1] span of one solar day centred on `dayStart`. */
function fractionOfDay(t: Date, dayStart: number, daySpan: number): number {
  return (t.getTime() - dayStart) / daySpan;
}

/** Render one band as an absolutely-positioned coloured segment inside the bar. */
function renderBand(b: Band, dayStart: number, daySpan: number, keyPrefix: string) {
  const startF = fractionOfDay(b.start, dayStart, daySpan);
  const endF = fractionOfDay(b.end, dayStart, daySpan);
  // Handle midnight-wrap (night band): clip to [0,1] and emit two segments.
  if (startF > endF) {
    return [
      <div
        key={`${keyPrefix}-a`}
        className="pv-timeline__band"
        style={{ left: 0, width: `${endF * 100}%`, background: BAND_COLOR[b.kind] }}
      />,
      <div
        key={`${keyPrefix}-b`}
        className="pv-timeline__band"
        style={{
          left: `${startF * 100}%`,
          right: 0,
          background: BAND_COLOR[b.kind],
        }}
      />,
    ];
  }
  return (
    <div
      key={keyPrefix}
      className="pv-timeline__band"
      style={{
        left: `${startF * 100}%`,
        width: `${(endF - startF) * 100}%`,
        background: BAND_COLOR[b.kind],
      }}
    />
  );
}

export default function HourTimeline(): JSX.Element {
  const dt = useStore(dateTime);

  // suncalc.getTimes returns the events of the day containing `dt` (it ignores the
  // time-of-day). Use the UTC midnight BEFORE dt as the day span anchor so the marker
  // stays inside [0,1] for any time-of-day.
  const dayStart = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  // 24h span; night wraps past this boundary (clipped on render).
  const daySpan = 24 * 60 * 60 * 1000;

  // suncalc 2.0.1 getTimes signature: (date, lat, lng). Field shape verified in tests.
  // T059: never let a solar-event failure render as a silently empty bar.
  let bands: Band[] = [];
  let bandError: string | null = null;
  try {
    const times = getTimes(dt, OBSERVER_DEFAULT.lat, OBSERVER_DEFAULT.lon);
    bands = buildTimelineBands(times);
    if (bands.length === 0) {
      bandError = 'No sunrise/sunset transitions resolved for this date.';
    }
  } catch (err) {
    bands = [];
    bandError = err instanceof Error ? err.message : String(err);
  }

  const markerF = Math.max(0, Math.min(1, fractionOfDay(dt, dayStart, daySpan)));

  // Legend keys ONLY the kinds actually drawn. buildTimelineBands legitimately omits
  // bands whose suncalc endpoints are null — e.g. Berlin in high summer has no
  // astronomical `night`/`nightEnd`, so a static four-item legend would advertise a
  // colour that appears nowhere on the bar.
  const presentKinds = (['golden', 'blue', 'day', 'night'] as BandKind[]).filter((k) =>
    bands.some((b) => b.kind === k),
  );
  const absentKinds = (['golden', 'blue', 'day', 'night'] as BandKind[]).filter(
    (k) => !presentKinds.includes(k),
  );

  // UTC hour ticks for orientation.
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <section className="pv-panel" data-testid="hour-timeline">
      <header className="pv-panel__head">
        <h2 className="pv-panel__title">
          <span className="pv-panel__index">04</span>Solar day
        </h2>
        <span className="pv-panel__meta">
          {dt.toISOString().slice(0, 10)} · {dt.toISOString().slice(11, 16)} UTC ·{' '}
          {OBSERVER_DEFAULT.lat.toFixed(3)}°N {OBSERVER_DEFAULT.lon.toFixed(3)}°E
        </span>
      </header>

      <div className="pv-timeline__bar">
        {bands.map((b, i) => renderBand(b, dayStart, daySpan, `band-${i}-${b.kind}`))}
        {/* Now marker — a single hairline rule, haloed so it reads over any band. */}
        <div
          data-testid="hour-timeline-marker"
          className="pv-timeline__marker"
          style={{ left: `${markerF * 100}%` }}
        />
      </div>

      <div className="pv-timeline__ticks">
        {ticks.map((h) => (
          <span
            key={h}
            className="pv-timeline__tick"
            style={{
              left: `${(h / 24) * 100}%`,
              transform:
                h === 0
                  ? 'translateX(0)'
                  : h === 24
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
            }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>

      {bandError ? (
        <div className="pv-msg pv-msg--warn" role="status">
          <strong className="pv-msg__title">Solar bands unavailable</strong>
          The golden/blue/day/night classification could not be computed for this
          instant, so the bar above is unbanded. The time marker is still accurate.
          <span className="pv-msg__detail">{bandError}</span>
        </div>
      ) : (
        <div className="pv-legend">
          {presentKinds.map((k) => (
            <span key={k} className="pv-legend__item">
              <span
                className="pv-legend__swatch"
                style={{ background: BAND_COLOR[k] }}
                aria-hidden="true"
              />
              {BAND_LABEL[k]}
            </span>
          ))}
          {absentKinds.length > 0 && (
            <span className="pv-legend__item" style={{ color: 'var(--pv-ink-34)' }}>
              No {absentKinds.map((k) => BAND_LABEL[k].toLowerCase()).join(' / ')} at
              this latitude on this date
            </span>
          )}
        </div>
      )}
    </section>
  );
}
