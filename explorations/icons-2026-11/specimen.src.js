// Source of specimen.html. Build with `node scripts/build-icon-specimen.mjs`.
// It draws with the real modules, so what the page shows is what the planner would get.
import { ICONS, ICON_NAMES, icon, weatherIcon, phaseIcon, WEATHER_STATES, WEATHER_NAMES, LIGHT_PHASES, PHASE_ALTITUDE } from '../../src/miniature/icons.js';
import { sunSvg, moonSvg, drawSun, drawMoon, discRadius } from '../../src/miniature/bodies.js';
import { LIGHT_PHASE_NAMES } from '../../src/lib/lightPhases.ts';

const SIZES = [16, 20, 24, 32];
const BODY_SIZES = [12, 16, 20, 24, 32, 48, 96];
const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};
const root = document.getElementById('specimen');

/** A section shown twice, side by side: once on the light surface, once on the dark one. */
function section(title, note, fill) {
  const box = h('section');
  box.append(h('h2', '', title));
  if (note) box.append(h('p', 'note', note));
  const pair = h('div', 'pair');
  for (const theme of ['light', 'dark']) {
    const side = h('div', `side ${theme}`);
    side.dataset.theme = theme;
    fill(side, theme);
    pair.append(side);
  }
  box.append(pair);
  root.append(box);
}

const sizesRow = (draw, sizes = SIZES) => `<span class="sizes">${sizes.map((s) => `<span class="at" style="width:${Math.max(s, 16)}px">${draw(s)}</span>`).join('')}</span>`;

const GROUPS = [
  ['Panel and sheet', ['chevron-down', 'chevron-up', 'chevron-left', 'chevron-right', 'close', 'more', 'tune', 'help']],
  ['Time', ['shot-earlier', 'shot-later', 'minus', 'plus', 'now', 'play', 'pause', 'calendar', 'rise', 'set']],
  ['Map and view', ['layers', 'locate', 'compass', 'minimap', 'map', 'eye', 'aim', 'camera', 'lens', 'thirds', 'drone', 'takeoff']],
  ['Going there', ['pin', 'share', 'link', 'arrow-left', 'arrow-right', 'external']],
  ['Layers and landmarks', ['tower', 'tower-line', 'henge', 'tree', 'names', 'cloud-map']],
  ['Weather parts', ['cloud', 'overcast', 'rain', 'thunder']],
  ['Verdict support', ['verdict-go', 'verdict-maybe', 'verdict-skip']],
];
const grouped = new Set(GROUPS.flatMap(([, names]) => names));
const missing = ICON_NAMES.filter((n) => !grouped.has(n));
if (missing.length) GROUPS.push(['Ungrouped', missing]);

for (const [title, names] of GROUPS) {
  section(title, '', (side) => {
    const grid = h('div', 'grid');
    for (const name of names) grid.append(h('div', 'cell', `${sizesRow((s) => icon(name, { size: s }))}<b>${name}</b><small>${ICONS[name].use}</small>`));
    side.append(grid);
  });
}

section('Weather states', 'Clear sky and some cloud carry the canonical body of the minute: a high sun, a low sun, a moon. Overcast, rain and thunderstorm hide it.', (side) => {
  const bodies = [
    ['day', { kind: 'sun', altitudeDeg: 35 }],
    ['low sun', { kind: 'sun', altitudeDeg: 2 }],
    ['night', { kind: 'moon', fraction: 0.72, waxing: true, altitudeDeg: 30, sunAltitudeDeg: -20 }],
  ];
  const grid = h('div', 'grid');
  for (const state of WEATHER_STATES) {
    for (const [what, body] of state === 'clear' || state === 'some-cloud' ? bodies : [bodies[0]]) {
      grid.append(h('div', 'cell', `${sizesRow((s) => weatherIcon(state, { size: s, body }))}<b>${WEATHER_NAMES[state]}</b><small>${state === 'clear' || state === 'some-cloud' ? what : 'any hour'}</small>`));
    }
  }
  side.append(grid);
});

section('Light phases', 'The canonical sun against a horizon, at the height that makes the phase.', (side) => {
  const grid = h('div', 'grid');
  for (const phase of LIGHT_PHASES) grid.append(h('div', 'cell', `${sizesRow((s) => phaseIcon(phase, { size: s }))}<b>${LIGHT_PHASE_NAMES[phase]}</b><small>drawn at ${PHASE_ALTITUDE[phase]}°</small>`));
  side.append(grid);
});

const SUN_ALTS = [-6, -3, 0, 3, 6, 12, 20, 30, 45];
section('The sun, by altitude', 'One disc. Core, limb and glow from sunLook(altitude). Rows are sizes 12 to 96 px; the last row is the same sun drawn on a canvas.', (side) => {
  const table = h('div', 'bodies');
  table.append(h('div', 'brow head', `<i></i>${SUN_ALTS.map((a) => `<span>${a}°</span>`).join('')}`));
  for (const size of BODY_SIZES) table.append(h('div', 'brow', `<i>${size}</i>${SUN_ALTS.map((a) => `<span>${sunSvg({ altitudeDeg: a, size })}</span>`).join('')}`));
  const row = h('div', 'brow', '<i>canvas 48</i>');
  for (const a of SUN_ALTS) row.append(canvasCell(48, (ctx, r) => drawSun(ctx, 24, 24, r, a)));
  table.append(row);
  side.append(table);
});

