// The one sun and the one moon of the planner's interface.
//
// Every widget that shows a body draws it from here: a list row at 12 px, a button at 20 px,
// a card at 96 px, a canvas pill on the map. The colours are not chosen here. They come from
// `sunLook` and `moonLook` (src/lib/mapBodyLook.ts) over the altitude keyframes in
// src/lib/skyPalette.ts, so a body in the panel has the colour it has on the map and in the
// preview at the same minute.
//
// The geometry is fixed in units of the disc's radius, so every size is the same object:
//   sun   a disc, flat core to 65 % of the radius, then falling to the limb colour; no rays
//   moon  a dark disc (#20263a) with the lit part in the look's tint, and a hairline rim
//   glow  a halo from the limb out to GLOW_REACH radii, in the look's glow colour
//
// Pure strings and canvas calls: nothing here touches the DOM, so it runs in Node tests.
import { cssRgb, moonLook, sunLook } from '../lib/mapBodyLook.ts';
import { litDiscPath } from '../lib/moonPhase.ts';

/** How far the glow reaches, in disc radii from the centre. */
export const GLOW_REACH = 1.5;
/** Where the sun's flat core ends and the fall to the limb begins, as a share of the radius. */
export const SUN_CORE_EDGE = 0.65;
/** The sun's rim, as a share of the radius, in the glow colour: it holds a white midday disc on the light surface. */
export const SUN_RIM = 0.1;
/** The unlit moon. One value in both themes, as on the map. */
export const MOON_DARK = '#20263a';
/** Share of the box the disc's radius takes: with the glow, and without. */
const FILL_WITH_GLOW = 0.5 / GLOW_REACH;
const FILL_BARE = 0.46;

let serial = 0;
const round = (n) => Math.round(n * 1000) / 1000;
const rgba = ([r, g, b], a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${round(a)})`;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const escapeText = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The disc's radius in a square box of `size`, for callers that lay bodies out themselves. */
export const discRadius = (size, glow = true) => size * (glow ? FILL_WITH_GLOW : FILL_BARE);

/** The halo's opacity at the limb. The look's strength, held back so it stays a halo. */
const glowAtLimb = (look) => 0.8 * look.glowOpacity;

/**
 * The sun as an SVG fragment (defs and shapes, no outer <svg>), centred on cx, cy with disc
 * radius r. Use it to compose the sun into a larger drawing; `sunSvg` wraps it for plain use.
 */
export function sunFragment(cx, cy, r, altitudeDeg, { glow = true } = {}) {
  const look = sunLook(altitudeDeg);
  const id = `ue-sun-${++serial}`;
  const reach = r * GLOW_REACH;
  const halo = glow
    ? `<radialGradient id="${id}g" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(reach)}">` +
      `<stop offset="${round(1 / GLOW_REACH)}" stop-color="${cssRgb(look.glow)}" stop-opacity="${round(glowAtLimb(look))}"/>` +
      `<stop offset="${round((1 / GLOW_REACH + 1) / 2)}" stop-color="${cssRgb(look.glow)}" stop-opacity="${round(glowAtLimb(look) * 0.3)}"/>` +
      `<stop offset="1" stop-color="${cssRgb(look.glow)}" stop-opacity="0"/></radialGradient>`
    : '';
  return (
    `<defs>${halo}<radialGradient id="${id}d" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}">` +
    `<stop offset="0" stop-color="${cssRgb(look.core)}"/><stop offset="${SUN_CORE_EDGE}" stop-color="${cssRgb(look.core)}"/>` +
    `<stop offset="1" stop-color="${cssRgb(look.limb)}"/></radialGradient></defs>` +
    (glow ? `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(reach)}" fill="url(#${id}g)"/>` : '') +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="url(#${id}d)"/>` +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r * (1 - SUN_RIM / 2))}" fill="none" stroke="${cssRgb(look.glow)}" stroke-width="${round(r * SUN_RIM)}"/>`
  );
}

/**
 * Only the sun's glow, for a sun that is below a horizon the caller draws: a soft dome of
 * `reach` units round cx, cy. `strength` scales it, 0 to 1.
 */
