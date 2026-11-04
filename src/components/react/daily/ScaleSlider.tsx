/** A logarithmic slider with labelled marks. */
import { logPosition, logValue } from '../../../lib/lensScale.js';

interface Props {
  label: string;
  /** Shown beside the label. */
  readout: string;
  value: number;
  min: number;
  max: number;
  marks: readonly number[];
  format: (mark: number) => string;
  round: (value: number) => number;
  onChange: (value: number) => void;
  /** Spoken value, for screen readers. */
  valueText: string;
}

const STEPS = 1000;

export default function ScaleSlider({
  label,
  readout,
  value,
  min,
  max,
  marks,
  format,
  round,
  onChange,
  valueText,
}: Props): JSX.Element {
  return (
    <div className="ue-scale-slider">
      <div className="ue-scale-slider__head">
        <span>{label}</span>
        <output>{readout}</output>
      </div>
      <input
        className="ue-range"
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={STEPS}
        step={1}
        value={Math.round(logPosition(value, min, max) * STEPS)}
        onChange={(e) => onChange(round(logValue(Number(e.currentTarget.value) / STEPS, min, max)))}
      />
      <div className="ue-marks" aria-hidden="true">
        {marks.map((mark) => (
          <span key={mark} style={{ '--at': logPosition(mark, min, max) } as React.CSSProperties}>
            {format(mark)}
          </span>
        ))}
      </div>
    </div>
  );
}
