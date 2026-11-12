// Headless proof that the in-scene moon's terminator is right (docs: verify before claiming).
//
//   npm run build
//   rsync the built city into dist/city if it is not there (public/city is not in git)
//   npx astro preview --port 4410 &
//   node scripts/miniature/verify_moon_terminator.mjs http://localhost:4410 <shots dir>
//
// For each of two computed moments — a near-full moon and a first quarter — it opens the
// planner at eye level looking straight at the moon, reads the sun/moon directions the
// sky shader is actually fed (window.__sky), measures the lit fraction and the bright
// limb's direction from the screenshot's pixels, and compares both with the ephemeris.

import { chromium } from '@playwright/test';
import { getMoonIllumination, getMoonPosition, getPosition } from 'suncalc';

const [base = 'http://localhost:4410', out = '/tmp/moon-terminator'] = process.argv.slice(2);
const mkdir = (await import('node:fs')).mkdirSync;
mkdir(out, { recursive: true });

const RAD = Math.PI / 180;
const MOON_RADIUS = 0.0045; // sky.js: the disc's angular radius, radians
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
// state.js toDirection's world frame
const worldDir = (azDeg, altDeg) => {
  const a = azDeg * RAD, h = altDeg * RAD;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
};

// Where to stand: Treptower Park, open sky, well clear of the tower. 100 m up clears roofs.
const AT = '52.4905,13.4690';

// The two moments, chosen so the moon is well up and the sun well down. ?time is minutes
// after Berlin midnight (clock.js instant()).
const MOMENTS = [
  {
    name: 'full',
    utc: '2027-01-22T19:00:00Z', // 20:00 Berlin, moon alt ~28°, fraction 0.999
  },
  {
    name: 'quarter',
    utc: '2027-01-15T20:17:00Z', // 21:17 Berlin, moon alt ~34°, fraction 0.500
  },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push('console ' + m.text()));

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
  if (!cond) failed++;
};

