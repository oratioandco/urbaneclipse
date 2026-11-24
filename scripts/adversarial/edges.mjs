/**
 * The edges of /plan/: a failing and a slow forecast, days the forecast does not reach, bad
 * addresses, a day with nothing, a day with a lot, midnight, a device in another time zone,
 * very narrow and very wide screens, the keyboard alone, reduced motion, glass off, reload and
 * back, and deep links. One render per case (edge-<case>.png) and what the page said in
 * edges.json.
 *
 *   node scripts/adversarial/edges.mjs [case ...]      # no arguments: all of them
 */
import { open, plan, shot, save, close, BASE } from './lib.mjs';

const only = process.argv.slice(2);
const out = {};
const said = (page) =>
  page.evaluate(() => {
    const t = (id) => document.getElementById(id)?.innerText ?? null;
    return {
      url: location.search,
      body: { ...document.body.dataset },
      peek: t('peek-line'),
      dayLabel: t('day-label'),
      date: document.getElementById('date').value,
      clock: document.getElementById('clock').value,
      weather: t('weather'),
      count: t('shots-count'),
      readout: t('dv-readout'),
      status: t('eclipse'),
      plancards: t('plancards')?.slice(0, 700),
      firstCards: [...document.querySelectorAll('#shots-row .shotcard')].slice(0, 3).map((e) => e.innerText.replace(/\n/g, ' | ')),
      daylist: t('daylist')?.slice(0, 500),
      rows: document.querySelectorAll('#daylist .shotcard').length,
      toast: document.getElementById('toast').hidden ? null : t('toast'),
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });
const thisDay = async (page) => {
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForTimeout(2500);
};
async function run(name, options, fn) {
  if (only.length && !only.includes(name)) return;
  const { context, page, log, forecastCalls } = await open(options);
  try {
    out[name] = await fn(page, context, forecastCalls);
  } catch (error) {
    out[name] = { FAILED: String(error).split('\n')[0] };
    await shot(page, `edge-${name}-FAILED`).catch(() => {});
  }
  out[name].log = log.filter((l) => !/GPU stall|toNonIndexed/.test(l.text)).map((l) => `${l.type}: ${l.text.slice(0, 200)}`).filter((v, i, a) => a.indexOf(v) === i);
  console.log(`\n== ${name}\n${JSON.stringify(out[name], null, 1).slice(0, 3500)}`);
  await context.close();
}

for (const mode of ['fail', '500']) {
  await run(`forecast-${mode}`, { size: 'phone', forecast: mode }, async (page, _c, calls) => {
    await plan(page, '', { wait: 5000 });
    const first = await said(page);
    await shot(page, `edge-forecast-${mode}-next3`);
    await thisDay(page);
    await shot(page, `edge-forecast-${mode}-thisday`);
    const day = await said(page);
    // Does it try again? The plan's retry is a minute.
    const before = calls.length;
    await page.waitForTimeout(65_000);
    return { first, day, callsAtStart: before, callsAfter65s: calls.length, after65s: (await said(page)).peek };
  });
}
await run('forecast-slow', { size: 'phone', forecast: 'slow', slowMs: 12_000 }, async (page) => {
  await plan(page, '', { wait: 3000 });
  const early = await said(page);
  await shot(page, 'edge-forecast-slow-waiting');
  await thisDay(page);
  await shot(page, 'edge-forecast-slow-waiting-thisday');
  const earlyDay = await said(page);
  await page.waitForTimeout(16_000);
  await shot(page, 'edge-forecast-slow-arrived');
  return { early, earlyDay, late: await said(page) };
});
for (const [name, query] of [
  ['beyond-forecast', 'date=2027-03-22'],
  ['long-ago', 'date=2025-06-01'],
  ['far-future', 'date=2040-06-21'],
  ['bad-date', 'date=garbage'],
  ['bad-date-feb30', 'date=2027-02-30'],
  ['bad-time', 'time=9999'],
  ['bad-at', 'at=abc,def&look=1,2'],
  ['at-outside', 'at=52.300000,13.000000&look=10,2&lens=50&cam=ff'],
]) {
  await run(name, { size: 'phone', forecast: 'fixed' }, async (page) => {
    await plan(page, query, { wait: 4000 });
    const first = await said(page);
    if (first.body.eye !== 'true') await thisDay(page);
    await shot(page, `edge-${name}`);
    return { first, day: await said(page) };
  });
}
await run('no-shots', { size: 'phone', forecast: 'fixed' }, async (page) => {
  // New moon, sun switched off and streets off: nothing can line up.
  await plan(page, 'date=2026-12-09');
  await thisDay(page);
  await page.click('#sheet-step').catch(() => {});
  await page.click('#dayfilter [data-layer="sun"]');
  await page.click('#dayfilter [data-layer="streets"]');
  await page.waitForTimeout(1500);
  await shot(page, 'edge-no-shots-filtered');
  const filtered = await said(page);
  await page.click('#dayfilter [data-layer="moon"]');
  await page.click('#dayfilter [data-layer="tower"]');
  await page.waitForTimeout(1500);
  await shot(page, 'edge-no-shots-all-off');
  const allOff = await said(page);
  // The switches are remembered: what does the next visit show?
  await plan(page, '');
  await shot(page, 'edge-no-shots-next-visit');
  return { filtered, allOff, nextVisit: await said(page) };
});
await run('midsummer', { size: 'phone', forecast: 'fixed' }, async (page) => {
  await plan(page, 'date=2027-06-21');
  await thisDay(page);
  await shot(page, 'edge-midsummer-phone');
  const row = await page.$eval('#shots-row', (e) => ({ cards: e.children.length, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, cardWidth: e.children[0].getBoundingClientRect().width }));
  return { ...(await said(page)), row };
});
await run('midnight', { size: 'phone', forecast: 'fixed' }, async (page) => {
  await plan(page, 'date=2027-06-21&time=1438');
  await thisDay(page);
  const steps = [];
  for (let i = 0; i < 3; i++) {
    await page.click('#dv-plus');
    await page.waitForTimeout(500);
    steps.push({ clock: await page.inputValue('#clock'), date: await page.inputValue('#date'), plusDisabled: await page.$eval('#dv-plus', (b) => b.disabled) });
  }
  await shot(page, 'edge-midnight-end-of-day');
  // Typing a time past midnight, and 24:00.
  const typed = [];
  for (const value of ['24:00', '0:10', '25:61', 'noon', '7', '7.30pm']) {
    await page.fill('#clock', value);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    typed.push({ typed: value, clock: await page.inputValue('#clock'), slider: await page.inputValue('#time'), date: await page.inputValue('#date') });
  }
  return { steps, typed };
});
await run('day-change', { size: 'phone', forecast: 'fixed' }, async (page) => {
  // The device's clock two minutes before Berlin's midnight; then five minutes on.
  await page.clock.install({ time: new Date('2026-11-24T22:58:00Z') });
  await page.goto(`${BASE}/plan/?nointro`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  await page.waitForTimeout(3000);
  const before = await said(page);
  await shot(page, 'edge-day-change-2358');
  await page.clock.fastForward('06:00');
  await page.waitForTimeout(3000);
  const after = await said(page);
  await shot(page, 'edge-day-change-0004');
  return { before: { dayLabel: before.dayLabel, date: before.date, peek: before.peek, plancards: before.plancards?.slice(0, 200) }, after: { dayLabel: after.dayLabel, date: after.date, peek: after.peek, plancards: after.plancards?.slice(0, 200), url: after.url } };
});
{
  const zones = {};
  for (const timezone of ['Europe/Berlin', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
    await run(`zone-${timezone.split('/')[1]}`, { size: 'desktop', forecast: 'fixed', timezone }, async (page) => {
      await plan(page, '', { wait: 5000 });
      const a = await said(page);
      await thisDay(page);
      const b = await said(page);
      if (timezone !== 'Europe/Berlin') await shot(page, `edge-zone-${timezone.split('/')[1]}`);
      const strip = (s) => s?.replace(/in \d+ (h|min|day)[^\n]*/g, '').replace(/Passed|GO|MAYBE|SKIP/g, '');
      zones[timezone] = { dayLabel: a.dayLabel, date: a.date, plancards: strip(a.plancards), daylist: strip(b.daylist), weather: b.weather, clock: b.clock };
      return { ...zones[timezone], sameAsBerlin: JSON.stringify(zones[timezone]) === JSON.stringify(zones['Europe/Berlin']) };
    });
  }
}
for (const size of ['narrow', 'wide']) {
  await run(`width-${size}`, { size, forecast: 'fixed' }, async (page) => {
    await plan(page, '', { wait: 4000 });
    await shot(page, `edge-width-${size}-next3`);
    await thisDay(page);
    await shot(page, `edge-width-${size}-thisday`);
    // Anything that sticks out of the screen or is cut by its own box.
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('#panel *, .tools *, .topleft *')]
        .filter((e) => e.offsetParent !== null && e.children.length === 0 && e.innerText?.trim())
        .filter((e) => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1 || e.scrollWidth > e.clientWidth + 1; })
        .map((e) => `${e.tagName}.${e.className} "${e.innerText.trim().slice(0, 40)}"`)
        .slice(0, 25),
    );
    // Opened through the DOM: at 320 px a pointer click first has to scroll the row out from under the sheet's head.
    await page.$eval('#daylist .shotcard:nth-child(4)', (e) => e.click());
    await page.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60_000 });
    await page.waitForTimeout(3000);
    await shot(page, `edge-width-${size}-eye`);
    await page.click('#ticket-more');
    await page.waitForTimeout(600);
    await shot(page, `edge-width-${size}-eye-more`);
    return { ...(await said(page)), clipped, panel: await page.$eval('#panel', (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }) };
  });
}
await run('keyboard', { size: 'desktop', forecast: 'fixed' }, async (page) => {
  await plan(page, '', { wait: 3000 });
  const order = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const e = document.activeElement;
        const s = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return `${e.tagName}#${e.id || e.className.toString().slice(0, 24)} "${(e.getAttribute('aria-label') ?? e.innerText ?? '').trim().replace(/\n/g, ' ').slice(0, 50)}" ring=${s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? 'yes' : s.boxShadow !== 'none' ? 'shadow' : 'NO'} onscreen=${r.width > 0 && r.top >= 0 && r.bottom <= innerHeight}`;
      }),
    );
  }
  await shot(page, 'edge-keyboard-after-45-tabs');
  // The time slider with the arrow keys.
  await page.click('.tabs [data-mode="shoot"]');
  await page.focus('#time');
  const t0 = await page.inputValue('#clock');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const t1 = await page.inputValue('#clock');
  await page.keyboard.press('PageUp');
  const t2 = await page.inputValue('#clock');
  await shot(page, 'edge-keyboard-slider-focus');
  // A shot by keyboard: focus the first list row, Enter, then Escape.
  await page.focus('#daylist .shotcard');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  const eye = await page.evaluate(() => document.body.dataset.eye);
  const focusAtEye = await page.evaluate(() => `${document.activeElement.tagName}#${document.activeElement.id}`);
  await shot(page, 'edge-keyboard-eye');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  const afterEscape = await page.evaluate(() => document.body.dataset.eye);
  // The map itself: can it be moved without a pointer?
  const camBefore = await page.evaluate(() => window.__mini.camera.position.toArray().map((v) => Math.round(v)));
  await page.focus('#labels').catch(() => {});
  for (const key of ['ArrowLeft', 'ArrowLeft', '+', '=']) await page.keyboard.press(key);
  await page.waitForTimeout(800);
  const camAfter = await page.evaluate(() => window.__mini.camera.position.toArray().map((v) => Math.round(v)));
  return { order, slider: [t0, t1, t2], enterOpensShot: eye, focusAtEye, escapeLeavesEye: afterEscape === 'false', mapMovesWithKeys: JSON.stringify(camBefore) !== JSON.stringify(camAfter) };
});
await run('reduced-motion', { size: 'desktop', forecast: 'fixed', reducedMotion: true }, async (page) => {
  await plan(page, 'date=2027-06-21&time=600');
  await thisDay(page);
  await page.click('#shots-row .shotcard >> nth=1');
  await page.waitForTimeout(120);
  const soon = await page.inputValue('#clock');
  await page.waitForTimeout(1500);
  const later = await page.inputValue('#clock');
  // Opening a shot: is the flight to eye level cut short?
  const t0 = Date.now();
  await page.click('#shots-row .shotcard[aria-current]');
  await page.waitForFunction(() => window.__mini.look.active, null, { timeout: 30_000 });
  const flightMs = Date.now() - t0;
  await shot(page, 'edge-reduced-motion');
  const animations = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  return { clockAfter120ms: soon, clockAfter1600ms: later, glideIsInstant: soon === later, flightToEyeLevelMs: flightMs, runningCssAnimations: animations };
});
await run('glass-off', { size: 'phone', forecast: 'fixed' }, async (page) => {
  await plan(page, 'glass=off');
  await shot(page, 'edge-glass-off');
  const s = await page.$eval('#panel', (e) => ({ backdrop: getComputedStyle(e).backdropFilter, background: getComputedStyle(e).backgroundColor }));
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForTimeout(1200);
  return { ...(await said(page)), panel: s, keptInAddress: page.url().includes('glass') };
});
await run('reload-back', { size: 'phone', forecast: 'fixed' }, async (page) => {
  const res = {};
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.click('a:has-text("Open the planner")');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  await page.waitForTimeout(2500);
  if (await page.$eval('#intro', (d) => d.open)) await page.click('#intro-start');
  await page.waitForTimeout(1000);
  // Sheet heights and the back button.
  await page.click('#sheet-step');
  await page.waitForTimeout(700);
  res.sheetAfterStep = await page.evaluate(() => document.body.dataset.sheet);
  await page.goBack();
  await page.waitForTimeout(1200);
  res.afterBack1 = await page.evaluate(() => ({ sheet: document.body.dataset.sheet, path: location.pathname }));
  await page.goBack();
  await page.waitForTimeout(1200);
  res.afterBack2 = await page.evaluate(() => ({ sheet: document.body.dataset?.sheet, path: location.pathname }));
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1500);
  res.afterBack3 = await page.evaluate(() => ({ sheet: document.body.dataset?.sheet, path: location.pathname }));
  console.log('reload-back so far', JSON.stringify(res));
  // "This day", a shot open, then reload, then back. The sheet's height is remembered, so say it.
  await plan(page, 'sheet=full');
  await thisDay(page);
  await page.$eval('#daylist .shotcard:nth-child(5)', (e) => e.click());
  await page.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  const open1 = await said(page);
  const ticket1 = await page.$eval('#ticket-shot', (e) => e.innerText);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true && window.__mini.look.active, null, { timeout: 300_000 });
  await page.waitForTimeout(3000);
  const open2 = await said(page);
  await shot(page, 'edge-reload-at-eye-level');
  res.reloadAtEye = { before: { url: open1.url, status: open1.status, ticket: ticket1, clock: open1.clock, mode: open1.body.mode }, after: { url: open2.url, status: open2.status, ticket: await page.$eval('#ticket-shot', (e) => (e.hidden ? '(hidden)' : e.innerText)), clock: open2.clock, mode: open2.body.mode } };
  await page.goBack().catch(() => {});
  await page.waitForTimeout(2500);
  res.backFromEye = await page.evaluate(() => ({ path: location.pathname, search: location.search, eye: document.body.dataset?.eye }));
  await shot(page, 'edge-back-from-eye-level');
  return res;
});
await run('deep-links', { size: 'phone', forecast: 'fixed' }, async (page) => {
  // The four shots the introduction links to, opened cold.
  await page.goto(`${BASE}/plan/`, { waitUntil: 'domcontentloaded' });
  const links = await page.$$eval('#intro .intro-shot', (a) => a.map((e) => ({ title: e.querySelector('b').innerText, href: e.getAttribute('href') })));
  const res = [];
  for (const [i, link] of links.entries()) {
    await page.goto(BASE + link.href + '&nointro', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true && window.__mini.look.active, null, { timeout: 300_000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const s = await said(page);
    await shot(page, `edge-deep-link-${i + 1}`);
    res.push({ ...link, status: s.status, clock: s.clock, eye: s.body.eye, drone: s.body.drone, urlAfter: s.url });
  }
  return { links: res };
});
save(`edges${only.length ? '-' + only.join('-').slice(0, 40) : ''}.json`, out);
await close();
