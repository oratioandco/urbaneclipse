/** The day's cloud forecast in the panel: loading it and reading sunrise and sunset for colour. */
import { cloudsAt, cloudsFor, forecastReach, readSky } from './weather.js';
import { formatClock } from './time.js';
import { layers } from './chrome.js';
import { dateInput, dayStart } from './clock.js';
import { renderDayList } from './daylist.js';
import { updateSun } from './lighting.js';
import { updateTracks } from './plan.js';
import { app, invalidate } from './state.js';

const weatherLine = document.getElementById('weather');
export function loadWeather() {
  const date = dateInput.value;
  app.weather = null;
  const reach = forecastReach(date);
  if (!reach.ok) {
    weatherLine.textContent = reach.reason;
    weatherLine.dataset.state = 'none';
    return;
  }
  weatherLine.textContent = 'Loading the cloud forecast\u2026';
  weatherLine.dataset.state = 'loading';
  cloudsFor(date, dayStart()).then((day) => {
    if (dateInput.value !== date) return;
    app.weather = day;
    showWeather();
    updateTracks();
    renderDayList();
    updateSun();
    invalidate();
  });
}

/** Sunrise and sunset, read for colour: will the sun get through, and will clouds catch it? */
function showWeather() {
  if (!app.weather) {
    weatherLine.textContent = 'No cloud forecast available';
    weatherLine.dataset.state = 'none';
    return;
  }
  weatherLine.dataset.state = 'ok';
  weatherLine.replaceChildren(
    ...['rise', 'set'].map((which) => {
      const reading = readSky(app.weather, which);
      const part = document.createElement('span');
      if (!reading) return part;
      part.dataset.grade = reading.grade;
      part.textContent = `${which === 'rise' ? 'Sunrise' : 'Sunset'} ${formatClock(reading.t)}: ${reading.text}`;
      return part;
    }),
  );
}

/** Cloud at an instant, as a short note for the list. */
export function cloudNote(t) {
  if (!app.weather || !layers.weather) return '';
  const c = cloudsAt(app.weather, (t - dayStart()) / 60_000);
  const cover = Math.round(100 * Math.max(c.low, c.mid, c.high));
  return ` \u00b7 ${cover < 10 ? 'clear sky' : `${cover}% cloud${c.low > 0.6 ? ', low' : ''}`}`;
}
