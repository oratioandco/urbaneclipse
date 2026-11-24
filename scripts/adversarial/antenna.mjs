/**
 * Is a listed antenna row a shot one can see? For each day, every "behind the TV tower's
 * antenna" row of /plan/'s day list is opened as a tap would, and where it puts you is
 * measured: the moon's altitude at the clock's minute against the antenna's span as seen from
 * the eye (the sphere's top at 229 m to the tip at 368 m), and whether the look at the moon
 * reaches the tower with nothing built in between. PASS when the moon is on the antenna and
 * the view is clear. Writes antenna.json and antenna-<date>-<n>.png.
 *
 *   node scripts/adversarial/antenna.mjs [yyyy-mm-dd ...]
 */
import { open, plan, shot, save, close } from './lib.mjs';

const DATES = process.argv.slice(2).length ? process.argv.slice(2) : ['2026-12-24', '2027-02-20', '2027-03-28', '2027-09-09', '2027-09-10', '2027-09-11'];
const out = {};
let failed = 0;
for (const date of DATES) {
  const { page, context } = await open({ size: 'desktop', forecast: 'fixed' });
  await plan(page, `date=${date}`);
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForTimeout(3000);
  const rows = await page.evaluate(() => window.__mini.dayRows().map((r, i) => ({ i, where: r.where, title: r.title, detail: r.detail, t: r.t, stand: r.stand })).filter((r) => r.where === 'antenna'));
  out[date] = [];
  if (!rows.length) console.log(`      ${date}: no antenna row listed`);
  for (const [n, row] of rows.entries()) {
    await page.evaluate((i) => {
      const r = window.__mini.dayRows()[i];
      document.querySelectorAll('#daylist .shotcard')[i].click();
      return r.title;
    }, row.i);
    const arrived = await page.waitForFunction(() => document.body.dataset.eye === 'true' && window.__mini.look.active, null, { timeout: 60_000 }).then(() => true, () => false);
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => {
      const m = window.__mini;
      const l = m.look;
      const eyeY = m.camera.position.y;
      const flat = Math.hypot(l.x, l.z);
      const base = m.groundAt(0, 0);
      const up = (agl) => (Math.atan2(base + agl - eyeY, flat) * 180) / Math.PI;
      const moon = m.bodies?.().find((b) => b.moon) ?? null;
      return { eye: document.body.dataset.eye, km: +(flat / 1000).toFixed(2), sphereTop: +up(229).toFixed(2), tip: +up(368).toFixed(2), clock: document.getElementById('clock').value, ticket: document.getElementById('ticket-shot').innerText.replace(/\n/g, ' / '), status: document.getElementById('eclipse').innerText, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText, moonAlt: moon ? +moon.alt.toFixed(2) : null, moonAz: moon ? +moon.az.toFixed(2) : null, towerAz: +((Math.atan2(-l.x, l.z) * 180) / Math.PI + 360).toFixed(2) % 360, clear: moon ? m.clearView(l.x, l.z, m.camera.position.clone().set(Math.sin((moon.az * Math.PI) / 180) * Math.cos((moon.alt * Math.PI) / 180), Math.sin((moon.alt * Math.PI) / 180), -Math.cos((moon.az * Math.PI) / 180) * Math.cos((moon.alt * Math.PI) / 180)), flat - 40, l.lift ?? 0) : null };
    });
    const onAntenna = arrived && s.moonAlt !== null && s.moonAlt >= s.sphereTop - 0.15 && s.moonAlt <= s.tip + 0.15;
    const ok = onAntenna && s.clear === true && /antenna/i.test(s.status);
    if (!ok) failed++;
    out[date].push({ row, opened: s, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${date} ${row.title} (${row.stand}): ${arrived ? `stands ${s.km} km out at ${s.clock}; moon ${s.moonAlt}°, antenna ${s.sphereTop}° to ${s.tip}°; view ${s.clear ? 'clear' : 'blocked'}; says "${s.status}"` : `did not arrive: "${s.toast}"`}`);
    await shot(page, `antenna-${date}-${n}`);
    await page.click('#back');
    await page.waitForFunction(() => document.body.dataset.eye === 'false', null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  await context.close();
}
save('antenna.json', out);
console.log(failed ? `${failed} FAILED` : 'all passed');
await close();
process.exit(failed ? 1 : 0);
