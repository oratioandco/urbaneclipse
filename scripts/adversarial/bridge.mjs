/**
 * Finding 1, the bridges (docs/adversarial-test-2026-11.md). Three checks, each printed as
 * PASS or FAIL and written to bridge.json:
 *
 *   A  eye height: a link to each standing point on the Lichtenberger Brücke and on other
 *      bridges opens at eye level 1.6 m over the deck as the page then draws it (full detail),
 *      not inside it, and stays where the link put it.
 *   B  Dates from the bridge: at nord-mitte and sued-mitte the tower's passes are listed, not
 *      "Buildings hide it from here" (compare /classic's panel 05 by hand: 33 and 34 windows).
 *   C  any bridge: mid-span on a list of Berlin road bridges, "stand here" moves you less
 *      than 5 m; and the known not-a-deck places (under a rail viaduct) are not decks.
 *
 *   D  the five bridges the model lacks say "not in the model yet" where one stands at them,
 *      and the two railway viaducts of the census are not decks.
 *
 *   node scripts/adversarial/bridge.mjs [A] [B] [C] [D] [census]     SIZES=phone,desktop
 *
 * `census` lists every place the rule calls a deck (a sample of the street points), with its
 * height over the terrain and coordinates, to look for roofs and viaducts taken for decks.
 *
 * Coordinates: the Lichtenberger Brücke's points are src/lib/vantages.ts; the other bridges
 * are listed with their OpenStreetMap way ids below.
 */
import { open, plan, shot, save, close } from './lib.mjs';

const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);
const SIZES = (process.env.SIZES ?? 'desktop,phone').split(',');
const TOWER = [52.520815, 13.409419];
const EYE = 1.6;

const LICHTENBERGER = {
  'nord-west': [52.5115685, 13.4983761],
  'nord-mitte': [52.5115358, 13.498279],
  'nord-knick': [52.5112931, 13.4975595],
  'sued-west': [52.5112551, 13.4975327],
  'sued-mitte': [52.511101, 13.4991829],
  'sued-ost': [52.5110579, 13.4996359],
};
/**
 * Road bridges, each at the centre OpenStreetMap gives for it (Nominatim, 2026-11-24; the
 * `man_made=bridge` outline or the street way on it, way id in the comment). The four without
 * a comment are the tester's own points, which the page handled at d3732ef.
 */
const BRIDGES = {
  Moltkebruecke: [52.52189, 13.36876], // way 222139121
  'Warschauer Bruecke': [52.50634, 13.4494], // way 335239771
  Boesebruecke: [52.55471, 13.39816], // way 380356103
  'Swinemuender Bruecke': [52.54861, 13.39309], // way 590865980
  Langenscheidtbruecke: [52.48862, 13.36337], // way 686721915
  Elsenbruecke: [52.49584, 13.46319], // way 1017420119
  Modersohnbruecke: [52.50501, 13.45806], // way 1081624523
  Oberbaumbruecke: [52.50173, 13.44573], // way 288514442
  Putlitzbruecke: [52.53464, 13.34351], // way 376269506
  Monumentenbruecke: [52.48795, 13.37196], // way 386592863
  Schillingbruecke: [52.50931, 13.42935], // way 334070717
  Kronprinzenbruecke: [52.52189, 13.37588], // way 194146275
  Jannowitzbruecke: [52.51395, 13.4179],
  Admiralbruecke: [52.49535, 13.4152],
  'Weidendammer Bruecke': [52.52245, 13.388],
  Schlossbruecke: [52.5176, 13.3987],
};
const out = { A: {}, B: {}, C: {}, D: {} };
let failed = 0;
const verdict = (ok, text) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
};

