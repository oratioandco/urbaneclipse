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
