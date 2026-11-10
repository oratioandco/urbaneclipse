/** The moment: the day and time inputs, and turning them into instants in Berlin time. */
import { formatDay, formatMinutes, parseTime, uses12h } from './time.js';
import { params } from './config.js';
import { updateSun } from './lighting.js';
import { PHASE_COLOURS, updateDay } from './plan.js';
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
  clock.value = formatMinutes(Number(timeInput.value), fine.on);
  updateSun();
  invalidate();
});

// The offset only changes on the hour at most; asking Intl every frame showed in profiles.
const offsets = new Map();
const berlinOffsetMinutes = (date) => {
  const hour = Math.floor(date.getTime() / 3_600_000);
  let offset = offsets.get(hour);
  if (offset === undefined) {
    const local = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    offset = (local - utc) / 60_000;
    offsets.set(hour, offset);
  }
  return offset;
};

export function instant() {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  const minutes = Number(timeInput.value);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return new Date(guess.getTime() - berlinOffsetMinutes(guess) * 60_000);
}

/** Midnight Berlin time for a yyyy-mm-dd, as an instant. */
export function dateDayStart(value) {
  const [y, m, d] = value.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  return guess.getTime() - berlinOffsetMinutes(guess) * 60_000;
}

export function dayStart() {
  return dateDayStart(dateInput.value);
}

/** Set the time to an instant on the chosen day, to 5 seconds. */
export function setMinute(t) {
  const minutes = Math.round((t - dayStart()) / 5000) / 12;
  if (fine.on) setFine(true, minutes);
  else timeInput.value = String(minutes);
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
  const from = dayStart() + Number(timeInput.min) * 60_000;
  const to = dayStart() + Number(timeInput.max) * 60_000;
  const stops = lightGradientStops(lightBands(from, to, FERNSEHTURM.lat, FERNSEHTURM.lon, fine.on ? 30_000 : 300_000), from, to);
  timeInput.style.setProperty('--phases', stops.map((s) => `${PHASE_COLOURS[s.phase]} ${(s.at * 100).toFixed(1)}%`).join(','));
}

const startAt = params.get('date') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
dateInput.value = startAt;
timeInput.value = params.get('time') ?? '960';
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
timeInput.addEventListener('input', updateSun);
