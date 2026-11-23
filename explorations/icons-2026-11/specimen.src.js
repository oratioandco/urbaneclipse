// Source of specimen.html. Build with `node scripts/build-icon-specimen.mjs`.
// It draws with the real modules, so what the page shows is what the planner would get.
import { ICONS, ICON_NAMES, icon, weatherIcon, phaseIcon, WEATHER_STATES, WEATHER_NAMES, LIGHT_PHASES, PHASE_ALTITUDE } from '../../src/miniature/icons.js';
import { sunSvg, moonSvg, drawSun, drawMoon, discRadius } from '../../src/miniature/bodies.js';
import { MARK_KINDS, MARK_NAMES, MARK_COLOUR, markSvg, drawMark, needleSvg, drawNeedle } from '../../src/miniature/marks.js';
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
  ['Map and view', ['layers', 'locate', 'compass', 'minimap', 'map', 'eye', 'aim', 'camera', 'lens', 'thirds', 'walk', 'drone', 'takeoff']],
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


// --- Dan's feedback: marks, needle, drone ----------------------------------------------------

/** The marks as they are today: every event a dot in its body's colour. Drawn here only. */
const todayMark = (kind, size) => `<svg viewBox="-8 -8 16 16" width="${size}" height="${size}" style="overflow:visible"><circle r="7.2" fill="var(--surface)"/><circle r="6" fill="${kind.endsWith('moon') ? MARK_COLOUR.moon : kind === 'henge-sun' ? '#d9a441' : MARK_COLOUR.sun}"/></svg>`;
/** Dan's suggestion taken literally: only the sun behind the tower becomes a white-filled ring. */
const danMark = (kind, size) => (kind === 'tower-sun' ? markSvg('tower-sun', { size }) : todayMark(kind === 'henge-sun' ? 'tower-sun' : kind, size));
const CANDIDATES = [
  ['Today', 'every event a dot; street henges a second orange', todayMark],
  ['Dan’s suggestion', 'the sun behind the tower as a white-filled ring, the rest unchanged', danMark],
  ['Chosen', 'shape says what happens, fill says which body', (kind, size) => markSvg(kind, { size })],
];
const MARK_SIZES = [8, 10, 12, 14];
const PAIRS = [['tower-sun', 'henge-sun'], ['henge-sun', 'tower-sun'], ['tower-sun', 'tower-moon'], ['henge-sun', 'henge-moon'], ['tower-moon', 'henge-moon'], ['henge-moon', 'tower-sun']];

section('Event marks: three candidates', 'What Dan saw as “the 2 orange dots” are the sun behind the TV tower and the sun down a street (a street henge). Each candidate at 8, 10, 12 and 14 px, alone and as overlapped pairs (the second mark drawn over the first, 40 % of a width to the right).', (side) => {
  for (const [name, what, draw] of CANDIDATES) {
    const card = h('div', 'cell wide');
    card.append(h('b', '', `${name} <small>${what}</small>`));
    const alone = h('div', 'markrow');
    for (const kind of MARK_KINDS) alone.append(h('span', 'markcell', `${MARK_SIZES.map((s) => draw(kind, s)).join('')}<small>${MARK_NAMES[kind]}</small>`));
    card.append(alone);
    const pairs = h('div', 'markrow');
    for (const [under, over] of PAIRS) {
      pairs.append(h('span', 'markcell', `${MARK_SIZES.map((s) => `<span class="pairbox" style="width:${s * 1.4}px;height:${s}px">${draw(under, s)}<span style="left:${s * 0.4}px">${draw(over, s)}</span></span>`).join('')}<small>${MARK_NAMES[under].replace('alignment, ', '').replace('Street ', '')} under ${MARK_NAMES[over].replace('alignment, ', '').replace('Street ', '').toLowerCase()}</small>`));
    }
    card.append(pairs);
    side.append(card);
  }
});

section('Event marks on a timeline', 'The chosen marks at 10 px on a day’s line, with two crowded stretches, then the same on a canvas at 12 px as the map and minimap would draw them.', (side, theme) => {
  const line = h('div', 'timeline');
  const events = [[8, 'henge-sun'], [22, 'tower-moon'], [41, 'tower-sun'], [43.2, 'henge-sun'], [46, 'tower-sun'], [63, 'henge-moon'], [64.8, 'tower-moon'], [80, 'henge-sun'], [81.5, 'henge-moon'], [83.3, 'tower-sun']];
  line.innerHTML = '<i></i>' + events.map(([at, kind]) => `<span style="left:${at}%">${markSvg(kind, { size: 10 })}</span>`).join('');
  side.append(line);
  const canvas = document.createElement('canvas');
  canvas.width = 880; canvas.height = 72; canvas.style.cssText = 'width:440px;height:36px;border-radius:10px;display:block;margin-top:10px';
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const ground = theme === 'dark' ? '#23263a' : '#e9e4da';
  ctx.fillStyle = ground; ctx.fillRect(0, 0, 440, 36);
  events.forEach(([at, kind]) => drawMark(ctx, kind, 20 + at * 4.6, 18, 12, ground));
  side.append(canvas);
});

