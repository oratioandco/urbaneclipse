// Event marks and the direction needle: the small signs on the timeline, the day strip, the
// map and the minimap. They answer Dan's feedback (2026-11-23): the two orange dots could not
// be told apart, least of all when they overlapped, and the direction arrow had no clear tip.
//
// Marks. What happens sets the shape, which body sets the fill, so no pair differs by colour
// alone and an overlapped pair still shows two things:
//
//                     sun                              moon
//   tower alignment   ring, white inside               ring, dark inside
//   street henge      upright bar, solid               upright bar, dark inside
//
// The ring is the mark the map already uses where the sun is behind the sphere. The bar is a
// street seen end on. A moon mark is a small version of the moon itself: the dark body with a
// lit edge. Every mark carries a halo in the surface colour, so two that overlap stay two.
//
// Needle. A long kite, about twice as long as it is wide, with a notched tail. The front half
// is the body's colour, the back half is ink: the coloured end is the end that points.
//
// Pure strings and canvas calls, as in ./bodies.js. The body colours are the map's line
// colours (PATH_CSS in overlay.js), since a mark stands for a line or a spot on that map.
import { MOON_DARK } from './bodies.js';

export const MARK_COLOUR = { sun: '#f26a12', moon: '#5b82ff' };
/** The inside of a mark: white for the sun, the unlit moon for the moon. The same in both themes. */
export const MARK_FILL = { sun: '#fff', moon: MOON_DARK };

export const MARK_KINDS = ['tower-sun', 'henge-sun', 'tower-moon', 'henge-moon'];
/** The words for each mark, in the vocabulary of the panel spec. A mark never appears without them. */
export const MARK_NAMES = {
  'tower-sun': 'Tower alignment, sun',
  'henge-sun': 'Street henge, sun',
  'tower-moon': 'Tower alignment, moon',
  'henge-moon': 'Street henge, moon',
};

// Geometry in a 16-unit box centred on 0, 0. A mark's size is the box's side in pixels.
const RING_R = 4.7;
const RING_W = 2.6;
const BAR_W = 6;
const BAR_H = 14;
const BAR_EDGE = 2;
const HALO = 1.3;

const escapeText = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const round = (n) => Math.round(n * 1000) / 1000;
const parts = (kind) => {
  const [event, body] = String(kind).split('-');
  if (!MARK_KINDS.includes(kind)) throw new Error(`No mark "${kind}"`);
  return { event, body };
};

/** The drawing of a mark, without the outer <svg>. `halo` is a CSS colour, or '' for none. */
export function markBody(kind, halo = 'var(--surface, #fff)') {
  const { event, body } = parts(kind);
  const colour = MARK_COLOUR[body];
  if (event === 'tower') {
    return (
      (halo ? `<circle r="${RING_R + RING_W / 2 + HALO}" fill="${halo}"/>` : '') +
      `<circle r="${RING_R}" fill="${MARK_FILL[body]}" stroke="${colour}" stroke-width="${RING_W}"/>`
    );
  }
  const bar = (grow) => `x="${-BAR_W / 2 - grow}" y="${-BAR_H / 2 - grow}" width="${BAR_W + 2 * grow}" height="${BAR_H + 2 * grow}" rx="${BAR_W / 2 + grow}"`;
  return (
    (halo ? `<rect ${bar(HALO)} fill="${halo}"/>` : '') +
    (body === 'sun' ? `<rect ${bar(0)} fill="${colour}"/>` : `<rect ${bar(-BAR_EDGE / 2)} fill="${MARK_FILL.moon}" stroke="${colour}" stroke-width="${BAR_EDGE}"/>`)
  );
}

/**
 * A mark as an inline-SVG string.
 * @param {'tower-sun'|'henge-sun'|'tower-moon'|'henge-moon'} kind
 * @param {{ size?: number, label?: string, halo?: string }} [options] `size` in CSS pixels (8 to
 *   14 on the timeline). Decorative unless `label` is given: pass MARK_NAMES[kind] when no
 *   word stands beside it. `halo` is the colour behind the mark; it defaults to `--surface`.
 */
export function markSvg(kind, { size = 12, label = '', halo } = {}) {
  const a11y = label ? `role="img" aria-label="${escapeText(label)}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ue-mark ue-mark-${kind}" viewBox="-8 -8 16 16" width="${size}" height="${size}" ${a11y} focusable="false" style="overflow:visible">${label ? `<title>${escapeText(label)}</title>` : ''}${markBody(kind, halo)}</svg>`;
}

/**
 * The same mark on a 2D canvas, centred on x, y. `size` is the side of its box in canvas
 * units; `halo` a colour for the ring behind it (pass the surface or map colour), or ''.
 */
