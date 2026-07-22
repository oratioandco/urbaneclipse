/**
 * CameraControls — US6 — sensor/focal/zoom authoring UI for the camera profile.
 *
 * Pure presentation + nanostores wiring. Reads/writes `cameraProfile` from the store.
 * The CesiumViewer island listens to the same atom and applies the new frustum.fov
 * via fovToCesium(computeHorizontalFov(sensor, focal*zoom), aspectRatio).
 *
 * Rendered INSIDE the CesiumViewer island so it shares the client:only lifecycle.
 *
 * NOTE (headless diagnostic contract): scripts/diagnose.mjs finds the APS-C preset by
 * matching a <button> whose trimmed textContent is EXACTLY 'APS-C'. Keep the preset
 * buttons as real <button> elements whose only text is `preset.code` — descriptive
 * copy lives in the caption line below the segment, never inside the button.
 */
import { useStore } from '@nanostores/react';
import { cameraProfile, type CameraProfile } from '../../store.js';

interface SensorPreset {
  /** The button's entire textContent — see the diagnostic contract note above. */
  code: string;
  label: string;
  sensorWidth: number; // mm
}

const SENSOR_PRESETS: SensorPreset[] = [
  { code: 'FF', label: 'Full-frame', sensorWidth: 36 },
  { code: 'APS-C', label: 'APS-C', sensorWidth: 23.6 },
  { code: 'M4/3', label: 'Micro 4/3', sensorWidth: 17.3 },
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
    2 * (180 / Math.PI) * Math.atan(profile.sensorWidth / (2 * effectiveFocal));

  // The currently-active preset (if any) — compare by sensorWidth so a custom slider
  // value still highlights the matching preset.
  const activePreset = SENSOR_PRESETS.find(
    (p) => p.sensorWidth === profile.sensorWidth,
  );

  // Defensive display (T059): a corrupted/persisted profile could yield a
  // non-finite FOV. Say so rather than printing "NaN°".
  const fovValid = Number.isFinite(hfovDeg) && hfovDeg > 0;

  return (
    <section className="pv-panel" data-testid="camera-controls">
      <header className="pv-panel__head">
        <h2 className="pv-panel__title">
          <span className="pv-panel__index">02</span>Optics
        </h2>
        <span className="pv-panel__meta">
          {fovValid ? `${hfovDeg.toFixed(2)}° h` : '—'}
        </span>
      </header>

      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Sensor</span>
          <span className="pv-value pv-value--sub">
            {profile.sensorWidth.toFixed(1)} mm
          </span>
        </div>
        <div className="pv-segment" role="group" aria-label="Sensor format">
          {SENSOR_PRESETS.map((p) => {
            const on = profile.sensorWidth === p.sensorWidth;
            return (
              <button
                key={p.code}
                type="button"
                aria-pressed={on}
                title={`${p.label} — ${p.sensorWidth} mm wide`}
                onClick={() => update({ sensorWidth: p.sensorWidth })}
                className={`pv-btn${on ? ' pv-btn--on' : ''}`}
              >
                {p.code}
              </button>
            );
          })}
        </div>
        <p className="pv-note">
          {activePreset ? activePreset.label : 'Custom format'}
        </p>
      </div>

      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Focal length</span>
          <span className="pv-value">{profile.focalLength} mm</span>
        </div>
        <input
          className="pv-range"
          type="range"
          aria-label="Focal length in millimetres"
          min={50}
          max={800}
          step={10}
          value={profile.focalLength}
          onChange={(e) =>
            update({ focalLength: parseInt(e.currentTarget.value, 10) })
          }
        />
        <div className="pv-scale">
          <span>50</span>
          <span>800 mm</span>
        </div>
      </div>

      <div className="pv-field">
        <div className="pv-field__line">
          <span className="pv-label">Zoom</span>
          <span className="pv-value">{profile.zoom.toFixed(1)}×</span>
        </div>
        <input
          className="pv-range"
          type="range"
          aria-label="Zoom multiplier"
          min={1}
          max={4}
          step={0.1}
          value={profile.zoom}
          onChange={(e) => update({ zoom: parseFloat(e.currentTarget.value) })}
        />
        <div className="pv-scale">
          <span>1.0×</span>
          <span>4.0×</span>
        </div>
      </div>

      <dl className="pv-readout">
        <div className="pv-readout__row">
          <dt className="pv-label">Effective</dt>
          <dd className="pv-value">{effectiveFocal.toFixed(0)} mm</dd>
        </div>
        <div className="pv-readout__row">
          <dt className="pv-label">Horiz. FOV</dt>
          <dd className="pv-value">
            {fovValid ? `${hfovDeg.toFixed(2)}°` : 'unavailable'}
          </dd>
        </div>
      </dl>

      {!fovValid && (
        <div className="pv-msg pv-msg--error" role="alert">
          <strong className="pv-msg__title">Invalid camera profile</strong>
          The sensor width and effective focal length must both be positive, so the
          field of view cannot be derived. Pick a sensor preset to reset the optics.
        </div>
      )}
    </section>
  );
}