/** Where the eye is against what is drawn under it now. */
const eyeState = (page) =>
  page.evaluate(() => {
    const m = window.__mini;
    const l = m.look;
    const roof = m.roofAt(l.x, l.z);
    const ground = m.groundAt(l.x, l.z);
    const floor = roof === -Infinity ? ground : roof;
    return { x: +l.x.toFixed(1), z: +l.z.toFixed(1), camY: +m.camera.position.y.toFixed(2), ground: +ground.toFixed(2), floor: +floor.toFixed(2), eyeOverFloor: +(m.camera.position.y - floor).toFixed(2), lift: +(l.lift ?? 0).toFixed(2), deck: m.deckAt(l.x, l.z) !== null };
  });

if (want('A')) {
  for (const size of SIZES) {
    const { page, context } = await open({ size, forecast: 'fixed' });
    for (const [id, [lat, lon]] of Object.entries({ ...LICHTENBERGER, Jannowitzbruecke: BRIDGES.Jannowitzbruecke, Schlossbruecke: BRIDGES.Schlossbruecke, Moltkebruecke: BRIDGES.Moltkebruecke })) {
      await plan(page, `date=2026-11-24&time=600&at=${lat},${lon}&look=280,1&lens=50`, { wait: 500 });
      await page.waitForFunction(() => window.__mini.look.active, null, { timeout: 30_000 });
      const early = await eyeState(page);
      await page.waitForTimeout(7000);
      const s = await eyeState(page);
      const want = await page.evaluate(([lat, lon, T]) => window.__mini.sceneFromLatLon(lat, lon, T[0], T[1]), [lat, lon, TOWER]);
      s.moved = +Math.hypot(s.x - want[0], s.z - want[1]).toFixed(1);
      out.A[`${size} ${id}`] = { early, settled: s };
      verdict(Math.abs(s.eyeOverFloor - EYE) <= 0.15 && s.moved < 5, `A ${size} ${id}: eye ${s.eyeOverFloor} m over the deck (early ${early.eyeOverFloor}), moved ${s.moved} m`);
      if (id === 'sued-mitte') await shot(page, `bridge-A-${size}-sued-mitte`);
    }
    await context.close();
  }
}

if (want('B')) {
  for (const size of SIZES) {
    for (const id of ['nord-mitte', 'sued-mitte']) {
      const [lat, lon] = LICHTENBERGER[id];
      const { page, context } = await open({ size, forecast: 'fixed', geolocation: { latitude: lat, longitude: lon, accuracy: 8 } });
      await plan(page, 'date=2026-11-24&time=600');
      await page.click('#locate');
      await page.waitForFunction(() => window.__mini.look.active, null, { timeout: 30_000 });
      await page.waitForTimeout(5000);
      if ((await page.evaluate(() => document.body.dataset.more)) !== 'open') await page.click('#ticket-more');
      await page.waitForTimeout(500);
      await page.click('#dates-toggle');
      // "From here" (fromHereView.js): the list says `searching` until the year is in, then
      // `ready`, `empty` or `failed`; its dates are shot cards, each with the shot's sentence.
      // (This read the earlier list: an h3 per landmark and lines starting with a weekday.)
      await page.waitForFunction(() => ['ready', 'empty', 'failed'].includes(document.getElementById('dates').dataset.state), null, { timeout: 300_000 });
      await page.waitForTimeout(2000);
      const text = await page.$eval('#dates', (e) => e.innerText);
      const titles = await page.$$eval('#dates .shotcard--row', (cards) => cards.map((card) => `${card.dataset.when ?? ''} | ${card.querySelector('.sc-title')?.textContent ?? ''} | ${card.getAttribute('aria-label') ?? ''}`));
      const towerRows = titles.filter((title) => /TV tower/.test(title));
      const tower = towerRows.join('\n');
      const rows = towerRows.length;
      const sphere = towerRows.filter((title) => /sphere/i.test(title)).length;
      const hidden = Number(/(\d+) more hidden/.exec(text)?.[1] ?? /All (\d+) dates are hidden/.exec(text)?.[1] ?? 0);
      // What stands in the way of a low look at the tower from here: the first thing a ray at
      // 2 degrees meets, as a distance and a place, to look up on a map.
      const block = await page.evaluate(([lat0, lon0]) => {
        const m = window.__mini;
        const l = m.look;
        const flat = Math.hypot(l.x, l.z);
        const az = Math.atan2(-l.x, l.z);
        const e = (2 * Math.PI) / 180;
        const dir = m.camera.position.clone().set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
        if (m.clearView(l.x, l.z, dir, flat - 40, l.lift ?? 0)) return null;
        const b = m.lastBlock;
        return { metres: Math.round(b.distance), at: [+(lat0 + (b.distance * Math.cos(az)) / 111_320).toFixed(5), +(lon0 + (b.distance * Math.sin(az)) / (111_320 * Math.cos((lat0 * Math.PI) / 180))).toFixed(5)], roofOverGround: +(m.roofAt(b.point.x, b.point.z) - m.groundAt(b.point.x, b.point.z)).toFixed(1) };
      }, [lat, lon]);
      out.B[`${size} ${id}`] = { rows, sphere, hidden, blockAt2Degrees: block, text: tower.slice(0, 1500) };
      save(`bridge-B-${size}-${id}.txt`, text);
      await shot(page, `bridge-B-${size}-${id}`);
      // /classic's panel 05 has the sphere's dates here (28 Dec, 21 Feb, 7 to 9 Apr). They must
      // be listed, or counted as hidden with the building that hides them named.
      const ok = sphere >= 3 || (hidden >= 3 && block !== null);
      verdict(ok, `B ${size} ${id}: ${rows} tower rows, ${sphere} at the sphere, ${hidden} more hidden${block ? `; a look at 2\u00b0 is blocked ${block.metres} m on, at ${block.at.join(',')}, by something ${block.roofOverGround} m high` : '; a look at 2\u00b0 is clear'}`);
      await context.close();
    }
  }
}

