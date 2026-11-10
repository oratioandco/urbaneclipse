/**
 * The days at a glance, above the cards: one strip per day on a shared 24-hour axis —
 * the light phases as a band, the cloud forecast as a line, and a tick per planned
 * shot, tall for the big spectacles. Nothing here is only for looking: a tick flies to
 * its shot, a day's name scrolls to its cards, and hovering reads the hour off the
 * curve. The cards below are the same shots as text, so no value lives only here.
 */
import { lightBands, lightGradientStops } from '../lib/lightPhases.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { formatClock } from './time.js';
import { PHASE_COLOURS } from './plan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 240; // The strip's drawing width; stretched to the row, strokes stay 2px.
const H = 34; // Cloud line lives in the top 20, the phase band in the bottom 10.

let seq = 0; // Gradient ids must be unique in the document.

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** One day's strip: the label button, and the band with phases, cloud and shot ticks. */
function sparkRow(mount, { from, name, picks, day, now }, { onTick, onDay }) {
  const row = document.createElement('div');
  row.className = 'sparkrow';

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'spark-day';
  label.setAttribute('aria-label', `Show ${name}'s shots`);
  const readout = document.createElement('small');
  label.append(Object.assign(document.createElement('b'), { textContent: name }), readout);
  label.addEventListener('click', () => onDay?.(from));

  const band = document.createElement('div');
  band.className = 'spark-band';

  // The day's light, as one gradient — the slider's own visual language.
  const svg = el('svg', { class: 'spark-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const gid = `spark-phases-${seq++}`;
  const defs = el('defs');
  const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 });
  for (const { phase, at } of lightGradientStops(lightBands(from, from + 86_400_000, FERNSEHTURM.lat, FERNSEHTURM.lon, 10 * 60_000), from, from + 86_400_000)) {
    grad.append(el('stop', { offset: `${(at * 100).toFixed(2)}%`, 'stop-color': PHASE_COLOURS[phase] }));
  }
  defs.append(grad);
  svg.append(defs, el('rect', { x: 0, y: H - 10, width: W, height: 10, rx: 5, fill: `url(#${gid})` }));

  // The cloud forecast, once the day's fetch is in: cover runs 0..1 across the top.
  if (day) {
    const cover = day.berlin.low.map((low, h) => Math.max(low, day.berlin.mid[h], day.berlin.high[h]));
    const pt = (h) => `${((h / (cover.length - 1)) * W).toFixed(1)},${(20 - cover[h] * 15).toFixed(1)}`;
    svg.append(
      el('path', { d: `M0,20 L${cover.map((_, h) => pt(h)).join(' L')} L${W},20 Z`, fill: 'var(--muted)', opacity: '0.1' }),
      el('polyline', { points: cover.map((_, h) => pt(h)).join(' '), fill: 'none', stroke: 'var(--muted)', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    );
  }

  band.append(svg);

  // Where the day has got to, on today's strip.
  if (now !== null && now >= from && now < from + 86_400_000) {
    const nowMark = document.createElement('span');
    nowMark.className = 'spark-now';
    nowMark.style.left = `${(((now - from) / 86_400_000) * 100).toFixed(2)}%`;
    band.append(nowMark);
  }

  // The shots: a tick per pick, its head at the minute it happens, its height the spectacle.
  for (const pick of picks) {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = `spark-tick spark-${pick.body}`;
    tick.style.setProperty('--score', pick.score.toFixed(2));
    const at = Math.min(97, Math.max(3, ((pick.t - from) / 86_400_000) * 100));
    tick.style.left = `${at.toFixed(2)}%`;
    const when = formatClock(pick.t);
    tick.title = `${when} — ${pick.title}`;
    tick.setAttribute('aria-label', `${when}, ${pick.title}. ${pick.detail}. Tap to fly there.`);
    tick.addEventListener('click', () => onTick?.(pick, from));
    const stem = document.createElement('i');
    stem.setAttribute('aria-hidden', 'true');
    tick.append(stem);
    band.append(tick);
  }

  // Hover reads the hour off the strip: a hairline on the band, the hour and cover on the label.
  const cross = document.createElement('span');
  cross.className = 'spark-cross';
  cross.hidden = true;
  band.append(cross);
  band.addEventListener('pointermove', (e) => {
    const box = band.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    cross.style.left = `${(at * 100).toFixed(2)}%`;
    cross.hidden = false;
    const hour = Math.round(at * 23);
    // Short stamps: the readout shares the label column, so "10 AM · 98%", not a full clock.
    let text = formatClock(from + hour * 3_600_000).replace(':00 ', ' ');
    if (day) {
      const h = Math.min(day.berlin.low.length - 1, hour);
      const cover = Math.round(100 * Math.max(day.berlin.low[h], day.berlin.mid[h], day.berlin.high[h]));
      text += ` · ${cover}%`;
    }
    readout.textContent = text;
  });
  band.addEventListener('pointerleave', () => {
    cross.hidden = true;
    readout.textContent = '';
  });

  row.append(label, band);
  mount.append(row);
}

/** The whole strip; an empty day list (no shots anywhere) leaves it empty. */
export function renderSparkstrip(mount, blocks, handlers = {}) {
  mount.replaceChildren();
  for (const block of blocks) sparkRow(mount, block, handlers);
}
