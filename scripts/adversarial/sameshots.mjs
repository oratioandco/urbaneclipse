/**
 * Finding 6: do `/map` and `/plan/` name the same tower shots for the same day? Reads the
 * "Best shots" rows of `/map` and the tower rows of `/plan/`'s day list (Europe/Berlin, 24-hour
 * clock so the two print times alike) and writes sameshots.json and a render of each.
 */
import { open, shot, save, close, BASE } from './lib.mjs';

const date = process.env.DATE ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const out = { date };
{
  const { context, page } = await open({ size: 'desktop', forecast: 'fixed', timezone: 'Europe/Berlin', locale: 'de-DE' });
  await page.goto(`${BASE}/map/#/?day=${date}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid=highlights] .ue-row', { timeout: 60_000 });
  await page.waitForTimeout(3000);
  out.map = await page.evaluate(() => [...document.querySelectorAll('[data-testid=highlights] > .ue-row')].map((r) => `${r.querySelector('.ue-row__time').innerText} ${r.querySelector('strong').innerText} | ${r.querySelector('small').innerText.split(' · ')[0]}`));
  out.mapStreets = await page.evaluate(() => [...document.querySelectorAll('[data-testid=streets-today] > .ue-row')].map((r) => `${r.querySelector('.ue-row__time').innerText} ${r.querySelector('strong').innerText}`));
  await page.evaluate(() => document.querySelector('.ue-sheet')?.setAttribute('data-expanded', 'true'));
  await shot(page, 'sameshots-map');
  await context.close();
}
{
  const { context, page } = await open({ size: 'desktop', forecast: 'fixed', timezone: 'Europe/Berlin', locale: 'de-DE' });
  await page.goto(`${BASE}/plan/?nointro&date=${date}&time=720`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  await page.waitForTimeout(4000);
  const rows = await page.evaluate(() => window.__mini.dayRows?.() ?? null);
  out.plan = rows?.filter((r) => r.kind === 'tower').map((r) => `${new Date(r.t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })} ${r.title} | ${r.stand} of the tower`) ?? null;
  out.planStreets = rows?.filter((r) => r.kind === 'street').map((r) => `${new Date(r.t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })} ${r.moment?.view?.name ?? r.short}`) ?? null;
  await shot(page, 'sameshots-plan');
  await context.close();
}
out.same = JSON.stringify(out.map) === JSON.stringify(out.plan);
out.sameStreets = JSON.stringify(out.mapStreets) === JSON.stringify(out.planStreets);
console.log(JSON.stringify(out, null, 1));
save('sameshots.json', out);
await close();
