/**
 * Dan's three points, each as close-up renders at three times the size:
 *   1. event marks: the day view's timeline on a day where a tower alignment and a street henge
 *      fall in the same minute, the three-day strips, and the legend;
 *   2. the direction arrow beside the "Sun N° up" pill, by day and by night, on the map and at
 *      eye level;
 *   3. the drone button, and the tooltip of every toolbar button (hovered with a mouse, focused
 *      with the keyboard, and what a touch screen gets).
 * Writes dan-*.png and dan.json to OUT.
 */
import { open, plan, shot, save, close, SIZES } from './lib.mjs';

SIZES.closeup = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 };
SIZES.phone3 = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const out = {};
const clipOf = async (page, selector, pad = 6) => {
  const b = await page.locator(selector).first().boundingBox();
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad };
};

// 1. Marks. 31 October 2027 has a henge and a tower alignment both at 7:17.
for (const size of ['closeup', 'phone3']) {
  const { context, page } = await open({ size, forecast: 'fixed' });
  await plan(page, 'date=2027-10-31&time=600');
  await page.click('.tabs [data-mode="shoot"]');
  await page.waitForFunction(() => document.querySelectorAll('#shots-row .shotcard').length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, `dan-1-marks-timeline-${size}`, { clip: await clipOf(page, '#timeline', 10) });
  out[`marks-${size}`] = await page.$$eval('#tl-plot [data-mark], #tl-plot .tl-tick, #tl-plot g', (els) => els.slice(0, 60).map((e) => ({ cls: e.getAttribute('class'), mark: e.dataset.mark, x: Math.round(e.getBoundingClientRect().x * 10) / 10, title: e.querySelector('title')?.textContent })));
  // The cards' own mark, beside the words.
  await shot(page, `dan-1-marks-cards-${size}`, { clip: await clipOf(page, '#shots-row', 4) });
  // The strips of the next three days (today's real shots).
  await plan(page, '');
  await page.waitForTimeout(1500);
  await shot(page, `dan-1-marks-strips-${size}`, { clip: await clipOf(page, '#sparkstrip', 8) });
  if (size === 'closeup') {
    await page.click('#layers');
    await page.click('#layers-menu summary');
    await page.waitForTimeout(400);
    await shot(page, 'dan-1-marks-legend', { clip: await clipOf(page, '#layers-menu', 4) });
    await page.click('#layers');
  }
  await context.close();
}

// 2. The arrow. Full frames by day and at night; the clips are cut from these by hand (the pills
// are drawn on a canvas, so the page cannot say where they are).
for (const [name, size, query] of [
  ['map-day', 'closeup', 'date=2026-11-25&time=600'],
  ['map-night', 'closeup', 'date=2026-11-25&time=1200'],
  ['map-day', 'phone3', 'date=2026-11-25&time=600'],
  ['eye-day', 'closeup', 'date=2027-06-10&time=1200&at=52.492250,13.471850&look=200,2.6&lens=50&cam=ff'],
]) {
  const { context, page } = await open({ size, forecast: 'fixed' });
  await plan(page, query, { wait: 5000 });
  await shot(page, `dan-2-arrow-${name}-${size}`);
  await context.close();
}

// 3. The drone button and the tooltips.
{
  const { context, page } = await open({ size: 'closeup', forecast: 'fixed' });
  await plan(page, 'date=2027-06-10&time=1200&at=52.492250,13.471850&look=307,2.6&lens=50&cam=ff', { wait: 5000 });
  await shot(page, 'dan-3-drone-button', { clip: await clipOf(page, '.topleft', 8) });
  await page.hover('#takeoff');
  await page.waitForTimeout(700);
  await shot(page, 'dan-3-drone-button-hover', { clip: { x: 0, y: 0, width: 420, height: 110 } });
  const tips = [];
  for (const where of ['eye', 'map']) {
    if (where === 'map') {
      await page.click('#back');
      await page.waitForFunction(() => document.body.dataset.eye === 'false', null, { timeout: 30_000 });
      await page.waitForTimeout(1200);
    }
    const ids = await page.$$eval('.tools button, .topleft button', (b) => b.filter((e) => e.offsetParent !== null).map((e) => e.id));
    for (const id of ids) {
      await page.hover(`#${id}`);
      await page.waitForTimeout(600);
      const tip = await page.$eval(`#${id}`, (e) => {
        const s = getComputedStyle(e, '::before');
        return { id: e.id, dataTip: e.dataset.tip ?? null, title: e.title || null, aria: e.getAttribute('aria-label'), tipShown: s.visibility === 'visible' && Number(s.opacity) > 0.9, tipText: s.content };
      });
      tips.push({ where, ...tip });
      const b = await page.locator(`#${id}`).boundingBox();
      await shot(page, `dan-3-tip-${where}-${id}`, { clip: { x: Math.max(0, Math.min(b.x - 240, 1280 - 320)), y: Math.max(0, b.y - 14), width: 320, height: b.height + 60 } });
    }
  }
  // Keyboard: the tooltip on focus.
  await page.keyboard.press('Tab');
  await page.focus('#compass');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(500);
  out.focusTip = await page.$eval('#compass', (e) => ({ focused: document.activeElement === e, focusVisible: e.matches(':focus-visible'), shown: getComputedStyle(e, '::before').visibility }));
  await shot(page, 'dan-3-tip-keyboard-focus', { clip: { x: 960, y: 0, width: 320, height: 120 } });
  out.tips = tips;
  await context.close();
}
{
  // Touch: no hover. What does a finger get?
  const { context, page } = await open({ size: 'phone3', forecast: 'fixed' });
  await plan(page, 'date=2026-11-25&time=600');
  out.touch = await page.evaluate(() => ({
    hover: matchMedia('(hover: hover)').matches,
    toolbar: [...document.querySelectorAll('.tools button')].filter((e) => e.offsetParent !== null).map((e) => ({ id: e.id, title: e.title || null, dataTip: e.dataset.tip ?? null, text: e.innerText.trim() })),
  }));
  await page.tap('#layers');
  await page.waitForTimeout(600);
  await shot(page, 'dan-3-touch-toolbar', { clip: { x: 150, y: 0, width: 240, height: 420 } });
  await context.close();
}
save('dan.json', out);
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await close();
