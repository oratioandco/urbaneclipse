/**
 * The scene mask and the list of places with trees in the way, by asking the planner's scene
 * about every row's own spots until the list of the covered days is stable.
 *
 *   npm run build && npx astro preview --port 4471 &
 *   BASE=http://localhost:4471 CACHE=<dir> npx vitest run -c scripts/adversarial/vitest.config.ts
 *
 * It needs the pipeline (dayShots) and the scene at once, so it runs under vitest and drives
 * the page through lib.mjs. Each round lists the rows of every covered day with the lists so
 * far, asks the page about each spot it has not asked about (`__mini.shotShareAt`, and
 * `__mini.streetShareAt` for a street), and applies the planner's rule (pointer.js `clearAt`):
 * a tower row no spot of which shows its shot has all its spots masked; a row whose own spot
 * buildings hide has that spot masked; every spot with the tree register's trees across the
 * shot goes to the tree list, in full leaf (`spots`) and bare (`bare`). About fifteen rounds,
 * about an hour; `rows.mjs` over the days afterwards is the proof, through the planner itself.
 *
 * The days covered are written into both files (`covered: { from, to }`): the site lists no
 * shots outside them (dayShots.js `dayCovered`) and the build warns within 60 days of the end.
 *   FROM=2026-11-24   the first day (default: the mask's own, else today)
 *   DAYS=430          how many days (default 430: fourteen months)
 *   FRESH=1           start both lists over (after a change to the rules or the city)
 *   ONLY=streets      ask about the streets alone (the tower rows' entries stay as they are)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { decodeStreets } from '../../src/lib/streets';
import { applySceneMask, decodeViewshed, treeTest } from '../../src/lib/viewshed';
import { berlinDayStart } from '../../src/miniature/berlinClock.js';
import { dayShots } from '../../src/miniature/dayShots.js';
import { sceneFromLatLon } from '../../src/miniature/eye.js';

it('crawl', async () => {
  // @ts-ignore: a plain module
  const { open, plan, close } = await import('./lib.mjs');
  const header = JSON.parse(readFileSync('public/viewshed/fernsehturm.json', 'utf8'));
  const packed = new Uint8Array(readFileSync(`public/viewshed/${header.binary}`));
  // Each street with its two ends in the scene's metres, as the planner holds them (main.js).
  const FT = { lat: 52.520815, lon: 13.409419 };
  const views = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8'))).map((view: any) => ({ ...view, a: sceneFromLatLon(view.from.lat, view.from.lon, FT.lat, FT.lon), b: sceneFromLatLon(view.to.lat, view.to.lon, FT.lat, FT.lon) }));
  const maskFile = 'public/viewshed/fernsehturm-scene.json';
  const treeFile = 'public/viewshed/trees-in-the-way.json';
  const maskHad = JSON.parse(readFileSync(maskFile, 'utf8'));
  const treeHad = JSON.parse(readFileSync(treeFile, 'utf8'));
  const fresh = process.env.FRESH === '1';
  const from = process.env.FROM ?? maskHad.covered?.from ?? new Date().toISOString().slice(0, 10);
  const days = Number(process.env.DAYS ?? 430);
  const dayAt = (n: number) => new Date(Date.parse(`${from}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const covered = { from, to: dayAt(days - 1) };
  type Spot = (number | string)[];
  const six = (p: Spot): Spot => [Number(Number(p[0]).toFixed(6)), Number(Number(p[1]).toFixed(6)), ...p.slice(2)];
  const lists = { mask: fresh ? [] : (maskHad.spots as Spot[]), leaf: fresh ? [] : (treeHad.spots as Spot[]), bare: fresh ? [] : ((treeHad.bare ?? []) as Spot[]) };
  const sets = { mask: new Set(lists.mask.map(String)), leaf: new Set(lists.leaf.map(String)), bare: new Set(lists.bare.map(String)) };
  const added = { mask: 0, leaf: 0, bare: 0 };
  const add = (which: keyof typeof lists, at: Spot) => {
    const p = six(at);
    if (sets[which].has(String(p))) return;
    sets[which].add(String(p));
    lists[which].push(p);
    added[which]++;
  };
  const write = () => {
    writeFileSync(maskFile, `${JSON.stringify({ note: 'Places the viewshed calls visible from which the planner’s scene, in full detail, does not show the row’s shot. Measured by scripts/adversarial/crawl.test.ts and rows.mjs --mask for the covered days; applied by src/lib/viewshed.ts applySceneMask. Outside the covered days no shots are listed.', covered, spots: lists.mask })}\n`);
    writeFileSync(treeFile, `${JSON.stringify({ note: 'Places from which the tree register’s trees stand across a listed shot: in full leaf more than one ray in five of its disc or target (spots), bare more than half (bare). A third entry is a street’s tag: how high the body stands down it, in degrees. Measured in the planner’s scene by scripts/adversarial/crawl.test.ts and rows.mjs --trees for the covered days; asked through src/lib/viewshed.ts treeTest.', covered, spots: lists.leaf, bare: lists.bare })}\n`);
  };

  const { page } = await open({ size: 'desktop', forecast: 'fixed' });
  await plan(page, 'view=day&date=2027-03-04', { wait: 4000 });
  type Verdict = { ok: boolean; clear: boolean; treed: boolean; leaf: boolean; bare: boolean };
  const cache = new Map<string, Verdict>();
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
          out.push({ ok: r.seen.ok, clear: !s.centre && s.disc.buildings <= 0.2 + 1e-9 && s.target.buildings <= 0.2 + 1e-9, treed: (s.disc.trees ?? 0) > 0.2 + 1e-9 || (s.target.trees ?? 0) > 0.2 + 1e-9, leaf: Boolean(r.trees?.leaf), bare: Boolean(r.trees?.bare) });
        }
        return out;
      }, part);
      part.forEach((c, k) => cache.set(keyOf(c), res[k]));
    }
  };
  // Streets: one answer for a place and a height of the body down it.
  const streets = new Map<string, { opened: boolean; leaf: boolean; bare: boolean }>();
  const streetKey = (r: any) => `${r.at[0].toFixed(6)},${r.at[1].toFixed(6)},${r.treeTag}`;
  const askStreets = async (list: any[]) => {
    for (let i = 0; i < list.length; i += 40) {
      const part = list.slice(i, i + 40);
      const res = await page.evaluate(async (part: any[]) => {
        const m = (window as any).__mini;
        const out = [];
        for (const s of part) out.push(await m.streetShareAt(s));
        return out;
      }, part.map((r) => ({ body: r.body, t: r.t, a: r.moment.view.a, b: r.moment.view.b, bearingDeg: r.moment.view.bearingDeg, toleranceDeg: r.moment.view.toleranceDeg, bodyAlt: r.moment.bodyAlt })));
      part.forEach((r, k) => streets.set(streetKey(r), res[k]));
    }
  };

  for (let round = 1; round <= 40; round++) {
    const view: any = applySceneMask(decodeViewshed(header, packed), lists.mask as any);
    view.treesAt = treeTest(lists.leaf as any, lists.bare as any);
    const rows: any[] = [];
    const streetRows: any[] = [];
    for (let n = 0; n < days; n++) {
      for (const r of dayShots(berlinDayStart(dayAt(n)), { shed: view, views }) as any[]) {
        if (r.kind === 'street') {
          if (r.at) streetRows.push(r);
        } else if (r.landmark === 'fernsehturm' && !r.target && process.env.ONLY !== 'streets') rows.push(r);
      }
    }
    const candidates = (r: any) => [{ t: r.openAt ?? r.t, at: r.at }, ...(r.alternates ?? []).map((a: any) => ({ t: a.t, at: a.at })), ...(r.standOthers ?? []).map((at: any) => ({ t: r.openAt ?? r.t, at }))].map((c) => ({ ...c, where: r.where, body: r.body }));
    const need = new Map<string, any>();
    for (const r of rows) for (const c of candidates(r)) if (!cache.has(keyOf(c))) need.set(keyOf(c), c);
    await ask([...need.values()]);
    const needStreets = new Map<string, any>();
    for (const r of streetRows) if (!streets.has(streetKey(r))) needStreets.set(streetKey(r), r);
    await askStreets([...needStreets.values()]);
    added.mask = added.leaf = added.bare = 0;
    let failing = 0;
    for (const r of rows) {
      const cs = candidates(r).map((c) => ({ c, v: cache.get(keyOf(c))! }));
      // The planner (pointer.js clearAt): the first spot buildings leave clear and that day's trees too, else the first buildings leave clear.
      const chosen = cs.find((x) => x.v.clear && !x.v.treed) ?? cs.find((x) => x.v.clear);
      for (const x of cs) {
        if (x.v.leaf) add('leaf', x.c.at);
        if (x.v.bare) add('bare', x.c.at);
      }
      if (!chosen) {
        failing++;
        for (const x of cs) add('mask', x.c.at);
        continue;
      }
      if (!chosen.v.ok) {
        failing++;
        add('mask', chosen.c.at);
      }
      // Its own spot is the one its words are about: one the scene refuses goes to the mask.
      if (chosen !== cs[0] && (!cs[0].v.clear || !cs[0].v.ok)) {
        failing++;
        add('mask', cs[0].c.at);
      }
    }
    for (const r of streetRows) {
      const v = streets.get(streetKey(r))!;
      if (v.leaf) add('leaf', [r.at[0], r.at[1], r.treeTag]);
      if (v.bare) add('bare', [r.at[0], r.at[1], r.treeTag]);
    }
    console.log(`crawl ${round}: ${covered.from} to ${covered.to}: ${rows.length} tower rows (sphere ${rows.filter((r) => r.where === 'sphere').length}, antenna ${rows.filter((r) => r.where === 'antenna').length}), ${streetRows.length} street rows; asked ${need.size} spots and ${needStreets.size} streets; failing ${failing}; mask +${added.mask} = ${lists.mask.length}, trees in leaf +${added.leaf} = ${lists.leaf.length}, bare +${added.bare} = ${lists.bare.length}`);
    write();
    if (!added.mask && !added.leaf && !added.bare) break;
  }
  await close();
}, 8 * 3_600_000);
