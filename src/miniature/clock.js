/** The moment: the day and time inputs, and turning them into instants in Berlin time. */
import { formatDay, formatMinutes, parseTime, uses12h } from './time.js';
import { berlinDayEnd, berlinDayStart, isLaterReading, isSkipped, wallMinutesOf, wallToInstant } from './berlinClock.js';
import { params } from './config.js';
import { updateSun } from './lighting.js';
import { PHASE_COLOURS, updateDay } from './plan.js';
import { snapMinute } from './daylist.js';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { lightBands, lightGradientStops } from '../lib/lightPhases.ts';
import { invalidate } from './state.js';

export const dateInput = document.getElementById('date');
export const timeInput = document.getElementById('time');
export const clock = document.getElementById('clock');
// The time can be typed or picked as well as slid; the browser shows it in the viewer's format.
clock.classList.toggle('h12', uses12h);
clock.addEventListener('focus', () => clock.select());
clock.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') clock.blur();
  if (event.key === 'Escape') {
    clock.value = formatMinutes(Number(timeInput.value), fine.on);
    clock.blur();
  }
});
clock.addEventListener('change', () => {
  const minutes = parseTime(clock.value);
  // In fine timing the window moves to the typed time first, or the slider would clamp it.
  if (minutes !== null && fine.on) setFine(true, minutes);
  else if (minutes !== null) timeInput.value = String(minutes);
  skipMissingHour();
  clock.value = formatMinutes(Number(timeInput.value), fine.on);
  updateSun();
  invalidate();
});

/**
 * On the day the clocks go forward there is no 02:00 to 03:00. A time set inside it moves to
 * what the clock really reads then (02:30 becomes 03:30), so the label and the sky agree.
 */
function skipMissingHour() {
  const minutes = Number(timeInput.value);
  if (!isSkipped(dateInput.value, minutes)) return;
  const real = Math.min(Number(timeInput.max), minuteOf(instantOfMinute(minutes)));
  timeInput.value = String(real);
}

/**
 * A shot picked in the hour that happens twice (02:00 to 03:00 when the clocks go back) can
 * be its second occurrence, which the slider's wall-clock minutes cannot say. It is kept here
 * for as long as the slider and the day still read what the shot set.
 */
let pinned = null;

/** The instant (ms) of a wall-clock minute on the chosen day. */
export function instantOfMinute(minutes) {
  return wallToInstant(dateInput.value, minutes);
}

/** What the Berlin clock reads at an instant, in minutes after the chosen day's midnight. */
export function minuteOf(t) {
  return wallMinutesOf(dateInput.value, t);
}

export function instant() {
  if (pinned && pinned.day === dateInput.value && pinned.value === timeInput.value) return new Date(pinned.t);
  return new Date(instantOfMinute(Number(timeInput.value)));
}

/** Midnight Berlin time for a yyyy-mm-dd, as an instant. */
export function dateDayStart(value) {
  return berlinDayStart(value);
}

export function dayStart() {
  return berlinDayStart(dateInput.value);
}

/** The midnight that ends the chosen day: 23 or 25 hours after it starts when the clocks change. */
export function dayEnd() {
  return berlinDayEnd(dateInput.value);
}

/** Set the time to an instant on the chosen day, to 5 seconds. */
export function setMinute(t) {
  // Wall-clock minutes, not minutes elapsed since midnight: the two differ by an hour after
  // a clock change, which used to set the scene an hour off the shot.
  const minutes = Math.round(minuteOf(t) * 12) / 12;
  if (fine.on) setFine(true, minutes);
  else timeInput.value = String(minutes);
  pinned = isLaterReading(dateInput.value, t) ? { day: dateInput.value, value: timeInput.value, t: Math.round(t / 5000) * 5000 } : null;
  updateSun();
}

/**
 * Fine timing: the slider covers half an hour either side of the moment, in 5-second steps,
 * and the clock shows seconds. The sun takes a minute or two to cross the sphere.
 */
export const fine = { on: false };
const FINE_MINUTES = 30;
const fineButton = document.getElementById('fine');
export function setFine(on, value = Number(timeInput.value)) {
  fine.on = on;
  fineButton.setAttribute('aria-pressed', String(on));
  document.body.dataset.fine = String(on);
  const middle = Math.min(1439 - FINE_MINUTES, Math.max(FINE_MINUTES, value));
  timeInput.min = String(on ? middle - FINE_MINUTES : 0);
  timeInput.max = String(on ? middle + FINE_MINUTES : 1439);
  timeInput.value = String(value);
  showPhases();
  if (document.activeElement !== clock) clock.value = formatMinutes(value, on);
}
fineButton.addEventListener('click', () => {
  setFine(!fine.on);
  invalidate();
});
// Back on the map the slider is the whole day again.
new MutationObserver(() => {
  if (document.body.dataset.eye !== 'true' && fine.on) setFine(false);
}).observe(document.body, { attributes: true, attributeFilter: ['data-eye'] });

/** The slider's colours: the light through the stretch of time it covers. */
export function showPhases() {
  const from = instantOfMinute(Number(timeInput.min));
  const to = instantOfMinute(Number(timeInput.max));
  const stops = lightGradientStops(lightBands(from, to, FERNSEHTURM.lat, FERNSEHTURM.lon, fine.on ? 30_000 : 300_000), from, to);
  timeInput.style.setProperty('--phases', stops.map((s) => `${PHASE_COLOURS[s.phase]} ${(s.at * 100).toFixed(1)}%`).join(','));
}

const startAt = params.get('date') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
dateInput.value = startAt;
timeInput.value = params.get('time') ?? '960';
skipMissingHour();
const todayInBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
function showDay() {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  const isToday = dateInput.value === todayInBerlin();
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' });
  document.getElementById('day-label').textContent = isToday ? `Today, ${label}` : label;
  // At eye level the date sits on the button for more dates.
  document.getElementById('dates-day').textContent = isToday ? 'Today' : formatDay(dateInput.value);
  document.getElementById('today').hidden = isToday;
}
export function setDay(value) {
  if (!value) return;
  dateInput.value = value;
  skipMissingHour();
  showDay();
  updateDay();
  updateSun();
  invalidate();
}
function shiftDay(days) {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  setDay(new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10));
}
dateInput.addEventListener('input', () => setDay(dateInput.value));
document.getElementById('prev-day').addEventListener('click', () => shiftDay(-1));
document.getElementById('next-day').addEventListener('click', () => shiftDay(1));
document.getElementById('today').addEventListener('click', () => setDay(todayInBerlin()));
showDay();
// Scrubbing near a tower alignment snaps to its minute, so the disc lands behind the
// sphere instead of a minute beside it. Fine timing is the photographer's hand, not a scrub.
timeInput.addEventListener('input', () => {
  if (!fine.on) {
    const snap = snapMinute(instantOfMinute(Number(timeInput.value)));
    if (snap !== null) timeInput.value = String(Math.round(minuteOf(snap)));
  }
  skipMissingHour();
  updateSun();
});
