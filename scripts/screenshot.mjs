// Headless screenshot of the Plaster Void app for visual verification (Constitution III).
// Usage: node scripts/screenshot.mjs [URL] [OUT]
import { chromium } from '@playwright/test';

const URL = process.argv[2] || process.env.URL || 'http://localhost:4321/';
const OUT = process.argv[3] || 'data/screenshot.png';
const WAIT = Number(process.env.WAIT || 12000);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const reqs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('response', (r) => {
  const u = r.url().replace(/^https?:\/\/[^/]+/, '');
  if (u.includes('/cesium/') || u.includes('/test_tile/') || u.includes('/_astro/')) {
    reqs.push(`${r.status()} ${u}`);
  }
});

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
// Give Cesium time to init + the tileset to stream + a frame to render.
await page.waitForTimeout(WAIT);
await page.screenshot({ path: OUT });

const probe = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return {
    hasCanvas: !!canvas,
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    bodyText: (document.body.innerText || '').slice(0, 200),
  };
});

console.log('PROBE:', JSON.stringify(probe));
console.log('REQUESTS:', reqs.length ? reqs.join('\n  ') : '(none matched)');
console.log('CONSOLE_ERRORS:', JSON.stringify(errors, null, 2));
await browser.close();
