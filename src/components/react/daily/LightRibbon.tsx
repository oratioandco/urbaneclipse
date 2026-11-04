/** The day's light as coloured bands behind a time slider. */
import {
  LIGHT_PHASE_NAMES,
  lightGradientStops,
  type LightBand,
  type LightPhase,
} from '../../../lib/lightPhases.js';

interface Props {
  bands: LightBand[];
  from: number;
  to: number;
}

const LEGEND: LightPhase[] = ['night', 'twilight', 'blue', 'golden', 'day'];

export default function LightRibbon({ bands, from, to }: Props): JSX.Element {
  const stops = lightGradientStops(bands, from, to)
    .map((stop) => `var(--ue-light-${stop.phase}) ${(stop.at * 100).toFixed(2)}%`)
    .join(', ');
  return <div className="ue-ribbon" aria-hidden="true" style={{ background: `linear-gradient(to right, ${stops})` }} />;
}

/** Names the colours. Shown once per screen. */
export function LightLegend(): JSX.Element {
  return (
    <ul className="ue-legend" aria-hidden="true">
      {LEGEND.map((phase) => (
        <li key={phase}>
          <i className={`ue-light--${phase}`} />
          {LIGHT_PHASE_NAMES[phase]}
        </li>
      ))}
    </ul>
  );
}
