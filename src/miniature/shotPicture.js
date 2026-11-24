/**
 * A shot as one small picture: the canonical sun or moon (bodies.js), as it looks at that
 * minute, behind the icon set's TV tower or at the end of its street (icons.js). It says in
 * one glance what the words beside it say: which body, and behind the tower or down a street.
 * Nothing is drawn here that the two modules do not already draw.
 */
import { moonFragment, sunFragment } from './bodies.js';
import { bodyState } from './bodyAt.js';
import { ICON_STROKE, iconBody } from './icons.js';

/** The landmark in front of the disc: the warm near-black of the miniature's shadows. */
const SILHOUETTE = '#24221f';
let serial = 0;

/** Where the disc sits in the 24-unit box: behind the sphere, on the antenna, or down the street. */
const PLACE = {
  sphere: { x: 12, y: 10.5, r: 6.75 },
  antenna: { x: 12, y: 5.75, r: 5 },
  street: { x: 12, y: 7, r: 5.25 },
};

/**
 * @param {{ body: 'sun'|'moon', kind: 'tower'|'street', where?: 'sphere'|'antenna', t: number }} row
 * @param {{ size?: number }} [options] side of the box in CSS pixels
 */
export function shotPicture(row, { size = 32 } = {}) {
  const state = bodyState(row.body, row.t);
  const at = PLACE[row.kind === 'street' ? 'street' : row.where === 'antenna' ? 'antenna' : 'sphere'];
  const disc = state.kind === 'moon' ? moonFragment(at.x, at.y, at.r, { ...state, glow: false }) : sunFragment(at.x, at.y, at.r, state.altitudeDeg, { glow: false });
  // The tower stands in front of the disc: its sphere solid, as a silhouette is.
  const front = row.kind === 'street' ? iconBody('henge') : `${iconBody('tower')}<circle cx="12" cy="10.5" r="3.25" fill="currentColor"/>`;
  // In front of the bright disc the landmark is a silhouette, dark in both themes; beside the
  // disc it is drawn in the text colour like every icon. So it is drawn twice, the dark one
  // clipped to the disc.
  const id = `ue-shot-${++serial}`;
  const strokes = `fill="none" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ue-shot ue-shot-${row.kind}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<defs><clipPath id="${id}"><circle cx="${at.x}" cy="${at.y}" r="${at.r}"/></clipPath></defs>` +
    `${disc}<g ${strokes} stroke="currentColor">${front}</g>` +
    `<g ${strokes} stroke="currentColor" color="${SILHOUETTE}" clip-path="url(#${id})">${front}</g></svg>`
  );
}
