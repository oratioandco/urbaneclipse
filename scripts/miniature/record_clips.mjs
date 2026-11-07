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
  // The sun setting behind the sphere from 2.5 km, as found by the day list.
  'sun-sphere': { photo: true, url: '/plan/?nointro&date=2027-06-03&time=720', pick: '2.5 km', span: [-4, 4], seconds: 9, poster: 0.5 },
  // The full moon setting behind the antenna at dawn.
  'moon-antenna': { photo: true, url: '/plan/?nointro&date=2027-03-22&time=310&at=52.527508,13.470412&look=259.8,4.4&lens=400&cam=ff', from: 305, to: 316, seconds: 9, poster: 0.47 },
  // Grunewaldstraße, a street henge: the sun sinking straight down the street.
  'street-henge': { photo: true, url: '/plan/?nointro&date=2027-03-08&time=1065&at=52.489820,13.353401&look=260.8,1.4&lens=85&cam=ff', from: 1056, to: 1069, seconds: 9, poster: 0.62 },
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
