/** The day's light as coloured bands behind a time slider. */
import { LIGHT_PHASE_NAMES, type LightBand, type LightPhase } from '../../../lib/lightPhases.js';

interface Props {
  bands: LightBand[];
  from: number;
  to: number;
}

const LEGEND: LightPhase[] = ['night', 'twilight', 'blue', 'golden', 'day'];

export default function LightRibbon({ bands, from, to }: Props): JSX.Element {
  const span = to - from;
  return (
    <div className="ue-ribbon" aria-hidden="true">
      {bands.map((band) => (
        <span
          key={band.from}
          className={`ue-light--${band.phase}`}
          title={LIGHT_PHASE_NAMES[band.phase]}
          style={{
            left: `${((Math.max(band.from, from) - from) / span) * 100}%`,
            width: `${((Math.min(band.to, to) - Math.max(band.from, from)) / span) * 100}%`,
          }}
        />
      ))}
    </div>
  );
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