if (want('C')) {
  const { page, context } = await open({ size: 'desktop', forecast: 'fixed' });
  await plan(page, 'date=2026-11-24&time=600');
  for (const [name, [lat, lon]] of Object.entries(BRIDGES)) {
    const r = await page.evaluate(([lat, lon, T]) => {
      const m = window.__mini;
      const [x, z] = m.sceneFromLatLon(lat, lon, T[0], T[1]);
      return [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]].map(([dx, dz]) => {
        const px = x + dx, pz = z + dz;
        const roof = m.roofAt(px, pz);
        const s = m.standable(px, pz);
        return { above: roof === -Infinity ? null : +(roof - m.groundAt(px, pz)).toFixed(1), deck: m.deckAt(px, pz) !== null, moved: Math.round(Math.hypot(s.x - px, s.z - pz)) };
      });
    }, [lat, lon, TOWER]);
    out.C[name] = r;
    const worst = Math.max(...r.map((p) => p.moved));
    const noDeck = r.every((p) => p.above === null);
    // The decision for these two: not stood on, and said (check D). Moving is then expected.
    const listed = ['Boesebruecke', 'Swinemuender Bruecke'].includes(name);
    verdict(listed ? r.every((p) => !p.deck) : worst < 5, `C ${name}${listed ? ' (listed as not in the model: no deck expected)' : ''}: moved up to ${worst} m (${r.map((p) => `${p.above ?? 'open'}${p.deck ? ' deck' : ''}`).join(', ')})${noDeck ? ' — no deck in the model: one stands on the terrain under the bridge' : ''}`);
  }
  await context.close();
}
// D: the bridges the model does not have say so, and the railway viaducts are not stood on.
if (want('D')) {
  const { page, context } = await open({ size: 'phone', forecast: 'fixed' });
  for (const name of ['Boesebruecke', 'Swinemuender Bruecke', 'Langenscheidtbruecke', 'Elsenbruecke', 'Oberbaumbruecke', 'Moltkebruecke']) {
    const [lat, lon] = BRIDGES[name];
    await plan(page, `date=2026-11-24&time=600&at=${lat},${lon}&look=280,1&lens=50`, { wait: 1500 });
    const toast = await page.evaluate(() => (document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText));
    out.D[name] = toast;
    const said = /not in the model yet/.test(toast);
    // Either one stands on its deck after all (the Swinemünder Brücke's middle is recognised
    // at some detail levels), or the page says the bridge is not in the model.
    const onDeck = await page.evaluate(() => window.__mini.deckAt(window.__mini.look.x, window.__mini.look.z) !== null);
    verdict(name === 'Moltkebruecke' ? onDeck && !said : said && !onDeck, `D ${name}: ${onDeck ? 'stands on a deck' : 'not on a deck'}, ${toast ? `says "${toast.slice(0, 60)}\u2026"` : 'says nothing'}`);
    if (name === 'Boesebruecke') await shot(page, 'bridge-D-boese');
  }
  await plan(page, 'date=2026-11-24&time=600');
  for (const [lat, lon] of [[52.50465, 13.32633], [52.50509, 13.32914]]) {
    const deck = await page.evaluate(([lat, lon, T]) => { const m = window.__mini; const [x, z] = m.sceneFromLatLon(lat, lon, T[0], T[1]); return [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]].some(([dx, dz]) => m.deckAt(x + dx, z + dz) !== null); }, [lat, lon, TOWER]);
    verdict(!deck, `D rail viaduct at ${lat},${lon}: ${deck ? 'still a deck' : 'not a deck'}`);
  }
  await context.close();
}

