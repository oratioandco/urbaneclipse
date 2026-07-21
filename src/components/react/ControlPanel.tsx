/**
 * ControlPanel — plaster-void overlay for the line-of-sight controls.
 *
 * Rendered INSIDE the CesiumViewer island (not its own `client:only` island) so it
 * shares the same React tree + the same browser-only lifecycle. Reads/writes the
 * shared nanostores in src/store.ts:
 *   - observerHeight (slider, 0.5..50 m above ellipsoid)
 *   - targetHeight   (slider, 1..400 m above ellipsoid)
 *   - isOccluded     (read-only display: CLEAR / BLOCKED)
 *
 * Pure presentation + store wiring — NO Cesium import (Constitution Principle I).
 */
import { useStore } from '@nanostores/react';
import { observerHeight, targetHeight, isOccluded } from '../../store.js';

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

export default function ControlPanel(): JSX.Element {
  const oh = useStore(observerHeight);
  const th = useStore(targetHeight);
  const occluded = useStore(isOccluded);

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 700, letterSpacing: 0.4 }}>LINE OF SIGHT</div>

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
