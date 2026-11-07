#!/usr/bin/env node
/**
 * Scouts photogenic spots: stands at each hand-picked place (bridges, avenues, a hill, riverbanks),
 * faces the TV tower, asks the planner's own "Dates" list when the sun or moon passes behind the
 * tower from there, opens the best few, and screenshots them at 1080×1920 (scene only).
 *
 *   node social/scout.mjs http://localhost:4321 [spot ...]
 * Output: social/assets/scout/<spot>-<n>.jpg and scout.json (title, detail, link per frame)
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.argv[2];
const ONLY = process.argv.slice(3);
const OUT = new URL('./assets/scout/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const TOWER = [52.520815, 13.409419];

const SPOTS = {
  oberbaum: [52.50165, 13.44565],          // Oberbaumbrücke, over the Spree
  eastside: [52.50455, 13.43975],          // East Side Gallery riverbank
  jannowitz: [52.51335, 13.41905],         // Jannowitzbrücke
  schilling: [52.50905, 13.42685],         // Schillingbrücke
  monbijou: [52.52215, 13.39655],          // Monbijoubrücke by the Bode-Museum
  weidendamm: [52.52035, 13.38875],        // Weidendammer Brücke
  kanzleramt: [52.51985, 13.36935],        // Spreebogen by the Kanzleramt
  klamott: [52.52825, 13.43555],           // Mont Klamott, Volkspark Friedrichshain
  strausberger: [52.51825, 13.42985],      // Karl-Marx-Allee, Strausberger Platz
  frankfurtertor: [52.51575, 13.45395],    // Karl-Marx-Allee, Frankfurter Tor
  linden: [52.51665, 13.38095],            // Pariser Platz, down Unter den Linden
  treptow: [52.49225, 13.47185],           // Treptower Park riverbank
  rummelsburg: [52.49735, 13.49055],       // Rummelsburger Bucht
};

function bearing([lat1, lon1], [lat2, lon2]) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const HIDE = 'body.clean .bottom, body.clean .tools, body.clean .topleft, body.clean #stick, body.clean #viewhere, body.clean #toast, body.clean #flatmap, body.clean #labels { visibility: hidden !important; }';
const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const found = fs.existsSync(`${OUT}/scout.json`) ? JSON.parse(fs.readFileSync(`${OUT}/scout.json`, 'utf8')) : {};

for (const [name, at] of Object.entries(SPOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const page = await ctx.newPage();
  const look = bearing(at, TOWER).toFixed(1);
  await page.goto(`${BASE}/plan/?nointro&date=2026-12-01&time=720&at=${at[0]},${at[1]}&look=${look},3&lens=135&cam=ff`);
  try {
    await page.waitForFunction(() => window.__mini?.look?.active, null, { timeout: 120000 });
  } catch {
    console.log(name, 'did not open');
    await page.close();
    continue;
  }
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.body.classList.add('clean'));
  await page.screenshot({ path: `${OUT}/${name}-view.jpg`, type: 'jpeg', quality: 80 });
  await page.evaluate(() => document.body.classList.remove('clean'));
  await page.click('#dates-toggle');
  await page.waitForFunction(() => document.querySelector('#dates .dayrow') || /hide|Neither|Buildings/.test(document.getElementById('dates').textContent), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const rows = await page.$$eval('#dates .dayrow', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  const note = await page.$eval('#dates', (e) => e.innerText.slice(0, 300));
  console.log(`\n${name}: ${rows.length} rows`);
  rows.slice(0, 12).forEach((r) => console.log('  ', r));
  if (!rows.length) console.log('  ', note.replace(/\s+/g, ' '));
  // Prefer the sun behind the sphere and the moon on the antenna or sphere; take up to three.
  const score = (r) => (/sphere/i.test(r) ? 3 : 0) + (/antenna/i.test(r) ? 2 : 0) + (/Night|Blue hour|Golden/i.test(r) ? 1 : 0);
  const picks = rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => b.s - a.s).slice(0, 3);
  found[name] = [];
  for (const [n, p] of picks.entries()) {
    await page.evaluate(() => document.body.classList.remove('clean'));
    if (!(await page.$('#dates .dayrow'))) {
      await page.click('#dates-toggle');
      await page.waitForSelector('#dates .dayrow', { timeout: 60000 }).catch(() => {});
    }
    const row = page.locator('#dates .dayrow').nth(p.i);
    await row.click().catch(() => {});
    await page.waitForTimeout(5000);
    await page.evaluate(() => document.body.classList.add('clean'));
    const file = `${name}-${n}.jpg`;
    await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 85 });
    found[name].push({ file, row: p.r, link: page.url().replace(BASE, '') });
    if (await page.$('body[data-dates="open"]')) await page.click('#dates-toggle').catch(() => {});
  }
  fs.writeFileSync(`${OUT}/scout.json`, JSON.stringify(found, null, 1));
  await page.close();
}
await browser.close();
