import type { Page } from '@playwright/test';

/**
 * Shared E2E helpers (T062). These reuse the techniques scripts/diagnose.mjs and
 * scripts/screenshot.mjs already worked out for driving this Cesium app headlessly:
 *   - the `window.__cesium` debug hook (viewer/tileset handles) exposed unconditionally
 *     by CesiumViewer.tsx
 *   - waiting on scene-state (tileset root content) rather than a fixed sleep
 *   - a generous settle window afterward, because SwiftShader (software GL) cannot
 *     always finish per-frame post-process + b3dm tile uploads concurrently, so
 *     `tileset.tilesLoaded` may never flip true in headless CI even though the scene
 *     is otherwise fully wired
 *
 * None of these specs read back pixels (non-`@gpu`) — they only assert on DOM state,
 * store-driven attributes, and `window.__cesium` scene-state, all of which are valid
 * under software rendering.
 */

/** Navigate to the app root and wait for the Cesium viewer + tileset to be constructed. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  // Give the client:only React island time to mount and Cesium to construct the
  // viewer/tileset before we start polling window.__cesium.
  // NOTE: waitForFunction's signature is (pageFunction, arg?, options?) — the options
  // object MUST be the 3rd positional argument (`undefined` arg in between), otherwise
  // it is silently treated as `arg` and the call falls back to Playwright's default
  // timeout (here, `actionTimeout` from playwright.config.ts) instead of the one below.
  await page.waitForFunction(
    () => !!(window as any).__cesium?.viewer,
    undefined,
    { timeout: 60_000 },
  );
}

/**
 * Wait for the tileset's root content to have streamed in. This is the gate the
 * occlusion engine itself uses (see scripts/diagnose.mjs) — it is far more reliable
 * under headless SwiftShader than waiting for `tileset.tilesLoaded` (which can stay
 * false indefinitely for a large always-refining tileset under software rendering).
 */
export async function waitForTilesetRoot(page: Page, timeout = 60_000): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const c = (window as any).__cesium;
        return !!(c && c.tileset && c.tileset.root && c.tileset.root.content);
      },
      undefined,
      { timeout },
    )
    .catch(() => {
      // Best-effort, mirroring scripts/diagnose.mjs: some CI sandboxes never finish
      // streaming the 183MB Berlin tileset under SwiftShader. Callers that need the
      // tileset for their assertion should still fail downstream with a clear signal;
      // callers that only need the occlusion engine (which recomputes off height/tile
      // changes, not per-frame) can proceed once the classifier has produced a state.
    });
}

/** Read the current `lastOcclusion` classification off the debug hook. */
export async function readLastOcclusion(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__cesium?.lastOcclusion ?? 'missing');
}
