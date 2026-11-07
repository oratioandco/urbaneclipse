#!/usr/bin/env node
/**
 * Footage for the social films, recorded from the real planner frame by frame at 1080×1920
 * (a 540×960 phone layout at 2×). Each frame sets the time (and camera), waits two frames,
 * screenshots. Eye-level shots are taken twice per frame: with the planner's UI ("-ui") and
 * with only the scene ("-clean").
 *
 *   node social/record.mjs https://urbaneclipse.oratio.co [shot ...]
 * Output: social/assets/footage/<shot>.mp4 (CRF 16, for editing)
 * FEED=1 records the eye-level takes again in a 540×675 layout (1080×1350) as <shot>-ui-feed.mp4 and
 * <shot>-clean-feed.mp4, so the 4:5 posts show the planner as it lays itself out at that size
 * instead of a cropped phone.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.argv[2];
const ONLY = process.argv.slice(3);
const OUT = new URL('./assets/footage/', import.meta.url).pathname;
const STILLS = new URL('./assets/stills/', import.meta.url).pathname;
const FPS = 30;
const FEED = process.env.FEED === '1';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(STILLS, { recursive: true });

const HIDE_UI = 'body.clean .bottom, body.clean .tools, body.clean .topleft, body.clean #stick, body.clean #viewhere, body.clean #toast, body.clean #flatmap { visibility: hidden !important; } body.clean.nolabels #labels { visibility: hidden !important; }';

const SHOTS = {
  // Afternoon into deep night over the whole city, the camera turning slowly.
  'city-daynight': { url: '/plan/?nointro&date=2027-03-22&time=900&height=2600', from: 900, to: 1435, seconds: 16, orbit: 40, clean: 'only' },
  // The night city, closer, turning.
  'city-night': { url: '/plan/?nointro&date=2027-03-22&time=1350&height=1500&tilt=62', from: 1350, to: 1365, seconds: 10, orbit: 50, clean: 'only' },
  // Noon, the same turn, for the "planned to the second" beat.
  'city-noon': { url: '/plan/?nointro&date=2027-06-03&time=740&height=1900&tilt=58', from: 740, to: 760, seconds: 8, orbit: 35, clean: 'only' },
  // Golden hour, low and close, long shadows across Mitte.
  'city-golden': { url: '/plan/?nointro&date=2027-03-22&time=1060&height=1300&tilt=66&heading=200', from: 1060, to: 1080, seconds: 9, orbit: 40, clean: 'only' },
  // Treptow, across the Spree: a ring of sun round the sphere, 10 June 2027 at 21:04.
  eclipse: { url: '/plan/?nointro&date=2027-06-10&time=1264&at=52.492250,13.471850&look=307,2.2&lens=600&cam=ff', from: 1261.5, to: 1266.5, seconds: 10 },
  // Treptow at night: the moon behind the antenna, 18 February 2027 at 05:42.
  moon: { url: '/plan/?nointro&date=2027-02-18&time=342.083&at=52.492250,13.471850&look=307,2.7&lens=600&cam=ff', from: 338, to: 346, seconds: 10 },
  // Treptow at dawn: the full moon at the sphere, 24 November 2026 at 07:23.
  dawn: { url: '/plan/?nointro&date=2026-11-24&time=443.083&at=52.492250,13.471850&look=307,2.6&lens=600&cam=ff', from: 439, to: 447, seconds: 10 },
  // Karl-Marx-Allee from Frankfurter Tor: the sun sets down the avenue behind the sphere, 12 April 2027.
  henge: { url: '/plan/?nointro&date=2027-04-12&time=1171.25&at=52.515750,13.453950&look=280.1,3.5&lens=300&cam=ff', from: 1168, to: 1175, seconds: 10 },
  // Karl-Marx-Allee: the full moon setting down the avenue at dawn, 21 February 2027.
  kmamoon: { url: '/plan/?nointro&date=2027-02-21&time=414&at=52.515750,13.453950&look=280,2.5&lens=200&cam=ff', from: 408, to: 420, seconds: 10 },
  // Mont Klamott, Volkspark Friedrichshain: the sun behind the sphere over the hill, 21 February 2027.
  klamott: { url: '/plan/?nointro&date=2027-02-21&time=1006.333&at=52.528250,13.435550&look=245,5.5&lens=300&cam=ff', from: 1003, to: 1010, seconds: 10 },
  // Rising as a drone over the Spree at Treptow towards the tower at sunset.
  drone: { url: '/plan/?nointro&date=2027-06-10&time=1250&at=52.492250,13.471850&look=307,1.5&lens=70&cam=drone-3', from: 1250, to: 1254, seconds: 7, rise: [2, 110] },
};

const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: FEED ? 675 : 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

async function setTime(page, m) {
  await page.evaluate((m) => {
    const time = document.getElementById('time');
    if (m < Number(time.min) || m > Number(time.max)) document.getElementById('fine')?.click();
    time.value = String(m);
    time.dispatchEvent(new Event('input'));
  }, m);
}
const frames2 = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const [name, shot] of Object.entries(SHOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  if (FEED && shot.clean === 'only') continue;
  const page = await ctx.newPage();
  await page.goto(BASE + shot.url);
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  const eye = shot.url.includes('at=');
  if (eye) await page.waitForFunction(() => window.__mini.look.active, null, { timeout: 60000 });
  await page.addStyleTag({ content: HIDE_UI });
  if (shot.clean === 'only') await page.evaluate(() => document.body.classList.add('clean', 'nolabels'));
  if (shot.rise) {
    await page.click('#takeoff');
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(7000);
  const n = Math.round(shot.seconds * FPS);
  const variants = shot.clean === 'only' ? ['clean'] : ['ui', 'clean'];
  const dirs = Object.fromEntries(variants.map((v) => [v, fs.mkdtempSync(path.join(os.tmpdir(), `shot-${name}-${v}-`))]));
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    await setTime(page, shot.from + (shot.to - shot.from) * k);
    if (shot.orbit) {
      await page.evaluate(([deg]) => {
        const m = window.__mini;
        const c = m.camera, t = m.controls.target;
        const a = (deg * Math.PI) / 180;
        const x = c.position.x - t.x, z = c.position.z - t.z;
        c.position.x = t.x + x * Math.cos(a) - z * Math.sin(a);
        c.position.z = t.z + x * Math.sin(a) + z * Math.cos(a);
        c.lookAt(t);
        m.controls.update();
        m.invalidate();
      }, [shot.orbit / (n - 1)]);
    }
    if (shot.rise) {
      const h = Math.round(shot.rise[0] + (shot.rise[1] - shot.rise[0]) * (0.5 - Math.cos(Math.PI * k) / 2));
      await page.$eval('#height', (el, h) => { el.value = String(h); el.dispatchEvent(new Event('input')); }, h);
    }
    await frames2(page);
    if (shot.orbit) await frames2(page);
    for (const v of variants) {
      if (shot.clean !== 'only') await page.evaluate((v) => { document.body.classList.toggle('clean', v === 'clean'); document.body.classList.toggle('nolabels', v === 'clean'); }, v);
      await page.screenshot({ path: path.join(dirs[v], `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 });
    }
  }
  for (const v of variants) {
    const file = path.join(OUT, FEED ? `${name}-${v}-feed.mp4` : shot.clean === 'only' ? `${name}.mp4` : `${name}-${v}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dirs[v], '%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-an', file]);
    fs.rmSync(dirs[v], { recursive: true, force: true });
    console.log(`${path.basename(file)}: ${n} frames, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  }
  await page.close();
}

// Stills of the planner's own panels: the dates list and the share menu, at the eclipse spot.
if (!FEED && (!ONLY.length || ONLY.includes('panels'))) {
  const page = await ctx.newPage();
  await page.goto(BASE + SHOTS.henge.url);
  await page.waitForFunction(() => window.__mini?.look?.active, null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${STILLS}/eye-ui.png` });
  await page.click('#dates-toggle');
  await page.waitForSelector('#dates .dayrow, #dates li', { timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${STILLS}/dates.png` });
  await page.click('#dates-toggle');
  await page.waitForTimeout(800);
  await page.click('#share');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${STILLS}/share.png` });
  console.log('panels: eye-ui, dates, share');
  await page.close();
}
await browser.close();
