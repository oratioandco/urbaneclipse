/**
 * Does a day's row show what it says, from where one stands? A row names a picture ("Moonset
 * behind the TV tower's antenna", "Sun behind the Viktoria"); once the planner has flown to its
 * spot, this says what the body really is behind from that eye point at the row's minute, by
 * the same rules the eye-level line uses (towerShots.js, landmarkShots.js). Pure: the sweep of
 * a year's rows (scripts/adversarial/rows.mjs) and the tests ask here.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FIGURE_TARGETS } from '../lib/landmarkStands.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { sceneFromLatLon } from './eye.js';
import { figureView } from './landmarkShots.js';
import { bodyAgainstTower } from './towerShots.js';

/** What each kind of tower row promises, as states of `bodyAgainstTower`. */
const PROMISED = {
  antenna: ['antenna'],
  // The sun behind, round or at the edge of the sphere; the moon round it or at its edge.
  sphere: { sun: ['hidden', 'ring', 'edge'], moon: ['ring', 'edge'] },
};

/**
 * @param row a row of `collectRows` (dayShots.js)
 * @param eye { x, y, z } the eye in scene metres (y is the eye's own height)
 * @param base the scene's ground height at the tower's foot
 * @param t the instant looked at: the row's own, or the clock's when the planner opened the
 *   row at another minute of its pass (each minute has its own spot)
 * @returns { says, sees, ok }: what the row promises, what stands there, and whether they agree
 */
export function rowSeen(row, eye, base = 0, t = row.openAt ?? row.t) {
  const body = sampleBody(row.body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  if (row.kind === 'street') {
    const view = row.moment.view;
    const off = Math.abs(((((body.az - view.bearingDeg) % 360) + 540) % 360) - 180);
    const ok = body.alt > 0 && off <= view.toleranceDeg + 0.3;
    return { says: 'street', sees: ok ? 'street' : `${off.toFixed(1)}° off the street`, ok };
  }
  if (row.target) {
    const target = FIGURE_TARGETS.find((item) => item.id === row.target);
    const [x, z] = sceneFromLatLon(target.landmark.lat, target.landmark.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
    const view = figureView(target, eye, { x, z }, body);
    return { says: row.where, sees: view.covered ? row.where : `${Math.hypot(view.across, view.up).toFixed(2)}° beside the figure`, ok: view.covered };
  }
  const where = row.where ?? 'sphere';
  const promised = where === 'antenna' ? PROMISED.antenna : PROMISED.sphere[row.body];
  const { state } = bodyAgainstTower(eye, base, body);
  return { says: where, sees: state, ok: promised.includes(state) };
}
