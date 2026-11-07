/** The moment: the day and time inputs, and turning them into instants in Berlin time. */
import { formatDay, formatMinutes, parseTime, uses12h } from './time.js';
import { params } from './config.js';
import { updateSun } from './lighting.js';
import { updateDay } from './plan.js';
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
    clock.value = formatMinutes(Number(timeInput.value));
    clock.blur();
  }
});
clock.addEventListener('change', () => {
  const minutes = parseTime(clock.value);
  if (minutes !== null) timeInput.value = String(minutes);
  clock.value = formatMinutes(Number(timeInput.value));
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

export function dayStart() {
  const [y, m, d] = dateInput.value.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  return guess.getTime() - berlinOffsetMinutes(guess) * 60_000;
}

export function setMinute(t) {
  timeInput.value = String(Math.round((t - dayStart()) / 60_000));
  updateSun();
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
