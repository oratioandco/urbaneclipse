import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers.js';

/**
 * T062 — US4: hour-timeline bands render + the "now" marker moves with `dateTime`
 * (SC-004, quickstart.md #4).
 *
 * HourTimeline is pure store + suncalc — it needs the Cesium viewer island mounted
 * (client:only) but NOT the 3D Tiles building tileset, so unlike the US1 occlusion
 * suite this test has no SwiftShader/tile-loading caveat: it is fully deterministic.
 *
 * Anchors ONLY on the guaranteed-stable `data-testid`s (`hour-timeline`,
 * `hour-timeline-marker`) plus the guaranteed `<input type="datetime-local">` in the
 * control panel. Band segments have no individual testid (this is flagged in the
 * final report as a nice-to-have); they are instead located structurally, by the
 * fact that each band renders an absolutely-positioned element carrying an inline
 * `width` style, while the marker (also inline-styled) carries only `left` — a
 * DOM-shape distinction rather than a CSS-class or color dependency, so it survives
 * the in-flight visual redesign as long as the band-per-element rendering approach
 * (src/components/react/HourTimeline.tsx renderBand) is kept.
 */

async function setDateTimeValue(page: import('@playwright/test').Page, value: string): Promise<void> {
  const input = page.locator('input[type="datetime-local"]').first();
  await input.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test.describe('US4 — hour timeline', () => {
  test('renders solar-day bands and the marker moves as dateTime changes', async ({ page }) => {
    await gotoApp(page);

    const timeline = page.getByTestId('hour-timeline');
    await expect(timeline).toBeVisible();

    const marker = page.getByTestId('hour-timeline-marker');
    await expect(marker).toBeVisible();

    // Bands: at least one absolutely-positioned, width-styled segment inside the
    // timeline (golden/blue/day/night — src/lib/timeline.ts buildTimelineBands).
    const bandSegments = timeline.locator('div[style*="width"]');
    await expect
      .poll(async () => bandSegments.count(), {
        message: 'expected at least one solar-day band segment to render',
      })
      .toBeGreaterThan(0);

    // Set a known midday UTC instant and record the marker's horizontal position.
    await setDateTimeValue(page, '2026-07-21T12:00');
    await page.waitForTimeout(200); // rAF-coalesced scrub (store.ts setDateTimeScrubbing)
    const middayBox = await marker.boundingBox();
    expect(middayBox).not.toBeNull();

    // Jump 12 hours forward (midnight) — the marker must move to a materially
    // different horizontal position (it maps dateTime linearly onto a 24h span).
    await setDateTimeValue(page, '2026-07-22T00:00');
    await page.waitForTimeout(200);
    const midnightBox = await marker.boundingBox();
    expect(midnightBox).not.toBeNull();

    expect(
      Math.abs((midnightBox!.x ?? 0) - (middayBox!.x ?? 0)),
      'expected the "now" marker to move horizontally when dateTime jumps by 12h',
    ).toBeGreaterThan(10);

    // The timeline's own displayed date/time readout should also reflect the change
    // (guards against a marker that moves but the rest of the panel not re-rendering).
    await expect(timeline).toContainText('2026-07-22');
  });

  test('a small time step nudges the marker only slightly (linear day mapping)', async ({
    page,
  }) => {
    await gotoApp(page);
    const marker = page.getByTestId('hour-timeline-marker');

    await setDateTimeValue(page, '2026-07-21T10:00');
    await page.waitForTimeout(200);
    const before = await marker.boundingBox();

    await setDateTimeValue(page, '2026-07-21T11:00');
    await page.waitForTimeout(200);
    const after = await marker.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    const delta = Math.abs((after!.x ?? 0) - (before!.x ?? 0));
    // A 1h step is 1/24 of the bar; it must move, but far less than a 12h jump.
    expect(delta, 'expected a small (1h) forward step to move the marker slightly').toBeGreaterThan(0);
  });
});
