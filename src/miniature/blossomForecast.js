/**
 * Predicting the cherry blossom from the year's warmth: Berlin's daily mean temperatures from
 * Open-Meteo, summed as growing degree days, each kind's peak read where the sum crosses its
 * threshold. Only worth it while the season is in reach — in autumn the answer is pure
 * climatology and no request is made. When the prediction lands it goes on `app.blossomPeaks`,
 * which the tree renderer reads on its next pass (never blocking a frame on the fetch).
 */
import { CHERRY_EARLY, CHERRY_ORNAMENTAL, CHERRY_LATE, climatologyPeak, peakFromGdd } from './blossom.js';
import { layers } from './chrome.js';
import { app, invalidate } from './state.js';
import { setTrees } from './trees.js';

/** How close the season must be before a forecast beats the climatology, in days. */
const REACH = 42;

const cache = new Map();

/** Only the ornamental kinds, in the order the UI names them. */
const KINDS = [CHERRY_EARLY, CHERRY_ORNAMENTAL, CHERRY_LATE];
const LABEL = { [CHERRY_EARLY]: 'early', [CHERRY_ORNAMENTAL]: 'ornamental', [CHERRY_LATE]: 'late' };

function withinReach(now, kind) {
  const peak = climatologyPeak(now.getUTCFullYear(), kind) ?? climatologyPeak(now.getUTCFullYear() + 1, kind);
  const next = peak < now.getTime() ? climatologyPeak(now.getUTCFullYear() + 1, kind) : peak;
  return next != null && Math.abs(next - now.getTime()) < REACH * 86_400_000;
}

function gddCurve(day) {
  if (cache.has(day)) return cache.get(day);
  const work = (async () => {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', '52.5208');
    url.searchParams.set('longitude', '13.4094');
    url.searchParams.set('daily', 'temperature_2m_mean');
    url.searchParams.set('past_days', '92');
    url.searchParams.set('forecast_days', '16');
    url.searchParams.set('timezone', 'Europe/Berlin');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`blossom: HTTP ${response.status}`);
    const { daily } = await response.json();
    const time = daily.time.map((d) => Date.parse(`${d}T12:00:00Z`));
    const means = daily.temperature_2m_mean.map((v) => v ?? 0);
    const days = [];
    let sum = 0;
    for (let i = 0; i < time.length; i++) {
      sum += Math.max(0, means[i]);
      days.push({ t: time[i], gdd: sum });
    }
    return days;
  })().catch((error) => {
    console.error('[miniature] blossom forecast failed', error);
    cache.delete(day);
    return null;
  });
  cache.set(day, work);
  return work;
}

/** Fetch the temperatures once a day and, in season, set the predicted peaks on the app. */
export function loadBlossom() {
  const now = new Date();
  if (!KINDS.some((kind) => withinReach(now, kind))) return;
  const day = now.toISOString().slice(0, 10);
  gddCurve(day).then((days) => {
    if (!days || day !== new Date().toISOString().slice(0, 10)) return;
    const peaks = {};
    for (const kind of KINDS) {
      const predicted = peakFromGdd(days, kind);
      // A prediction only replaces the climatology while it stays plausible: within reach of
      // today. Beyond the horizon it would be the extrapolation talking, not the weather.
      if (predicted && Math.abs(predicted - now.getTime()) < REACH * 86_400_000) peaks[kind] = predicted;
    }
    if (!Object.keys(peaks).length) return;
    app.blossomPeaks = peaks;
    setTrees({ date: now, on: layers.trees });
    invalidate();
  });
}
