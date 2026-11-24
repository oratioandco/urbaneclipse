/**
 * The shot card: the one way `/plan/` shows a shot. A small frame of the landmark in the
 * light and weather of its minute, with the time, the place, sun or moon, and the verdict.
 * Design: `explorations/slider-panel-2026-11/next-shots-grid.html` on `wip/slider-explorations`
 * (layout and content from there; type and tokens are the app's, from miniature.css).
 *
 *   shotCard(shot, verdict, { size, tag })  ->  element
 *   drawShotFrame(canvas, shot, verdict)    ->  draws the frame alone
 *
 * `shot` (the rows of `collectRows` in daylist.js are shots):
 *   t          instant, ms                                   required
 *   body       'sun' | 'moon'                                required
 *   kind       'tower' | 'street'                            required
 *   where      'sphere' | 'antenna'      tower shots: which part the disc is behind
 *   landmark   a name in public/landmark-sprites (default 'fernsehturm')
 *   distanceM  how far the landmark stands (sets the disc's size against the sphere)
 *   title      the shot in a sentence ("Sun behind the TV tower's sphere")
 *   short      the place ("TV tower", "Hohenzollerndamm")
 *   stand      tower shots: where to stand ("5.3 km SE")
 *   detail     the list row's small print
 * `verdict` is what `shotVerdict` (verdict.js) returns: its word and reason are shown, its
 * grade backs them with colour, and its `sky` (cloud layers, rain) is what the frame is drawn
 * from. Without a forecast the frame is the clear sky of that minute and the card says so.
 *
 * Sizes, all the same card: `card` (text over the frame; the day view's strip, and the grid
 * to come: give its container any width), `row` (frame left, words right; the lists) and
 * `ticket` (one line; eye level). The frame is the sky of `skyPalette`, the canonical sun or
 * moon of bodies.js at that altitude, the forecast's three cloud layers and rain, and the
 * landmark's sprite as a silhouette. A street has no sprite: it is framed as the street
 * itself, two rows of houses running to the point where the body stands, its light on the road.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { skyPalette } from '../lib/skyPalette.ts';
import { drawMoon, drawSun } from './bodies.js';
import { bodyState } from './bodyAt.js';
import { icon } from './icons.js';
import { markSvg } from './marks.js';
import { breakable, shortStreet } from './shotWords.js';
import { formatClock } from './time.js';
import { discOverSphere } from './towerShots.js';

/** The frame's drawing size per card size, in canvas pixels (twice the largest CSS size). */
export const FRAME_PIXELS = { card: [320, 400], row: [176, 132], ticket: [88, 88] };
const VERDICT_ICON = { good: 'verdict-go', fair: 'verdict-maybe', poor: 'verdict-skip' };

/** Where things are on a sprite, as shares of its height from the top (fernsehturm.png). */
const SPRITE = { fernsehturm: { sphere: 0.415, sphereR: 0.052, antenna: 0.2 } };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const step = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const bytes = (c) => [c[0] * 255, c[1] * 255, c[2] * 255];

// Sprites load once; a frame drawn before its sprite is in is drawn again when it lands.
const sprites = new Map();
function sprite(name) {
  if (!sprites.has(name)) {
    const entry = { image: null, box: null, waiting: new Set() };
    sprites.set(name, entry);
    if (typeof Image !== 'undefined') {
      const image = new Image();
      image.onload = () => {
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(image, 0, 0);
        // The sprite's own bounds: what is not transparent.
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
        for (let yy = 0; yy < c.height; yy += 2) {
          for (let xx = 0; xx < c.width; xx += 2) {
            if (d[(yy * c.width + xx) * 4 + 3] > 24) {
              if (xx < x0) x0 = xx;
              if (xx > x1) x1 = xx;
              if (yy < y0) y0 = yy;
              if (yy > y1) y1 = yy;
            }
          }
        }
        entry.image = c;
        entry.box = x1 > x0 ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : [0, 0, c.width, c.height];
        for (const redraw of entry.waiting) redraw();
        entry.waiting.clear();
      };
      image.src = `/landmark-sprites/${name}.png`;
    }
  }
  return sprites.get(name);
}