const PHASES = [
  [0, true], [0.08, true], [0.25, true], [0.5, true], [0.78, true], [1, true], [0.78, false], [0.5, false], [0.25, false], [0.08, false],
];
section('The moon, by phase', 'One disc: dark body, lit part in moonLook’s tint, glow by lit share. High in a dark sky.', (side) => {
  const table = h('div', 'bodies');
  table.append(h('div', 'brow head', `<i></i>${PHASES.map(([f, w]) => `<span>${Math.round(f * 100)}%${f > 0 && f < 1 ? (w ? ' ↗' : ' ↘') : ''}</span>`).join('')}`));
  for (const size of BODY_SIZES) table.append(h('div', 'brow', `<i>${size}</i>${PHASES.map(([f, w]) => `<span>${moonSvg({ fraction: f, waxing: w, size })}</span>`).join('')}`));
  const row = h('div', 'brow', '<i>canvas 48</i>');
  for (const [f, w] of PHASES) row.append(canvasCell(48, (ctx, r) => drawMoon(ctx, 24, 24, r, { fraction: f, waxing: w })));
  table.append(row);
  side.append(table);
});

const MOON_SKIES = [
  ['1° night', 1, -20], ['4° night', 4, -20], ['8° night', 8, -20], ['12° night', 12, -20], ['30° night', 30, -20], ['60° night', 60, -20],
  ['30° dusk', 30, -6], ['30° day', 30, 20], ['4° day', 4, 20],
];
section('The moon, by altitude and sky', 'It warms toward the horizon and pales in daylight, as moonLook says. 85% lit.', (side) => {
  const table = h('div', 'bodies');
  table.append(h('div', 'brow head', `<i></i>${MOON_SKIES.map(([name]) => `<span>${name}</span>`).join('')}`));
  for (const size of [12, 20, 32, 48, 96]) table.append(h('div', 'brow', `<i>${size}</i>${MOON_SKIES.map(([, alt, sun]) => `<span>${moonSvg({ fraction: 0.85, waxing: true, altitudeDeg: alt, sunAltitudeDeg: sun, size })}</span>`).join('')}`));
  side.append(table);
});

section('In use', 'How the pieces sit together at the app’s sizes: 40 px controls, a verdict as a word with its icon, shot rows with the body of their minute.', (side) => {
  const tools = h('div', 'tools');
  for (const name of ['compass', 'tower', 'locate', 'help', 'layers', 'camera', 'minimap', 'share', 'more', 'close']) tools.append(h('button', 'round', icon(name, { size: 22 })));
  tools.append(h('button', 'round', sunSvg({ altitudeDeg: 12, size: 26 })), h('button', 'round', moonSvg({ fraction: 0.6, size: 26 })));
  side.append(tools);

  const scrub = h('div', 'tools');
  for (const name of ['shot-earlier', 'minus', 'play', 'pause', 'plus', 'shot-later', 'now']) scrub.append(h('button', 'round small', icon(name, { size: 20 })));
  side.append(scrub);

  const verdicts = h('div', 'verdicts');
  verdicts.innerHTML =
    `<span class="verdict go">${icon('verdict-go', { size: 16 })}<b>Go</b> · clear light</span>` +
    `<span class="verdict maybe">${icon('verdict-maybe', { size: 16 })}<b>Maybe</b> · mixed cloud</span>` +
    `<span class="verdict skip">${icon('verdict-skip', { size: 16 })}<b>Skip</b> · overcast</span>`;
  side.append(verdicts);

  const rows = h('div', 'rows');
  rows.innerHTML =
    `<div class="shot">${sunSvg({ altitudeDeg: 1.5, size: 28 })}<span><b>Sun behind the TV tower’s sphere</b><small>16:02–16:05 · 2.1 km SE of the tower · 2° up</small></span><span class="verdict go">${icon('verdict-go', { size: 16 })}<b>Go</b></span>${weatherIcon('some-cloud', { size: 20, body: { kind: 'sun', altitudeDeg: 1.5 } })}</div>` +
    `<div class="shot">${moonSvg({ fraction: 0.93, waxing: true, altitudeDeg: 3, sunAltitudeDeg: -9, size: 28 })}<span><b>Moonrise behind the antenna</b><small>17:41–17:44 · 3.0–4.4 km W of the tower · 93% lit</small></span><span class="verdict maybe">${icon('verdict-maybe', { size: 16 })}<b>Maybe</b></span>${weatherIcon('overcast', { size: 20 })}</div>` +
    `<div class="shot">${sunSvg({ altitudeDeg: 24, size: 28 })}<span><b>Street henge, Karl-Marx-Allee</b><small>12:20 · the sun down the street · 24° up</small></span><span class="verdict skip">${icon('verdict-skip', { size: 16 })}<b>Skip</b></span>${weatherIcon('rain', { size: 20 })}</div>`;
  side.append(rows);

  const phases = h('div', 'chips');
  phases.innerHTML = LIGHT_PHASES.map((p) => `<span class="chip">${phaseIcon(p, { size: 20 })}${LIGHT_PHASE_NAMES[p]}</span>`).join('') +
    WEATHER_STATES.map((w) => `<span class="chip">${weatherIcon(w, { size: 20 })}${WEATHER_NAMES[w]}</span>`).join('') +
    `<span class="chip">${icon('rise', { size: 16 })}17:41</span><span class="chip">${icon('set', { size: 16 })}06:12</span>`;
  side.append(phases);
});

function canvasCell(size, draw) {
  const cell = h('span');
  const canvas = document.createElement('canvas');
  const dpr = 2;
  canvas.width = canvas.height = size * dpr;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  draw(ctx, discRadius(size));
  cell.append(canvas);
  return cell;
}
document.title = `Urban Eclipse icons · ${ICON_NAMES.length} icons`;
