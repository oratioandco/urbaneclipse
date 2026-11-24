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
 *   node scripts/adversarial/bridge.mjs [A] [B] [C]     SIZES=phone,desktop
 *
 * Coordinates: the Lichtenberger Brücke's points are src/lib/vantages.ts; the other bridges
 * are OSM way midpoints (Overpass, 2026-11-24), listed with their way ids below.
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
/** Mid-span points on road bridges, from the tester's list (retest of d3732ef). */
const BRIDGES = {
  Modersohnbruecke: [52.50468, 13.46265],
  Moltkebruecke: [52.5219, 13.36895],
  'Warschauer Bruecke': [52.5064, 13.4493],
  Elsenbruecke: [52.49905, 13.4619],
  Jannowitzbruecke: [52.51395, 13.4179],
  Schillingbruecke: [52.50985, 13.4279],
  Boesebruecke: [52.5548, 13.3979],
  'Swinemuender Bruecke': [52.54965, 13.3929],
  Putlitzbruecke: [52.537, 13.3439],
  Admiralbruecke: [52.49535, 13.4152],
  'Weidendammer Bruecke': [52.52245, 13.388],
  Schlossbruecke: [52.5176, 13.3987],
  Kronprinzenbruecke: [52.52215, 13.3756],
  Monumentenbruecke: [52.4884, 13.3718],
  Oberbaumbruecke: [52.50195, 13.44575],
  'Kynastbruecke Ostkreuz': [52.5027, 13.47005],
  Langenscheidtbruecke: [52.4902, 13.3642],
};
const out = { A: {}, B: {}, C: {} };
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
      await page.waitForFunction(() => document.querySelector('#dates h3') && !document.getElementById('dates').innerText.includes('Searching'), null, { timeout: 300_000 });
      await page.waitForTimeout(2000);
      const text = await page.$eval('#dates', (e) => e.innerText);
      const tower = text.split(/BEHIND THE /i)[1] ?? '';
      const rows = (tower.match(/\d{4} · /g) ?? []).length;
      const sphere = (tower.match(/behind the sphere|ring of|at the edge|sphere in front/gi) ?? []).length;
      out.B[`${size} ${id}`] = { rows, sphere, hidden: /(\d+) more hidden/.exec(tower)?.[1] ?? null, text: tower.slice(0, 1500) };
      save(`bridge-B-${size}-${id}.txt`, text);
      await shot(page, `bridge-B-${size}-${id}`);
      verdict(rows >= 10 && sphere >= 3, `B ${size} ${id}: ${rows} tower rows, ${sphere} at the sphere${out.B[`${size} ${id}`].hidden ? `, ${out.B[`${size} ${id}`].hidden} more hidden` : ''}`);
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
    verdict(worst < 5, `C ${name}: moved up to ${worst} m (${r.map((p) => `${p.above ?? 'open'}${p.deck ? ' deck' : ''}`).join(', ')})`);
  }
  await context.close();
}
save('bridge.json', out);
console.log(failed ? `${failed} FAILED` : 'all passed');
await close();
process.exit(failed ? 1 : 0);
