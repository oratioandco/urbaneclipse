/**
 * Prints what /plan/ says on a cold start, in words: the peek line, both tabs, the day list,
 * every control's tooltip and name. For judging the wording, and for finding selectors.
 *   node scripts/adversarial/dump.mjs [phone|desktop] [query] [forecast]
 */
import { open, plan, shot, close } from './lib.mjs';

const size = process.argv[2] ?? 'phone';
const query = process.argv[3] ?? '';
const { page, log, forecastCalls } = await open({ size, forecast: process.argv[4] ?? 'live' });
await plan(page, query);
const text = (sel) => page.$eval(sel, (e) => e.innerText).catch(() => null);
const strip = (html) => html.replace(/<svg.*?<\/svg>/gs, '<svg/>').replace(/<canvas.*?<\/canvas>/gs, '<canvas/>');
console.log('URL', page.url());
console.log('BODY', await page.evaluate(() => JSON.stringify(document.body.dataset)));
console.log('PEEK', await text('#peek-line'), '|', await page.getAttribute('#sheet-toggle', 'aria-label'));
console.log('OVERVIEW', await text('#overview'));
console.log('PLANCARDS', await text('#plancards'));
await shot(page, `dump-${size}-cold`);
await page.click('.tabs [data-mode="shoot"]');
await page.waitForTimeout(800);
console.log('BODY', await page.evaluate(() => JSON.stringify(document.body.dataset)));
console.log('DAYVIEW', await text('#dayview'));
console.log('WEATHER', await text('#weather'));
console.log('DAYLIST', await text('#daylist'));
console.log('ROW HTML', (await page.$$eval('#daylist > *', (r) => r.map((e) => e.outerHTML))).slice(0, 2).map(strip));
console.log('CARD HTML', (await page.$$eval('#shots-row > *', (r) => r.map((e) => e.outerHTML))).slice(0, 2).map(strip));
console.log('TIMELINE HTML', strip(await page.$eval('#tl-plot', (e) => e.outerHTML)).slice(0, 3000));
await shot(page, `dump-${size}-thisday`);
console.log(
  'CONTROLS',
  await page.$$eval('button, a[href], input, select, [role=button]', (b) =>
    b.map((e) => `${e.tagName} #${e.id} "${(e.innerText ?? '').trim().slice(0, 30)}" title=${e.title || '-'} aria=${e.getAttribute('aria-label') ?? '-'} shown=${e.offsetParent !== null}`),
  ),
);
console.log('FORECAST CALLS', forecastCalls.length, forecastCalls[0]);
console.log('LOG', JSON.stringify(log, null, 1));
await close();
