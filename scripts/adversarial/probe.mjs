/**
 * One state of /plan/, looked at: opens a query, optionally runs a few steps, saves a
 * screenshot and prints the panel's words.
 *   node scripts/adversarial/probe.mjs <name> <phone|desktop|narrow|wide> '<query>' [step ...]
 * Steps: click:<selector>  wait:<ms>  key:<key>  eval:<js>  text:<selector>  shot:<name>  hover:<selector>
 * Environment: FORECAST=live|fixed|fail|500|slow, SCHEME=dark, TZ_ID=<zone>, REDUCED=1, GPU=0, LOCALE=de-DE, GEO=lat,lon
 */
import { open, plan, shot, close } from './lib.mjs';

const [name, size = 'phone', query = '', ...steps] = process.argv.slice(2);
const { page, log } = await open({
  size,
  forecast: process.env.FORECAST ?? 'fixed',
  scheme: process.env.SCHEME ?? 'light',
  timezone: process.env.TZ_ID,
  reducedMotion: Boolean(process.env.REDUCED),
  locale: process.env.LOCALE,
  geolocation: process.env.GEO ? { latitude: Number(process.env.GEO.split(',')[0]), longitude: Number(process.env.GEO.split(',')[1]), accuracy: 8 } : undefined,
});
await plan(page, query);
for (const step of steps) {
  const [kind, ...rest] = step.split(':');
  const arg = rest.join(':');
  try {
    if (kind === 'click') await page.click(arg, { timeout: 5000 });
    else if (kind === 'hover') await page.hover(arg, { timeout: 5000 });
    else if (kind === 'wait') await page.waitForTimeout(Number(arg));
    else if (kind === 'key') await page.keyboard.press(arg);
    else if (kind === 'eval') console.log('EVAL', arg.slice(0, 60), '=>', JSON.stringify(await page.evaluate(arg)));
    else if (kind === 'text') console.log('TEXT', arg, '=>', JSON.stringify(await page.$eval(arg, (e) => e.innerText)));
    else if (kind === 'shot') await shot(page, arg);
  } catch (error) {
    console.log('STEP FAILED', step, String(error).split('\n')[0]);
  }
}
await page.waitForTimeout(500);
await shot(page, name);
console.log('URL', page.url());
console.log('BODY', await page.evaluate(() => JSON.stringify(document.body.dataset)));
console.log('PANEL', JSON.stringify(await page.$eval('#panel', (e) => e.innerText)));
const seen = new Set();
for (const l of log) {
  const key = l.type + l.text.slice(0, 120);
  if (!seen.has(key)) console.log('LOG', l.type, l.text.slice(0, 300));
  seen.add(key);
}
await close();