export function sunGlowFragment(cx, cy, reach, altitudeDeg, strength = 1) {
  const look = sunLook(altitudeDeg);
  const id = `ue-sun-${++serial}`;
  const at = Math.min(1, glowAtLimb(look) * strength);
  return (
    `<defs><radialGradient id="${id}g" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(reach)}">` +
    `<stop offset="0" stop-color="${cssRgb(look.glow)}" stop-opacity="${round(at)}"/>` +
    `<stop offset="0.6" stop-color="${cssRgb(look.glow)}" stop-opacity="${round(at * 0.5)}"/>` +
    `<stop offset="1" stop-color="${cssRgb(look.glow)}" stop-opacity="0"/></radialGradient></defs>` +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(reach)}" fill="url(#${id}g)"/>`
  );
}

/**
 * The moon as an SVG fragment. `fraction` is the lit share (0 new, 1 full), `waxing` which
 * side is lit, `rotateDeg` turns the bright limb (0 leaves it upright, as the lists show it).
 */
export function moonFragment(cx, cy, r, { fraction = 1, waxing = true, altitudeDeg = 30, sunAltitudeDeg = -18, rotateDeg = 0, glow = true } = {}) {
  const lit = clamp01(fraction);
  const look = moonLook(altitudeDeg, sunAltitudeDeg, lit);
  const id = `ue-moon-${++serial}`;
  const reach = r * GLOW_REACH;
  const halo = glow
    ? `<defs><radialGradient id="${id}g" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(reach)}">` +
      `<stop offset="${round(1 / GLOW_REACH)}" stop-color="${cssRgb(look.glow)}" stop-opacity="${round(glowAtLimb(look))}"/>` +
      `<stop offset="${round((1 / GLOW_REACH + 1) / 2)}" stop-color="${cssRgb(look.glow)}" stop-opacity="${round(glowAtLimb(look) * 0.3)}"/>` +
      `<stop offset="1" stop-color="${cssRgb(look.glow)}" stop-opacity="0"/></radialGradient></defs>` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(reach)}" fill="url(#${id}g)"/>`
    : '';
  const turn = rotateDeg ? ` rotate(${round(rotateDeg)})` : '';
  const place = `translate(${round(cx)} ${round(cy)})${turn} scale(${round(r * MOON_LIT)})`;
  // The seas: on the lit face only, in the dark body's own colour.
  const seas =
    lit > 0.005
      ? `<defs><clipPath id="${id}c"><path d="${litDiscPath(lit, waxing)}"/></clipPath></defs>` +
        `<g transform="${place}" clip-path="url(#${id}c)" fill="${MOON_DARK}" fill-opacity="${SEA_OPACITY}">${MOON_SEAS.map(([x, y, sr]) => `<circle cx="${x}" cy="${y}" r="${sr}"/>`).join('')}</g>`
      : '';
  return (
    halo +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${MOON_DARK}"/>` +
    (lit > 0.005 ? `<path d="${litDiscPath(lit, waxing)}" transform="${place}" fill="${cssRgb(look.core)}"/>` : '') +
    seas +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r * (1 - RIM / 2))}" fill="none" stroke="${cssRgb(moonRim(sunAltitudeDeg, lit))}" stroke-opacity="${RIM_OPACITY}" stroke-width="${round(r * RIM)}"/>`
  );
}
// What makes the moon the moon at every altitude and size (adversarial test 2026-11, finding 5:
// low on the horizon its lit face takes the horizon's warmth, as the real one does, and a
// peach disc with a hairline round it read as the sun). The colour still comes from
// `moonLook`; these three marks are the moon's own, and the sun has none of them:
//   the dark limb   the lit part stops well short of the edge, so a ring of the dark body shows
//   the seas        dark patches on the lit face, where the eye knows them from the real moon
//   the cool rim    a rim in the high moon's own glow, whatever warmth the horizon lends the face
/** The moon's rim, as a share of the radius: it also keeps a new moon findable on the dark surface. */
const RIM = 0.09;
/** The lit part's radius, as a share of the disc's. */
const MOON_LIT = 0.78;
const RIM_OPACITY = 0.9;
/** The seas, in units of the lit radius: x, y, radius. Roughly Imbrium, Serenitatis and
 * Tranquillitatis, Nubium and Humorum, Crisium: the pattern, not a map. */
export const MOON_SEAS = [
  [-0.3, -0.34, 0.3],
  [0.22, -0.3, 0.24],
  [0.36, 0.06, 0.2],
  [-0.22, 0.34, 0.26],
  [0.66, -0.3, 0.11],
];
const SEA_OPACITY = 0.3;
/** The rim's colour: the glow `moonLook` gives a moon high in that sky, where it is the moon's own blue. */
const moonRim = (sunAltitudeDeg, lit) => moonLook(90, sunAltitudeDeg, lit).glow;

