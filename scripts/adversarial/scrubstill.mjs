/**
 * Does a drag of the clock leave the resting picture as it was? At an eye-level view with trees
 * in it: a still, a second still two seconds later (the control: what differs with nothing
 * done), then the clock dragged away and back to the same value, a wait, and a third still.
 * A fourth is taken in the middle of a drag, to show what the cheaper frames look like.
 * Reports how many pixels differ by more than 2/255 between the stills, and what the page says
 * of its trees and shadows at each. Writes scrubstill-*.png and scrubstill.json.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { open, save, close, BASE, OUT } from './lib.mjs';

// A minute with no alignment near it, so the clock does not snap, and fine timing on.
const LINK = process.env.LINK ?? 'date=2026-11-26&time=600.5&at=52.537829,13.438970&look=226.6,4.4&lens=85&cam=ff';
const { page } = await open({ size: 'desktop', forecast: 'fixed' });
await page.goto(`${BASE}/plan/?nointro&${LINK}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true && window.__mini.look.active, null, { timeout: 300_000 });
await page.waitForTimeout(9000);
const clip = await page.evaluate(() => { const f = window.__mini.frame(); return { x: Math.round(f.x) + 2, y: Math.round(f.y) + 2, width: Math.round(f.w) - 4, height: Math.round(f.h) - 40 }; });
const state = () => page.evaluate(() => { const trees = []; window.__mini.scene.traverse((o) => o.isInstancedMesh && o.visible && trees.push(o)); return { time: document.getElementById('time').value, trees: trees.reduce((s, t) => s + t.count, 0), treeTriangles: trees.reduce((s, t) => s + (t.count * t.geometry.attributes.position.count) / 3, 0), treesCastShadow: trees.every((t) => t.castShadow) }; });
const still = async (name) => { await page.screenshot({ path: join(OUT, `scrubstill-${name}.png`), clip }); return state(); };
const out = {};
out.before = await still('1-before');
await page.waitForTimeout(2000);
out.control = await still('2-control');
// A drag that runs until told to stop, a step a frame; one still is taken in the middle of it.
const start = await page.evaluate(() => document.getElementById('time').value);
await page.evaluate(() => {
  const time = document.getElementById('time');
  window.__drag = true;
  let n = 0;
  const tick = () => {
    time.value = String(Number(time.value) + (Math.floor(n++ / 60) % 2 ? -1 : 1) / 12);
    time.dispatchEvent(new Event('input', { bubbles: true }));
    if (window.__drag) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(1500);
out.during = await still('3-during');
await page.evaluate((v) => {
  window.__drag = false;
  const time = document.getElementById('time');
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { time.value = v; time.dispatchEvent(new Event('input', { bubbles: true })); resolve(); })));
}, start);
await page.waitForTimeout(4000);
out.after = await still('4-after');
const share = (a, b) => {
  try {
    const r = execFileSync('ffmpeg', ['-hide_banner', '-i', join(OUT, `scrubstill-${a}.png`), '-i', join(OUT, `scrubstill-${b}.png`), '-lavfi', "blend=all_mode=difference,format=gray,lut='if(gt(val,2),255,0)',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const avg = Number(/YAVG=([\d.]+)/.exec(r)?.[1]);
    return +((avg / 255) * 100).toFixed(3);
  } catch (e) { return String(e).slice(0, 120); }
};
out.pixelsDifferingPercent = { 'before vs control (nothing done)': share('1-before', '2-control'), 'before vs after the drag': share('1-before', '4-after'), 'before vs in the drag': share('1-before', '3-during') };
console.log(JSON.stringify(out, null, 1));
save('scrubstill.json', out);
await close();
