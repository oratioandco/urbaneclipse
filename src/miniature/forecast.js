/** The day's cloud forecast in the panel: loading it and reading sunrise and sunset for colour. */
import { cloudsAt, cloudsFor, forecastReach, visibilityAt } from './weather.js';
import { formatClock } from './time.js';
import { shotVerdict } from './verdict.js';
import { layers, setCloudHint } from './chrome.js';
import { dateInput, dayStart } from './clock.js';
import { renderDayList } from './daylist.js';
import { renderPlanCards } from './planmode.js';
import { updateSun } from './lighting.js';
import { updateTracks } from './plan.js';
import { app, invalidate } from './state.js';

const weatherLine = document.getElementById('weather');
export function loadWeather() {
  const date = dateInput.value;
  app.weather = null;
  setCloudHint(false);
  const reach = forecastReach(date);
  if (!reach.ok) {
    weatherLine.textContent = reach.reason;
    weatherLine.dataset.state = 'none';
    return;
  }
  weatherLine.textContent = 'Loading the cloud forecast\u2026';
  weatherLine.dataset.state = 'loading';
  app.weatherFailed = false;
  cloudsFor(date, dayStart()).then((day) => {
    if (dateInput.value !== date) return;
    app.weather = day;
    app.weatherFailed = !day;
    if (!day) {
      // The request failed: say so, and let the lists and the day view say "No forecast".
      showWeather();
      updateTracks();
      renderDayList();
      return;
    }
    // The low and middle decks are what can hide the map: when their peak for the day is heavy,
    // the layers button says so.
    setCloudHint(Math.max(...day.berlin.low.map((low, h) => Math.max(low, day.berlin.mid[h]))) > 0.55);
    showWeather();
    updateTracks();
    renderDayList();
    renderPlanCards();
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
      const event = app.weather[which];
      const part = document.createElement('span');
      if (!event) return part;
      // The same verdict a shot at that minute gets (verdict.js): the sun on the horizon, seen
      // through the cloud out toward it. Whether clouds above may colour is a note, not a grade.
      const said = shotVerdict(app.weather, dayStart(), event.t, { body: 'sun' });
      const word = Object.assign(document.createElement('em'), { className: 'verdict', textContent: said.word });
      word.dataset.grade = said.grade;
      part.append(`${which === 'rise' ? 'Sunrise' : 'Sunset'} ${formatClock(event.t)}: `, word, ` \u00b7 ${said.reason}${said.colour ? ' \u00b7 clouds above may catch the colour' : ''}`);
      return part;
    }),
  );
}

/** Cloud and sight at an instant, as a short note for the list. */
export function cloudNote(t) {
  if (!app.weather || !layers.weather) return '';
  const minutes = (t - dayStart()) / 60_000;
  const c = cloudsAt(app.weather, minutes);
  const cover = Math.round(100 * Math.max(c.low, c.mid, c.high));
  const vis = visibilityAt(app.weather, minutes);
  const view = vis < 20_000 ? ` \u00b7 ${vis >= 950 ? `${(Math.round(vis / 100) / 10).toFixed(1).replace(/\.0$/, '')} km` : `${Math.round(vis / 50) * 50} m`} view` : '';
  return ` \u00b7 ${cover < 10 ? 'clear sky' : `${cover}% cloud${c.low > 0.6 ? ', low' : ''}`}${view}`;
}
