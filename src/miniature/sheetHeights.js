/**
 * The phone sheet's three heights, as pure state: which one a drag lands on, what a tap or
 * Escape does, and how tall each is for a given screen. No DOM, so it runs under Node.
 *
 * - peek: one line, the next shot
 * - half: the day view
 * - full: planning below it, scrolling
 */
export const HEIGHTS = ['peek', 'half', 'full'];

/** A stored or typed height, or the fallback when it is not one of the three. */
export const parseHeight = (value, fallback = 'half') => (HEIGHTS.includes(value) ? value : fallback);

/** Escape and the back button: one height down, and peek stays peek. */
export const stepDown = (height) => (height === 'full' ? 'half' : 'peek');
export const stepUp = (height) => (height === 'peek' ? 'half' : 'full');
/** A tap on the handle: peek opens to half, anything taller folds to peek. */
export const tapHeight = (height) => (height === 'peek' ? 'half' : 'peek');

/**
 * The three heights in pixels. `head` is the handle row, `day` the day view under it, `all`
 * everything in the sheet; `viewport` the screen's height and `topGap` what stays map at full.
 * A sheet whose planning adds next to nothing has no full height of its own. Half is at most
 * `halfShare` of the screen.
 */
export function sheetSizes({ viewport, head, day, all, topGap = 56, halfShare = 0.5 }) {
  const most = Math.max(head, viewport - topGap);
  const peek = Math.min(head, most);
  // Half never takes more than half the screen: on a 320 x 568 phone the day view's cards and
  // timeline together came to 69 %, and the map was a strip. What does not fit waits at full.
  const half = Math.min(head + day, most, Math.max(head, Math.round(viewport * halfShare)));
  const full = Math.max(half, Math.min(head + all, most));
  return { peek, half, full };
}

/** A flick faster than this, in px per ms, moves a height on its own. */
export const FLICK = 0.45;

/**
 * Where a released drag settles. `at` is the sheet's height in px at release, `velocity` px per
 * ms (up is positive), `from` the height the drag started at. A slow release goes to the
 * nearest height; a flick goes at least one height its way, however short the drag was.
 */
export function snapHeight({ at, velocity = 0, from, sizes }) {
  const order = HEIGHTS.filter((h, i) => i === 0 || sizes[h] > sizes[HEIGHTS[i - 1]] + 1);
  const nearest = (px) => order.reduce((best, h) => (Math.abs(sizes[h] - px) < Math.abs(sizes[best] - px) ? h : best), order[0]);
  if (Math.abs(velocity) < FLICK) return nearest(at);
  // Carry the flick a little, then make sure it at least left the height it started at.
  const landed = nearest(at + velocity * 180);
  const start = Math.max(0, order.indexOf(nearest(sizes[from] ?? at)));
  const index = order.indexOf(landed);
  if (velocity > 0) return order[Math.min(order.length - 1, Math.max(index, start + 1))];
  return order[Math.max(0, Math.min(index, start - 1))];
}

/** How much of the screen a box covers, 0 to 1: the figure the panel is held to. */
export const coverage = (box, screen) => (box.width * box.height) / (screen.width * screen.height);
