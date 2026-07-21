/**
 * CameraControls — US6 — sensor/focal/zoom authoring UI for the camera profile.
 *
 * Pure presentation + nanostores wiring. Reads/writes `cameraProfile` from the store.
 * The CesiumViewer island listens to the same atom and applies the new frustum.fov
 * via fovToCesium(computeHorizontalFov(sensor, focal*zoom), aspectRatio).
 *
 * Rendered INSIDE the CesiumViewer island so it shares the client:only lifecycle.
 */
import { useStore } from '@nanostores/react';
import { cameraProfile, type CameraProfile } from '../../store.js';

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 220,
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

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 8,
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontVariantNumeric: 'tabular-nums',
};

interface SensorPreset {
  label: string;
  sensorWidth: number; // mm
}

const SENSOR_PRESETS: SensorPreset[] = [
  { label: 'Full-frame', sensorWidth: 36 },
  { label: 'APS-C', sensorWidth: 23.6 },
  { label: 'Micro 4/3', sensorWidth: 17.3 },
];

export default function CameraControls(): JSX.Element {
  const profile = useStore(cameraProfile);

  const update = (patch: Partial<CameraProfile>): void => {
    cameraProfile.set({ ...cameraProfile.get(), ...patch });
  };

  // Effective focal length accounts for the zoom multiplier (the *apparent* focal length
  // the FOV math consumes). Shown in the UI for clarity.
  const effectiveFocal = profile.focalLength * profile.zoom;
  // Horizontal FOV in degrees for display only — the actual radian value is computed
  // in CesiumViewer via computeHorizontalFov/fovToCesium.
  const hfovDeg =
    2 *
    (180 / Math.PI) *
    Math.atan(profile.sensorWidth / (2 * effectiveFocal));

  // The currently-active preset (if any) — compare by sensorWidth so a custom slider
  // value still highlights the matching preset.
  const activePreset = SENSOR_PRESETS.find((p) => p.sensorWidth === profile.sensorWidth);

  return (
    <div style={PANEL_STYLE} data-testid="camera-controls">
      <div style={{ fontWeight: 700, letterSpacing: 0.4 }}>CAMERA</div>

      <div style={ROW_STYLE}>
        <span style={{ opacity: 0.7 }}>Sensor</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {SENSOR_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => update({ sensorWidth: p.sensorWidth })}
              style={{
                flex: 1,
                padding: '4px 6px',
                border: '1px solid rgba(0,0,0,0.12)',
                borderRadius: 4,
                background:
                  profile.sensorWidth === p.sensorWidth ? '#111' : '#fff',
                color: profile.sensorWidth === p.sensorWidth ? '#fff' : '#111',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
          {activePreset
            ? `${activePreset.label} · ${profile.sensorWidth} mm`
            : `Custom · ${profile.sensorWidth.toFixed(1)} mm`}
        </span>
      </div>

      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE}>
          <span>Focal length</span>
          <span>{profile.focalLength} mm</span>
        </label>
        <input
          type="range"
          min={50}
          max={800}
          step={10}
          value={profile.focalLength}
          onChange={(e) => update({ focalLength: parseInt(e.currentTarget.value, 10) })}
          style={{ width: '100%' }}
        />
      </div>

      <div style={ROW_STYLE}>
        <label style={LABEL_STYLE}>
          <span>Zoom</span>
          <span>{profile.zoom.toFixed(1)}×</span>
        </label>
        <input
          type="range"
          min={1}
          max={4}
          step={0.1}
          value={profile.zoom}
          onChange={(e) => update({ zoom: parseFloat(e.currentTarget.value) })}
          style={{ width: '100%' }}
        />
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '6px 8px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.04)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <div>Effective: {effectiveFocal.toFixed(0)} mm</div>
        <div>Horizontal FOV: {hfovDeg.toFixed(2)}°</div>
      </div>
    </div>
  );
}
