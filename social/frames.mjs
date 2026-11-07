#!/usr/bin/env node
/**
 * Stills of planner links at 1080×1920 (scene only), to compare framings before recording.
 *   node social/frames.mjs http://localhost:4321 out-dir name=/plan/?... [name=/plan/?... ...]
 * Prints each frame's status pill so the moment can be checked.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const [BASE, OUT, ...items] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const HIDE = 'body.clean .bottom, body.clean .tools, body.clean .topleft, body.clean #stick, body.clean #viewhere, body.clean #toast, body.clean #flatmap, body.clean #labels { visibility: hidden !important; }';
const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const item of items) {
  const [name, url] = [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)];
  const page = await ctx.newPage();
  await page.goto(BASE + url + '&nointro');
  await page.waitForFunction(() => window.__mini?.look?.active, null, { timeout: 120000 }).catch(() => {});
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(6000);
  const status = await page.evaluate(() => [document.getElementById('eclipse')?.innerText, document.getElementById('facing')?.innerText, document.getElementById('lens-label')?.innerText].join(' | '));
  await page.screenshot({ path: `${OUT}/${name}-ui.jpg`, type: 'jpeg', quality: 85 });
  await page.evaluate(() => document.body.classList.add('clean'));
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 85 });
  console.log(name, '|', status);
  await page.close();
}
await browser.close();
