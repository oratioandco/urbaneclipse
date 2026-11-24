/**
 * While the clock is being dragged the scene is drawn a little cheaper, and whole again the
 * moment the drag rests. Measured on 2026-11-24 (scripts/adversarial/eyescrub.mjs, eye level,
 * 1280 x 800): 10 to 12 million triangles a frame, half of them the shadow pass, the trees the
 * largest part; a frame took 33 to 50 ms. In a drag the sun moves 0.02 degrees a step, so:
 *   - the shadow map is redrawn on every third frame at most (`SCRUB_SHADOW_EVERY`, and never more often than quality.js allows);
 *   - the trees stay out of it (their shadows hold still from the last full one);
 *   - the trees are drawn in a quarter of their triangles (trees.js `setTreeDetail`).
 * `SCRUB_REST_MS` after the last step the full shadow map is drawn once more, trees included,
 * so the picture at rest is the same as without any of this.
 */
export const SCRUB_SHADOW_EVERY = 3;
export const SCRUB_REST_MS = 200;
let scrubbedAt = -Infinity;
/** The clock moved under a hand (or a glide): call on every step. */
export const noteScrub = (now = performance.now()) => (scrubbedAt = now);
/** Whether a drag of the clock is going on at `now`. */
export const scrubbing = (now = performance.now()) => now - scrubbedAt < SCRUB_REST_MS;
