/**
 * Shared set-up for the adversarial test scripts (docs/adversarial-test-2026-11.md).
 *
 *   npm run build && npx astro preview --port 4471 &
 *   node scripts/adversarial/<script>.mjs            # BASE, OUT, CITY and CACHE can be set in the environment
 *
 * The city geometry is not in git: /city/ requests are answered from CITY (the live site, read
 * only) through a cache on disk, as scripts/miniature/perf.mjs does. The forecast is either the
 * real one ('live'), a fixed partly cloudy day ('fixed'), a failure ('fail', '500'), or the fixed
 * one after a delay ('slow'). Chrome draws with the machine's GPU (Metal); GPU=0 uses the software
 * rasteriser, which is five times slower and draws the eye-level sky differently.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BASE = process.env.BASE ?? 'http://localhost:4471';
export const OUT = process.env.OUT ?? 'adversarial-renders';
export const CITY = process.env.CITY ?? 'https://urbaneclipse.oratio.co';
export const CACHE = process.env.CACHE ?? '.perf-city-cache';
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

export const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  narrow: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  wide: { viewport: { width: 2560, height: 1200 }, deviceScaleFactor: 1 },
};

const hours = (f) => Array.from({ length: 24 }, (_, h) => f(h));
const fixedPoint = {
  hourly: {
    cloud_cover_low: hours((h) => 35 + 20 * Math.sin(h / 3)),
    cloud_cover_mid: hours((h) => 40 + 25 * Math.cos(h / 4)),
    cloud_cover_high: hours(() => 30),
    precipitation_probability: hours(() => 10),
    precipitation: hours(() => 0),
    wind_speed_10m: hours(() => 4),
    wind_direction_10m: hours(() => 250),
    visibility: hours(() => 24_000),
  },
};

let browser;
export async function open({ size = 'desktop', scheme = 'light', forecast = 'live', timezone, reducedMotion, slowMs = 8000, geolocation, locale, gpu = process.env.GPU !== '0' } = {}) {
  browser ??= await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    ...SIZES[size],
    colorScheme: scheme,
    ...(timezone ? { timezoneId: timezone } : {}),
    ...(reducedMotion ? { reducedMotion: 'reduce' } : {}),
    ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {}),
    ...(locale ? { locale } : {}),
  });
  const page = await context.newPage();
  const log = [];
  page.on('pageerror', (e) => log.push({ type: 'pageerror', text: String(e) }));
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log.push({ type: m.type(), text: m.text(), url: m.location()?.url }));
  page.on('requestfailed', (r) => log.push({ type: 'requestfailed', text: `${r.url()} ${r.failure()?.errorText}` }));
  page.on('response', (r) => r.status() >= 400 && log.push({ type: 'http', text: `${r.status()} ${r.url()}` }));

  await context.route('**/city/**', async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const file = join(CACHE, name);
    if (!existsSync(file)) {
      const response = await fetch(`${CITY}${url.pathname}${url.search}`, { headers: { 'accept-encoding': 'identity' } });
      if (!response.ok) return route.fulfill({ status: response.status, body: '' });
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
  const forecastCalls = [];
  if (forecast !== 'live') {
    await context.route(/api\.open-meteo\.com/, async (route) => {
      forecastCalls.push(route.request().url());
      if (forecast === 'fail') return route.abort('failed');
      if (forecast === '500') return route.fulfill({ status: 500, body: 'nope' });
      if (forecast === 'slow') await new Promise((r) => setTimeout(r, slowMs));
      const q = new URL(route.request().url()).searchParams;
      const points = q.get('latitude').split(',').length;
      const days = Number(q.get('forecast_days') ?? 1);
      const point = { hourly: Object.fromEntries(Object.entries(fixedPoint.hourly).map(([k, v]) => [k, Array.from({ length: Math.max(1, days) }, () => v).flat()])) };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(points > 1 ? Array.from({ length: points }, () => point) : point) });
    });
  } else {
    page.on('request', (r) => /open-meteo/.test(r.url()) && forecastCalls.push(r.url()));
  }
  return { context, page, log, forecastCalls };
}

/** Open /plan/ and wait until the city is built. */
export async function plan(page, query = '', { wait = 1500 } = {}) {
  await page.goto(`${BASE}/plan/?nointro${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  await page.waitForTimeout(wait);
}

export const shot = (page, name, opts = {}) => page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
export const close = () => browser?.close();
export const save = (name, data) => writeFileSync(join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
