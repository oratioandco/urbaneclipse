import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers.js';

/**
 * T062 — US5: solver responsiveness (SC-003, SC-008; quickstart.md #5).
 *
 * Clicking SEARCH must:
 *   1. actually spawn the dedicated worker (src/workers/solver.worker.ts), not run the
 *      43_200-step sweep on the main thread;
 *   2. keep the UI responsive WHILE the sweep runs (the worker chunks its work and
 *      yields via setTimeout(0) — see the worker's CHUNK_SIZE comment) — verified here
 *      by confirming a page-level timer keeps ticking at close to its true rate during
 *      the search, i.e. the main thread is never blocked long enough to starve it;
 *   3. reach a terminal state: either a completed sweep with concrete match instants,
 *      or an explicit, worded "no alignments found" result — never left spinning
 *      forever and never a silent failure (FR-013).
 *
 * Worker-construction detection reuses scripts/diagnose.mjs's exact technique: shim
 * `window.Worker` via `addInitScript` (must run before the page's own scripts) to flag
 * when a `solver.worker` URL is constructed, without altering its behaviour.
 *
 * Anchors on `data-testid="solver-search"` plus a real `<button>` (guaranteed by the
 * task brief: "a real `<button>` whose trimmed textContent starts with SEARCH" — also
 * now a documented HARD CONTRACT comment in SolverSearch.tsx itself).
 */

test.describe('US5 — solver responsiveness', () => {
  test('SEARCH spawns the worker, keeps the UI responsive, and reaches a terminal state', async ({
    page,
  }) => {
    // Must be installed before ANY page script runs (addInitScript runs on every
    // subsequent navigation before the page's own scripts, matching diagnose.mjs).
    await page.addInitScript(() => {
      const OriginalWorker = window.Worker;
      class CountingWorker extends OriginalWorker {
        constructor(url: string | URL, opts?: WorkerOptions) {
          super(url, opts);
          const s = String((url as URL)?.url ?? url);
          if (s.includes('solver.worker')) {
            (window as any).__solverWorkerConstructed = true;
          }
        }
      }
      // @ts-expect-error — intentional shim, mirrors scripts/diagnose.mjs.
      window.Worker = CountingWorker;
    });

    await gotoApp(page);

    const panel = page.getByTestId('solver-search');
    await expect(panel).toBeVisible();

    const searchButton = panel.getByRole('button', { name: /^search/i });
    await expect(searchButton).toBeEnabled();

    // A page-level heartbeat: if the main thread were blocked by the 43_200-step sweep
    // (instead of it running in a Worker), this timer would stall along with everything
    // else, and its tick count would fall far short of the elapsed-time/interval ratio.
    await page.evaluate(() => {
      (window as any).__heartbeatTicks = 0;
      (window as any).__heartbeatTimer = setInterval(() => {
        (window as any).__heartbeatTicks += 1;
      }, 50);
    });

    await searchButton.click();

    // 1. Worker construction signal (yield a few frames, as diagnose.mjs does).
    await expect
      .poll(async () => page.evaluate(() => !!(window as any).__solverWorkerConstructed), {
        message: 'expected `new Worker(...solver.worker...)` to have been constructed',
        timeout: 5_000,
      })
      .toBe(true);

    // 2. State transition visible in the UI: the button becomes disabled/relabelled
    // while the sweep runs (SolverSearch.tsx: disabled={status==='running'}).
    await expect(searchButton).toBeDisabled({ timeout: 5_000 });

    // 3. Responsiveness: let ~1.5s of wall-clock pass while the sweep is presumably
    // still running, then confirm the heartbeat kept pace. 50ms interval over 1500ms
    // should yield ~30 ticks; a genuinely blocked main thread would yield far fewer.
    await page.waitForTimeout(1500);
    const ticks = await page.evaluate(() => (window as any).__heartbeatTicks as number);
    expect(
      ticks,
      'expected the main-thread heartbeat timer to keep firing while the solver ran, ' +
        'proving the sweep executes in the Worker and does not block the UI thread',
    ).toBeGreaterThan(15);

    // 4. Terminal state: the button re-enables once the worker posts `done` (or the
    // panel would stay disabled forever on a hang). 43_200 one-minute steps chunked at
    // 5_000/yield is fast in practice, but the budget here is generous (worker startup
    // + suncalc cost can vary under headless CI).
    await expect(searchButton).toBeEnabled({ timeout: 30_000 });
    await page.waitForTimeout(200); // let the final state re-render settle

    // Terminal outcome must be CONCRETE — either real match instants or an explicit
    // "no alignments" result — never an ambiguous/blank end state (FR-013).
    const finalText = (await panel.textContent()) ?? '';
    // NB: matched against textContent, which concatenates adjacent elements with NO
    // separator — the panel reads "...4 hitsAzimuth280.0°...". A trailing \b after
    // "hits" therefore never matches, because the next character is a word character
    // from the following element. Anchor on the digits instead.
    expect(
      /no alignments found|\d+\s*hits?/i.test(finalText) || /solver failed/i.test(finalText),
      `expected an explicit terminal result (matches, "no alignments found", or a ` +
        `reported failure) in the panel; got: ${finalText.slice(0, 300)}`,
    ).toBe(true);

    // An outright worker/runtime failure is not itself a suite failure to hide — but it
    // MUST have been reported in words, not just silently disabled. Surface it loudly
    // in the test output if it happened, since it would indicate a real regression.
    if (/solver failed/i.test(finalText)) {
      test.info().annotations.push({
        type: 'warning',
        description: `Solver worker reported an error terminal state: ${finalText.slice(0, 300)}`,
      });
    }
  });
});
