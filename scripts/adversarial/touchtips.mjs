/**
 * Do the toolbar's buttons explain themselves to a finger? On a phone with a touch screen:
 * every visible toolbar button is long-pressed (the tip must show and the button must not
 * act), then the layers button is tapped (it must act and show its tip). Real touch events
 * through the DevTools protocol. Writes touchtips.json and touchtips-<id>.png.
 */
import { open, shot, save, close, BASE } from './lib.mjs';

const { context, page } = await open({ size: 'phone', forecast: 'fixed' });
await page.goto(`${BASE}/plan/?nointro`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
await page.waitForTimeout(3000);
const cdp = await context.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const state = () => page.evaluate(() => ({
  shown: [...document.querySelectorAll('[data-tip-shown]')].map((e) => `${e.id}: ${e.dataset.tip}`),
  opacity: [...document.querySelectorAll('[data-tip-shown]')].map((e) => getComputedStyle(e, '::before').opacity),
  layersOpen: !document.getElementById('layers-menu').hidden,
  intro: document.body.dataset.intro ?? null,
  eye: document.body.dataset.view ?? document.body.dataset.eye ?? null,
  toast: document.querySelector('.toast:not([hidden])')?.innerText ?? null,
}));
const buttons = await page.evaluate(() => [...document.querySelectorAll('.tools [data-tip]')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, x: r.x + r.width / 2, y: r.y + r.height / 2, tip: e.dataset.tip }; }));
const out = { buttons: buttons.map((b) => `${b.id}: ${b.tip}`), held: {}, tapped: {} };
const before = await state();
for (const b of buttons) {
  await touch('touchStart', b.x, b.y);
  await page.waitForTimeout(800);
  if (b.id === 'locate' || b.id === 'compass') await shot(page, `touchtips-hold-${b.id}`);
  await touch('touchEnd', b.x, b.y);
  await page.waitForTimeout(500);
  const s = await state();
  out.held[b.id] = { ...s, acted: s.layersOpen !== before.layersOpen || s.intro !== before.intro || s.eye !== before.eye || s.toast !== before.toast };
  await page.waitForTimeout(2000);
}
const layers = buttons.find((b) => b.id === 'layers');
await touch('touchStart', layers.x, layers.y);
await page.waitForTimeout(60);
await touch('touchEnd', layers.x, layers.y);
await page.waitForTimeout(500);
out.tapped.layers = await state();
await shot(page, 'touchtips-tap-layers');
await page.waitForTimeout(2200);
out.afterTwoSeconds = (await state()).shown;
console.log(JSON.stringify(out, null, 1));
save('touchtips.json', out);
await context.close();
await close();