function wrap(inner, size, label, className) {
  const a11y = label ? `role="img" aria-label="${escapeText(label)}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" ${a11y} focusable="false">${label ? `<title>${escapeText(label)}</title>` : ''}${inner}</svg>`;
}

/**
 * The sun as a complete inline SVG string.
 * @param {{ altitudeDeg?: number, size?: number, glow?: boolean, label?: string }} [options]
 *   `altitudeDeg` is the sun's height at the minute shown. Decorative unless `label` is given.
 */
export function sunSvg({ altitudeDeg = 30, size = 24, glow = true, label = '' } = {}) {
  return wrap(sunFragment(12, 12, discRadius(24, glow), altitudeDeg, { glow }), size, label, 'ue-body ue-sun');
}

/**
 * The moon as a complete inline SVG string.
 * @param {{ fraction?: number, waxing?: boolean, altitudeDeg?: number, sunAltitudeDeg?: number,
 *   rotateDeg?: number, size?: number, glow?: boolean, label?: string }} [options]
 */
export function moonSvg({ size = 24, glow = true, label = '', ...moon } = {}) {
  return wrap(moonFragment(12, 12, discRadius(24, glow), { ...moon, glow }), size, label, 'ue-body ue-moon');
}

/** Either body from one description: `{ kind: 'sun', altitudeDeg }` or `{ kind: 'moon', fraction, … }`. */
export function bodySvg({ kind = 'sun', ...options } = {}) {
  return kind === 'moon' ? moonSvg(options) : sunSvg(options);
}

function drawGlow(ctx, x, y, radius, look) {
  const reach = radius * GLOW_REACH;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, reach);
  const at = glowAtLimb(look);
  halo.addColorStop(0, rgba(look.glow, at));
  halo.addColorStop(1 / GLOW_REACH, rgba(look.glow, at));
  halo.addColorStop((1 / GLOW_REACH + 1) / 2, rgba(look.glow, at * 0.3));
  halo.addColorStop(1, rgba(look.glow, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, Math.PI * 2);
  ctx.fill();
}

/** The same sun on a 2D canvas: centre x, y and the disc's radius in canvas units. */
export function drawSun(ctx, x, y, radius, altitudeDeg, { glow = true } = {}) {
  const look = sunLook(altitudeDeg);
  ctx.save();
  if (glow) drawGlow(ctx, x, y, radius, look);
  const disc = ctx.createRadialGradient(x, y, 0, x, y, radius);
  disc.addColorStop(0, cssRgb(look.core));
  disc.addColorStop(SUN_CORE_EDGE, cssRgb(look.core));
  disc.addColorStop(1, cssRgb(look.limb));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = cssRgb(look.glow);
  ctx.lineWidth = radius * SUN_RIM;
  ctx.beginPath();
  ctx.arc(x, y, radius * (1 - SUN_RIM / 2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The same moon on a 2D canvas. Takes the options of `moonFragment`. */
export function drawMoon(ctx, x, y, radius, { fraction = 1, waxing = true, altitudeDeg = 30, sunAltitudeDeg = -18, rotateDeg = 0, glow = true } = {}) {
  const lit = clamp01(fraction);
  const look = moonLook(altitudeDeg, sunAltitudeDeg, lit);
  ctx.save();
  if (glow) drawGlow(ctx, x, y, radius, look);
  ctx.fillStyle = MOON_DARK;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  if (lit > 0.005) {
    ctx.save();
    ctx.translate(x, y);
    if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.scale(radius * MOON_LIT, radius * MOON_LIT);
    ctx.fillStyle = cssRgb(look.core);
    const face = new Path2D(litDiscPath(lit, waxing));
    ctx.fill(face);
    // The seas, on the lit face only.
    ctx.clip(face);
    ctx.fillStyle = MOON_DARK;
    ctx.globalAlpha *= SEA_OPACITY;
    for (const [sx, sy, sr] of MOON_SEAS) {
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.strokeStyle = rgba(moonRim(sunAltitudeDeg, lit), RIM_OPACITY);
  ctx.lineWidth = radius * RIM;
  ctx.beginPath();
  ctx.arc(x, y, radius * (1 - RIM / 2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
