/**
 * HourTimeline — US4 — color-coded solar-day band bar with a "now" marker.
 *
 * Pure presentation + nanostores wiring. Reads `dateTime` from the store, computes
 * suncalc.getTimes for that date at OBSERVER_DEFAULT, classifies the day into
 * golden/blue/day/night bands via buildTimelineBands, and renders a horizontal bar
 * plus a marker at the current dateTime position.
 *
 * Rendered INSIDE the CesiumViewer island so it shares the client:only lifecycle.
 * Imports suncalc directly — fine, suncalc is pure JS (no WebGL) and the island is
 * client:only (suncalc never loads in the SSR graph).
 */
import { useStore } from '@nanostores/react';
import { getTimes } from 'suncalc';
import { dateTime } from '../../store.js';
import { buildTimelineBands, type Band, type BandKind } from '../../lib/timeline.js';
import { OBSERVER_DEFAULT } from '../../lib/berlin.js';

const BAND_COLOR: Record<BandKind, string> = {
  golden: '#f5b942', // amber
  blue: '#3b82f6', // blue
  day: '#fde68a', // pale daylight (light yellow reads as "lit")
  night: '#1e293b', // dark slate
};

const CONTAINER_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  right: 16,
  bottom: 16,
  zIndex: 10,
  padding: '8px 12px',
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 8,
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 11,
  color: '#111',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  pointerEvents: 'auto',
};

const BAR_HEIGHT = 14;

/** Project a Date onto the [0,1] span of one solar day centered on `dayStart`. */
function fractionOfDay(t: Date, dayStart: number, daySpan: number): number {
  return (t.getTime() - dayStart) / daySpan;
}

/** Render one band as an absolutely-positioned colored segment inside the bar. */
function renderBand(b: Band, dayStart: number, daySpan: number, keyPrefix: string) {
  const startF = fractionOfDay(b.start, dayStart, daySpan);
  const endF = fractionOfDay(b.end, dayStart, daySpan);
  // Handle midnight-wrap (night band): clip to [0,1] and emit two segments.
  if (startF > endF) {
    return [
      <div
        key={`${keyPrefix}-a`}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: `${endF * 100}%`,
          background: BAND_COLOR[b.kind],
        }}
      />,
      <div
        key={`${keyPrefix}-b`}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
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
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
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
  let bands: Band[] = [];
  try {
    const times = getTimes(dt, OBSERVER_DEFAULT.lat, OBSERVER_DEFAULT.lon);
    bands = buildTimelineBands(times);
  } catch {
    bands = [];
  }

  const markerF = Math.max(0, Math.min(1, fractionOfDay(dt, dayStart, daySpan)));

  // UTC hours tick labels (00, 06, 12, 18, 24) for orientation.
  const ticks = [0, 6, 12, 18, 24];

  return (
    <div style={CONTAINER_STYLE} data-testid="hour-timeline">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, letterSpacing: 0.4 }}>SOLAR DAY</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
          {dt.toISOString().slice(0, 16)}Z
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          height: BAR_HEIGHT,
          background: '#e5e7eb', // neutral base for any uncovered gap
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {bands.map((b, i) => renderBand(b, dayStart, daySpan, `band-${i}-${b.kind}`))}
        {/* Now marker — vertical line + triangle */}
        <div
          data-testid="hour-timeline-marker"
          style={{
            position: 'absolute',
            top: -2,
            bottom: -2,
            left: `${markerF * 100}%`,
            width: 2,
            background: '#dc2626',
            transform: 'translateX(-1px)',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div
        style={{
          position: 'relative',
          height: 12,
          marginTop: 2,
          color: '#555',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ticks.map((h) => (
          <span
            key={h}
            style={{
              position: 'absolute',
              left: `${(h / 24) * 100}%`,
              transform: h === 0 ? 'translateX(0)' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        {(['golden', 'blue', 'day', 'night'] as BandKind[]).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                background: BAND_COLOR[k],
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.1)',
              }}
            />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}