export function drawMark(ctx, kind, x, y, size = 12, halo = '') {
  const { event, body } = parts(kind);
  const u = size / 16;
  const colour = MARK_COLOUR[body];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(u, u);
  if (event === 'tower') {
    if (halo) {
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, RING_R + RING_W / 2 + HALO, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = MARK_FILL[body];
    ctx.strokeStyle = colour;
    ctx.lineWidth = RING_W;
    ctx.beginPath();
    ctx.arc(0, 0, RING_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    const bar = (grow) => {
      ctx.beginPath();
      ctx.roundRect(-BAR_W / 2 - grow, -BAR_H / 2 - grow, BAR_W + 2 * grow, BAR_H + 2 * grow, BAR_W / 2 + grow);
    };
    if (halo) {
      ctx.fillStyle = halo;
      bar(HALO);
      ctx.fill();
    }
    if (body === 'sun') {
      ctx.fillStyle = colour;
      bar(0);
      ctx.fill();
    } else {
      ctx.fillStyle = MARK_FILL.moon;
      ctx.strokeStyle = colour;
      ctx.lineWidth = BAR_EDGE;
      bar(-BAR_EDGE / 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The direction needle. Unit length along +x, from the tail at -0.5 to the tip at 0.5.

/**
 * Marks too close to tell apart, as groups. `xs` are the marks' positions along a line, in
 * pixels, in any order; the result is a list of groups of indices into `xs`, left to right. A
 * group is every mark within `reach` pixels of its leftmost one. Two marks that meet still
 * read as two (the halo keeps them apart); from `min` marks on a group is a cluster, to be drawn
 * as one sign with a count (`clusterBody`). Smaller groups come back as single marks.
 */
export function clusterMarks(xs, { reach = 12, min = 3 } = {}) {
  const order = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
  const groups = [];
  let open = null;
  for (const i of order) {
    if (open && xs[i] - xs[open[0]] <= reach) open.push(i);
    else groups.push((open = [i]));
  }
  return groups.flatMap((g) => (g.length >= min ? [g] : g.map((i) => [i])));
}

/**
 * A cluster's sign, without the outer <svg>: a pill with the number of shots in it, in the
 * body's colour when all are the sun's or all the moon's (`body`), in ink when mixed (null).
 * In the 16-unit box of the marks, so it scales with them.
 */
export function clusterBody(count, body = null, halo = 'var(--surface, #fff)') {
  const text = String(count);
  const w = 12 + 5.5 * text.length;
  const fill = body ? MARK_COLOUR[body] : 'var(--ink, #24221f)';
  return (
    (halo ? `<rect x="${-w / 2 - HALO}" y="${-8 - HALO}" width="${w + 2 * HALO}" height="${16 + 2 * HALO}" rx="${8 + HALO}" fill="${halo}"/>` : '') +
    `<rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="8" fill="${fill}"/>` +
    `<text y="4.4" text-anchor="middle" font-size="12.5" font-weight="700" fill="${body ? '#fff' : 'var(--surface-solid, #fff)'}" style="font-variant-numeric:tabular-nums">${text}</text>`
  );
}

/** Half the needle's width at the tail, as a share of its length: about twice as long as wide. */
export const NEEDLE_HALF_WIDTH = 0.26;
const NOTCH = -0.26;
/** Where ink ends and colour begins. A little behind the middle, so the coloured part leads. */
const SPLIT = -0.08;
const widthAt = (x) => NEEDLE_HALF_WIDTH * (0.5 - x);
/** The coloured front: from the split to the tip. */
const TIP = [[0.5, 0], [SPLIT, widthAt(SPLIT)], [SPLIT, -widthAt(SPLIT)]];
/** The ink back: from the wings and the notch up to the split. */
const TAIL = [[SPLIT, -widthAt(SPLIT)], [SPLIT, widthAt(SPLIT)], [-0.5, widthAt(-0.5)], [NOTCH, 0], [-0.5, -widthAt(-0.5)]];
const OUTLINE = [[0.5, 0], [-0.5, widthAt(-0.5)], [NOTCH, 0], [-0.5, -widthAt(-0.5)]];
const pathOf = (points, scale) => `M${points.map(([x, y]) => `${round(x * scale)} ${round(y * scale)}`).join('L')}Z`;

/**
 * The needle as an inline-SVG string, pointing where the body lies.
 * @param {{ kind?: 'sun'|'moon', angleDeg?: number, size?: number, label?: string, halo?: string }} [options]
 *   `angleDeg` turns it clockwise from pointing right (the screen angle, `Math.atan2(uy, ux)`
 *   in degrees). `size` is its length in CSS pixels. The back half takes `currentColor`.
 */
export function needleSvg({ kind = 'sun', angleDeg = 0, size = 16, label = '', halo = 'var(--surface, #fff)' } = {}) {
  if (!MARK_COLOUR[kind]) throw new Error(`No body "${kind}"`);
  const a11y = label ? `role="img" aria-label="${escapeText(label)}"` : 'aria-hidden="true"';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ue-needle ue-needle-${kind}" viewBox="-8 -8 16 16" width="${size}" height="${size}" ${a11y} focusable="false" style="overflow:visible">` +
    `${label ? `<title>${escapeText(label)}</title>` : ''}<g transform="rotate(${round(angleDeg)})">` +
    (halo ? `<path d="${pathOf(OUTLINE, 16)}" fill="${halo}" stroke="${halo}" stroke-width="2.4" stroke-linejoin="round"/>` : '') +
    `<path d="${pathOf(TAIL, 16)}" fill="currentColor"/><path d="${pathOf(TIP, 16)}" fill="${MARK_COLOUR[kind]}"/></g></svg>`
  );
}

/**
 * The same needle on a 2D canvas: centred on x, y, pointing along `angleRad` (as
 * `Math.atan2(uy, ux)`), `length` canvas units long. `ink` colours the back half; `halo`, if
 * given, is drawn behind it so it holds on the map.
 */
export function drawNeedle(ctx, x, y, angleRad, length = 16, { kind = 'sun', ink = '#24221f', halo = '' } = {}) {
  if (!MARK_COLOUR[kind]) throw new Error(`No body "${kind}"`);
  const trace = (points) => {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(px * length, py * length) : ctx.moveTo(px * length, py * length)));
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  if (halo) {
    ctx.fillStyle = halo;
    ctx.strokeStyle = halo;
    ctx.lineWidth = length * 0.15;
    ctx.lineJoin = 'round';
    trace(OUTLINE);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = ink;
  trace(TAIL);
  ctx.fill();
  ctx.fillStyle = MARK_COLOUR[kind];
  trace(TIP);
  ctx.fill();
  ctx.restore();
}