/** A soft round patch of colour: clouds and glows. */
function blob(x, cx, cy, rx, ry, col, a) {
  x.save();
  x.translate(cx, cy);
  x.scale(1, ry / rx);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgb(col, a));
  g.addColorStop(0.55, rgb(col, a * 0.55));
  g.addColorStop(1, rgb(col, 0));
  x.fillStyle = g;
  x.fillRect(-rx, -rx, rx * 2, rx * 2);
  x.restore();
}

/**
 * Draw one frame: the picture you would take at the shot's minute, weather included.
 * Pure drawing on the canvas it is given; the same shot always gives the same frame.
 */
export function drawShotFrame(canvas, shot, verdict = null) {
  const x = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const sky = verdict?.sky ?? null;
  const low = sky?.low ?? 0;
  const mid = sky?.mid ?? 0;
  const high = sky?.high ?? 0;
  const cover = Math.max(low, mid, high);
  const clear = 1 - step(0.45, 0.95, Math.max(low, mid * 0.85, high * 0.4));
  const sunAlt = sampleBody('sun', new Date(shot.t), FERNSEHTURM.lat, FERNSEHTURM.lon).alt;
  const body = bodyState(shot.body, shot.t);
  let seed = 17 + (Math.floor(shot.t / 60_000) % 100_000);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // The sky of that minute, from the app's own palette; cloud greys it.
  const palette = skyPalette('sun', sunAlt);
  const dayness = clamp((sunAlt + 6) / 10, 0, 1);
  const grey = mix([22, 25, 38], [132, 138, 150], dayness);
  const over = clamp((cover - 0.5) * 2.1, 0, 0.9);
  const top = mix(bytes(palette.skyTop), grey, over);
  const bottom = mix(bytes(palette.haze), mix(grey, [156, 160, 170], dayness * 0.5), over);
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(top));
  g.addColorStop(1, rgb(bottom));
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const night = step(-5, -12, sunAlt) * (1 - step(0.3, 0.8, cover));
  for (let k = 0; k < 50; k++) {
    const sx = rnd() * w;
    const sy = rnd() * h * 0.8;
    const a = night * (0.3 + rnd() * 0.7);
    if (a > 0.04) {
      x.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      x.fillRect(sx, sy, w / 160, w / 160);
    }
  }

  // Where the body stands in the frame, and how large: a long lens on the tower, so the disc
  // has its true size against the sphere; down a street, at the far end, just over the roofs.
  const street = shot.kind === 'street';
  const name = shot.landmark ?? 'fernsehturm';
  const marks = SPRITE[name] ?? SPRITE.fernsehturm;
  const towerH = h * 1.7;
  // On a card the words lie over the lower half: the subject stands in the upper one.
  const horizon = h * 0.56;
  let at;
  if (street) at = { x: w / 2, y: horizon - h * (0.07 + clamp(body.altitudeDeg, 0, 6) * 0.012), r: w * 0.085 };
  else if (shot.where === 'antenna') at = { x: w / 2, y: h * 0.3, r: towerH * marks.sphereR * 1.5 };
  else at = { x: w / 2, y: h * 0.4, r: towerH * marks.sphereR * clamp(shot.distanceM ? discOverSphere(shot.distanceM) : 1.3, 0.8, 2.6) };

  const glow = bytes(palette.glowColor);
  x.globalCompositeOperation = 'lighter';
  blob(x, at.x, at.y, w * 0.6, w * 0.6, shot.body === 'moon' ? [150, 175, 240] : glow, (shot.body === 'moon' ? 0.22 : 0.1 + 0.4 * dayness) * clear);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 0.3 + 0.7 * clear;
  if (body.kind === 'moon') drawMoon(x, at.x, at.y, at.r, { ...body, glow: clear > 0.4 });
  else drawSun(x, at.x, at.y, at.r, body.altitudeDeg, { glow: clear > 0.4 });
  x.globalAlpha = 1;

  // Cloud, layer by layer: thin and high first, the low deck in front of everything.
  const warm = step(-6, 0, sunAlt) * (1 - step(4, 10, sunAlt)) * (1 - step(0.7, 0.9, cover));
  const puffs = (c, y0, y1, n, ry, amax) => {
    const col = mix(mix([34, 38, 60], mix([150, 154, 166], [246, 247, 251], 1 - step(0.6, 0.9, c)), dayness), [255, 150, 96], warm * 0.75);
    for (let k = 0; k < Math.round(c * n); k++) blob(x, rnd() * w, h * lerp(y0, y1, rnd()), w * (0.22 + rnd() * 0.24), h * ry * (0.7 + rnd() * 0.6), col, amax * (0.4 + c * 0.6));
  };
  puffs(high, 0.04, 0.2, 7, 0.04, 0.5);
  puffs(mid, 0.2, 0.46, 8, 0.06, 0.62);

  const shade = verdict?.grade === 'poor' ? rgb(mix([40, 44, 60], [104, 110, 122], dayness), 0.8) : rgb(mix([12, 12, 26], [52, 30, 30], dayness), shot.body === 'moon' ? 0.72 : lerp(0.86, 0.6, step(2, 12, sunAlt)));
  if (street) {
    // The street itself: two rows of houses running to the point under the body, and the
    // body's light lying on the road between them. Roof lines step, as Berlin's do.
    const vx = w / 2;
    const wall = (side) => {
      x.beginPath();
      x.moveTo(vx + side * w * 0.035, horizon);
      let px = vx + side * w * 0.035;
      let roof = horizon - h * 0.035;
      x.lineTo(px, roof);
      for (let k = 0; k < 5; k++) {
        // Houses of uneven width and height, so the two sides are a street and not a funnel.
        const nx = px + side * w * (0.045 + k * 0.035) * (0.7 + rnd() * 0.7);
        const rise = h * (0.05 + k * 0.045) * (0.45 + rnd() * 1.0);
        x.lineTo(px, roof - rise * 0.25);
        roof -= rise;
        x.lineTo(nx, roof + rise * 0.1);
        px = nx;
      }
      x.lineTo(side > 0 ? w : 0, roof);
      x.lineTo(side > 0 ? w : 0, h);
      x.lineTo(vx + side * w * 0.5, h);
      x.closePath();
      x.fillStyle = rgb(mix([10, 11, 22], [44, 30, 32], dayness));
      x.fill();
      x.fillStyle = shade;
      x.fill();
    };
    // The road first, then the houses over its edges.
    const road = x.createLinearGradient(0, horizon, 0, h);
    road.addColorStop(0, rgb(mix([14, 15, 26], [70, 56, 54], dayness)));
    road.addColorStop(1, rgb([10, 11, 18]));
    x.fillStyle = road;
    x.fillRect(0, horizon, w, h - horizon);
    const light = shot.body === 'moon' ? [170, 195, 255] : glow;
    const beam = x.createLinearGradient(0, horizon, 0, h);
    beam.addColorStop(0, rgb(light, 0.85 * clear));
    beam.addColorStop(1, rgb(light, 0.12 * clear));
    x.fillStyle = beam;
    x.beginPath();
    x.moveTo(vx - w * 0.012, horizon);
    x.lineTo(vx + w * 0.012, horizon);
    x.lineTo(vx + w * 0.2, h);
    x.lineTo(vx - w * 0.2, h);
    x.closePath();
    x.fill();
    wall(-1);
    wall(1);
  } else {
    const sp = sprite(name);
    if (sp.image) {
      // The tower's upper half, close: scaled so the sphere sits where the disc is.
      const [bx, by, bw, bh] = sp.box;
      const scale = towerH / bh;
      const anchor = shot.where === 'antenna' ? marks.antenna : marks.sphere;
      const tinted = document.createElement('canvas');
      tinted.width = bw;
      tinted.height = bh;
      const tx = tinted.getContext('2d');
      tx.drawImage(sp.image, bx, by, bw, bh, 0, 0, bw, bh);
      tx.globalCompositeOperation = 'source-atop';
      tx.fillStyle = shade;
      tx.fillRect(0, 0, bw, bh);
      x.imageSmoothingQuality = 'high';
      x.drawImage(tinted, w / 2 - (bw * scale) / 2, at.y - anchor * towerH, bw * scale, towerH);
    } else sp.waiting.add(() => drawShotFrame(canvas, shot, verdict));
  }
  puffs(low, 0.5, 0.86, 6, 0.08, 0.62);
  if ((sky?.rain ?? 0) >= 0.45) {
    x.strokeStyle = 'rgba(200,220,240,.34)';
    x.lineWidth = Math.max(1, w / 200);
    x.beginPath();
    for (let k = 0; k < 60; k++) {
      const rx = rnd() * w * 1.1;
      const ry = rnd() * h;
      x.moveTo(rx, ry);
      x.lineTo(rx - w * 0.012, ry + h * 0.05);
    }
    x.stroke();
  }
}

