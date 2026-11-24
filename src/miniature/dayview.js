/**
 * The day view: one day, the full 24 hours on a straight scale. At rest it says three things:
 * the day's light (the sun and moon curves over a horizon, and the light bar), whether the
 * weather lets it through (one cloud band, rain bars), and the few moments that are shots
 * (ticks on the scale, and the row of cards above it).
 *
 * It is also the time control. The app's time lives in the `#time` input, as it always has:
 * the thumb here writes to it and fires its `input` event, so the light, the clock and the
 * address follow as before, and the input itself stays in place, unseen, as the slider for
 * keyboards and screen readers. The arithmetic is in dayTimeline.js.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { LIGHT_PHASE_NAMES, lightPhaseAt } from '../lib/lightPhases.ts';
import { cssRgb } from '../lib/mapBodyLook.ts';
import { skyPalette } from '../lib/skyPalette.ts';
import { dateInput, dayEnd, dayStart, instantOfMinute, minuteOf } from './clock.js';
import { phaseStops } from './dayMath.js';
import { bodyIcon } from './bodyAt.js';
import { currentRows, dayVerdict, emptyNote, markKind, openShot, showVerdict } from './daylist.js';
import { icon } from './icons.js';
import { MARK_NAMES, markBody } from './marks.js';
import { shotCard } from './shotCard.js';
import {
  DAY_MINUTES,
  altitudeToY,
  clampMinute,
  cloudBand,
  glideAt,
  minuteToX,
  neighbourShot,
  nextShotIndex,
  rainBars,
  shotAt,
  shotRowLayout,
  shotRowScroll,
  topAltitude,
  xToMinute,
} from './dayTimeline.js';
import { PHASE_COLOURS } from './plan.js';
import { app, invalidate } from './state.js';
import { formatClock, formatHour, formatMinutes, uses12h } from './time.js';
import { skyAt } from './verdict.js';

// Taken from the page, not from clock.js: these modules import each other in a ring, and this
// file wires the input up as soon as it loads.
const timeInput = document.getElementById('time');
const timeline = document.getElementById('timeline');
const plot = document.getElementById('tl-plot');
const bar = document.getElementById('tl-bar');
const thumb = document.getElementById('tl-thumb');
const label = document.getElementById('tl-label');
const sunDot = document.getElementById('tl-sun');
const moonDot = document.getElementById('tl-moon');
const shotsRow = document.getElementById('shots-row');
const shotsCount = document.getElementById('shots-count');
const readout = document.getElementById('dv-readout');
const earlier = document.getElementById('dv-earlier');
const later = document.getElementById('dv-later');

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};

// The plot, top to bottom, in CSS pixels: the thumb's label, the cloud band with rain
// hanging from it, the curves over the horizon, the light bar, the hours.
const PAD_X = 12;
const BAND = { y: 16, h: 9 };
const RAIN = { y: BAND.y + BAND.h + 1, h: 11 };
const CURVES = { y: 28, h: 46 };
const BAR = { y: 78, h: 8 };
const HOURS_Y = 97;
const STEP_MIN = 10;
/** A mark's 16-unit box on the scale: 11 px, the size the set was judged at. */
const MARK_SCALE = 11 / 16;
const DOT = 14;
// For the headless renders of the card on its own (the landmarks no list shows yet).
window.__shotCard = shotCard;
/** The strip's cards are 6:5 (miniature.css `--shot-aspect`): their frames are drawn to that. */
const STRIP_PIXELS = [336, 280];

const atEye = () => document.body.dataset.eye === 'true';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const here = (body, t) => sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);

/** The look the thumb's two dots were last drawn for. */
let dots = '';
/** What the last drawing was made for, so a scrub only moves the thumb. */
let drawn = { width: 0, from: 0, top: 30, rows: [], minutes: [], verdicts: [], key: '', current: -1 };
const scaleX = (minute) => PAD_X + minuteToX(minute) * (drawn.width - 2 * PAD_X);
const curveY = (alt) => CURVES.y + altitudeToY(alt, drawn.top) * CURVES.h;

