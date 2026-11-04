/** Sensor, lens and eye height for a preview. */
import { useState, type ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import {
  EYE_MARKS,
  EYE_MAX_M,
  EYE_MIN_M,
  SENSOR_FORMATS,
  focalForFov,
  roundEye,
  roundFocal,
  sensorFormatFor,
  type SensorFormat,
} from '../../../lib/lensScale.js';
import { cameraProfile, lensAutoFit, observerHeight, setCameraProfile } from '../../../store.js';
import ScaleSlider from './ScaleSlider.js';

interface Props {
  fovDeg?: number;
  autoLabel: string;
  /** Lets the screen make room while the panel is open. */
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}

export default function AdjustPanel({ fovDeg, autoLabel, onOpenChange }: Props): JSX.Element {
  const eye = useStore(observerHeight);
  const auto = useStore(lensAutoFit);
  const camera = useStore(cameraProfile);
  const [open, setOpen] = useState(false);

  const format = sensorFormatFor(camera.sensorWidth);
  // In auto the scene chooses the framing, so the scale shows the lens that matches it.
  const shownFocal = auto && fovDeg ? roundFocal(focalForFov(fovDeg, format.width)) : camera.focalLength;

  /** Keeps the framing mode, and keeps the lens inside the new format's range. */
  const chooseSensor = (f: SensorFormat): void => {
    const focalLength = Math.min(f.maxFocal, Math.max(f.minFocal, camera.focalLength));
    cameraProfile.set({ ...camera, sensorWidth: f.width, focalLength, zoom: 1 });
  };

  return (
    <section className="ue-adjust">
      <button
        type="button"
        className="ue-adjust__toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          onOpenChange(!open);
        }}
      >
        Adjust
        <span>{shownFocal} mm{auto ? ' auto' : ''} · eye {eye.toFixed(1)} m</span>
      </button>
      {open && (
        <div className="ue-adjust__body">
          <div className="ue-chips" role="group" aria-label="Sensor">
            {SENSOR_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="ue-chip"
                aria-pressed={format.id === f.id}
                onClick={() => chooseSensor(f)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div>
            <ScaleSlider
              label="Lens"
              readout={`${shownFocal} mm`}
              value={shownFocal}
              min={format.minFocal}
              max={format.maxFocal}
              marks={format.focalMarks}
              format={String}
              round={roundFocal}
              valueText={`${shownFocal} millimetres`}
              onChange={(mm) => setCameraProfile({ ...camera, focalLength: mm, zoom: 1 })}
            />
            <button
              type="button"
              className="ue-chip ue-chip--auto"
              aria-pressed={auto}
              onClick={() => lensAutoFit.set(true)}
            >
              {autoLabel}
            </button>
          </div>
          <ScaleSlider
            label="Eye height"
            readout={`${eye.toFixed(1)} m`}
            value={eye}
            min={EYE_MIN_M}
            max={EYE_MAX_M}
            marks={EYE_MARKS}
            format={(m) => `${m} m`}
            round={roundEye}
            valueText={`${eye.toFixed(1)} metres`}
            onChange={(m) => observerHeight.set(m)}
          />
        </div>
      )}
    </section>
  );
}
