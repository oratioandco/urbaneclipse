/**
 * ControlPanel — plaster-void overlay for the line-of-sight controls.
 *
 * Rendered INSIDE the CesiumViewer island (not its own `client:only` island) so it
 * shares the same React tree + the same browser-only lifecycle. Reads/writes the
 * shared nanostores in src/store.ts:
 *   - dateTime       (US3 datetime-local input; scrub via setDateTimeScrubbing while
 *                     the picker is open, commit on blur / change)
 *   - observerHeight (slider, 0.5..50 m above ellipsoid)
 *   - targetHeight   (slider, 1..400 m above ellipsoid)
 *   - isOccluded     (read-only display: CLEAR / BLOCKED)
 *
 * Pure presentation + store wiring — NO Cesium import (Constitution Principle I).
 */
import { useStore } from '@nanostores/react';
import {
  dateTime,
  observerHeight,
  targetHeight,
  isOccluded,
  setDateTimeScrubbing,
} from '../../store.js';

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
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
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 8,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontVariantNumeric: 'tabular-nums',
};

const statusBase: React.CSSProperties = {
  marginTop: 10,
  padding: '6px 8px',
  borderRadius: 4,
  fontWeight: 700,
  textAlign: 'center',
  letterSpacing: 0.5,
  fontVariantNumeric: 'tabular-nums',
};

/**
 * Round-trip helpers between a JS Date and an <input type="datetime-local"> value.
 * The input's .value is a "local time" string with NO timezone marker
 * (e.g. "2026-07-21T13:45"); we interpret it as UTC to keep the store TZ-stable.
 * (Display-only consumers can format toISOString for explicitness; the store carries
 * an absolute instant either way.)
 */
function dateToLocalInput(d: Date): string {
  // YYYY-MM-DDTHH:MM, all in UTC. Cheap manual format avoids toISOString's trailing 'Z'
  // (which the input rejects) and any local-timezone drift.
  const iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  return iso.slice(0, 16);
}
function localInputToDate(s: string): Date {
  // The input never includes seconds or ms; parse as UTC by appending 'Z'. If the user
  // cleared the field, fall back to "now" so the store never holds an Invalid Date.
  if (!s) return new Date();
  return new Date(`${s}:00Z`);
}

export default function ControlPanel(): JSX.Element {
  const oh = useStore(observerHeight);
  const th = useStore(targetHeight);
  const occluded = useStore(isOccluded);
  const dt = useStore(dateTime);

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 700, letterSpacing: 0.4 }}>LINE OF SIGHT</div>

      {/* US3 — date/time scrub. While typing, scrub via setDateTimeScrubbing (rAF
          coalesced, no spam); on a final commit (change event), set directly. The
          CesiumViewer island listens to dateTime and pushes it into viewer.clock so
          Cesium's sun/shadows follow suncalc time (Strategy B). */}
      <div style={rowStyle}>
        <label style={labelStyle}>
          <span>Date / time (UTC)</span>
          <span style={{ opacity: 0.6 }}>{dt.toISOString().slice(11, 16)}Z</span>
        </label>
        <input
          type="datetime-local"
          value={dateToLocalInput(dt)}
          onInput={(e) =>
            setDateTimeScrubbing(localInputToDate(e.currentTarget.value))
          }
          onChange={(e) =>
            dateTime.set(localInputToDate(e.currentTarget.value))
          }
          style={{ width: '100%', font: 'inherit', padding: '3px 4px' }}
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          <span>Observer height</span>
          <span>{oh.toFixed(1)} m</span>
        </label>
        <input
          type="range"
          min={0.5}
          max={50}
          step={0.5}
          value={oh}
          onChange={(e) => observerHeight.set(parseFloat(e.currentTarget.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>
          <span>Target height</span>
          <span>{th.toFixed(0)} m</span>
        </label>
        <input
          type="range"
          min={1}
          max={400}
          step={1}
          value={th}
          onChange={(e) => targetHeight.set(parseFloat(e.currentTarget.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div
        style={{
          ...statusBase,
          background: occluded ? 'rgba(220,60,60,0.15)' : 'rgba(60,180,90,0.15)',
          color: occluded ? '#a02020' : '#1f7a3a',
        }}
      >
        {occluded ? 'BLOCKED' : 'CLEAR'}
      </div>
    </div>
  );
}
