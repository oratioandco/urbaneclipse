/**
 * Measures the planner (/plan/) in headless Chrome: network, start-up, frame cost while idle and
 * while the time slider is dragged, renderer counters, memory, long tasks. The numbers behind
 * docs/performance-2026-11.md.
 *
 *   npm run build && npx astro preview --port 4403 &
 *   node scripts/miniature/perf.mjs http://localhost:4403 [phone|desktop] [--gpu] [--city=<origin>]
 *       [--cache=<dir>] [--shot=<png>] [--profile=<json>] [--query=<extra url options>]
 *
 * The city geometry is not in git. With --city the script answers /city/ requests from that
 * origin (read-only) and keeps the files in --cache, so a local build shows the real buildings
 * and the second run needs no network. Requests answered from the cache are counted at the size
 * the origin sent them (compressed), which the cache records beside each file.
 *
 * Headless Chrome draws with a software rasteriser unless --gpu works on the machine, so frame
 * times here compare one build against another; they do not say what a phone will do.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4403';
const device = args.includes('desktop') ? 'desktop' : 'phone';
const gpu = args.includes('--gpu');
const cityOrigin = flag('city');
const cacheDir = flag('cache') ?? '.perf-city-cache';
// Today by default, so the (fixed) forecast applies; --query=date=2027-03-22 is a day without one.
const query = flag('query') ?? 'time=780';
const cpuRate = Number(flag('cpu') ?? 1);

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext(DEVICES[device]);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Performance.enable');
if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });

// Network: every response, with the bytes that crossed the wire.
const requests = new Map();
cdp.on('Network.responseReceived', (e) => requests.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status, wire: 0 }));
cdp.on('Network.loadingFinished', (e) => {
  const r = requests.get(e.requestId);
  if (r) r.wire = e.encodedDataLength;
});

// The city, from the origin through a cache on disk.
const cityWire = new Map();
if (cityOrigin) {
  mkdirSync(cacheDir, { recursive: true });
  await page.route('**/city/**', async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const file = join(cacheDir, name);
    if (!existsSync(file)) {
      const response = await fetch(`${cityOrigin}${url.pathname}${url.search}`, { headers: { 'accept-encoding': 'identity' } });
      if (!response.ok) return route.fulfill({ status: response.status, body: '' });
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      const head = await fetch(`${cityOrigin}${url.pathname}${url.search}`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
      writeFileSync(`${file}.wire`, head.headers.get('content-length') ?? '');
    }
    const wire = Number(existsSync(`${file}.wire`) ? readFileSync(`${file}.wire`, 'utf8') : 0);
    const body = readFileSync(file);
    cityWire.set(url.pathname, wire || body.length);
    await route.fulfill({ status: 200, body, contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
}
// The forecast is someone else's server and changes by the hour: answer it with a fixed, partly
// cloudy day, so the cloud shaders run and every run sees the same sky.
const hours = (f) => Array.from({ length: 24 }, (_, h) => f(h));
const forecastPoint = {
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
await page.route(/api\.open-meteo\.com/, (route) => {
  const points = new URL(route.request().url()).searchParams.get('latitude').split(',').length;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: points }, () => forecastPoint)) });
});
await page.route(/archive-api\.open-meteo\.com|brightsky/, (route) => route.abort());

await page.addInitScript(() => {
  window.__perf = { longTasks: [], firstFrame: null, ready: null };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__perf.longTasks.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) });
  }).observe({ entryTypes: ['longtask'] });
  const poll = () => {
    const p = window.__perf;
    if (p.firstFrame === null && window.__mini?.stats.frames > 0) p.firstFrame = performance.now();
    if (p.ready === null && window.__ready) p.ready = performance.now();
    if (p.ready === null || p.firstFrame === null) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const loadProfilePath = flag('profile-load');
if (loadProfilePath) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
}
const url = `${base}/plan/?nointro&stats&${query}`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
const hasCity = Boolean(cityOrigin) || (await page.evaluate(() => fetch('/city/manifest.json?v=2').then((r) => r.ok && r.headers.get('content-type')?.includes('json'))));
if (hasCity) await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
else await page.waitForTimeout(4000);
if (loadProfilePath) {
  writeFileSync(loadProfilePath, JSON.stringify((await cdp.send('Profiler.stop')).profile));
  await cdp.send('Profiler.disable');
}
// Trees and the detail levels for the first view arrive after "ready".
await page.waitForTimeout(hasCity ? 6000 : 1000);

const snapshot = () =>
  page.evaluate(() => {
    const m = window.__mini;
    const info = m.renderer.info;
    return {
      frames: m.stats.frames,
      calls: m.stats.calls,
      triangles: m.stats.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length,
      pixelRatio: m.quality(),
      shadowEvery: m.shadowEvery?.() ?? 1,
      buffer: [m.renderer.domElement.width, m.renderer.domElement.height],
      shadowMap: m.sun.shadow.mapSize.x,
      tiles: m.tiles.length,
      tilesShown: m.tiles.filter((t) => t.mesh).length,
      levels: m.tiles.reduce((acc, t) => ((acc[t.level] = (acc[t.level] ?? 0) + 1), acc), {}),
      renderer: (() => {
        const gl = m.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })(),
    };
  });

const out = { url, device, gpu, cpuRate, hasCity };
out.start = await page.evaluate(() => ({
  firstFrameMs: Math.round(window.__perf.firstFrame ?? -1),
  cityBuiltMs: Math.round(window.__perf.ready ?? -1),
  domContentLoadedMs: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
  fcpMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1),
}));

if (args.includes('--load-only')) {
  out.loadFrames = (await snapshot()).frames;
  out.longTasks = await page.evaluate(() => ({ count: window.__perf.longTasks.length, totalMs: window.__perf.longTasks.reduce((s, e) => s + e.ms, 0) }));
  console.log(JSON.stringify(out));
  process.exit(0);
}
// Network totals, by kind. City files answered from the cache count at their recorded wire size.
const groups = {};
for (const r of requests.values()) {
  const path = new URL(r.url).pathname;
  const kind = path.startsWith('/city/') ? (/tile_/.test(path) ? 'city tiles' : 'city other') : r.type === 'Script' ? 'js' : r.type === 'Stylesheet' ? 'css' : r.type === 'Document' ? 'html' : 'other';
  const wire = path.startsWith('/city/') && cityWire.has(path) ? cityWire.get(path) : r.wire;
  groups[kind] ??= { requests: 0, wireKB: 0 };
  groups[kind].requests++;
  groups[kind].wireKB += wire / 1024;
}
for (const g of Object.values(groups)) g.wireKB = Math.round(g.wireKB);
out.network = groups;
if (args.includes('--requests')) out.requestList = [...requests.values()].map((r) => `${r.status} ${Math.round(r.wire / 1024)}KB ${new URL(r.url).pathname}`);
out.afterLoad = await snapshot();

// Idle: does anything draw when nothing changes?
const idleBefore = await snapshot();
await page.waitForTimeout(5000);
const idleAfter = await snapshot();
out.idle = { framesDrawnIn5s: idleAfter.frames - idleBefore.frames };

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const before = await metrics();
out.memory = { jsHeapUsedMB: +(before.JSHeapUsedSize / 1e6).toFixed(1), jsHeapTotalMB: +(before.JSHeapTotalSize / 1e6).toFixed(1) };

/**
 * A slider drag: one step per animation frame, as a finger would feed it. Per step, the time the
 * input handler took (the sun, the plan, the DOM) and the time until the next frame came back
 * (which includes the draw, and with a software rasteriser mostly is the draw).
 */