const TURNS = [0, 45, 90, 135, 180, 225, 270, 315];
section('Direction needle', 'The coloured end points at the body. First the triangle the map draws today (11 long, 12 wide), then the needle for the sun and the moon at 12, 16 and 20 px, then on a canvas pill as the map would draw it.', (side, theme) => {
  const ink = theme === 'dark' ? '#ece8df' : '#24221f';
  const table = h('div', 'bodies');
  table.append(h('div', 'brow head', `<i></i>${TURNS.map((t) => `<span>${t}°</span>`).join('')}`));
  table.append(h('div', 'brow', `<i>today</i>${TURNS.map((t) => `<span><svg viewBox="-8 -8 16 16" width="16" height="16" style="overflow:visible"><path d="M7 0L-4 -6L-4 6Z" fill="currentColor" transform="rotate(${t})"/></svg></span>`).join('')}`));
  for (const kind of ['sun', 'moon']) for (const size of [12, 16, 20]) table.append(h('div', 'brow', `<i>${kind} ${size}</i>${TURNS.map((t) => `<span>${needleSvg({ kind, angleDeg: t, size })}</span>`).join('')}`));
  side.append(table);
  const canvas = document.createElement('canvas');
  canvas.width = 1000; canvas.height = 150; canvas.style.cssText = 'width:500px;height:75px;border-radius:10px;display:block;margin-top:10px';
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = theme === 'dark' ? '#2b2f45' : '#d8d2c6'; ctx.fillRect(0, 0, 500, 75);
  const pills = [[70, 'Sun 12° up', 'sun', -0.5, () => drawSun(ctx, 0, 0, 7.5, 12, { glow: false })], [230, 'Moon 9° up', 'moon', 2.6, () => drawMoon(ctx, 0, 0, 7.5, { fraction: 0.6, glow: false })], [400, 'Sun 2° up', 'sun', 1.2, () => drawSun(ctx, 0, 0, 7.5, 2, { glow: false })]];
  for (const [cx, text, kind, angle, body] of pills) {
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    const width = 40 + ctx.measureText(text).width + 12;
    ctx.fillStyle = theme === 'dark' ? 'rgba(20, 23, 38, 0.86)' : 'rgba(255, 253, 249, 0.92)';
    ctx.beginPath(); ctx.roundRect(cx - width / 2, 22, width, 30, 15); ctx.fill();
    ctx.save(); ctx.translate(cx - width / 2 + 16, 37); body(); ctx.restore();
    ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.fillText(text, cx - width / 2 + 29, 37.5);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const reach = Math.min(Math.abs(ux) > 1e-3 ? width / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-3 ? 15 / Math.abs(uy) : Infinity);
    drawNeedle(ctx, cx + ux * (reach + 12), 37 + uy * (reach + 12), angle, 18, { kind, ink, halo: theme === 'dark' ? 'rgba(20, 23, 38, 0.86)' : 'rgba(255, 253, 249, 0.92)' });
  }
  side.append(canvas);
});

section('Drone, against the icons it sits beside', 'Dan could not tell what the drone icon showed. Today’s icon, then the redrawn one, next to walking, eye level and the camera at 20 and 24 px, and in 40 px toolbar buttons.', (side) => {
  const old = (s) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5.5" cy="5.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/><circle cx="5.5" cy="18.5" r="3"/><circle cx="18.5" cy="18.5" r="3"/><path d="M7.6 7.6l2.4 2.4M16.4 7.6 14 10M7.6 16.4l2.4-2.4M16.4 16.4 14 14"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor" stroke="none"/></svg>`;
  const grid = h('div', 'grid');
  grid.append(h('div', 'cell', `${sizesRow(old, [20, 24])}<b>today</b><small>walk.js DRONE_ICON: four rings seen from above</small>`));
  for (const name of ['drone', 'walk', 'eye', 'camera']) grid.append(h('div', 'cell', `${sizesRow((s) => icon(name, { size: s }), [20, 24])}<b>${name}</b><small>${ICONS[name].use}</small>`));
  side.append(grid);
  const tools = h('div', 'tools');
  tools.style.marginTop = '10px';
  for (const name of ['walk', 'drone', 'eye', 'camera', 'takeoff']) tools.append(h('button', 'round', icon(name, { size: 22 })));
  for (const name of ['walk', 'drone']) tools.append(h('span', 'chip', `${icon(name, { size: 20 })}${name === 'walk' ? 'On foot' : 'Drone'}`));
  side.append(tools);
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
