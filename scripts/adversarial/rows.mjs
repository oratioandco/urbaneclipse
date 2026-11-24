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
const kinds = arg('kinds', 'antenna,sphere,landmark,street').split(',');
const verbose = process.argv.includes('--verbose');
const maskFile = arg('mask', '');
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const { page, log } = await open({ size: 'desktop', forecast: 'fixed' });
await plan(page, `date=${from}&time=720`, { wait: 3000 });
// The viewsheds decide which rows there are: wait for the three of them.
await page.waitForFunction(() => window.__mini.dayRows().some((row) => row.kind === 'tower') || true, null, { timeout: 30_000 });
await page.waitForTimeout(4000);

const result = { from, days, kinds, counts: {}, failures: [] };
const started = Date.now();
for (let i = 0; i < days; i++) {
  const date = addDays(from, i);
  const day = await page.evaluate(
    async ([date, kinds]) => {
      const m = window.__mini;
      const input = document.querySelector('#date');
      input.value = date;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      const kindOf = (row) => (row.kind === 'street' ? 'street' : row.target ? 'landmark' : (row.where ?? 'sphere'));
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
        if (!row.target && row.kind !== 'street' && !(opened && seen?.ok)) {
          const offered = [row.at, ...(row.alternates ?? []).map((a) => a.at), ...(row.standOthers ?? [])];
          const far = (p) => {
            const [x, z] = m.sceneFromLatLon(p[0], p[1], 52.520815, 13.409419);
            return Math.hypot(x - m.look.x, z - m.look.z);
          };
          spots = opened ? [offered.reduce((a, b) => (far(b) < far(a) ? b : a))] : offered;
        }
        out.push({ kind, t: row.t, title: row.title, detail: row.detail, opened, seen, toast, error, spots });
      }
      return out;
    },
    [date, kinds],
  );
  for (const row of day) {
    const count = (result.counts[row.kind] ??= { rows: 0, opened: 0, right: 0 });
    count.rows++;
    if (row.opened) count.opened++;
    if (row.seen?.ok) count.right++;
    if (!row.opened || !row.seen?.ok) result.failures.push({ date, ...row });
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
result.errors = log.filter((l) => l.type === 'pageerror').map((l) => l.text);
save('rows.json', result);
for (const f of result.failures) console.log('FAIL', f.date, f.kind, f.opened ? `opened, but ${f.seen.says} -> ${f.seen.sees}` : `did not open${f.toast ? ` (said: ${f.toast})` : ' (said nothing)'}`, '|', f.title, '|', f.detail);
console.log(JSON.stringify(result.counts), 'failures', result.failures.length, 'page errors', result.errors.length);
await close();
process.exit(result.failures.length ? 1 : 0);
