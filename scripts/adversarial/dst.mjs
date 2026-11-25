/**
 * The two clock-change days in the day view ("This day") of /plan/: a shot picked from the
 * strip of cards above the timeline, the Shot buttons, and the thumb set by hand. For each it
 * writes down the card's time, what the clock then reads, the readout's line, and where the
 * scene's sun stands (from the light's direction), so the page can be compared with itself.
 * Writes dst.json and dst-<date>-<step>.png.
 */
import { open, plan, shot, save, close } from './lib.mjs';

// The days: the two clock changes and a plain day as the control. The cards are read off the
// page (the first of the morning and the last of the evening), not written here: a card's
// minute moves when the pipeline does, and what is tested is that clock, slider and card agree.
const CASES = ['2027-03-28', '2027-10-31', '2027-06-21'];
/** "7:12 PM" as wall-clock minutes. */
const minutesOf = (text) => {
  const [, h, m, half] = text.match(/^(\d+):(\d+) ([AP]M)$/);
  return (Number(h) % 12) * 60 + Number(m) + (half === 'PM' ? 720 : 0);
};
let mismatches = 0;
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
for (const date of CASES) {
  await plan(page, `date=${date}`);
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForFunction(() => document.querySelectorAll('#shots-row .shotcard').length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const times = await page.$$eval('#shots-row .shotcard .sc-time', (els) => els.map((el) => el.innerText.trim()));
  const cards = [...new Set([times[0], times[times.length - 1]])];
  const set = cards.map(minutesOf);
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
    // The card's minute is the clock's and the slider's; set by hand, the same card is current.
    const agree = afterCard.clock.replace(/:\d\d (?=[AP]M)/, ' ').startsWith(time.replace(' ', ':').slice(0, time.indexOf(' '))) && afterCard.clock.endsWith(time.slice(-2)) && Math.floor(afterCard.slider) === set[i] && (afterSet.currentCard ?? '').startsWith(time);
    if (!agree) {
      mismatches++;
      console.log('MISMATCH', date, 'card', time, 'clock', afterCard.clock, 'slider', afterCard.slider, 'wanted', set[i], 'current after setting by hand:', afterSet.currentCard);
    }
    out.push({ date, card: time, detail, afterCard, setTo: set[i], afterSet, agree });
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
console.log(mismatches ? `${mismatches} card(s) whose clock, slider and card disagree` : 'clock, slider and card agree on every card tried');
process.exit(mismatches ? 1 : 0);