const drag = (from, to, steps) =>
  page.evaluate(
    async ({ from, to, steps }) => {
      const input = document.getElementById('time');
      const m = window.__mini;
      const handler = [];
      const interval = [];
      let last = performance.now();
      const frames0 = m.stats.frames;
      const shadow0 = m.stats.shadowFrames ?? 0;
      for (let i = 0; i <= steps; i++) {
        input.value = String(Math.round(from + ((to - from) * i) / steps));
        const t0 = performance.now();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        handler.push(performance.now() - t0);
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        interval.push(now - last);
        last = now;
      }
      const stat = (a) => {
        const s = [...a].sort((x, y) => x - y);
        return { median: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
      };
      return { steps: steps + 1, framesDrawn: m.stats.frames - frames0, shadowFrames: m.stats.shadowFrames === undefined ? null : m.stats.shadowFrames - shadow0, handlerMs: stat(handler), frameIntervalMs: stat(interval.slice(1)), calls: m.stats.calls, triangles: m.stats.triangles };
    },
    { from, to, steps },
  );

// One frame of each kind: the view alone, and the view with the shadow map redrawn.
const oneFrame = (shadows) =>
  page.evaluate(async (shadows) => {
    const m = window.__mini;
    if (shadows) m.invalidateShadows();
    else m.invalidate();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { calls: m.stats.calls, triangles: m.stats.triangles };
  }, shadows);
out.frameWithoutShadowPass = await oneFrame(false);
out.frameWithShadowPass = await oneFrame(true);
out.sceneCounts = await page.evaluate(() => {
  const m = window.__mini;
  let tileTris = 0;
  let treeTris = 0;
  let trees = 0;
  m.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (o.isInstancedMesh) {
      trees += o.count;
      treeTris += tris * o.count;
    }
  });
  // Every tile keeps its coarse level beside the one it shows.
  const held = new Set();
  for (const t of m.tiles) {
    if (t.mesh) tileTris += t.mesh.geometry.index.count / 3;
    if (t.mesh) held.add(t.mesh.geometry);
    if (t.coarse) held.add(t.coarse);
  }
  let indexBytes = 0;
  let vertexBytes = 0;
  for (const g of held) {
    indexBytes += g.index.array.byteLength;
    vertexBytes += g.attributes.position.data.array.byteLength;
  }
  return { buildingTrianglesLoaded: Math.round(tileTris), buildingIndexMB: +(indexBytes / 1e6).toFixed(1), buildingVertexMB: +(vertexBytes / 1e6).toFixed(1), treeInstances: trees, treeTriangles: Math.round(treeTris) };
});

