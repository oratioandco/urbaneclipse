/**
 * The two clock-change days in the day view ("This day") of /plan/: a shot picked from the
 * strip of cards above the timeline, the Shot buttons, and the thumb set by hand. For each it
 * writes down the card's time, what the clock then reads, the readout's line, and where the
 * scene's sun stands (from the light's direction), so the page can be compared with itself.
 * Writes dst.json and dst-<date>-<step>.png.
 */
import { open, plan, shot, save, close } from './lib.mjs';

// Each: the day, and the time on a card to pick (as the card prints it).
const CASES = [
  { date: '2027-03-28', cards: ['7:22 AM', '7:07 PM'], set: [442, 1147] },
  { date: '2027-10-31', cards: ['7:17 AM', '4:15 PM'], set: [437, 975] },
  { date: '2027-06-21', cards: ['6:38 AM'], set: [398] }, // a plain day, as the control
];
const { page } = await open({ size: 'desktop', forecast: 'fixed' });
const state = () =>
  page.evaluate(() => {
    const m = window.__mini;
    const d = m.sun.position.clone().sub(m.sun.target.position).normalize();
    const current = document.querySelector('#shots-row .shotcard[aria-current]');
    return {
      clock: document.getElementById('clock').value,
      slider: Number(document.getElementById('time').value),
      label: document.getElementById('tl-label').innerText,
      readout: document.getElementById('dv-readout').innerText,
      valuetext: document.getElementById('time').getAttribute('aria-valuetext'),
      currentCard: current ? `${current.querySelector('.sc-time').innerText} ${current.querySelector('.sc-title').innerText}` : null,
      sceneLightAltDeg: Math.round((Math.asin(d.y) * 180) / Math.PI * 10) / 10,
      sceneLightAzDeg: Math.round((((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360) * 10) / 10,
      url: location.search,
    };
  });
const out = [];
for (const { date, cards, set } of CASES) {
  await plan(page, `date=${date}`);
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForFunction(() => document.querySelectorAll('#shots-row .shotcard').length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  for (const [i, time] of cards.entries()) {
    const card = page.locator('#shots-row .shotcard', { has: page.locator('.sc-time', { hasText: new RegExp(`^${time}$`) }) }).first();
    const detail = await card.locator('.sc-detail').innerText();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForTimeout(2500);
    const afterCard = await state();
    await shot(page, `dst-${date}-card-${time.replace(/[: ]/g, '')}`);
    // The same minute, set by hand on the slider (wall-clock minutes, as the address holds them).
    await page.$eval('#time', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, set[i]);
    await page.waitForTimeout(1500);
    const afterSet = await state();
    out.push({ date, card: time, detail, afterCard, setTo: set[i], afterSet });
    console.log(date, 'card', time, '->', afterCard.clock, '| light alt', afterCard.sceneLightAltDeg, '| readout:', afterCard.readout.replace(/\n/g, ' '), '|| slider', set[i], '->', afterSet.clock, 'light alt', afterSet.sceneLightAltDeg, '| current card:', afterSet.currentCard, '| readout:', afterSet.readout.replace(/\n/g, ' '));
  }
  // The Shot buttons step through the same list.
  await page.$eval('#time', (el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const steps = [];
  for (let k = 0; k < 4; k++) {
    await page.click('#dv-later');
    await page.waitForTimeout(1800);
    const s = await state();
    steps.push({ clock: s.clock, currentCard: s.currentCard });
  }
  console.log(date, 'Shot > steps:', steps.map((s) => `${s.clock} on card ${s.currentCard}`).join(' | '));
  out.push({ date, shotSteps: steps });
}
save('dst.json', out);
await close();
