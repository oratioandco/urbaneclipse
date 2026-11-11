/**
 * Cloud forecasts for planning: hourly low, mid and high cloud over Berlin, and over points
 * out toward where the sun rises and sets, since a sunset glows when the horizon under the
 * sun is clear and there are higher clouds overhead to catch its light.
 *
 * From Open-Meteo (open-meteo.com, CC BY 4.0), free for non-commercial use; a commercial
 * launch needs their paid plan or the Deutscher Wetterdienst's open data instead. Forecasts
 * reach about 16 days ahead; recent days come from the same service's past forecasts.
 */
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';

const FORECAST_DAYS = 16;
const PAST_DAYS = 90;
const HORIZON_KM = [60, 120, 220];
const cache = new Map();

/** Where the sun meets the horizon on a day: its azimuth at rise and at set, degrees. */
function horizonAzimuths(dayStart) {
  let rise = null;
  let set = null;
  let last = sampleBody('sun', new Date(dayStart), FERNSEHTURM.lat, FERNSEHTURM.lon);
  for (let t = dayStart + 300_000; t <= dayStart + 86_400_000; t += 300_000) {
    const p = sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
    if (last.alt < 0 && p.alt >= 0) rise = { az: p.az, t };
    if (last.alt >= 0 && p.alt < 0) set = { az: last.az, t };
    last = p;
  }
  return { rise, set };
}

/** A point some kilometres out along a bearing, near enough on a sphere. */
function outAlong(bearingDeg, km) {
  const R = 6371;
  const d = km / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (FERNSEHTURM.lat * Math.PI) / 180;
  const lon1 = (FERNSEHTURM.lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/** Whether a day has a forecast at all: up to 16 days ahead, or within the last 90. */
export function forecastReach(date) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (days > FORECAST_DAYS - 1) return { ok: false, reason: `No forecast yet: it reaches ${FORECAST_DAYS} days ahead` };
  if (days < -PAST_DAYS) return { ok: false, reason: 'No weather kept for days this long ago' };
  return { ok: true };
}

/**
 * The day's clouds: hourly arrays (0 to 1) for Berlin, and for the horizon toward sunrise and
 * sunset. Null when the day is out of reach or the request fails.
 */
export async function cloudsFor(date, dayStart) {
  if (cache.has(date)) return cache.get(date);
  const promise = (async () => {
    if (!forecastReach(date).ok) return null;
    const { rise, set } = horizonAzimuths(dayStart);
    const points = [{ lat: FERNSEHTURM.lat, lon: FERNSEHTURM.lon }];
    for (const side of [rise, set]) for (const km of HORIZON_KM) points.push(side ? outAlong(side.az, km) : points[0]);
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(3)).join(','));
    url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(3)).join(','));
    url.searchParams.set('hourly', 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,visibility');
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('timezone', 'Europe/Berlin');
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`weather: HTTP ${response.status}`);
    const all = await response.json();
    const series = (i) => {
      const h = all[i].hourly;
      return { low: h.cloud_cover_low.map((v) => (v ?? 0) / 100), mid: h.cloud_cover_mid.map((v) => (v ?? 0) / 100), high: h.cloud_cover_high.map((v) => (v ?? 0) / 100) };
    };
    // How far you can see, metres. The forecast tops out at 24 km; a missing value is as clear.
    const berlin = all[0].hourly;
    const horizon = (from) => {
      const parts = HORIZON_KM.map((_, k) => series(from + k));
      return { low: parts[0].low.map((_, h) => Math.max(...parts.map((p) => p.low[h]))) };
    };
    const wind = { speed: berlin.wind_speed_10m.map((v) => v ?? 0), from: berlin.wind_direction_10m.map((v) => v ?? 270) };
    const vis = berlin.visibility.map((v) => v ?? 24_000);
    const rain = { prob: berlin.precipitation_probability.map((v) => (v ?? 0) / 100), mm: berlin.precipitation.map((v) => v ?? 0) };
    return { berlin: series(0), rain, wind, vis, riseHorizon: horizon(1), setHorizon: horizon(1 + HORIZON_KM.length), rise, set };
  })().catch((error) => {
    console.error('[miniature] weather failed', error);
    cache.delete(date);
    return null;
  });
  cache.set(date, promise);
  return promise;
}

/** Clouds at a moment, interpolated between the hours. */
export function cloudsAt(day, minutes) {
  const h = Math.min(22.999, Math.max(0, minutes / 60));
  const i = Math.floor(h);
  const f = h - i;
  const at = (a) => a[i] * (1 - f) + a[i + 1] * f;
  return { low: at(day.berlin.low), mid: at(day.berlin.mid), high: at(day.berlin.high) };
}

/** How far you can see at a moment, in metres, interpolated between the hours. */
export function visibilityAt(day, minutes) {
  const h = Math.min(22.999, Math.max(0, minutes / 60));
  const i = Math.floor(h);
  const f = h - i;
  return day.vis[i] * (1 - f) + day.vis[i + 1] * f;
}

/**
 * A photographer's reading of a sunrise or sunset from the clouds: whether the sun gets
 * through under the horizon's clouds, and whether there are clouds above to catch its colour.
 */
export function readSky(day, which) {
  const event = which === 'rise' ? day.rise : day.set;
  if (!event) return null;
  const hour = new Date(event.t).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false });
  const h = Math.min(23, Number(hour));
  const over = { low: day.berlin.low[h], mid: day.berlin.mid[h], high: day.berlin.high[h] };
  const horizonLow = (which === 'rise' ? day.riseHorizon : day.setHorizon).low[h];
  const canvas = Math.max(over.mid, over.high);
  if (over.low > 0.75) return { t: event.t, grade: 'poor', text: 'overcast, little direct light' };
  if (horizonLow > 0.6) return { t: event.t, grade: 'poor', text: 'low cloud on the horizon may hide the sun' };
  if (canvas > 0.2 && canvas < 0.8 && over.low < 0.5) return { t: event.t, grade: 'good', text: 'clouds above to catch the colour' };
  if (over.low + canvas < 0.15) return { t: event.t, grade: 'fair', text: 'clear: clean light, plain sky' };
  return { t: event.t, grade: 'fair', text: 'mixed cloud' };
}

/**
 * How far the clouds have drifted since midnight, in scene metres (x east, z south), hour by
 * hour with the forecast wind. Clouds travel faster than the wind at the ground; twice it is
 * a fair guess for low and middle cloud.
 */
export function cloudDrift(day, minutes) {
  let x = 0;
  let z = 0;
  const hours = Math.max(0, Math.min(24, minutes / 60));
  for (let h = 0; h < Math.ceil(hours); h++) {
    const span = Math.min(1, hours - h) * 3600;
    const speed = 2 * (day.wind.speed[h] ?? 0);
    const from = ((day.wind.from[h] ?? 270) * Math.PI) / 180;
    // Blowing from a bearing means moving toward the opposite one.
    x += -Math.sin(from) * speed * span;
    z += Math.cos(from) * speed * span;
  }
  return { x, z };
}