// Not run unless asked for (it takes minutes): every place the rule calls a deck, for a look
// by hand at the ones high over the terrain. A false positive is a roof or a viaduct here.
if (only.includes('census')) {
  const { page, context } = await open({ size: 'desktop', forecast: 'fixed' });
  await plan(page, 'date=2026-11-24&time=600');
  const found = await page.evaluate(async () => {
    const m = window.__mini;
    const r = new Int16Array(await (await fetch('/city/roads.bin')).arrayBuffer());
    const t0 = performance.now();
    const decks = [];
    let built = 0;
    for (let i = 0; i < r.length / 2; i += 23) {
      if (performance.now() - t0 > 400_000) break;
      const x = r[2 * i] / 2, z = r[2 * i + 1] / 2;
      if (m.roofAt(x, z) === -Infinity) continue;
      built++;
      const d = m.deckAt(x, z);
      if (d !== null) decks.push([x, z, +(d - m.groundAt(x, z)).toFixed(1)]);
    }
    return { built, decks, seconds: Math.round((performance.now() - t0) / 1000) };
  });
  const clusters = [];
  for (const [x, z, h] of found.decks) {
    let c = clusters.find((k) => Math.hypot(k.x - x, k.z - z) < 150);
    if (!c) clusters.push((c = { x, z, n: 0, min: 99, max: 0 }));
    c.n++;
    c.min = Math.min(c.min, h);
    c.max = Math.max(c.max, h);
  }
  for (const c of clusters) c.at = [+(TOWER[0] - c.z / 111_320).toFixed(5), +(TOWER[1] + c.x / (111_320 * Math.cos((TOWER[0] * Math.PI) / 180))).toFixed(5)];
  clusters.sort((p, q) => q.max - p.max);
  out.census = { sampledBuilt: found.built, decks: found.decks.length, seconds: found.seconds, clusters };
  console.log(`census: ${found.built} street points under or on something built, ${found.decks.length} on a deck, ${clusters.length} places, ${found.seconds} s`);
  for (const c of clusters) console.log(`  ${c.at.join(',')}  ${c.n} points, ${c.min}-${c.max} m over the terrain`);
  await context.close();
}
save('bridge.json', out);
console.log(failed ? `${failed} FAILED` : 'all passed');
await close();
process.exit(failed ? 1 : 0);
