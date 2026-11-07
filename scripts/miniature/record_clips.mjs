#!/usr/bin/env node
/**
 * Records the landing page's clips from the planner itself, frame by frame, so they are smooth
 * whatever the machine: each frame sets the time, waits for the render, and takes a screenshot;
 * ffmpeg then makes an H.264 MP4 and a poster.
 *
 * Usage: npx astro build && npx astro preview, then
 *   node scripts/miniature/record_clips.mjs http://localhost:4321 [clip ...]
 * Output: public/media/<clip>.mp4 and <clip>.jpg
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2];
const ONLY = process.argv.slice(3);
const OUT = new URL('../../public/media/', import.meta.url).pathname;
const FPS = 30;
fs.mkdirSync(OUT, { recursive: true });

/** The panel and buttons, hidden for the clips that show only the city. */
const CLEAN = '.bottom, .tools, .topleft, #stick, #viewhere, #toast { display: none !important; }';
/** For the photo itself: everything but the scene hidden, layout kept so the viewfinder stays put. */
const PHOTO = '.bottom, .tools, .topleft, #stick, #viewhere, #toast, #labels { visibility: hidden !important; }';

const CLIPS = {
  // Berlin from morning to night: shadows, golden hour, the city's lights, the hour lines.
  'berlin-day': { url: '/plan/?nointro&date=2027-06-21&time=300&height=4200', from: 300, to: 1380, seconds: 12, css: CLEAN, poster: 0.86 },
  // Treptow, across the Spree: a ring of sun round the sphere, 10 June 2027.
  'sun-sphere': { photo: true, url: '/plan/?nointro&date=2027-06-10&time=1264&at=52.492250,13.471850&look=307,2.6&lens=400&cam=ff', from: 1261.5, to: 1266.5, seconds: 9, poster: 0.5 },
  // Treptow at night: the moon setting behind the antenna, 18 February 2027.
  'moon-antenna': { photo: true, url: '/plan/?nointro&date=2027-02-18&time=342.083&at=52.492250,13.471850&look=307,3.2&lens=400&cam=ff', from: 339, to: 345, seconds: 9, poster: 0.55 },
  // Karl-Marx-Allee from Frankfurter Tor: the sun going down the avenue behind the sphere, 12 April 2027.
  'street-henge': { photo: true, url: '/plan/?nointro&date=2027-04-12&time=1171.25&at=52.515750,13.453950&look=280.1,3&lens=200&cam=ff', from: 1166, to: 1173, seconds: 9, poster: 0.78 },
};

const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
for (const [name, clip] of Object.entries(CLIPS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const page = await (await browser.newContext({ viewport: clip.photo ? { width: 1500, height: 1060 } : { width: 1280, height: 720 } })).newPage();
  await page.goto(BASE + clip.url);
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  if (clip.pick) {
    await page.click('#sheet-toggle');
    await page.locator('#daylist .dayrow', { hasText: clip.pick }).first().click();
    await page.waitForFunction(() => window.__mini.look.active, null, { timeout: 60000 });
    const now = await page.evaluate(() => Number(document.getElementById('time').value));
    clip.from = now + clip.span[0];
    clip.to = now + clip.span[1];
  } else if (clip.url.includes('at=')) {
    await page.waitForFunction(() => window.__mini.look.active, null, { timeout: 60000 });
  }
  if (clip.css) await page.addStyleTag({ content: clip.css });
  // Eye-level clips show only what is inside the viewfinder: the photo you would take.
  let crop;
  if (clip.photo) {
    await page.addStyleTag({ content: PHOTO });
    const f = await page.evaluate(() => window.__mini.frame());
    const even = (v) => Math.round(v / 2) * 2;
    crop = { x: even(f.x + 2), y: even(f.y + 2), width: even(f.w - 4), height: even(f.h - 4) };
  }
  // Let full detail arrive where the camera looks.
  await page.waitForTimeout(6000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clip-${name}-`));
  const frames = Math.round(clip.seconds * FPS);
  for (let i = 0; i < frames; i++) {
    const minutes = clip.from + ((clip.to - clip.from) * i) / (frames - 1);
    await page.evaluate((m) => {
      const time = document.getElementById('time');
      // Widen the slider if fine timing would clamp the value.
      if (m < Number(time.min) || m > Number(time.max)) document.getElementById('fine').click();
      time.value = String(m);
      time.dispatchEvent(new Event('input'));
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, minutes);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92, clip: crop });
  }
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
  // The poster: the clip's most telling frame, two thirds in for most.
  const poster = String(Math.round(frames * (clip.poster ?? 0.6))).padStart(4, '0');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, `${poster}.jpg`), '-q:v', '4', path.join(OUT, `${name}.jpg`)]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${frames} frames, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
  await page.close();
}
await browser.close();