/** The plot's standing parts: everything that only changes with the day or its forecast. */
function drawPlot() {
  const width = timeline.clientWidth;
  if (!width) return;
  const from = dayStart();
  const inner = width - 2 * PAD_X;
  const x = (minute) => PAD_X + minuteToX(minute) * inner;
  plot.setAttribute('viewBox', `0 0 ${width} 100`);

  const samples = [];
  for (let minute = 0; minute <= DAY_MINUTES; minute += STEP_MIN) {
    // The scale is the wall clock's: each minute on it is that reading's own instant, which is
    // not midnight plus that many minutes on the two days the clocks change.
    const t = instantOfMinute(minute);
    samples.push({ minute, sun: here('sun', t).alt, moon: here('moon', t).alt });
  }
  const top = topAltitude(Math.max(...samples.map((s) => s.sun)), Math.max(...samples.map((s) => s.moon)));
  drawn = { ...drawn, width, from, top };
  const horizonY = curveY(0);
  const line = (body) => samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.minute).toFixed(1)},${curveY(s[body]).toFixed(1)}`).join('');

  const nodes = [];
  const defs = el('defs');
  const above = el('clipPath', { id: 'tl-above' });
  above.append(el('rect', { x: 0, y: 0, width, height: horizonY }));
  const below = el('clipPath', { id: 'tl-below' });
  below.append(el('rect', { x: 0, y: horizonY, width, height: 100 - horizonY }));
  const glow = el('linearGradient', { id: 'tl-daylight', x1: 0, y1: 0, x2: 0, y2: 1 });
  glow.append(el('stop', { offset: 0, 'stop-color': 'var(--sun)', 'stop-opacity': 0.3 }), el('stop', { offset: 1, 'stop-color': 'var(--sun)', 'stop-opacity': 0 }));
  // The sun's curve takes the sun's own colour for its height, minute by minute: orange on
  // the horizon, pale gold higher, white when high, from the palette the map's sun uses.
  const sunTint = el('linearGradient', { id: 'tl-suntint', gradientUnits: 'userSpaceOnUse', x1: x(0), y1: 0, x2: x(DAY_MINUTES), y2: 0 });
  for (const s of samples) sunTint.append(el('stop', { offset: (s.minute / DAY_MINUTES).toFixed(4), 'stop-color': cssRgb(skyPalette('sun', Math.max(0, s.sun)).discTint) }));
  defs.append(above, below, glow, sunTint);

  // Cloud: one band from the three layers, each hour at its centre. Clear sky leaves it empty.
  const day = app.weather;
  if (day) {
    const band = cloudBand(day.berlin);
    const cloud = el('linearGradient', { id: 'tl-cloud', x1: 0, y1: 0, x2: 1, y2: 0 });
    band.forEach((strength, h) => cloud.append(el('stop', { offset: ((h + 0.5) / band.length).toFixed(4), 'stop-color': 'var(--cloud)', 'stop-opacity': strength.toFixed(3) })));
    defs.append(cloud);
    nodes.push(el('rect', { class: 'tl-cloud', x: PAD_X, y: BAND.y, width: inner, height: BAND.h, rx: BAND.h / 2, fill: 'url(#tl-cloud)' }));
    rainBars(day.rain).forEach((rain, h) => {
      if (!rain) return;
      const w = inner / 24;
      nodes.push(el('rect', { class: 'tl-rain', x: (PAD_X + h * w + w * 0.2).toFixed(1), y: RAIN.y, width: (w * 0.6).toFixed(1), height: (rain.height * RAIN.h).toFixed(1), rx: 1, opacity: rain.strength.toFixed(2) }));
    });
  }

  // The light: the sun's curve, solid while it is up, and the moon's, dotted.
  nodes.push(
    el('path', { class: 'tl-daylight', d: `${line('sun')}L${x(DAY_MINUTES)},${horizonY}L${x(0)},${horizonY}Z`, fill: 'url(#tl-daylight)', 'clip-path': 'url(#tl-above)' }),
    el('path', { class: 'tl-horizon', d: `M${PAD_X},${horizonY.toFixed(1)}H${width - PAD_X}` }),
    el('path', { class: 'tl-curve tl-down', d: line('sun'), 'clip-path': 'url(#tl-below)' }),
    el('path', { class: 'tl-curve tl-moon tl-down', d: line('moon'), 'clip-path': 'url(#tl-below)' }),
    el('path', { class: 'tl-curve tl-moon', d: line('moon'), 'clip-path': 'url(#tl-above)' }),
    el('path', { class: 'tl-curve tl-casing', d: line('sun'), 'clip-path': 'url(#tl-above)' }),
    el('path', { class: 'tl-curve tl-sun', d: line('sun'), stroke: 'url(#tl-suntint)', 'clip-path': 'url(#tl-above)' }),
  );

  // The shots, as ticks standing on the light bar at their minute.
  // Their heads are the marks of marks.js: a ring for the tower, a bar for a street, white
  // inside for the sun and dark for the moon. Streets first, so a tower's ring lies on top
  // where the two meet.
  const now = Date.now();
  const order = drawn.rows.map((row, i) => ({ row, i })).sort((a, b) => (a.row.kind === 'tower') - (b.row.kind === 'tower'));
  for (const { row, i } of order) {
    const at = x(drawn.minutes[i]).toFixed(1);
    const tick = el('g', { class: `tl-tick tl-tick-${row.body}${row.t < now ? ' tl-past' : ''}` });
    tick.innerHTML = `<path d="M${at},${CURVES.y + 4}V${BAR.y}"/><g transform="translate(${at} ${CURVES.y + 4}) scale(${MARK_SCALE})">${markBody(markKind(row), 'var(--surface-solid)')}</g>`;
    nodes.push(tick);
  }
  // Where today has got to.
  if (now >= from && now < dayEnd()) {
    const at = x(minuteOf(now)).toFixed(1);
    nodes.push(el('path', { class: 'tl-now', d: `M${at},${BAR.y - 4}V${BAR.y + BAR.h + 4}` }));
  }
  const hours = uses12h ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21, 24];
  for (const hour of hours) {
    nodes.push(el('text', { class: 'tl-hour', x: x(hour * 60), y: HOURS_Y, 'text-anchor': hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle' }, formatHour(hour % 24)));
  }
  plot.replaceChildren(defs, ...nodes);

  // The light bar: one continuous gradient, in the colours the app gives the phases.
  const stops = phaseStops(dateInput.value);
  bar.style.background = `linear-gradient(90deg, ${stops.map((s) => `${PHASE_COLOURS[s.phase]} ${(s.at * 100).toFixed(1)}%`).join(',')})`;
  dots = '';
}

/** The row of shots above the scale: the same rows the day list holds, as cards. */
function drawShots() {
  const rows = drawn.rows;
  const now = Date.now();
  const isToday = now >= drawn.from && now < dayEnd();
  if (!rows.length) {
    const note = app.dayReady ? emptyNote() : Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Working out the day…' });
    shotsRow.replaceChildren(note);
    shotsRow.dataset.scrolls = 'false';
    shotsCount.textContent = '';
    return;
  }
  // Two and a half frames show on a phone: each wide enough for its words on one line, the
  // half one saying there are more. On a wider row, as many as fit at that width.
  const whole = shotRowLayout(shotsRow.clientWidth, rows.length, { min: 2, ideal: 140 });
  const layout = whole.fits === 2 && rows.length > 2 ? { ...whole, card: (shotsRow.clientWidth - 2 * whole.gap) / 2.5 } : whole;
  shotsRow.style.setProperty('--card', `${layout.card.toFixed(2)}px`);
  shotsRow.dataset.scrolls = String(layout.scrolls);
  shotsRow.replaceChildren(
    ...rows.map((row, i) => {
      const verdict = drawn.verdicts[i];
      // The one shot card (shotCard.js), at its card size.
      const card = shotCard(row, verdict, { pixels: STRIP_PIXELS });
      card.dataset.index = String(i);
      card.title = `${row.title} (${MARK_NAMES[markKind(row)].toLowerCase()}) · ${row.detail}`;
      const go = Object.assign(document.createElement('span'), { className: 'sc-go', textContent: 'View from here' });
      go.insertAdjacentHTML('beforeend', icon('chevron-right', { size: 12 }));
      card.querySelector('.sc-meta').append(go);
      card.addEventListener('click', () => {
        // A first tap brings the time to the shot; a tap on the shot the thumb stands on opens
        // the view from where to stand for it.
        if (shotAt(drawn.minutes, Number(timeInput.value)) === i) openShot(row, verdict);
        else glideTo(drawn.minutes[i]);
      });
      return card;
    }),
  );
  // "Possible" is a claim about the weather: only with a forecast. Without one, the count
  // is the geometry's, and says so.
  const graded = drawn.verdicts.some((v) => v.grade !== null && v.grade !== 'past');
  const open = drawn.verdicts.filter((v) => v.grade !== 'past' && v.grade !== 'poor').length;
  const ahead = drawn.verdicts.filter((v) => v.grade !== 'past').length;
  if (graded) shotsCount.textContent = `${open} possible${isToday ? ' from now' : ''}${layout.scrolls ? ` · ${rows.length} in all` : ''}`;
  else if (!ahead) shotsCount.textContent = `all ${rows.length} passed`;
  else shotsCount.textContent = `${ahead} line up${isToday ? ' from now' : ''} · ${dayVerdict(null).label.toLowerCase()}`;
  // A new day opens at its next shot; a redraw of the same day leaves the row where it is.
  const key = `${dateInput.value}|${rows.length}|${Math.round(layout.card)}`;
  if (key !== drawn.key) {
    drawn.key = key;
    shotsRow.scrollLeft = shotRowScroll(isToday ? nextShotIndex(rows.map((r) => r.t), now) : 0, rows.length, layout);
  }
  showEdges();
}

/** The row fades at an edge that has more behind it. */
function showEdges() {
  shotsRow.dataset.before = String(shotsRow.scrollLeft > 2);
  shotsRow.dataset.after = String(shotsRow.scrollLeft + shotsRow.clientWidth < shotsRow.scrollWidth - 2);
}
shotsRow.addEventListener('scroll', showEdges, { passive: true });

/** Everything that follows the minute: the thumb, its label, the dots on the curves, the line of text. */
function place() {
  if (!drawn.width || atEye()) return;
  const minute = clampMinute(Number(timeInput.value));
  const t = instantOfMinute(minute);
  thumb.style.transform = `translateX(${scaleX(minute).toFixed(2)}px)`;
  const stamp = formatMinutes(minute);
  label.textContent = stamp;

  const sun = here('sun', t);
  const moon = here('moon', t);
  // One sun and one moon: the dots on the curves are the canonical bodies of that minute
  // (bodyAt.js), redrawn only when their look can have changed (half a degree).
  sunDot.style.top = `${curveY(sun.alt).toFixed(1)}px`;
  sunDot.dataset.up = String(sun.alt > 0);
  moonDot.style.top = `${curveY(moon.alt).toFixed(1)}px`;
  moonDot.dataset.up = String(moon.alt > 0);
  const look = `${drawn.from}|${Math.round(sun.alt * 2)}|${Math.round(moon.alt * 2)}`;
  if (look !== dots) {
    dots = look;
    sunDot.innerHTML = bodyIcon('sun', t, { size: DOT });
    moonDot.innerHTML = bodyIcon('moon', t, { size: DOT });
  }

  const index = shotAt(drawn.minutes, minute);
  for (const card of shotsRow.querySelectorAll('.shotcard')) {
    const on = Number(card.dataset.index) === index;
    if (on) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
  }
  // The card the thumb has just come to stand on is brought into the row's view.
  if (index !== drawn.current) {
    drawn.current = index;
    const card = index >= 0 ? shotsRow.querySelector(`.shotcard[data-index="${index}"]`) : null;
    if (card && (card.offsetLeft < shotsRow.scrollLeft || card.offsetLeft + card.offsetWidth > shotsRow.scrollLeft + shotsRow.clientWidth)) {
      shotsRow.scrollTo({ left: card.offsetLeft - (shotsRow.clientWidth - card.offsetWidth) / 2, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }
  earlier.disabled = neighbourShot(drawn.minutes, minute, -1) === null;
  later.disabled = neighbourShot(drawn.minutes, minute, 1) === null;

  const phase = LIGHT_PHASE_NAMES[lightPhaseAt(sun.alt)];
  const up = sun.alt > -0.5 ? `sun ${Math.round(sun.alt)}° up` : moon.alt > 0 ? `moon ${Math.round(moon.alt)}° up` : 'sun and moon down';
  let sky = '';
  if (app.weather) {
    const at = skyAt(app.weather, minute);
    const cover = Math.round(100 * Math.max(at.low, at.mid, at.high));
    sky = ` · ${cover < 10 ? 'clear sky' : `cloud ${cover}%`}${at.rain >= 0.2 ? ` · rain ${Math.round(at.rain * 100)}%` : ''}`;
  } else sky = ` · ${dayVerdict(null).label.toLowerCase()}`;
  if (index >= 0) {
    const shot = Object.assign(document.createElement('b'), { textContent: drawn.rows[index].title });
    const verdict = document.createElement('em');
    verdict.className = 'verdict';
    showVerdict(verdict, drawn.verdicts[index]);
    readout.replaceChildren(shot, ' · ', verdict);
  } else readout.textContent = `${phase} · ${up}${sky}`;
  timeInput.setAttribute('aria-valuetext', `${stamp}, ${index >= 0 ? `${drawn.rows[index].title}, ${drawn.verdicts[index].label}` : `${phase}, ${up}${sky.replace(/ · /g, ', ')}`}`);
}

/** Redraw the day view: after the day, its paths, its forecast or the layers change. */
export function renderDayView() {
  const rows = currentRows();
  drawn.rows = rows;
  drawn.from = dayStart();
  // Where a shot stands on the scale is what the clock reads at it.
  drawn.minutes = rows.map((row) => minuteOf(row.t));
  drawn.verdicts = rows.map((row) => dayVerdict(row));
  // Out of sight (the panel shows the next three days): draw when it comes back, at its width.
  if (!timeline.clientWidth) {
    drawn.width = 0;
    return;
  }
  drawPlot();
  drawShots();
  place();
}
// The plot is drawn in real pixels, so a new width (a turned phone, the panel unfolding, the
// way back from eye level) draws it again.
new ResizeObserver(() => {
  if (timeline.clientWidth && timeline.clientWidth !== drawn.width && !atEye()) renderDayView();
}).observe(timeline);
// Shots pass and "now" moves on under an open panel.
setInterval(() => {
  if (!atEye() && !document.hidden) renderDayView();
}, 60_000);

// Whoever sets the time (the clock field, a shot, a link) sets `#time`; the thumb follows.
let placing = 0;
const follow = () => {
  if (placing) return;
  placing = requestAnimationFrame(() => {
    placing = 0;
    place();
  });
};
{
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(timeInput, 'value', {
    configurable: true,
    get() {
      return native.get.call(this);
    },
    set(value) {
      native.set.call(this, value);
      follow();
    },
  });
  timeInput.addEventListener('input', follow);
}