const span = (className, text = '') => Object.assign(document.createElement('span'), { className, textContent: text });

/** What the card says of the body and the kind of shot, in a few words. */
export function shotWhat(shot) {
  const body = shot.body === 'moon' ? 'Moon' : 'Sun';
  if (shot.kind === 'street') return `${body} down the street`;
  if (shot.where === 'antenna') return `${body} on the antenna${shot.stand ? ` · ${shot.stand}` : ''}`;
  return `${body}${shot.stand ? ` · ${shot.stand}` : ' behind the sphere'}`;
}

/**
 * The card as an element. `size` is 'card', 'row' or 'ticket'; `tag` the element ('button'
 * where the card does something, 'div' where it only shows). The caller adds the click.
 */
export function shotCard(shot, verdict = null, { size = 'card', tag = 'button' } = {}) {
  const card = document.createElement(tag);
  if (tag === 'button') card.type = 'button';
  card.className = `shotcard shotcard--${size}`;
  card.dataset.body = shot.body;
  card.dataset.kind = shot.kind;
  card.dataset.grade = verdict?.grade ?? 'none';

  const frame = span('sc-frame');
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = FRAME_PIXELS[size] ?? FRAME_PIXELS.card;
  canvas.setAttribute('aria-hidden', 'true');
  frame.append(canvas);
  drawShotFrame(canvas, shot, verdict);

  // The verdict: its sign and word in a pill, the reason beside it. Without a forecast the
  // pill says which kind of none, and there is no reason to give.
  const said = span('sc-verdict');
  if (verdict) {
    const word = document.createElement('b');
    const sign = VERDICT_ICON[verdict.grade];
    word.innerHTML = sign ? icon(sign, { size: 12 }) : '';
    word.append(verdict.word);
    said.append(word);
    if (verdict.reason) said.append(span('sc-why', verdict.reason));
  }

  const kind = `${shot.kind === 'tower' ? 'tower' : 'henge'}-${shot.body}`;
  const what = span('sc-what');
  what.innerHTML = markSvg(kind, { size: 10, halo: '' });
  what.append(shotWhat(shot));
  const name = span('sc-name', breakable(shortStreet(shot.short ?? shot.title ?? '')));
  name.lang = 'de';
  const meta = span('sc-meta');
  meta.append(span('sc-time', formatClock(shot.t)), name, span('sc-title', shot.title ?? ''), what, span('sc-detail', shot.detail ?? ''));

  card.append(frame, said, meta);
  if (tag === 'button') card.setAttribute('aria-label', `${formatClock(shot.t)}, ${shot.title ?? shot.short}. ${verdict ? `${verdict.label}. ` : ''}${shot.detail ?? ''}`);
  return card;
}
