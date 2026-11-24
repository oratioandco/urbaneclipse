/**
 * The four views side by side: a screenshot of each at phone and desktop size, light and dark,
 * with the console's errors and warnings and what crossed the wire on a cold load.
 * Writes views-<view>-<size>-<scheme>.png and views.json to OUT.
 */
import { open, shot, save, close, BASE } from './lib.mjs';

const VIEWS = { home: '/', plan: '/plan/?nointro', map: '/map/', classic: '/classic/' };
const result = {};
for (const [view, path] of Object.entries(VIEWS)) {
  for (const size of ['phone', 'desktop']) {
    for (const scheme of ['light', 'dark']) {
      const { context, page, log } = await open({ size, scheme, forecast: 'fixed' });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      const req = new Map();
      cdp.on('Network.responseReceived', (e) => req.set(e.requestId, { url: e.response.url, type: e.type, wire: 0 }));
      cdp.on('Network.loadingFinished', (e) => req.get(e.requestId) && (req.get(e.requestId).wire = e.encodedDataLength));
      await page.goto(BASE + path, { waitUntil: 'load' });
      if (view === 'plan') await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
      await page.waitForTimeout(view === 'home' ? 2500 : 7000);
      await shot(page, `views-${view}-${size}-${scheme}`);
      const groups = {};
      for (const r of req.values()) {
        const host = new URL(r.url).host === new URL(BASE).host ? '' : new URL(r.url).host + ' ';
        const kind = host + (new URL(r.url).pathname.startsWith('/city/') ? 'city (from cache, size not counted)' : r.type);
        groups[kind] ??= { n: 0, kB: 0 };
        groups[kind].n++;
        groups[kind].kB += r.wire / 1024;
      }
      for (const g of Object.values(groups)) g.kB = Math.round(g.kB);
      const styles = await page.evaluate(() => {
        const cs = (el) => el && getComputedStyle(el);
        const h = document.querySelector('h1, h2, .headline, [class*=title]');
        const btn = document.querySelector('button, a.button, a[class*=btn], .chip');
        return {
          bodyFont: cs(document.body).fontFamily, bodyBg: cs(document.body).backgroundColor, bodyColor: cs(document.body).color,
          heading: h && { text: h.textContent.trim().slice(0, 40), font: cs(h).fontFamily, size: cs(h).fontSize, weight: cs(h).fontWeight },
          button: btn && { text: btn.textContent.trim().slice(0, 30), radius: cs(btn).borderRadius, bg: cs(btn).backgroundColor, color: cs(btn).color, height: btn.getBoundingClientRect().height },
          lang: document.documentElement.lang, title: document.title,
          overflowX: document.documentElement.scrollWidth > innerWidth,
        };
      });
      result[`${view}-${size}-${scheme}`] = { log, network: groups, styles };
      console.log(view, size, scheme, JSON.stringify(groups), 'log:', log.length);
      await context.close();
    }
  }
}
save('views.json', result);
await close();