/** Set the time from the day view: no snapping, and through the input's own event. */
function setMinute(minute) {
  app.freeScrub = true;
  timeInput.value = String(clampMinute(minute));
  timeInput.dispatchEvent(new Event('input', { bubbles: true }));
  app.freeScrub = false;
  invalidate();
}

let glide = 0;
function stopGlide() {
  cancelAnimationFrame(glide);
  glide = 0;
}
/** Bring the time to a minute at a glide, so the light is seen to move there. */
function glideTo(minute) {
  stopGlide();
  const from = Number(timeInput.value);
  if (reducedMotion.matches || Math.abs(minute - from) < 0.5) return setMinute(minute);
  const start = performance.now();
  const ms = 420;
  const step = (now) => {
    const at = glideAt(from, minute, now - start, ms);
    setMinute(at);
    glide = now - start < ms ? requestAnimationFrame(step) : 0;
  };
  glide = requestAnimationFrame(step);
}

// Dragging. A mouse scrubs from the press. A finger scrubs once it moves sideways: the
// timeline lets the browser keep vertical swipes (touch-action: pan-y), so a swipe that
// starts here scrolls the sheet, and the browser cancels the pointer to say so. Whole minutes:
// a quarter of a pixel at phone width, so the thumb moves freely and never snaps to a shot.
// The timeline's box is read once, at the press: nothing is measured while the thumb moves.
let scrub = null;
const minuteAt = (event, box = timeline.getBoundingClientRect()) => Math.round(xToMinute(event.clientX, box.left + PAD_X, box.width - 2 * PAD_X));
timeline.addEventListener('pointerdown', (event) => {
  if (atEye() || scrub || (event.pointerType === 'mouse' && event.button !== 0)) return;
  stopGlide();
  scrub = { id: event.pointerId, x0: event.clientX, moved: event.pointerType === 'mouse', box: timeline.getBoundingClientRect() };
  if (scrub.moved) {
    timeline.setPointerCapture(scrub.id);
    timeline.dataset.scrub = 'true';
    setMinute(minuteAt(event, scrub.box));
  }
});
timeline.addEventListener('pointermove', (event) => {
  if (!scrub || event.pointerId !== scrub.id) return;
  if (!scrub.moved) {
    if (Math.abs(event.clientX - scrub.x0) < 4) return;
    scrub.moved = true;
    timeline.setPointerCapture(scrub.id);
    timeline.dataset.scrub = 'true';
  }
  setMinute(minuteAt(event, scrub.box));
});
function endScrub(event) {
  if (!scrub || event.pointerId !== scrub.id) return;
  // A tap that never moved: go to the minute under it.
  if (!scrub.moved && event.type === 'pointerup') glideTo(minuteAt(event, scrub.box));
  scrub = null;
  delete timeline.dataset.scrub;
}
timeline.addEventListener('pointerup', endScrub);
timeline.addEventListener('pointercancel', endScrub);

