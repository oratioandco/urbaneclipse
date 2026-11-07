#!/usr/bin/env node
/**
 * Film C's one continuous camera move, recorded from the real planner frame by frame:
 * the moon on the antenna through a 600 mm lens across the Spree at Treptow, zoom out to 24 mm, rise to 120 m,
 * pull back to the whole night city, run the day forward while drifting to the TV tower's other
 * spot, and dive back in for a ring of sun round the sphere at 600 mm.
 *
 * The page's clock is replaced by a virtual one (requestAnimationFrame and performance.now),
 * stepped 1/30 s per frame, so the planner's own animated transitions record smoothly.
 *
 *   node social/record_c.mjs http://localhost:4321
 * Output: social/assets/footage/journey-ui.mp4 and journey-clean.mp4
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.argv[2];
const OUT = new URL('./assets/footage/', import.meta.url).pathname;
const FPS = 30;
// FEED=1: the same journey in a 540×675 layout, as journey-ui-feed.mp4 and journey-clean-feed.mp4.
const FEED = process.env.FEED === '1';
const VARIANTS = ['ui', 'clean'];
// Treptow, across the Spree: the moon behind the antenna on 18 February 2027, and a ring of sun on 10 June.
const MOON = '/plan/?nointro&date=2027-02-18&time=341.4&at=52.492250,13.471850&look=307,2.7&lens=600&cam=ff';
const SUN = { url: '/plan/?nointro&date=2027-06-10&time=1264&at=52.492250,13.471850&look=307,2.2&lens=600&cam=ff' };
const HIDE_UI = 'body.clean .bottom, body.clean .tools, body.clean .topleft, body.clean #stick, body.clean #viewhere, body.clean #toast, body.clean #flatmap, body.clean #labels { visibility: hidden !important; }';

const ease = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const lerp = (a, b, k) => a + (b - a) * k;

const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: FEED ? 675 : 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let manual = false;
  let v = 0;
  performance.now = () => (manual ? v : realNow());
  window.requestAnimationFrame = (cb) => realRaf((t) => cb(manual ? v : t));
  window.__clock = { start() { v = realNow(); manual = true; }, step(ms) { v += ms; } };
});

// Where the sun shot stands, in scene metres, read from the planner itself.
const probe = await ctx.newPage();
await probe.goto(BASE + SUN.url);
await probe.waitForFunction(() => window.__mini?.look?.active, null, { timeout: 120000 });
Object.assign(SUN, await probe.evaluate(() => ({ x: window.__mini.look.x, z: window.__mini.look.z })));
await probe.close();

const page = await ctx.newPage();
await page.goto(BASE + MOON);
await page.waitForFunction(() => window.__mini?.look?.active, null, { timeout: 120000 });
await page.addStyleTag({ content: HIDE_UI });
await page.waitForTimeout(7000);
// Slider positions for the lenses, from the slider's own log scale.
const slider = await page.evaluate(() => {
  const el = document.getElementById('lens');
  const at = (v) => { el.value = String(v); el.dispatchEvent(new Event('input')); return window.__mini.look.lens; };
  const v600 = Number(el.value);
  const min = at(0), max = at(1000);
  at(v600);
  const pos = (mm) => (Math.log(mm / min) / Math.log(max / min)) * 1000;
  return { v600, v24: pos(24) };
});
console.log('lens slider', slider, 'sun spot', SUN);
await page.evaluate(() => window.__clock.start());

const dirs = Object.fromEntries(VARIANTS.map((v) => [v, fs.mkdtempSync(path.join(os.tmpdir(), `journey-${v}-`))]));
let n = 0;
const setTime = (m) => page.evaluate((m) => {
  const time = document.getElementById('time');
  const fine = document.getElementById('fine');
  if ((m < Number(time.min) || m > Number(time.max)) && fine?.getAttribute('aria-pressed') === 'true') fine.click();
  time.value = String(m);
  time.dispatchEvent(new Event('input'));
}, m);
async function shoot(extraFrames = 0) {
  await page.evaluate(() => window.__clock.step(1000 / 30));
  for (let i = 0; i < 2 + extraFrames; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  for (const v of VARIANTS) {
    await page.evaluate((v) => document.body.classList.toggle('clean', v === 'clean'), v);
    await page.screenshot({ path: path.join(dirs[v], `${String(n).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 });
  }
  n++;
}
const setLensSlider = (v) => page.$eval('#lens', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, v);
const orbit = (deg, scale = 1, target = null) => page.evaluate(([deg, scale, target]) => {
  const m = window.__mini;
  const c = m.camera, t = m.controls.target;
  if (target) { const dx = target[0] - t.x, dz = target[1] - t.z; t.x += dx; t.z += dz; c.position.x += dx; c.position.z += dz; }
  const a = (deg * Math.PI) / 180;
  const x = c.position.x - t.x, y = c.position.y - t.y, z = c.position.z - t.z;
  c.position.set(t.x + (x * Math.cos(a) - z * Math.sin(a)) * scale, t.y + y * scale, t.z + (x * Math.sin(a) + z * Math.cos(a)) * scale);
  c.lookAt(t);
  m.controls.update();
  m.invalidate();
}, [deg, scale, target]);

// A1: the photo. 2.5 s.
for (let i = 0; i < 75; i++) { await setTime(lerp(341.4, 342.3, i / 74)); await shoot(); }
// A2: zoom out 600 → 24 mm. 4 s.
for (let i = 0; i < 120; i++) {
  const k = ease(i / 119);
  await setTime(lerp(342.3, 343, i / 119));
  await setLensSlider(lerp(slider.v600, slider.v24, k));
  await shoot();
}
// A3: take off and rise to 120 m. 4 s.
await page.$eval('#takeoff', (el) => el.click());
for (let i = 0; i < 120; i++) {
  const h = Math.round(lerp(1, 120, ease(i / 119)));
  await page.$eval('#height', (el, h) => { el.value = String(h); el.dispatchEvent(new Event('input')); }, h);
  await setTime(lerp(343, 343.5, i / 119));
  await shoot();
}
// The moon's street beams read as pale streaks over the night map, so the streets layer rests
// until June, where the sun's beams are warm and belong to the shot.
const streets = (on) => page.$eval('#layers-menu input[data-layer="streets"]', (el, on) => { if (el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change')); } }, on);
await streets(false);
// A4: back to the map, the planner's own 1.4 s transition, then keep pulling back. 1.6 s + 2 s.
await page.evaluate(() => window.__mini.exitEye());
for (let i = 0; i < 48; i++) await shoot();
const moonTarget = await page.evaluate(() => [window.__mini.controls.target.x, window.__mini.controls.target.z]);
for (let i = 0; i < 60; i++) { await orbit(0.35, 1 + 0.012 * (1 - i / 60)); await setTime(lerp(343.5, 360, i / 59)); await shoot(1); }
// B1: the day runs forward (18 February, 06:00 → 13:00). 3 s.
for (let i = 0; i < 90; i++) {
  const k = i / 89;
  await setTime(lerp(360, 780, k));
  await orbit(0.3, 1, [lerp(moonTarget[0], SUN.x, k * 0.45), lerp(moonTarget[1], SUN.z, k * 0.45)]);
  await shoot(1);
}
// Into June: the same hour on 3 June, while the light is high and the change is quiet.
await page.evaluate(() => { const d = document.getElementById('date'); d.value = '2027-06-10'; d.dispatchEvent(new Event('input')); });
await streets(true);
// B2: 13:00 → 20:58, drifting back over the spot and coming down. 3 s.
const startTarget = await page.evaluate(() => [window.__mini.controls.target.x, window.__mini.controls.target.z]);
for (let i = 0; i < 90; i++) {
  const k = i / 89;
  await setTime(lerp(780, 1258, k));
  await orbit(0.3, 1 - 0.012 * ease(k), [lerp(startTarget[0], SUN.x, ease(k)), lerp(startTarget[1], SUN.z, ease(k))]);
  await shoot(1);
}
// C1: step back in at the spot, 600 mm. The planner's 1.7 s dive.
await page.evaluate(([x, z]) => window.__mini.enterEye(x, z, { heading: 307, pitch: 2.2, lens: 600 }), [SUN.x, SUN.z]);
for (let i = 0; i < 54; i++) { await setTime(lerp(1258, 1260.5, i / 53)); await shoot(); }
// C2: the sun slides behind the sphere into a ring. 4 s.
await page.evaluate(() => { const f = document.getElementById('fine'); if (f && f.getAttribute('aria-pressed') !== 'true') f.click(); });
for (let i = 0; i < 120; i++) { await setTime(lerp(1260.6, 1265.5, i / 119)); await shoot(); }

for (const v of VARIANTS) {
  const file = path.join(OUT, FEED ? `journey-${v}-feed.mp4` : `journey-${v}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dirs[v], '%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-an', file]);
  fs.rmSync(dirs[v], { recursive: true, force: true });
  console.log(`${path.basename(file)}: ${n} frames`);
}
await browser.close();
