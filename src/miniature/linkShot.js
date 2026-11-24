/**
 * Does a link's standing point belong to the shot the link names? A planner link carries both
 * (`at=…&shot=…&here=1`), and a card on the ticket says "this view is that shot". Edited by
 * hand, or put together wrongly, a link can name a tower shot from a place where the tower and
 * the body are nowhere near each other. Pure: no three.js, no DOM.
 *
 *   shotSeenFrom(row, lat, lon)   true when, from there at the row's minute, the shot is at
 *                                 least roughly what the row says
 *
 * Tower rows (sphere, antenna): the body's bearing and the bearing to the tower agree within
 * 2 degrees, so the body is at the tower. Street rows: the place is within the street's length
 * of where the street is seen from. Other rows (a landmark's figures) are not judged here.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';

const METRES_PER_DEG = 111_320;
const offset = (fromLat, fromLon, toLat, toLon) => ({ east: (toLon - fromLon) * METRES_PER_DEG * Math.cos((fromLat * Math.PI) / 180), north: (toLat - fromLat) * METRES_PER_DEG });

export const TOWER_WITHIN_DEG = 2;

export function shotSeenFrom(row, lat, lon) {
  if (row.kind === 'tower' && (row.landmark ?? 'fernsehturm') === 'fernsehturm') {
    const { east, north } = offset(lat, lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
    const toTower = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    const body = sampleBody(row.body, new Date(row.openAt ?? row.t), lat, lon);
    const off = Math.abs(((body.az - toTower + 540) % 360) - 180);
    return off <= TOWER_WITHIN_DEG;
  }
  if (row.kind === 'street' && row.at) {
    const { east, north } = offset(lat, lon, row.at[0], row.at[1]);
    return Math.hypot(east, north) <= Math.max(150, row.distanceM ?? 0);
  }
  return true;
}
