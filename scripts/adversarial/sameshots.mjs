/**
 * The same shots on `/plan/` and `/map`: both list a day from the one pipeline
 * (src/miniature/dayShots.js), so for any day the two pages must name the same shots at the
 * same times, written the same way (src/miniature/time.js).
 *
 *   node scripts/adversarial/sameshots.mjs                       # three days with every kind of row
 *   node scripts/adversarial/sameshots.mjs 2026-11-25 2027-03-17
 *
 * `/plan/`'s rows are read off its day list ("1 day"): the time, the sentence, and for a henge
 * the street. `/map`'s are read off "Best shots" (the tower, the antenna, the Siegessäule and
 * the Brandenburger Tor: time and sentence) and "Streets today" (time and street). What each
 * page says beside that (where to stand, "of the tower", the light) is its own and is not
 * compared. Writes sameshots.json to OUT; exits 1 when a day differs.
 */
import { open, plan, save, close, BASE } from './lib.mjs';

const days = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!days.length) days.push('2026-11-25', '2026-12-16', '2027-03-17');
const result = {};
let failed = 0;
const only = (a, b) => a.filter((x) => !b.includes(x));

for (const day of days) {
  const { page, context } = await open({ size: 'desktop', forecast: 'fixed' });
  await plan(page, `date=${day}&time=720`, { wait: 5000 });
  await page.evaluate(() => document.querySelector('#viewbar [data-mode="shoot"]')?.click());
  await page.waitForTimeout(1500);
  const planRows = await page.evaluate(() =>
    window.__mini.dayRows().map((row) => {
      // The row's own card in the list gives the time as the page writes it.
      const card = [...document.querySelectorAll('#daylist .shotcard')].find((el) => el.querySelector('.sc-title')?.textContent === row.title && el.querySelector('.sc-detail')?.textContent.startsWith(row.detail.split(' · ')[0]));
      const time = card?.querySelector('.sc-time')?.textContent ?? row.detail.split(' · ')[0];
      return row.kind === 'street' ? { list: 'street', line: `${time} ${row.moment.view.name}` } : { list: 'shot', line: `${time} ${row.title}` };
    }),
  );
  await page.goto(`${BASE}/map/#/day=${day}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="streets-today"] .shotcard', { timeout: 60_000 });
  // The tower's and the landmarks' rows come once the building data is in.
  await page.waitForFunction(() => !/Checking buildings/.test(document.querySelector('[data-testid="highlights"]')?.textContent ?? 'Checking buildings'), null, { timeout: 60_000 });
  await page.waitForTimeout(4000);
  const mapRows = await page.evaluate(() => {
    // A row here is the shared shot card: the sentence for a tower or landmark shot, the street's name for a henge.
    const read = (row, list) => ({ list, line: `${row.querySelector('.sc-time')?.textContent ?? ''} ${(row.querySelector('.sc-title')?.textContent ?? '').replace(list === 'street' ? /^(Sun|Moon) down / : /^$/, '')}` });
    const streets = [...document.querySelectorAll('[data-testid="streets-today"] .shotcard')];
    const shots = [...document.querySelectorAll('[data-testid="highlights"] .shotcard')].filter((row) => !streets.includes(row));
    return [...shots.map((row) => read(row, 'shot')), ...streets.map((row) => read(row, 'street'))];
  });
  const lines = (rows, list) => rows.filter((row) => row.list === list).map((row) => row.line.replace(/­/g, '')).sort();
  const dayResult = {};
  let same = true;
  for (const list of ['shot', 'street']) {
    const a = lines(planRows, list);
    const b = lines(mapRows, list);
    dayResult[list] = { plan: a.length, map: b.length, onlyPlan: only(a, b), onlyMap: only(b, a) };
    if (dayResult[list].onlyPlan.length || dayResult[list].onlyMap.length) same = false;
  }
  result[day] = { same, ...dayResult };
  if (!same) failed++;
  console.log(`${same ? 'PASS' : 'FAIL'}  ${day}: ${dayResult.shot.plan} tower and landmark rows, ${dayResult.street.plan} street rows on /plan/; ${dayResult.shot.map} and ${dayResult.street.map} on /map`);
  for (const list of ['shot', 'street']) {
    for (const line of dayResult[list].onlyPlan) console.log(`      only on /plan/: ${line}`);
    for (const line of dayResult[list].onlyMap) console.log(`      only on /map:   ${line}`);
  }
  await context.close();
}
save('sameshots.json', result);
await close();
process.exit(failed ? 1 : 0);
