/**
 * The scene mask and the list of places with trees in the way, by asking the planner's scene
 * about every tower row's own spots until the year's list is stable.
 *
 *   npm run build && npx astro preview --port 4471 &
 *   BASE=http://localhost:4471 CACHE=<dir> npx vitest run -c scripts/adversarial/vitest.config.ts
 *
 * It needs the pipeline (dayShots) and the scene at once, so it runs under vitest and drives
 * the page through lib.mjs. Each round lists the year's rows with the mask so far, asks the
 * page (`__mini.shotShareAt`) about each spot it has not asked about, and applies the
 * planner's rule (pointer.js `clearAt`): a row no spot of which shows its shot has all its
 * spots masked; a row whose own spot buildings hide has that spot masked; every spot with the
 * tree register's trees in the frame goes to the tree list. About fifteen rounds, under an
 * hour; `rows.mjs` over the year afterwards is the proof, through the planner itself.
 * MASK_FROM_EMPTY=1 starts the mask over (after a change to the rules or the city).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { applySceneMask, decodeViewshed, treeTest } from '../../src/lib/viewshed';
import { berlinDayStart } from '../../src/miniature/berlinClock.js';
import { dayShots } from '../../src/miniature/dayShots.js';

it('crawl', async () => {
  // @ts-ignore: a plain module
  const { open, plan, close } = await import('./lib.mjs');
  const header = JSON.parse(readFileSync('public/viewshed/fernsehturm.json', 'utf8'));
  const packed = new Uint8Array(readFileSync(`public/viewshed/${header.binary}`));
  const maskFile = 'public/viewshed/fernsehturm-scene.json';
  const treeFile = 'public/viewshed/trees-in-the-way.json';
  const maskHad = JSON.parse(readFileSync(maskFile, 'utf8'));
  const treeHad = JSON.parse(readFileSync(treeFile, 'utf8'));
  const six = (p: number[]) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))];
  const maskSpots: number[][] = process.env.MASK_FROM_EMPTY === '1' ? [] : maskHad.spots;
  const treeSpots: number[][] = treeHad.spots;
  const maskSet = new Set(maskSpots.map((p) => p.join(',')));
  const treeSet = new Set(treeSpots.map((p) => p.join(',')));
  const { page } = await open({ size: 'desktop', forecast: 'fixed' });
  await plan(page, 'view=day&date=2027-03-04', { wait: 4000 });
  const cache = new Map<string, { ok: boolean; clear: boolean; treed: boolean }>();
  const keyOf = (c: any) => `${c.where}|${c.body}|${c.at[0].toFixed(6)},${c.at[1].toFixed(6)}|${c.t}`;
  const ask = async (list: any[]) => {
    for (let i = 0; i < list.length; i += 150) {
      const part = list.slice(i, i + 150);
      const res = await page.evaluate(async (part: any[]) => {
        const m = (window as any).__mini;
        const out = [];
        for (const c of part) {
          const r = await m.shotShareAt({ body: c.body, kind: 'tower', where: c.where, t: c.t, openAt: c.t }, c.at, c.t);
          const s = r.share;
          out.push({ ok: r.seen.ok, clear: !s.centre && s.disc.buildings <= 0.2 + 1e-9 && s.target.buildings <= 0.2 + 1e-9, treed: (s.disc.trees ?? 0) > 0.2 + 1e-9 || (s.target.trees ?? 0) > 0.2 + 1e-9 });
        }
        return out;
      }, part);
      part.forEach((c, k) => cache.set(keyOf(c), res[k]));
    }
  };
  for (let round = 1; round <= 40; round++) {
    const view: any = applySceneMask(decodeViewshed(header, packed), maskSpots as any);
    view.treesAt = treeTest(treeSpots as any);
    const rows: any[] = [];
    for (let n = 0; n < 365; n++) {
      const date = new Date(Date.parse('2026-11-24T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
      for (const r of dayShots(berlinDayStart(date), { shed: view }) as any[]) if (r.landmark === 'fernsehturm' && !r.target) rows.push({ date, r });
    }
    const candidates = (r: any) => [{ t: r.openAt ?? r.t, at: r.at }, ...(r.alternates ?? []).map((a: any) => ({ t: a.t, at: a.at })), ...(r.standOthers ?? []).map((at: any) => ({ t: r.openAt ?? r.t, at }))].map((c) => ({ ...c, where: r.where, body: r.body }));
    const need = new Map<string, any>();
    for (const { r } of rows) for (const c of candidates(r)) if (!cache.has(keyOf(c))) need.set(keyOf(c), c);
    await ask([...need.values()]);
    let maskAdded = 0;
    let treesAdded = 0;
    let failing = 0;
    const addMask = (at: number[]) => {
      const p = six(at);
      if (maskSet.has(p.join(','))) return;
      maskSet.add(p.join(','));
      maskSpots.push(p);
      maskAdded++;
    };
    const addTree = (at: number[]) => {
      const p = six(at);
      if (treeSet.has(p.join(','))) return;
      treeSet.add(p.join(','));
      treeSpots.push(p);
      treesAdded++;
    };
    for (const { r } of rows) {
      const cs = candidates(r).map((c) => ({ c, v: cache.get(keyOf(c))! }));
      // The planner (pointer.js clearAt): the first spot buildings leave clear and trees too, else the first buildings leave clear.
      const chosen = cs.find((x) => x.v.clear && !x.v.treed) ?? cs.find((x) => x.v.clear);
      for (const x of cs) if (x.v.treed) addTree(x.c.at);
      if (!chosen) {
        failing++;
        for (const x of cs) addMask(x.c.at);
        continue;
      }
      if (!chosen.v.ok) {
        failing++;
        addMask(chosen.c.at);
      }
      // Its own spot is the one its words are about: one the scene refuses goes to the mask.
      if (chosen !== cs[0] && (!cs[0].v.clear || !cs[0].v.ok)) {
        failing++;
        addMask(cs[0].c.at);
      }
    }
    console.log(`crawl ${round}: ${rows.length} rows (sphere ${rows.filter((x) => x.r.where === 'sphere').length}, antenna ${rows.filter((x) => x.r.where === 'antenna').length}), asked ${need.size}, failing ${failing}, mask +${maskAdded} = ${maskSpots.length}, trees +${treesAdded} = ${treeSpots.length}`);
    writeFileSync(maskFile, `${JSON.stringify({ note: maskHad.note, spots: maskSpots })}\n`);
    writeFileSync(treeFile, `${JSON.stringify({ note: treeHad.note, spots: treeSpots })}\n`);
    if (!maskAdded && !treesAdded) break;
  }
  await close();
}, 6 * 3_600_000);
