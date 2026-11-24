/**
 * The spec's five core use cases, walked from a cold start (no stored state, the introduction
 * showing) with the real forecast, on a phone and on a desktop. Counts the taps, saves a render
 * of every step (uc-<size>-<n>-<name>.png) and writes what each step said to usecases.json.
 * It also holds one shot against itself: its time and verdict in the peek line, the three-day
 * strip, the coming-days list, the day view's card, the day list, the ticket, the Go-there menu
 * and the calendar file.
 *
 *   node scripts/adversarial/usecases.mjs [phone|desktop ...]   FORECAST=fixed for a fixed sky
 */
import { readFileSync } from 'node:fs';
import { open, shot, save, close, BASE } from './lib.mjs';

const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ['phone', 'desktop'];
const all = {};
for (const size of sizes) {
  const { context, page, log } = await open({ size, forecast: process.env.FORECAST ?? 'live' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const steps = [];
  let taps = 0;
  let n = 0;
  const text = (sel) => page.$eval(sel, (e) => e.innerText).catch(() => null);
  const step = async (name, note = {}) => {
    n += 1;
    await shot(page, `uc-${size}-${String(n).padStart(2, '0')}-${name}`);
    steps.push({ n, name, taps, ...note });
    console.log(size, n, name, 'taps', taps, JSON.stringify(note).slice(0, 400));
  };
  const tap = async (sel, opts = {}) => {
    await page.locator(sel).first().click({ timeout: 8000, ...opts });
    taps += 1;
  };
  const tryStep = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      await step(`${name}-FAILED`, { error: String(error).split('\n')[0] });
    }
  };

  // Cold start on the landing page.
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await step('home', { headline: await text('h1'), buttons: await page.$$eval('a, button', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()).filter(Boolean).slice(0, 12)) });
  await tap('a:has-text("Open the planner")');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  await page.waitForTimeout(2500);
  const introOpen = await page.$eval('#intro', (d) => d.open);
  await step('plan-first-sight', { introOpen, intro: introOpen ? (await text('#intro')).slice(0, 900) : null });
  if (introOpen) await tap('#intro-start');
  await page.waitForTimeout(6000);

  // 1. "Is there anything worth shooting soon?"
  const uc1 = taps;
  await step('uc1-next-shots', { peek: await text('#peek-line'), peekSaid: await page.getAttribute('#sheet-toggle', 'aria-label'), sheet: await page.evaluate(() => document.body.dataset.sheet), moon: await text('#moon-head'), list: (await text('#plancards'))?.slice(0, 1500), listVisibleInViewport: await page.$eval('#plancards', (e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.height > 0 ? Math.round(Math.min(innerHeight, r.bottom) - r.top) : 0; }) });
  if (size !== 'desktop') {
    await tryStep('uc1-full-sheet', async () => {
      await tap('#sheet-step');
      await page.waitForTimeout(900);
      await step('uc1-list-opened', { sheet: await page.evaluate(() => document.body.dataset.sheet), tapsForUc1: taps - uc1 });
    });
  }
  const strip = await page.$$eval('#sparkstrip [aria-label], #sparkstrip [title]', (els) => els.map((e) => e.getAttribute('aria-label') ?? e.title));
  const planRows = await page.$$eval('#plancards .shotcard', (rows) => rows.map((e) => ({ time: e.querySelector('.sc-time')?.innerText, title: e.querySelector('.sc-title')?.innerText, verdict: e.querySelector('.sc-verdict')?.innerText.replace(/\n/g, ' · '), detail: e.querySelector('.sc-detail')?.innerText, day: e.closest('section, div')?.querySelector('h3, h4, .day')?.innerText })));

  // 2. "What will this day's light do?"
  const uc2 = taps;
  await tap('.tabs [data-mode="shoot"]');
  await page.waitForTimeout(2500);
  const cards = await page.$$eval('#shots-row .shotcard', (rows) => rows.map((e) => ({ time: e.querySelector('.sc-time')?.innerText, title: e.querySelector('.sc-title')?.innerText, verdict: e.querySelector('.sc-verdict')?.innerText.replace(/\n/g, ' · ') })));
  const rows = await page.$$eval('#daylist .shotcard', (rs) => rs.map((e) => ({ time: e.querySelector('.sc-time')?.innerText, title: e.querySelector('.sc-title')?.innerText, verdict: e.querySelector('.sc-verdict')?.innerText.replace(/\n/g, ' · '), detail: e.querySelector('.sc-detail')?.innerText })));
  await step('uc2-this-day', { tapsForUc2: taps - uc2, dayview: await text('#dayview'), weather: await text('#weather'), count: await text('#shots-count') });

  // 3. "Where exactly do I stand, and what will I see?" The first shot still ahead.
  const uc3 = taps;
  const ahead = rows.findIndex((r) => !/Passed/.test(r.verdict));
  let opened = null;
  await tryStep('uc3', async () => {
    if (size !== 'desktop' && (await page.evaluate(() => document.body.dataset.sheet)) !== 'full') await tap('#sheet-step');
    await page.waitForTimeout(600);
    await tap(`#daylist .shotcard >> nth=${Math.max(0, ahead)}`);
    await page.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60_000 });
    await page.waitForTimeout(3500);
    opened = { row: rows[Math.max(0, ahead)], ticket: await text('#ticket-shot'), status: await text('#eclipse'), clock: await page.inputValue('#clock'), url: page.url() };
    await step('uc3-eye-level', { tapsForUc3: taps - uc3, ...opened, panel: await text('#panel') });
    await tap('#ticket-more');
    await page.waitForTimeout(700);
    await step('uc3-more', { facing: await text('#facing'), lens: await text('#lens-label'), panel: (await text('#panel'))?.slice(0, 600) });
  });

  // 4. "When does this happen from my spot?"
  const uc4 = taps;
  await tryStep('uc4', async () => {
    await tap('#dates-toggle');
    await page.waitForFunction(() => document.querySelector('#dates h3') && !document.getElementById('dates').innerText.includes('Searching'), null, { timeout: 180_000 });
    await page.waitForTimeout(2500);
    await step('uc4-dates', { tapsForUc4: taps - uc4, dates: (await text('#dates'))?.slice(0, 1800) });
    await tap('#dates-toggle');
  });

  // 5. "Take me there and remind me."
  const uc5 = taps;
  await tryStep('uc5', async () => {
    await tap('#share');
    await page.waitForTimeout(500);
    const menu = { text: await text('#share-menu'), directions: await page.getAttribute('#directions', 'href') };
    await step('uc5-go-there', menu);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), tap('#calendar')]);
    const ics = readFileSync(await download.path(), 'utf8');
    await step('uc5-calendar', { file: download.suggestedFilename(), toast: await text('#toast'), ics });
    await tap('#share');
    await tap('#copylink');
    await page.waitForTimeout(600);
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `clipboard not readable: ${e.message}`);
    await step('uc5-link', { tapsForUc5: taps - uc5, toast: await text('#toast'), copied, url: page.url() });
  });

  // The way back.
  await tryStep('back', async () => {
    await tap('#back');
    await page.waitForFunction(() => document.body.dataset.eye === 'false', null, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    await step('back-on-the-map', { body: await page.evaluate(() => JSON.stringify(document.body.dataset)), peek: await text('#peek-line') });
  });
  all[size] = { steps, strip, planRows, cards, rows, opened, log: log.filter((l) => !/GPU stall/.test(l.text)) };
  await context.close();
}
save(`usecases-${sizes.join('-')}.json`, all);
await close();
