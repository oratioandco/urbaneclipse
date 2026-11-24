/**
 * Accuracy from the outside: reads shots off the interface of /plan/, opens each one, and
 * writes down what the page then shows (clock, date, slider, address, facing). The numbers go
 * to accuracy-shots.json for scripts/adversarial/reference.py, which asks the audit's reference
 * (Skyfield, JPL DE421) where the sun or moon really is at that minute from that spot.
 *
 * Part A: the day list of chosen days, the two clock-change days among them.
 * Part B: "Dates" at eye level from one spot, the year's list (--dates-only runs this part alone).
 *
 *   node scripts/adversarial/accuracy.mjs
 *   <python with skyfield> scripts/adversarial/reference.py <OUT>/accuracy-shots.json
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, plan, shot, save, close, OUT } from './lib.mjs';

// Each: the day, and which rows of its list to open (by kind and body, first match each).
const DAYS = [
  { date: '2027-03-28', pick: [['tower', 'sun'], ['street', 'sun'], ['tower', 'moon'], ['street', 'moon']] },
  { date: '2027-10-31', pick: [['tower', 'sun'], ['street', 'sun'], ['tower', 'moon'], ['street', 'moon']] },
  { date: '2026-12-24', pick: [['tower', 'sun'], ['tower', 'moon']] },
  { date: '2027-06-21', pick: [['tower', 'sun'], ['street', 'sun']] },
  { date: '2027-02-20', pick: [['tower', 'moon'], ['street', 'moon']] },
];
// Part B's spot: the one the planner's own introduction links to, 5.3 km south-east of the tower.
// (Lichtenberger Brücke cannot be stood on in /plan/: see bridge.mjs.)
const SPOT = process.env.SPOT ?? 'at=52.492250,13.471850&look=307,2.6&lens=400&cam=ff';
const datesOnly = process.argv.includes('--dates-only');

const { page, log } = await open({ size: 'desktop', forecast: 'fixed' });
const shown = () =>
  page.evaluate(() => {
    const q = new URLSearchParams(location.search);
    const m = window.__mini;
    return {
      url: location.search,
      urlDate: q.get('date'),
      urlTime: Number(q.get('time')),
      at: q.get('at')?.split(',').map(Number) ?? null,
      look: q.get('look')?.split(',').map(Number) ?? null,
      clock: document.getElementById('clock').value,
      dateInput: document.getElementById('date').value,
      slider: Number(document.getElementById('time').value),
      dayLabel: document.getElementById('day-label').innerText,
      facing: document.getElementById('facing').innerText,
      eclipse: document.getElementById('eclipse').innerText,
      ticket: document.getElementById('ticket-shot').innerText,
      readout: document.getElementById('dv-readout').innerText,
      datesDay: document.getElementById('dates-day').innerText,
      eye: document.body.dataset.eye,
      heading: m.look.heading,
      pitch: m.look.pitch,
    };
  });
const rowsOf = (sel) =>
  page.$$eval(sel, (rows) =>
    rows.map((e, index) => ({
      index,
      kind: e.dataset.kind,
      body: e.dataset.body,
      grade: e.dataset.grade,
      time: e.querySelector('.sc-time')?.innerText,
      title: e.querySelector('.sc-title')?.innerText,
      detail: e.querySelector('.sc-detail')?.innerText,
      verdict: e.querySelector('.sc-verdict')?.innerText.replace(/\n/g, ' · '),
    })),
  );

const out = datesOnly ? { ...JSON.parse(readFileSync(join(OUT, 'accuracy-shots.json'), 'utf8')), dates: [] } : { tookAt: new Date().toISOString(), dayList: [], dates: [] };

for (const { date, pick } of datesOnly ? [] : DAYS) {
  await plan(page, `date=${date}`);
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForFunction(() => document.querySelectorAll('#daylist .shotcard').length > 0 || /Nothing lines up/.test(document.getElementById('daylist').innerText), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const list = await rowsOf('#daylist .shotcard');
  const cards = await rowsOf('#shots-row .shotcard');
  const day = { date, rows: list, cards, opened: [] };
  await shot(page, `accuracy-${date}-list`);
  for (const [kind, body] of pick) {
    const row = list.find((r) => r.kind === kind && r.body === body);
    if (!row) continue;
    await page.click(`#daylist .shotcard >> nth=${row.index}`);
    await page.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    day.opened.push({ row, after: await shown() });
    await shot(page, `accuracy-${date}-${kind}-${body}`);
    await page.click('#back');
    await page.waitForFunction(() => document.body.dataset.eye === 'false', null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  out.dayList.push(day);
  console.log(date, 'rows', list.length, 'cards', cards.length, 'opened', day.opened.map((o) => `${o.row.time} -> clock ${o.after.clock} on ${o.after.dateInput}`).join(' | '));
}

// Part B: the year's dates from one spot.
await plan(page, SPOT, { wait: 4000 });
if ((await page.getAttribute('#ticket-more', 'aria-expanded')) !== 'true') await page.click('#ticket-more');
await page.click('#dates-toggle');
await page.waitForFunction(() => document.querySelector('#dates h3') && !document.getElementById('dates').innerText.includes('Searching'), null, { timeout: 180_000 });
await page.waitForTimeout(2000);
const sections = await page.$$eval('#dates section', (boxes) =>
  boxes.map((box) => ({
    heading: box.querySelector('h3').innerText,
    notes: [...box.querySelectorAll('p')].map((p) => p.innerText),
    rows: [...box.querySelectorAll('.dayrow')].map((r) => ({ body: r.dataset.body, title: r.querySelector('b').innerText, detail: r.querySelector('small').innerText })),
  })),
);
out.datesSpot = (await shown()).at;
out.sections = sections;
await shot(page, 'accuracy-dates-list');
const all = await page.$$eval('#dates .dayrow', (rows) => rows.map((r, index) => ({ index, body: r.dataset.body, title: r.querySelector('b').innerText, detail: r.querySelector('small').innerText, heading: r.closest('section').querySelector('h3').innerText })));
// Open: every row on a clock-change day, the first sun and first moon row, and the last row.
const wanted = new Set();
for (const r of all) if (/28 Mar|31 Oct/.test(r.title)) wanted.add(r.index);
for (const body of ['sun', 'moon']) {
  const first = all.find((r) => r.body === body);
  if (first) wanted.add(first.index);
}
for (const month of ['Jan', 'Apr', 'Jun', 'Sept', 'Sep', 'Nov 2027']) {
  const found = all.find((r) => r.title.includes(month) && !wanted.has(r.index));
  if (found) wanted.add(found.index);
}
if (all.length) wanted.add(all.length - 1);
for (const index of [...wanted].sort((a, b) => a - b)) {
  await page.click(`#dates .dayrow >> nth=${index}`);
  await page.waitForTimeout(2500);
  out.dates.push({ row: all[index], after: await shown() });
}
await shot(page, 'accuracy-dates-opened');
console.log('dates sections', sections.map((s) => `${s.heading}: ${s.rows.length} rows; ${s.notes.join(' / ')}`).join('\n'));
console.log(out.dates.map((o) => `${o.row.title} -> clock ${o.after.clock} on ${o.after.dateInput}, slider ${o.after.slider}`).join('\n'));
out.log = log.filter((l) => l.type !== 'warning');
save('accuracy-shots.json', out);
await close();
