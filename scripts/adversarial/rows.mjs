/**
 * Every row of the day list, opened: does a tap on it arrive at eye level, and is the body
 * then where the row says (behind the sphere, the antenna, the figure, down the street)?
 * The rule it checks: a row that cannot be opened onto its shot is not listed.
 *
 *   node scripts/adversarial/rows.mjs                       # 365 days from today
 *   node scripts/adversarial/rows.mjs --from=2026-11-24 --days=365 --kinds=antenna,sphere,landmark,street
 *   node scripts/adversarial/rows.mjs --from=2026-12-20 --days=1 --verbose
 *   node scripts/adversarial/rows.mjs --kinds=antenna,sphere --mask=public/viewshed/fernsehturm-scene.json
 *
 * With `--mask` the places of the tower rows that fail are added to the viewshed's scene mask,
 * so the pipeline stops offering them: build again and sweep again until none fails.
 * With `--trees=public/viewshed/trees-in-the-way.json` the spots of rows whose frame the tree
 * register's trees stand in are added to that list: the pipeline then prefers another spot of
 * the same pass, or says "street trees in the way". Exit 2 means places were added: build and
 * sweep again. `--before` runs the check as it was (one centre ray), to compare distributions.
 * Each run prints, by kind, how much of the disc and the target is hidden where a row opens:
 * by buildings and by trees.
 *
 * It drives `/plan/` itself: sets the day, takes the day's rows (`__mini.dayRows()`), calls each
 * row's own `go` (what a tap and a `shot=` link call), and asks `__mini.rowSeen(row)`
 * (src/miniature/rowCheck.js) what stands there. Writes rows.json to OUT and exits 1 when any
 * row fails. A year is about 7,000 rows; streets are the bulk and the least at risk, so
 * `--kinds=antenna,sphere,landmark` is the quick run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { open, plan, save, close } from './lib.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const from = arg('from', new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }));
const days = Number(arg('days', 365));
// `--step=3` takes every third day: a sample of the year, for a quicker look.
const step = Number(arg('step', 1));
const kinds = arg('kinds', 'antenna,sphere,landmark,street').split(',');
const verbose = process.argv.includes('--verbose');
const maskFile = arg('mask', '');
const treeFile = arg('trees', '');
const before = process.argv.includes('--before');
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const { page, log } = await open({ size: 'desktop', forecast: 'fixed' });
// `--before`: the check as it was (one ray to the disc's centre, no tree preference), to compare.
await plan(page, `date=${from}&time=720${before ? '&shotcheck=centre' : ''}`, { wait: 3000 });
// The trees load with the city; the tree measure needs them.
await page.waitForFunction(() => window.__mini.treeShareAt({ body: 'sun', kind: 'street', t: Date.now() }, [52.52, 13.4]) !== null, null, { timeout: 120_000 }).catch(() => console.log('trees not loaded: no tree measure'));
// The viewsheds decide which rows there are: wait for the three of them.
await page.waitForFunction(() => window.__mini.dayRows().some((row) => row.kind === 'tower') || true, null, { timeout: 30_000 });
await page.waitForTimeout(4000);

const result = { from, days, kinds, counts: {}, failures: [], treeRows: [], treeOthers: [] };
/** Up to one ray in five may be hidden (shotVisibility.js). */
const MAY_HIDE = 0.2;
const started = Date.now();
for (let i = 0; i < days; i += step) {
  const date = addDays(from, i);
  const day = await page.evaluate(
    async ([date, kinds]) => {
      const m = window.__mini;
      const input = document.querySelector('#date');
      input.value = date;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const kindOf = (row) => (row.kind === 'street' ? 'street' : row.target ? 'landmark' : (row.where ?? 'sphere'));
      // Whether buildings hide more than one ray in five of the shot where it opened.
      const share0 = (s) => {
        return s.centre || Math.max(s.disc.buildings, s.target.buildings) > 0.2 + 1e-9;
      };
      const out = [];
      for (const row of m.dayRows()) {
        const kind = kindOf(row);
        if (!kinds.includes(kind)) continue;
        // `go` says whether it arrived: the view flies there afterwards, which the sweep does
        // not wait for. Where one stands (`look`) is set at once.
        const toastBox = document.querySelector('#toast');
        toastBox.hidden = true;
        let error = '';
        let opened = false;
        try {
          opened = (await row.go()) === true;
        } catch (e) {
          error = String(e);
        }
        const seen = opened ? m.rowSeen(row) : null;
        const toast = toastBox.hidden === false ? toastBox.textContent : '';
        // The places the row offered, for the mask (`--mask`): all of them when none opened,
        // the one stood on when the body is not where the row says.
        let spots = [];
        const shareNow = opened ? m.shotShare(row) : null;
        const hidden = opened && share0(shareNow);
        const far = (p) => {
          const [x, z] = m.sceneFromLatLon(p[0], p[1], 52.520815, 13.409419);
          return Math.hypot(x - m.look.x, z - m.look.z);
        };
        // A row's words are its own spot's (distance, trees): when the planner had to open it
        // at another of its spots, its own is one the scene refuses, and goes to the mask too.
        const elsewhere = opened && row.kind !== 'street' && row.at && far(row.at) > 8;
        if (!row.target && row.kind !== 'street' && (!(opened && seen?.ok) || hidden)) {
          const offered = [row.at, ...(row.alternates ?? []).map((a) => a.at), ...(row.standOthers ?? [])];
          spots = opened ? [offered.reduce((a, b) => (far(b) < far(a) ? b : a))] : offered;
        }
        if (elsewhere && !row.target) spots = [...spots, row.at];
        // How much of the shot is seen from where it opened: the disc and the target, hidden by
        // buildings and by the tree register's trees (src/miniature/shotVisibility.js). And the
        // trees from the row's own spot, which is what the row's words are about.
        const share = shareNow;
        const treesHere = row.at ? m.treeShareAt(row, row.at) : null;
        // And from each of the row's other spots: the pipeline will stand the row on the first
        // the list leaves clear, so the list has to know them all at once.
        const blocked = (share) => share !== null && Math.max(share.disc, share.target) > 0.2 + 1e-9;
        const treeSpots = row.kind === 'street' ? [] : [...(row.alternates ?? []).map((a) => ({ at: a.at, t: a.t })), ...(row.standOthers ?? []).map((at) => ({ at, t: row.openAt }))].filter((c) => blocked(m.treeShareAt({ ...row, openAt: c.t, t: c.t }, c.at))).map((c) => c.at);
        out.push({ kind, t: row.t, title: row.title, detail: row.detail, opened, seen, toast, error, spots, share, treesHere, treeSpots, elsewhere, at: row.at, treesSaid: row.trees === true, score: row.score });
      }
      return out;
    },
    [date, kinds],
  );
  for (const row of day) {
    const count = (result.counts[row.kind] ??= { rows: 0, opened: 0, right: 0, built: [0, 0, 0, 0], trees: [0, 0, 0, 0], treesSaid: 0 });
    count.rows++;
    if (row.opened) count.opened++;
    if (row.seen?.ok) count.right++;
    // The distribution: none hidden, up to one ray in five, up to half, more.
    const bucket = (v) => (v <= 1e-9 ? 0 : v <= MAY_HIDE + 1e-9 ? 1 : v <= 0.5 ? 2 : 3);
    const built = row.share ? Math.max(row.share.disc.buildings, row.share.target.buildings) : null;
    const trees = row.share && row.share.disc.trees !== null ? Math.max(row.share.disc.trees, row.share.target.trees) : null;
    if (built !== null) count.built[bucket(built)]++;
    if (trees !== null) count.trees[bucket(trees)]++;
    if (row.treesSaid) count.treesSaid++;
    row.builtHidden = built !== null && (built > MAY_HIDE + 1e-9 || row.share.centre);
    // Trees from the row's own spot, for the list of places with trees in the way (`--trees`).
    row.treesAtRow = row.treesHere ? Math.max(row.treesHere.disc, row.treesHere.target) > MAY_HIDE + 1e-9 : false;
    if (!row.opened || !row.seen?.ok || row.builtHidden || (row.elsewhere && row.kind !== 'landmark')) result.failures.push({ date, ...row });
    if (row.elsewhere) count.elsewhere = (count.elsewhere ?? 0) + 1;
    if (row.treesAtRow && row.kind !== 'street') result.treeRows.push({ date, kind: row.kind, title: row.title, at: row.at, said: row.treesSaid });
    for (const at of row.treeSpots ?? []) result.treeOthers.push(at);
    if (verbose) console.log(date, row.kind, row.opened ? 'opened' : 'NOT OPENED', row.seen ? `${row.seen.says} -> ${row.seen.sees}` : '', row.title, '|', row.detail, row.toast ? `| said: ${row.toast}` : '', row.error);
  }
  if ((i + 1) % 20 === 0 || i === days - 1) console.log(`${date}: ${i + 1}/${days} days, ${Math.round((Date.now() - started) / 1000)} s`, JSON.stringify(result.counts), 'failures', result.failures.length);
}
// What the scene refused, added to the viewshed's mask (src/lib/viewshed.ts `applySceneMask`).
if (maskFile) {
  const had = existsSync(maskFile) ? JSON.parse(readFileSync(maskFile, 'utf8')) : { spots: [] };
  const seen = new Set(had.spots.map((p) => p.join(',')));
  let added = 0;
  for (const f of result.failures) {
    for (const p of f.spots ?? []) {
      const spot = [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))];
      if (seen.has(spot.join(','))) continue;
      seen.add(spot.join(','));
      had.spots.push(spot);
      added++;
    }
  }
  writeFileSync(maskFile, `${JSON.stringify({ note: 'Places the viewshed calls visible from which the planner\u2019s scene, in full detail, does not show the row\u2019s shot. Measured by scripts/adversarial/rows.mjs --mask; applied by src/lib/viewshed.ts applySceneMask.', spots: had.spots })}\n`);
  console.log(`mask: ${added} places added, ${had.spots.length} in all, in ${maskFile}`);
}
// Places from which the register's trees stand in a row's frame (src/lib/viewshed.ts `treeTest`).
let treesAdded = 0;
if (treeFile) {
  const had = existsSync(treeFile) ? JSON.parse(readFileSync(treeFile, 'utf8')) : { spots: [] };
  const seen = new Set(had.spots.map((p) => p.join(',')));
  for (const at of [...result.treeRows.filter((row) => !row.said).map((row) => row.at), ...result.treeOthers]) {
    const spot = [Number(at[0].toFixed(6)), Number(at[1].toFixed(6))];
    if (seen.has(spot.join(','))) continue;
    seen.add(spot.join(','));
    had.spots.push(spot);
    treesAdded++;
  }
  writeFileSync(treeFile, `${JSON.stringify({ note: 'Places from which the tree register\u2019s trees hide more than two ninths of a listed shot\u2019s disc or target, in full leaf. Measured in the planner\u2019s scene by scripts/adversarial/rows.mjs --trees; asked through src/lib/viewshed.ts treeTest.', spots: had.spots })}\n`);
  console.log(`trees: ${treesAdded} places added, ${had.spots.length} in all, in ${treeFile}`);
}
result.errors = log.filter((l) => l.type === 'pageerror').map((l) => l.text);
save('rows.json', result);
for (const f of result.failures) console.log('FAIL', f.date, f.kind, f.opened && f.seen?.ok && !f.builtHidden ? 'opened at another of its spots, not its own' : f.opened && f.seen?.ok ? `opened, but buildings hide ${Math.round(100 * Math.max(f.share.disc.buildings, f.share.target.buildings))}% of the disc or the target` : f.opened ? `opened, but ${f.seen.says} -> ${f.seen.sees}` : `did not open${f.toast ? ` (said: ${f.toast})` : ' (said nothing)'}`, '|', f.title, '|', f.detail);
console.log(JSON.stringify(result.counts), 'failures', result.failures.length, 'page errors', result.errors.length);
await close();
console.log('hidden share of the shot where it opens, by kind: [none, up to 1/5, up to 1/2, more]');
for (const [kind, c] of Object.entries(result.counts)) console.log(`  ${kind.padEnd(9)} buildings ${JSON.stringify(c.built)}  trees ${JSON.stringify(c.trees)}  rows that say trees are in the way: ${c.treesSaid}`);
console.log(`rows with trees in the way from their own spot: ${result.treeRows.length}, of which ${result.treeRows.filter((r) => r.said).length} say so`);
// 1: a row fails; 2: none fails, but a row has trees in the way from its spot and does not say so
// (its places are in the list now: build and sweep again).
const unsaid = result.treeRows.filter((row) => !row.said).length;
process.exit(result.failures.length ? 1 : unsaid ? 2 : 0);
