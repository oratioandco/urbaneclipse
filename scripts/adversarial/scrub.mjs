/**
 * Scrubbing the day view's thumb under a four-times slower CPU, on the phone layout: a finger
 * dragged across the timeline for six seconds, there and back. Reports the gaps between frames
 * the page managed to draw (requestAnimationFrame), the long tasks, and how far the clock
 * lagged behind the finger. Run with the GPU (the default); the numbers compare builds and
 * say nothing certain about a real phone.
 *
 *   node scripts/adversarial/scrub.mjs [rate=4] [phone|desktop]
 */
import { open, plan, save, close } from './lib.mjs';

const rate = Number(process.argv[2] ?? 4);
const size = process.argv[3] ?? 'phone';
const { context, page, log } = await open({ size, forecast: 'fixed' });
const cdp = await context.newCDPSession(page);
await plan(page, 'date=2027-06-21&time=300');
await page.click('.tabs [data-mode="shoot"]');
await page.waitForTimeout(2500);
const result = { rate, size };
for (const throttle of [1, rate]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(() => {
    window.__scrub = { frames: [], long: [], lag: [] };
    let last = performance.now();
    const tick = (now) => {
      window.__scrub.frames.push(now - last);
      last = now;
      window.__scrub.raf = requestAnimationFrame(tick);
    };
    window.__scrub.raf = requestAnimationFrame(tick);
    window.__scrub.observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__scrub.long.push(Math.round(e.duration))));
    window.__scrub.observer.observe({ entryTypes: ['longtask'] });
  });
  const box = await page.locator('#timeline').boundingBox();
  const y = box.y + box.height - 30;
  const x0 = box.x + box.width * 0.2;
  const x1 = box.x + box.width * 0.9;
  const drawnBefore = await page.evaluate(() => window.__mini.stats.frames);
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const start = Date.now();
  const STEPS = 180;
  for (let i = 0; i <= STEPS; i++) {
    const f = i <= STEPS / 2 ? i / (STEPS / 2) : 2 - i / (STEPS / 2);
    await page.mouse.move(x0 + (x1 - x0) * f, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const took = Date.now() - start;
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => {
    cancelAnimationFrame(window.__scrub.raf);
    window.__scrub.observer.disconnect();
    return { frames: window.__scrub.frames, long: window.__scrub.long, drawn: window.__mini.stats.frames, clock: document.getElementById('clock').value };
  });
  const sorted = [...data.frames].sort((a, b) => a - b);
  const pick = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
  result[`cpu${throttle}x`] = {
    dragMs: took,
    framesSeen: data.frames.length,
    fps: Math.round((data.frames.length / took) * 1000),
    sceneFramesDrawn: data.drawn - drawnBefore,
    frameGapMs: { median: pick(0.5), p90: pick(0.9), p99: pick(0.99), worst: Math.round(sorted[sorted.length - 1]) },
    longTasks: { count: data.long.length, totalMs: data.long.reduce((a, b) => a + b, 0), worstMs: Math.max(0, ...data.long) },
    clockAtEnd: data.clock,
  };
  console.log(JSON.stringify(result[`cpu${throttle}x`]));
}
result.errors = log.filter((l) => l.type === 'pageerror' || l.type === 'error').map((l) => l.text.slice(0, 160));
save(`scrub-${size}-${rate}x.json`, result);
await close();