for (const moment of MOMENTS) {
  const when = new Date(moment.utc);
  const momentDate = moment.utc.slice(0, 10);
  // ?time is minutes after Berlin midnight; find Berlin's wall-clock minutes for this UTC instant.
  const berlin = new Date(when.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const utcWall = new Date(when.toLocaleString('en-US', { timeZone: 'UTC' }));
  const minutes = Math.round((berlin.getTime() - utcWall.getTime()) / 60_000
    + when.getUTCHours() * 60 + when.getUTCMinutes());

  const mp = getMoonPosition(when, 52.52, 13.41);
  const sp = getPosition(when, 52.52, 13.41);
  const illum = getMoonIllumination(when);
  const expectedFraction = (1 - Math.cos(Math.acos(Math.max(-1, Math.min(1,
    dot3(worldDir(mp.azimuth, mp.altitude), worldDir(sp.azimuth, sp.altitude))))))) / 2;
  console.log(`\n== ${moment.name}: ${when.toISOString()}  moon az ${mp.azimuth.toFixed(1)} alt ${mp.altitude.toFixed(1)}, sun alt ${sp.altitude.toFixed(1)}, suncalc fraction ${illum.fraction.toFixed(4)}, geometry fraction ${expectedFraction.toFixed(4)}`);

  const url = `${base}/plan/?nointro&date=${momentDate}&time=${Math.round(minutes)}&at=${AT}&look=${mp.azimuth.toFixed(2)},${Math.min(mp.altitude, 80).toFixed(2)}&lens=600&fly=100&shadow=1024&mirror=0`;
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => window.__ready && window.__mini.look.active, null, { timeout: 120_000 });
  await page.waitForTimeout(2500); // transition to settle, texture in, a rendered frame

  // --- scene state: what the shader is actually fed ---
  const scene = await page.evaluate(() => {
    const v = (x) => ({ x: x.value.x, y: x.value.y, z: x.value.z });
    const cam = window.__mini.camera;
    const m = v(window.__sky.uMoonDir);
    // moon centre and screen radius: the dome sits on the camera, 0.0045 rad (sky.js's
    // MOON_RADIUS) out along uMoonDir
    const p = new (cam.position.constructor)(
      cam.position.x + m.x * 20000, cam.position.y + m.y * 20000, cam.position.z + m.z * 20000);
    const ndc = p.project(cam);
    const f = (innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
    return {
      sunDir: v(window.__sky.uSunDir),
      moonDir: m,
      moonLight: window.__sky.uMoonLight.value,
      fade: window.__sky.uFade.value,
      corona: window.__sky.uCorona.value,
      look: { ...window.__mini.look },
      camMat: cam.matrixWorld.elements.slice(0, 12),
      screen: { x: ((ndc.x + 1) / 2) * innerWidth, y: ((1 - ndc.y) / 2) * innerHeight },
      pxRadius: f * Math.tan(0.0045),
    };
  });
  console.log(`   scene: uFade ${scene.fade.toFixed(2)}, uCorona ${scene.corona}, uMoonLight ${scene.moonLight.toFixed(2)}, disc at (${scene.screen.x.toFixed(0)}, ${scene.screen.y.toFixed(0)}) r=${scene.pxRadius.toFixed(1)}px`);
  const sunArr = [scene.sunDir.x, scene.sunDir.y, scene.sunDir.z];
  const moonArr = [scene.moonDir.x, scene.moonDir.y, scene.moonDir.z];
  const cosE = Math.max(-1, Math.min(1, dot3(sunArr, moonArr)));
  const sceneFraction = (1 - cosE) / 2;
  check('shader fed the real geometry (elongation matches the ephemeris)',
    Math.abs(sceneFraction - expectedFraction) < 0.01, `scene ${sceneFraction.toFixed(4)}`);
  check('camera actually faces the moon', scene.look.lens === 600);

  // expected bright-limb direction on screen: the sun's component across the disc,
  // read on the camera's own right/up axes (screen y is down)
  const m = moonArr;
  const s = sunArr;
  const camRight = [scene.camMat[0], scene.camMat[1], scene.camMat[2]];
  const camUp = [scene.camMat[4], scene.camMat[5], scene.camMat[6]];
  const sunAcross = norm3(sub3(s, m.map((v) => v * cosE)));
  const expectedLimbScreen = [dot3(sunAcross, camRight), -dot3(sunAcross, camUp)];

  // --- pixels: decode the screenshot and measure the disc ---
  // The WebGL canvas cannot be read back (preserveDrawingBuffer is off) and file URLs are
  // blocked in-page, so the screenshot comes back as bytes and is decoded on a plain canvas.
  const shot = `${out}/moon-terminator-${moment.name}.png`;
  const buffer = await page.screenshot({ path: shot });
  const pixels = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const im = g.getImageData(0, 0, cv.width, cv.height);
    return { data: Array.from(im.data), w: cv.width, h: cv.height };
  }, buffer.toString('base64'));
  const px = Uint8ClampedArray.from(pixels.data);

  const { x: cxp, y: cyp } = scene.screen;
  const r = scene.pxRadius;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  // sky level just outside the disc
  const bg = [];
  for (let y = Math.round(cyp - 1.8 * r); y <= cyp + 1.8 * r; y++) {
    for (let x = Math.round(cxp - 1.8 * r); x <= cxp + 1.8 * r; x++) {
      const d = Math.hypot(x - cxp, y - cyp);
      if (d > 1.25 * r && d < 1.7 * r) bg.push(lum((y * pixels.w + x) * 4));
    }
  }
  bg.sort((a, b) => a - b);
  const bgLevel = bg[Math.floor(bg.length / 2)];
  const inside = [];
  for (let y = Math.round(cyp - r); y <= cyp + r; y++) {
    for (let x = Math.round(cxp - r); x <= cxp + r; x++) {
      if (Math.hypot(x - cxp, y - cyp) > 0.96 * r) continue;
      inside.push({ x, y, l: lum((y * pixels.w + x) * 4) });
    }
  }
  const sorted = inside.map((p) => p.l).sort((a, b) => a - b);
  const discHigh = sorted[Math.floor(sorted.length * 0.95)];
  const threshold = bgLevel + 0.45 * (discHigh - bgLevel);
  let lit = 0;
  let sx = 0, sy = 0;
  for (const p of inside) {
    if (p.l > threshold) { lit++; sx += p.x - cxp; sy += p.y - cyp; }
  }
  const litFraction = lit / inside.length;
  const limbScreen = lit > 0 ? [sx / lit, sy / lit] : [0, 0];
  const limbLen = Math.hypot(limbScreen[0], limbScreen[1]);
  const align = limbLen > 0
    ? (limbScreen[0] * expectedLimbScreen[0] + limbScreen[1] * expectedLimbScreen[1])
      / (limbLen * Math.hypot(...expectedLimbScreen))
    : 0;
  const limbAngle = (Math.acos(Math.max(-1, Math.min(1, align))) * 180) / Math.PI;

  console.log(`   pixels: bg ${bgLevel.toFixed(0)}, disc p95 ${discHigh.toFixed(0)}, threshold ${threshold.toFixed(0)}`);
  console.log(`   lit fraction ${litFraction.toFixed(3)} (expected ~${expectedFraction.toFixed(3)}), bright-limb offset ${limbLen.toFixed(1)}px at ${limbAngle.toFixed(1)}° from the sun's screen direction`);

  check(`[${moment.name}] lit fraction matches the phase`, Math.abs(litFraction - expectedFraction) < 0.12,
    `rendered ${litFraction.toFixed(3)} vs expected ${expectedFraction.toFixed(3)}`);
  if (moment.name === 'full') check('[full] disc is gibbous (well over half lit)', litFraction > 0.85);
  if (moment.name === 'quarter') check('[quarter] disc is about half lit', litFraction > 0.4 && litFraction < 0.6);
  // Near full the whole disc is lit and the bright limb is degenerate (every edge is
  // bright); the limb check means something only once the centroid has a direction.
  if (limbLen > 2) check(`[${moment.name}] bright limb faces the sun`, limbAngle < 25, `${limbAngle.toFixed(1)}°`);
  else console.log(`   (bright limb degenerate at ${litFraction.toFixed(3)} lit — whole disc bright)`);
}

console.log('\npage errors:', errors.length ? errors.join('\n  ') : '(none)');
await browser.close();
process.exit(failed ? 1 : 0);
