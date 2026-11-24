/**
 * At eye level with a landmark shot open (the Siegessäule's Viktoria, the Brandenburger Tor's
 * quadriga): what the status line, the viewfinder's caption and the map say about THAT
 * landmark, where they would otherwise speak of the TV tower. The open shot is `app.ticketShot`
 * (daylist.js keeps it); the maths is `figureView` in landmarkShots.js.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FIGURE_TARGETS } from '../lib/landmarkStands.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { sceneFromLatLon } from './eye.js';
import { figureView, figureWord } from './landmarkShots.js';
import { app } from './state.js';
import { formatClock } from './time.js';

const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
const distanceText = (m) => (m < 995 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * The open landmark shot as seen from an eye point (scene metres) at an instant, or null when
 * the open shot is not a landmark's: the shot, its target, the body, how far the eye has moved
 * from the shot's own spot (`movedM`), and `figureView`'s numbers.
 */
export function landmarkAtEye(eye, t) {
  const shot = app.ticketShot;
  if (!shot?.target) return null;
  const target = FIGURE_TARGETS.find((item) => item.id === shot.target);
  if (!target) return null;
  const [x, z] = sceneFromLatLon(target.landmark.lat, target.landmark.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const [sx, sz] = sceneFromLatLon(shot.at[0], shot.at[1], FERNSEHTURM.lat, FERNSEHTURM.lon);
  const body = sampleBody(shot.body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  return { shot, target, figure: figureWord(target), body, movedM: Math.hypot(eye.x - sx, eye.z - sz), ...figureView(target, eye, { x, z }, body) };
}

/**
 * The status line for the open landmark shot: `{ text, state, body, at }`, or null. `state` is
 * 'now' (the disc is on the figure), 'soon' or 'idle'; `at` is the instant a tap goes to.
 * Pure but for `landmarkAtEye`.
 */
export function landmarkStatus(eye, t) {
  const view = landmarkAtEye(eye, t);
  if (!view) return null;
  const { shot, figure } = view;
  const name = BODY_NAME[shot.body];
  if (view.covered) return { text: `${name} behind the ${figure} now`, state: 'now', body: shot.body, at: null };
  const minutes = Math.round((shot.t - t) / 60_000);
  // On the shot's own spot the alignment is a matter of time; anywhere else it is not coming.
  if (view.movedM < 30 && minutes !== 0 && Math.abs(minutes) <= 240) {
    const text = minutes > 0 ? `${name} behind the ${figure} in ${minutes} min (${formatClock(shot.t)})` : `${name} was behind the ${figure} ${-minutes} min ago (${formatClock(shot.t)})`;
    return { text, state: 'soon', body: shot.body, at: shot.t };
  }
  if (view.body.alt <= 0) return { text: `${name} is down: nothing behind the ${figure} now`, state: 'idle', body: shot.body, at: shot.t };
  const off = Math.hypot(view.across, view.up);
  const side = Math.abs(view.across) >= Math.abs(view.up) ? (view.across > 0 ? 'right of' : 'left of') : view.up > 0 ? 'above' : 'below';
  return { text: `${name} ${off < 10 ? off.toFixed(1) : Math.round(off)}° ${side} the ${figure} from here`, state: 'idle', body: shot.body, at: shot.t };
}

/**
 * The viewfinder's caption for the open landmark shot, or null: how far the landmark is, how
 * wide the disc is against the figure, and how tall each stands in a frame `frameDeg` high.
 * Commas mark where a narrow frame may cut it (overlay.js), least needed last.
 */
export function landmarkCaption(eye, t, frameDeg) {
  const view = landmarkAtEye(eye, t);
  if (!view) return null;
  const share = (deg) => {
    const pct = (100 * deg) / frameDeg;
    return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
  };
  const body = view.shot.body;
  const up = view.body.alt > -0.5;
  return (
    `${view.target.short} ${distanceText(view.distanceM)}` +
    (up ? ` · ${body} ${view.discShare.toFixed(1)}× the ${view.figure}` : '') +
    `, in frame: ${view.figure} ${share(view.figureDeg)}` +
    (up ? `, ${body} ${share(0.52)}` : '')
  );
}
