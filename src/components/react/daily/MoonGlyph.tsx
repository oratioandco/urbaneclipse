/** A small moon showing its phase, as seen from Berlin. */
import { litDiscPath, phaseLabel } from '../../../lib/moonPhase.js';

interface Props {
  fraction: number;
  waxing: boolean;
}

export default function MoonGlyph({ fraction, waxing }: Props): JSX.Element {
  return (
    <svg className="ue-moon-glyph" viewBox="-1.1 -1.1 2.2 2.2" role="img" aria-label={phaseLabel(fraction, waxing)}>
      <circle className="ue-moon-glyph__dark" r="1" />
      <path className="ue-moon-glyph__lit" d={litDiscPath(fraction, waxing)} />
    </svg>
  );
}
