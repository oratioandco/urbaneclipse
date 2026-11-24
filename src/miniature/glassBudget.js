/**
 * Whether the frosted glass is affordable on this device. A backdrop blur is redrawn every
 * frame the map moves behind it; where that drops frames, the panes fall back to near-opaque
 * paper. Pure, no DOM.
 */

/** A frame slower than this missed its slot on a 60 Hz screen (16.7 ms) by a wide margin. */
export const SLOW_FRAME = 24;
/** Fewer frames than this say nothing about a drag. */
export const MIN_FRAMES = 20;
/** A drag is rough when more than this share of its frames were slow. */
export const ROUGH_SHARE = 0.25;
/** This many rough drags in a row and the glass goes. */
export const ROUGH_DRAGS = 3;

/** The share of slow frames among frame intervals in ms, or null when there are too few. */
export function slowShare(intervals, limit = SLOW_FRAME) {
  if (intervals.length < MIN_FRAMES) return null;
  return intervals.filter((ms) => ms > limit).length / intervals.length;
}

/**
 * Count rough drags in a row: `streak` so far and one drag's intervals give the new streak.
 * A smooth drag resets it; a drag too short to judge leaves it.
 */
export function roughStreak(streak, intervals) {
  const share = slowShare(intervals);
  if (share === null) return streak;
  return share > ROUGH_SHARE ? streak + 1 : 0;
}

/** 'on' or 'off' from the `?glass=` option or what was remembered; anything else is 'on'. */
export const parseGlass = (value) => (value === 'off' || value === '0' || value === 'false' ? 'off' : 'on');
