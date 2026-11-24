/**
 * One product? The words, type, colours and sun and moon of the four views, read off the pages:
 * every visible text of /, /map and /classic (desktop), the computed type and colour of their
 * headings, buttons and panels, and the language each speaks. Writes crossview.json and
 * crossview-<view>.png (full page where the page scrolls).
 */
import { open, shot, save, close, BASE } from './lib.mjs';

const out = {};
for (const [view, path] of Object.entries({ home: '/', map: '/map/', classic: '/classic/', plan: '/plan/?nointro' })) {
  const { context, page, log } = await open({ size: 'desktop', forecast: 'fixed' });
  await page.goto(BASE + path, { waitUntil: 'load' });
  if (view === 'plan') await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  await page.waitForTimeout(view === 'home' ? 2000 : 9000);
  await shot(page, `crossview-${view}`, { fullPage: view === 'home' });
  out[view] = await page.evaluate(() => {
    const cs = (e) => getComputedStyle(e);
    const seen = new Map();
    for (const e of document.querySelectorAll('h1,h2,h3,button,a,[class*=chip],[class*=pill],label,p,small,span,b')) {
      if (e.offsetParent === null || !e.innerText?.trim() || e.children.length > 2) continue;
      const s = cs(e);
      const key = `${e.tagName} ${s.fontFamily.split(',')[0]} ${s.fontSize}/${s.fontWeight} ${s.textTransform} ls=${s.letterSpacing} r=${s.borderRadius} c=${s.color} bg=${s.backgroundColor}`;
      if (!seen.has(key)) seen.set(key, e.innerText.trim().slice(0, 40));
    }
    return {
      lang: document.documentElement.lang,
      title: document.title,
      themeColor: document.querySelector('meta[name=theme-color]')?.content ?? null,
      text: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 6000),
      styles: [...seen].map(([k, v]) => `${k}  «${v}»`).slice(0, 60),
      radii: [...new Set([...document.querySelectorAll('*')].filter((e) => e.offsetParent !== null).map((e) => cs(e).borderRadius))].slice(0, 30),
      fonts: [...new Set([...document.querySelectorAll('*')].filter((e) => e.offsetParent !== null).map((e) => cs(e).fontFamily.split(',')[0]))],
    };
  });
  out[view].log = log.filter((l) => !/GPU stall/.test(l.text)).map((l) => `${l.type}: ${l.text.slice(0, 200)}`).filter((v, i, a) => a.indexOf(v) === i);
  console.log(`\n== ${view} lang=${out[view].lang} fonts=${out[view].fonts.join(' | ')}\n${out[view].text.slice(0, 2500)}\nLOG ${out[view].log.join('\n')}`);
  await context.close();
}
save('crossview.json', out);
await close();
