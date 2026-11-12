/**
 * Shot weather — "kann ich diesen Schuss in den nächsten 3 Tagen wirklich machen?"
 * Pure assessment + a thin fetch wrapper, NO Cesium.
 *
 * The calendar says WHEN the geometry aligns; the sky decides whether it is visible.
 * Open-Meteo's free forecast API (no key, CORS-open) supplies hourly cloud cover and
 * precipitation for the standing point; this module maps each alignment window onto
 * the nearest hourly sample and speaks the photographer's three-word verdict:
 * klar / grenzwertig / bedeckt. A failed fetch must never fake a verdict — the panel
 * shows an honest "Wetter nicht erreichbar" and keeps the geometric list.
 *
 * The verdict thresholds are deliberately blunt. A photographer does not plan on
 * "62 % mid-level cloud in one model run"; they plan on "is there a hole in the
 * clouds at 19:12". Three bands, stated in the UI, beat a false precision gradient.
 */

/** Hourly forecast series at one point, decoded from Open-Meteo's unixtime schema. */
export interface WeatherForecast {
  /** Sample instants, one per hour, ascending, UTC-true (unixtime epochs). */
  times: Date[];
  /** Cloud cover 0–100 %. */
  cloudCoverPct: number[];
  /** Precipitation mm/h. */
  precipitationMm: number[];
}

export type WeatherVerdict = 'klar' | 'grenzwertig' | 'bedeckt';

export interface WeatherAssessment {
  verdict: WeatherVerdict;
  cloudCoverPct: number;
  precipitationMm: number;
  /** Distance from the assessed instant to the nearest hourly sample, hours. */
  sampleOffsetHours: number;
}

const CLEAR_MAX_PCT = 25;
const BORDER_MAX_PCT = 65;

/**
 * The three bands. Below ~25 % the shot is on; up to ~65 % it is a hole-in-the-clouds
 * gamble; beyond that the window is behind cloud — say so instead of hedging.
 */
export function verdictFromCover(cloudCoverPct: number): WeatherVerdict {
  if (cloudCoverPct < CLEAR_MAX_PCT) return 'klar';
  if (cloudCoverPct <= BORDER_MAX_PCT) return 'grenzwertig';
  return 'bedeckt';
}

const VERDICT_LABEL: Record<WeatherVerdict, string> = {
  klar: 'klar',
  grenzwertig: 'grenzwertig',
  bedeckt: 'bedeckt',
};

/** "12 % Wolken — klar", rain appended only when it actually matters (>0.1 mm/h). */
export function formatAssessment(a: WeatherAssessment): string {
  const rain = a.precipitationMm > 0.1 ? ` · ${a.precipitationMm.toFixed(1)} mm/h` : '';
  return `${Math.round(a.cloudCoverPct)} % Wolken — ${VERDICT_LABEL[a.verdict]}${rain}`;
}

/**
 * Assess one instant against the hourly series: the nearest sample wins, and its age
 * is reported so the UI can admit a coarse match. Null outside the forecast range —
 * an unassessed window must not inherit a neighbouring day's sky.
 */
export function assessWindowWeather(forecast: WeatherForecast, when: Date): WeatherAssessment | null {
  const t = when.getTime();
  if (forecast.times.length === 0) return null;
  const first = forecast.times[0]!.getTime();
  const last = forecast.times[forecast.times.length - 1]!.getTime();
  if (t < first || t > last) return null;

  let best = 0;
  let bestDiff = Math.abs(t - first);
  for (let i = 1; i < forecast.times.length; i++) {
    const diff = Math.abs(t - forecast.times[i]!.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  const cloudCoverPct = forecast.cloudCoverPct[best]!;
  return {
    verdict: verdictFromCover(cloudCoverPct),
    cloudCoverPct,
    precipitationMm: forecast.precipitationMm[best]!,
    sampleOffsetHours: bestDiff / 3_600_000,
  };
}

/**
 * Decode Open-Meteo's hourly payload (timeformat=unixtime). Throws on shape drift —
 * a silently mis-decoded series would mislabel whole evenings.
 */
export function parseOpenMeteoHourly(payload: unknown): WeatherForecast {
  const p = payload as {
    hourly?: { time?: unknown; cloud_cover?: unknown; precipitation?: unknown };
  };
  const times = p.hourly?.time;
  const cloud = p.hourly?.cloud_cover;
  const precip = p.hourly?.precipitation;
  if (
    !Array.isArray(times) ||
    !Array.isArray(cloud) ||
    !Array.isArray(precip) ||
    times.length !== cloud.length ||
    times.length !== precip.length
  ) {
    throw new Error('open-meteo payload shape unexpected (hourly time/cloud_cover/precipitation)');
  }
  return {
    times: (times as number[]).map((s) => new Date(s * 1000)),
    cloudCoverPct: cloud as number[],
    precipitationMm: precip as number[],
  };
}

let loading: Promise<WeatherForecast> | null = null;
let loadingKey = '';

/**
 * Fetch once and share per (lat, lon, day-bucket) so a panel re-run inside the same
 * hour reuses the series. A failure clears the cache so a later attempt can succeed.
 */
export function loadForecast(lat: number, lon: number): Promise<WeatherForecast> {
  // Bucket coordinates to ~1 km and the hour to 6 h: the forecast is model output, not
  // a per-metre truth, and the shared cache should behave the same way.
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.floor(Date.now() / 21_600_000)}`;
  if (loading && loadingKey === key) return loading;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=cloud_cover,precipitation&forecast_days=3&timeformat=unixtime&timezone=auto`;
  loadingKey = key;
  loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`open-meteo: HTTP ${response.status}`);
    return parseOpenMeteoHourly(await response.json());
  })().catch((err: unknown) => {
    loading = null;
    loadingKey = '';
    throw err;
  });
  return loading;
}
