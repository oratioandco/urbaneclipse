/**
 * Dynamic quality. Two levers follow the measured frame time, so a slow device gets a picture
 * that keeps up and a fast one loses nothing:
 *
 * - Shadow cadence. While the light or the view moves, the shadow map is redrawn with the whole
 *   city in it, which is a third of a frame's triangles. When those frames run slow it is
 *   redrawn every second (at worst every third) frame instead. The picture at rest is the same;
 *   in motion the shadows trail by a frame.
 * - Resolution. The cost of a frame's pixels grows with their number, and a large Retina or 4K
 *   screen asks for three to five times a phone's. So the drawing buffer starts under a pixel
 *   budget and steps down when frames run slow, back up towards the screen's full density when
 *   they keep pace. `?pixels=` overrides the starting budget.
 *
 * Fewer pixels only help when pixels are what is slow. When most of a frame goes by inside the
 * frame function itself (the main thread: scene traversal, draw calls, the 2D overlay), a
 * smaller buffer would blur the picture and gain nothing, so the resolution is left alone.
 */
import { params } from './config.js';

/** Pixels per frame to start with: about a 2560×1440 buffer. */
const START_PIXELS = Number(params.get('pixels')) || 3.7e6;
const MIN_RATIO = 0.6;
/** Mean frame time, ms, above which quality steps down, and at or below which it may step up. */
const SLOW_MS = 24;
const FAST_MS = 17.5;
/** Frames to judge by, and how long after a step down no step up is tried. */
const WINDOW = 30;
const HOLD_MS = 8000;
/** The share of a frame spent on the main thread above which pixels are not the bottleneck. */
const MAIN_THREAD_BOUND = 0.6;
/** Too few frames of a kind in a window say nothing about that kind. */
const MIN_OF_KIND = 6;
const MAX_SHADOW_EVERY = 3;

const deviceMax = () => Math.min(devicePixelRatio, 2);
const budgetRatio = () => Math.sqrt(START_PIXELS / (innerWidth * innerHeight));

export const quality = {
  ratio: Math.max(MIN_RATIO, Math.min(deviceMax(), budgetRatio())),
  /** The shadow map is redrawn on every Nth frame that asks for it. */
  shadowEvery: 1,
};

const samples = [];
let heldUntil = 0;

/** The mean without the slowest tenth: one hitch (a shader compiling, a tile decoding) is not the pace. */
function pace(list) {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const kept = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.9)));
  return kept.reduce((sum, v) => sum + v, 0) / kept.length;
}

/**
 * Feeds one rendered frame: the time until the next one (`ms`), how much of that the frame
 * function itself took (`main`), and whether it redrew the shadow map (`shadowed`). Returns a
 * new pixel ratio when it should change, else null; `quality.shadowEvery` changes in place.
 * Gaps (the renderer idles when nothing moves) are not frame times and are skipped.
 */
export function sampleFrame(ms, now, { main = 0, shadowed = false } = {}) {
  if (ms <= 0 || ms > 150) return null;
  samples.push({ ms, main, shadowed });
  if (samples.length < WINDOW) return null;
  const all = pace(samples.map((s) => s.ms));
  const withShadows = samples.filter((s) => s.shadowed);
  const shadowPace = withShadows.length >= MIN_OF_KIND ? pace(withShadows.map((s) => s.ms)) : null;
  const mainShare = samples.reduce((sum, s) => sum + Math.min(s.main, s.ms), 0) / samples.reduce((sum, s) => sum + s.ms, 0);
  samples.length = 0;
  let next = quality.ratio;
  if (all > SLOW_MS) {
    if (quality.shadowEvery === 1 && shadowPace !== null && shadowPace > SLOW_MS) {
      // The cheapest thing to give up: nothing changes at rest.
      quality.shadowEvery = 2;
      heldUntil = now + HOLD_MS;
    } else if (mainShare > MAIN_THREAD_BOUND) {
      if (quality.shadowEvery < MAX_SHADOW_EVERY && shadowPace !== null && shadowPace > 2 * SLOW_MS) {
        quality.shadowEvery++;
        heldUntil = now + HOLD_MS;
      }
    } else if (quality.ratio > MIN_RATIO) {
      next = Math.max(MIN_RATIO, quality.ratio * (all > 2 * SLOW_MS ? 0.7 : 0.85));
      heldUntil = now + HOLD_MS;
    }
  } else if (all <= FAST_MS && now > heldUntil) {
    if (quality.ratio < deviceMax()) next = Math.min(deviceMax(), quality.ratio * 1.12);
    else if (quality.shadowEvery > 1 && shadowPace !== null && shadowPace <= FAST_MS) quality.shadowEvery--;
  }
  if (Math.abs(next - quality.ratio) < 0.01) return null;
  quality.ratio = next;
  return next;
}

/** After a window resize the budget and the screen's density may both have changed. */
export function clampToScreen() {
  quality.ratio = Math.max(MIN_RATIO, Math.min(deviceMax(), quality.ratio));
  samples.length = 0;
}
