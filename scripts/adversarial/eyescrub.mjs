/**
 * Scrubbing the clock at eye level: how long a frame takes, and where the time goes.
 *
 * The ticket's slider is moved one step every animation frame for six seconds, there and back
 * across its hour (fine timing, 5-second steps), at an eye-level link. Reported: the gaps
 * between frames (median, 95th percentile), then
 *   - with PROFILE=1, the main thread's time by source file and function (a CPU profile through
 *     the DevTools protocol; run it against `astro dev`, where the names are not minified);
 *   - else an ablation: the same scrub with one thing switched off at a time by URL option.
 * Headless Chrome with the machine's GPU; the numbers compare builds, not phones.
 *
 *   node scripts/adversarial/eyescrub.mjs [phone|desktop]        BASE, OUT as in lib.mjs
 */
import { open, save, close, BASE } from './lib.mjs';

const size = process.argv[2] ?? 'desktop';
const LINK = 'date=2026-11-26&time=513&at=52.537829,13.438970&look=226.6,4.4&lens=200&cam=ff&shot=sphere-sun&here=1';
const VARIANTS = process.env.PROFILE
  ? { baseline: '' }
  : { baseline: '', 'glass off': '&glass=off', 'no edge blur': '&blur=0', 'no water mirror': '&mirror=0.01', 'shadow map 1024': '&shadow=1024', 'few trees': '&trees=1', 'half the pixels': '&pixels=1.8e6', 'more off, minimap closed': '&more=closed&minimap=closed', 'more and minimap open': '&more=open&minimap=open' };
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const out = { size, variants: {} };

for (const [name, option] of Object.entries(VARIANTS)) {
  const { context, page } = await open({ size, forecast: 'fixed' });
  const cdp = await context.newCDPSession(page);
  await page.goto(`${BASE}/plan/?nointro&${LINK}${option}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true && window.__mini.look.active, null, { timeout: 300_000 });
  await page.waitForTimeout(6000);
  if (process.env.PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  const run = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const time = document.getElementById('time');
        const lo = Number(time.min), hi = Number(time.max), step = 1 / 12;
        const frames = [];
        const m = window.__mini;
        const start = performance.now();
        let last = start, v = Number(time.value), dir = 1;
        const before = { frames: m.stats.frames, shadow: m.stats.shadowFrames };
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          v += dir * step * 2;
          if (v >= hi || v <= lo) dir = -dir;
          time.value = String(Math.max(lo, Math.min(hi, v)));
          time.dispatchEvent(new Event('input', { bubbles: true }));
          if (now - start < 6000) requestAnimationFrame(tick);
          else resolve({ frames: frames.slice(1), drawn: m.stats.frames - before.frames, shadowed: m.stats.shadowFrames - before.shadow, triangles: m.stats.triangles, calls: m.stats.calls, pixelRatio: m.quality(), canvas: [m.renderer.domElement.width, m.renderer.domElement.height], fine: document.getElementById('fine').getAttribute('aria-pressed') });
        };
        requestAnimationFrame(tick);
      }),
  );
  const sorted = [...run.frames].sort((a, b) => a - b);
  const result = { frames: sorted.length, median: +quantile(sorted, 0.5).toFixed(1), p95: +quantile(sorted, 0.95).toFixed(1), drawn: run.drawn, shadowed: run.shadowed, triangles: run.triangles, calls: run.calls, pixelRatio: +run.pixelRatio.toFixed(2), canvas: run.canvas };
  if (process.env.PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(profile.nodes.map((n) => [n.id, 0]));
    profile.samples.forEach((id, i) => self.set(id, self.get(id) + (profile.timeDeltas[i] ?? 0)));
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const byFile = new Map(), byFn = new Map();
    for (const n of profile.nodes) {
      const t = self.get(n.id);
      const file = n.callFrame.url ? n.callFrame.url.split('/').pop().split('?')[0] : `(${n.callFrame.functionName || 'native'})`;
      byFile.set(file, (byFile.get(file) ?? 0) + t);
      const fn = `${n.callFrame.functionName || '(anonymous)'} ${file}:${n.callFrame.lineNumber + 1}`;
      byFn.set(fn, (byFn.get(fn) ?? 0) + t);
    }
    const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, t]) => `${((t / total) * 100).toFixed(1).padStart(5)} %  ${(t / 1000 / sorted.length).toFixed(2).padStart(6)} ms/frame  ${k}`);
    result.byFile = top(byFile, 16);
    result.byFunction = top(byFn, 28);
    console.log(`\nmain thread by file (${(total / 1e6).toFixed(1)} s sampled, ${sorted.length} frames):\n${result.byFile.join('\n')}\n\nby function:\n${result.byFunction.join('\n')}`);
  }
  out.variants[name] = result;
  console.log(`${name.padEnd(28)} median ${String(result.median).padStart(5)} ms  p95 ${String(result.p95).padStart(5)} ms  ${result.frames} frames, ${result.drawn} drawn, ${result.shadowed} with shadows, ${(result.triangles / 1e6).toFixed(2)} M triangles, ${result.calls} calls, canvas ${result.canvas.join('x')}`);
  await context.close();
}
save(`eyescrub-${size}${process.env.PROFILE ? '-profile' : ''}.json`, out);
await close();