const profilePath = flag('profile');
if (profilePath) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
}
const m0 = await metrics();
out.dragDay = await drag(600, 1140, 90);
const m1 = await metrics();
out.dragDay.scriptMsPerStep = +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / out.dragDay.steps).toFixed(2);
out.dragDay.layoutStyleMsPerStep = +((((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) * 1000) / out.dragDay.steps).toFixed(2);
out.dragDay.layoutsPerStep = +((m1.LayoutCount - m0.LayoutCount) / out.dragDay.steps).toFixed(2);
out.dragDay.styleRecalcsPerStep = +((m1.RecalcStyleCount - m0.RecalcStyleCount) / out.dragDay.steps).toFixed(2);
if (profilePath) {
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(profilePath, JSON.stringify(profile));
  // Self time by function, the top of the list.
  const dt = profile.timeDeltas;
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const key = `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  out.dragDay.profileTopSelfMs = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)} ms  ${k}`);
}
// Again, now that the quality settings have had frames to judge by.
out.dragAgain = await drag(600, 1140, 90);
out.afterDrag = await snapshot();
// A pan: the map's centre moves a little every frame, as under a finger.
out.pan = await page.evaluate(async () => {
  const m = window.__mini;
  const interval = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    m.controls.target.x += 6;
    m.camera.position.x += 6;
    m.invalidate();
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    interval.push(now - last);
    last = now;
  }
  const s = interval.slice(1).sort((x, y) => x - y);
  return { frameIntervalMs: { median: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) }, calls: m.stats.calls, triangles: m.stats.triangles };
});
// The slider must move the scene: the key light's direction before and after.
out.sliderMovesLight = await page.evaluate(async () => {
  const input = document.getElementById('time');
  const dir = () => window.__mini.cityUniforms.uKeyDir.value.toArray().map((v) => +v.toFixed(3));
  input.value = '600';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const a = dir();
  input.value = '1020';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const b = dir();
  return { at1000: a, at1700: b, moved: a.some((v, i) => Math.abs(v - b[i]) > 0.05), clock: document.getElementById('clock').value };
});

await page.waitForTimeout(1500);
const after = await metrics();
out.memory.afterDragJsHeapUsedMB = +(after.JSHeapUsedSize / 1e6).toFixed(1);
out.longTasks = await page.evaluate(() => {
  const t = window.__perf.longTasks;
  const ready = window.__perf.ready ?? Infinity;
  const sum = (a) => a.reduce((s, e) => s + e.ms, 0);
  const load = t.filter((e) => e.start <= ready);
  const later = t.filter((e) => e.start > ready);
  return { duringLoad: { count: load.length, totalMs: sum(load), longestMs: Math.max(0, ...load.map((e) => e.ms)) }, afterLoad: { count: later.length, totalMs: sum(later), longestMs: Math.max(0, ...later.map((e) => e.ms)) } };
});
out.errors = [...new Set(errors)].slice(0, 8);

// Two pictures, morning and late afternoon, to look at: the slider has to move the shadows.
const shot = flag('shot');
if (shot) {
  for (const [minutes, name] of [[600, shot.replace(/\.png$/, '-1000.png')], [960, shot]]) {
    await page.evaluate(async (minutes) => {
      const input = document.getElementById('time');
      input.value = String(minutes);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    }, minutes);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(name, Buffer.from(data, 'base64'));
  }
}
console.log(JSON.stringify(out, null, 2));
// Chrome sometimes never answers the close; the numbers are out, so do not wait for it.
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(0);
