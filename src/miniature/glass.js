/**
 * Frosted glass, kept honest: watches the frames while the map or the day view's time is
 * dragged and, when three drags in a row run rough, swaps the blur for near-opaque paper for the rest of the session.
 * `?glass=off` starts without it.
 */
import { params } from './config.js';
import { parseGlass, ROUGH_DRAGS, roughStreak } from './glassBudget.js';
import { controls } from './render.js';

const KEY = 'miniature.glass';
const remembered = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const set = (mode) => { document.body.dataset.glass = mode; };
set(parseGlass(params.get('glass') ?? remembered()));

let frames = null;
let last = 0;
let streak = 0;
function sample(now) {
  if (!frames) return;
  frames.push(now - last);
  last = now;
  requestAnimationFrame(sample);
}
function begin() {
  if (document.body.dataset.glass === 'off' || frames) return;
  frames = [];
  last = performance.now();
  requestAnimationFrame(sample);
}
function judge() {
  if (!frames) return;
  // The first interval runs from the pointer going down, not from a frame.
  streak = roughStreak(streak, frames.slice(1));
  frames = null;
  if (streak < ROUGH_DRAGS) return;
  set('off');
  try { sessionStorage.setItem(KEY, 'off'); } catch { /* private window: this visit only */ }
}
controls.addEventListener('start', begin);
controls.addEventListener('end', judge);
// A drag of the day view's thumb moves the sun, so the whole map is redrawn behind the panel's
// blur just as when the map itself is dragged: it is judged the same way. Measured 2026-11-24
// (scripts/miniature/perf.mjs, phone, 28-shot day): 18 to 19 ms a frame with the glass against
// 16.7 without.
const timeline = document.getElementById('timeline');
timeline?.addEventListener('pointerdown', begin);
for (const name of ['pointerup', 'pointercancel']) timeline?.addEventListener(name, judge);
