/**
 * Dynamic resolution. The cost of a frame grows with its pixels, and a large Retina or 4K screen
 * asks for three to five times a phone's. So the drawing buffer starts under a pixel budget and
 * then follows the measured frame time: down a step when frames run slow, back up towards the
 * screen's full density when they keep pace. `?pixels=` overrides the starting budget.
 */
import { params } from './config.js';

/** Pixels per frame to start with: about a 2560×1440 buffer. */
const START_PIXELS = Number(params.get('pixels')) || 3.7e6;
const MIN_RATIO = 0.6;
/** Median frame time, ms, above which the resolution steps down, and at or below which it may step up. */
const SLOW_MS = 24;
const FAST_MS = 17.5;
/** Frames to judge by, and how long after a step down no step up is tried. */
const WINDOW = 30;
const HOLD_MS = 8000;

const deviceMax = () => Math.min(devicePixelRatio, 2);
const budgetRatio = () => Math.sqrt(START_PIXELS / (innerWidth * innerHeight));

export const quality = {
  ratio: Math.max(MIN_RATIO, Math.min(deviceMax(), budgetRatio())),
};

const samples = [];
let heldUntil = 0;

/**
 * Feeds one rendered frame's time. Returns a new pixel ratio when it should change, else null.
 * Gaps (the renderer idles when nothing moves) are not frame times and are skipped.
 */
export function sampleFrame(ms, now) {
  if (ms <= 0 || ms > 150) return null;
  samples.push(ms);
  if (samples.length < WINDOW) return null;
  const median = [...samples].sort((a, b) => a - b)[samples.length >> 1];
  samples.length = 0;
  let next = quality.ratio;
  if (median > SLOW_MS && quality.ratio > MIN_RATIO) {
    next = Math.max(MIN_RATIO, quality.ratio * (median > 2 * SLOW_MS ? 0.7 : 0.85));
    heldUntil = now + HOLD_MS;
  } else if (median <= FAST_MS && now > heldUntil && quality.ratio < deviceMax()) {
    next = Math.min(deviceMax(), quality.ratio * 1.12);
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
