/**
 * Does the ticket still name a shot one has left? Open a sphere shot from the day list, then
 *   1  stay and nudge the clock two minutes: the card, `shot=` in the address and the shot in
 *      the calendar's line must stay;
 *   2  walk off (about 130 m): all three must go;
 *   3  open it again and move the clock 30 minutes on: all three must go.
 * Runs at every size by default: desktop 1280 x 800, phone 390 x 844 and narrow 320 x 568
 * (lib.mjs SIZES). Writes stale.json and stale-<size>-<step>.png.
 *
 *   node scripts/adversarial/stale.mjs [yyyy-mm-dd] [desktop,phone,narrow]
 */
import { open, plan, shot, save, close } from './lib.mjs';

const date = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-11-26';
const sizes = (process.argv.slice(2).find((a) => /^[a-z,]+$/.test(a)) ?? process.env.SIZE ?? 'desktop,phone,narrow').split(',');
const out = {};
let failed = 0;
for (const size of sizes) {
const { page, context } = await open({ size, forecast: 'fixed' });
const snap = async () => {
  const s = await page.evaluate(() => ({ clock: document.getElementById('clock').value, ticket: document.getElementById('ticket-shot').hidden ? '' : document.getElementById('ticket-shot').innerText.replace(/\n/g, ' / '), status: document.getElementById('eclipse').innerText, url: location.search }));
  await page.click('#share');
  await page.waitForTimeout(300);
  s.calendar = await page.$eval('#calendar-what', (e) => e.innerText);
  await page.keyboard.press('Escape');
  await page.click('#share').catch(() => {});
  if (await page.evaluate(() => !document.getElementById('share-menu').hidden)) await page.click('#share');
  return s;
};
const openShot = async () => {
  await plan(page, `date=${date}`);
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForTimeout(2500);
  const i = await page.evaluate(() => window.__mini.dayRows().findIndex((r) => r.where === 'sphere' && r.body === 'sun'));
  await page.evaluate((i) => document.querySelectorAll('#daylist .shotcard')[i].click(), i);
  await page.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
};
const setClock = (by) => page.$eval('#time', (el, by) => { el.value = String(Number(el.value) + by); el.dispatchEvent(new Event('input', { bubbles: true })); }, by);
const check = (name, s, held) => {
  const named = { ticket: s.ticket !== '', address: /[?&]shot=/.test(s.url) };
  const ok = named.ticket === held && named.address === held;
  if (!ok) failed++;
  out[`${size} ${name}`] = { ...s, ok };
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${size} ${name}: clock ${s.clock}; ticket "${s.ticket}"; address ${named.address ? 'names the shot' : 'names no shot'}; calendar "${s.calendar}"`);
};

await openShot();
check('opened', await snap(), true);
await setClock(2);
await page.waitForTimeout(1200);
check('two minutes on, same spot', await snap(), true);
await shot(page, `stale-${size}-1-held`);
await page.keyboard.down('Shift');
await page.keyboard.down('a');
await page.waitForTimeout(9000);
await page.keyboard.up('a');
await page.keyboard.up('Shift');
await page.waitForTimeout(1500);
check('walked off', await snap(), false);
await shot(page, `stale-${size}-2-walked`);

await openShot();
await setClock(30);
await page.waitForTimeout(1500);
check('30 minutes on', await snap(), false);
await shot(page, `stale-${size}-3-later`);
await context.close();
}
save('stale.json', out);
console.log(failed ? `${failed} FAILED` : 'all passed');
await close();
process.exit(failed ? 1 : 0);