// The keyboard's slider is the `#time` input itself: a minute a press, ten with Shift, an
// hour with Page Up and Down. At eye level the same keys work the ticket's scrubber, within
// its range and to its step (5 seconds in fine timing), and it keeps its snap to the tower.
timeInput.addEventListener('keydown', (event) => {
  const eye = atEye();
  const fineStep = document.body.dataset.fine === 'true';
  const one = fineStep ? 1 / 12 : 1;
  const now = fineStep ? Number(timeInput.value) : Math.round(Number(timeInput.value));
  const small = (event.shiftKey ? 10 : 1) * one;
  const to = {
    ArrowLeft: now - small,
    ArrowDown: now - small,
    ArrowRight: now + small,
    ArrowUp: now + small,
    PageDown: now - 60 * one,
    PageUp: now + 60 * one,
    Home: Number(timeInput.min),
    End: Number(timeInput.max),
  }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  stopGlide();
  const value = Math.min(Number(timeInput.max), Math.max(Number(timeInput.min), to));
  if (!eye) return setMinute(value);
  timeInput.value = String(value);
  timeInput.dispatchEvent(new Event('input', { bubbles: true }));
  invalidate();
});

// The buttons: a minute either way, and the shot before and after.
document.getElementById('dv-minus').addEventListener('click', () => {
  stopGlide();
  setMinute(Math.ceil(Number(timeInput.value)) - 1);
});
document.getElementById('dv-plus').addEventListener('click', () => {
  stopGlide();
  setMinute(Math.floor(Number(timeInput.value)) + 1);
});
for (const [button, dir] of [[earlier, -1], [later, 1]]) {
  button.addEventListener('click', () => {
    const to = neighbourShot(drawn.minutes, Number(timeInput.value), dir);
    if (to === null) return;
    glideTo(to);
  });
}
