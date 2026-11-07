// Walks through the planner's main features in a real browser window and prints a line per
// check, then any page errors. Run against a build: npx astro preview, then
//   node scripts/miniature/walkthrough.mjs http://localhost:4321 /tmp/shots

import { chromium } from 'playwright';
const [base, out] = [process.argv[2], process.argv[3]];
const b = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errs.push('console ' + m.text()));
const ok = (name, cond, extra = '') => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`);
const shot = (n) => p.screenshot({ path: `${out}/r-${n}.png` });

await p.goto(base + '/?nointro&date=2027-03-22&time=1020');
await p.waitForFunction(() => window.__ready, null, { timeout: 90000 });
await p.waitForTimeout(1500);
ok('city loaded', (await p.evaluate(() => window.__mini.tiles.length)) === 355);
ok('day list filled', (await p.$$eval('#daylist .dayrow', (r) => r.length)) > 5, await p.textContent('#sheet-toggle span'));
ok('tracks drawn', (await p.$$eval('#tracks .track', (r) => r.length)) >= 2);
ok('rays for now', (await p.evaluate(() => window.__mini.rays.length)) >= 1);
await shot('overview');

// Time slider moves the sun.
const sunBefore = await p.textContent('#sun');
await p.$eval('#time', (el) => { el.value = '1200'; el.dispatchEvent(new Event('input')); });
await p.waitForTimeout(300);
ok('time changes the light', (await p.textContent('#sun')) !== sunBefore, `${sunBefore} -> ${await p.textContent('#sun')}`);
ok('clock follows', /8|20/.test(await p.inputValue('#clock')), await p.inputValue('#clock'));

// Next day.
await p.click('#next-day');
await p.waitForTimeout(500);
ok('next day', (await p.textContent('#day-label')).includes('23'), await p.textContent('#day-label'));
await p.click('#prev-day');
await p.waitForTimeout(500);

// Layers: hide streets, list shrinks.
const rowsAll = await p.$$eval('#daylist .dayrow', (r) => r.length);
await p.click('#layers');
await p.click('#layers-menu input[data-layer="streets"]', { force: true });
await p.waitForTimeout(300);
const rowsNoStreets = await p.$$eval('#daylist .dayrow', (r) => r.length);
ok('streets layer filters list', rowsNoStreets < rowsAll, `${rowsAll} -> ${rowsNoStreets}`);
await p.click('#layers-menu input[data-layer="streets"]', { force: true });
ok('flat map link keeps the day', (await p.getAttribute('#flatmap', 'href')) === '/map/#/day=2027-03-22', await p.getAttribute('#flatmap', 'href'));
await shot('layers');
await p.click('#layers');

// Hover a tower line: View from here.
await p.$eval('#time', (el) => { el.value = '1020'; el.dispatchEvent(new Event('input')); });
await p.waitForTimeout(400);
const target = await p.evaluate(() => {
  const r = window.__mini.rays[0];
  const v = new window.__mini.camera.position.constructor(r.base.x + (r.far.x - r.base.x) * 0.3, r.base.y, r.base.z + (r.far.z - r.base.z) * 0.3).project(window.__mini.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
});
await p.mouse.move(target.x, target.y);
await p.waitForTimeout(400);
ok('view-from-here offered on hover', !(await p.$eval('#viewhere', (el) => el.hidden)), await p.textContent('#viewhere'));
await p.click('#viewhere');
await p.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(1200);
ok('view-from-here lands at eye level', await p.evaluate(() => window.__mini.look.active), await p.textContent('#eclipse'));
await shot('viewhere');

// Walk forward.
const before = await p.evaluate(() => ({ x: window.__mini.look.x, z: window.__mini.look.z }));
await p.keyboard.down('w');
await p.waitForTimeout(700);
await p.keyboard.up('w');
const after = await p.evaluate(() => ({ x: window.__mini.look.x, z: window.__mini.look.z }));
ok('walking moves', Math.hypot(after.x - before.x, after.z - before.z) > 2, `${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m`);

// Take off and land.
await p.click('#takeoff');
await p.waitForTimeout(1900);
const lift = await p.evaluate(() => window.__mini.look.lift);
ok('take off', lift > 20, `${lift?.toFixed(0)} m, ${await p.textContent('#airspace')}`);
await shot('drone');
await p.click('#takeoff');
await p.waitForTimeout(1900);
ok('land', (await p.evaluate(() => window.__mini.look.mode)) === 'walk');

// Face buttons.
await p.click('#face-tower');
await p.waitForTimeout(800);
const heading = await p.evaluate(() => window.__mini.look.heading);
ok('face tower', Number.isFinite(heading));

// More dates from here.
await p.click('#dates-toggle');
await p.waitForFunction(() => document.querySelector('#dates h3') && !document.querySelector('#dates').textContent.includes('Searching'), null, { timeout: 90000 }).catch(() => {});
ok('dates from here', (await p.$$eval('#dates h3', (h) => h.length)) >= 1, (await p.$$eval('#dates .dayrow', (r) => r.length)) + ' rows');
await p.click('#dates-toggle');

// Minimap drawn.
ok('minimap drawn', await p.$eval('#minimap', (c) => c.width > 0));

// Back to the map.
await p.click('#back');
await p.waitForTimeout(1800);
ok('back to overview', await p.evaluate(() => document.body.dataset.eye === 'false'));

// Go from the list.
await p.click('#sheet-toggle');
await p.waitForTimeout(400);
await p.click('#daylist .dayrow[data-kind="street"]');
await p.waitForFunction(() => window.__mini.look.active, null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(1200);
ok('street Go lands', await p.evaluate(() => window.__mini.look.active), await p.evaluate(() => location.search));
const link = p.url();
await shot('street');

// Shared link reopens.
const p2 = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
p2.on('pageerror', (e) => errs.push('p2 ' + e.message));
await p2.goto(link);
await p2.waitForFunction(() => window.__mini?.look?.active, null, { timeout: 90000 }).catch(() => {});
const a = await p.evaluate(() => [window.__mini.look.x, window.__mini.look.z]);
const c = await p2.evaluate(() => [window.__mini.look.x, window.__mini.look.z]);
ok('link reopens the spot', Math.hypot(a[0] - c[0], a[1] - c[1]) < 1);

// Frame time.
await p.waitForTimeout(500);
const ms = await p.evaluate(async () => {
  window.__forceRender = true;
  await new Promise((r) => setTimeout(r, 2000));
  window.__forceRender = false;
  const h = [...window.__mini.getHistory()].sort((x, y) => x - y);
  return h[h.length >> 1];
});
ok('frame time', ms < 25, `${ms.toFixed(1)} ms`);
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
