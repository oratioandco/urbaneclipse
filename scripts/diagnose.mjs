// Objective scene-state inspector for the Plaster Void app (Constitution III — verify
// without relying on pixel rendering, which headless SwiftShader can't do for Cesium).
// Queries the live Cesium scene exposed at window.__cesium (dev only) to confirm the
// tileset is added, its content loaded, its bounding sphere is sane, the camera frustum
// contains it, and draw commands are being issued.
import { chromium } from '@playwright/test';

const URL = process.argv[2] || 'http://localhost:4321/';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[err] ${m.text()}`); });

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
// Vite's first load triggers dep optimization (504 "Outdated Optimize Dep" + an auto-
// reload in a real browser). Wait for it, then reload for a clean load past the transition.
await page.waitForTimeout(6000);
await page.reload({ waitUntil: 'load', timeout: 30000 });
// Wait for the tileset root content to stream (the only gate the occlusion
// engine cares about). NOTE: full `tilesLoaded` for the 183MB Berlin tileset
// is unreliable in headless Chrome — SwiftShader (software GL) cannot keep the
// per-frame post-process shader running concurrently with b3dm GPU uploads, so
// ~30-60 tiles stay in 'processing' indefinitely. On real hardware this is a
// few seconds. The orchestrator verifies pixel-painting separately on a real
// GPU; here we assert the integration: root content loaded, primitives added,
// post-process registered, occlusion state produced.
await page.waitForFunction(
  () => {
    const c = window.__cesium;
    return !!(c && c.tileset && c.tileset.root && c.tileset.root.content);
  },
  { timeout: 60000 },
).catch(() => {});
// Stream for a fixed window to let tile selection settle and the occlusion rAF
// poll fire (it gates on tilesLoaded, so on SwiftShader it will keep polling —
// but the FIRST poll that sees tileset.tilesLoaded briefly transition to true
// OR a manual recompute invocation will produce a state). 15s matches the
// pre-integration diagnose cadence.
await page.waitForTimeout(15000);

const state = await page.evaluate(() => {
  const c = window.__cesium;
  if (!c) return { exposed: false };
  const { viewer, tileset } = c;
  const out = {};
  const safe = (k, fn) => { try { out[k] = fn(); } catch (e) { out[k] = `ERR:${e.message}`; } };
  safe('primitives', () => viewer.scene.primitives.length);
  safe('tilesLoaded', () => tileset.tilesLoaded);
  safe('boundingSphereRadius', () => tileset.boundingSphere?.radius);
  safe('rootContentReady', () => !!(tileset.root && tileset.root.content));
  safe('totalMemoryMB', () => ((tileset.totalMemoryUsedInBytes || 0) / 1e6).toFixed(2));
  safe('commandsThisFrame', () => viewer.scene.frameState.commandList.length);
  safe('cameraPosMag', () => {
    const p = viewer.camera.position;
    return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z).toFixed(0);
  });
  safe('cullingIntersect', () => {
    const cv = viewer.scene.frameState.cullingVolume;
    return cv && tileset.boundingSphere ? cv.computeVisibility(tileset.boundingSphere) : 'n/a';
  });
  // US1 / US2 extensions: confirm the plaster post-process stage is registered and
  // the occlusion engine has produced a classified state.
  safe('postProcessStagesLength', () => viewer.scene.postProcessStages.length);
  safe('lastOcclusion', () => c.lastOcclusion ?? 'missing');
  // Tile queue diagnostics — explains why tilesLoaded might stay false (large
  // tilesets with always-refining leaves keep the queue non-empty in some views).
  safe('statistics', () => {
    const s = tileset.statistics;
    if (!s) return 'no-statistics';
    return {
      visited: s.visited,
      selected: s.selected,
      culled: s.culled,
      processed: s.numberOfTilesWithShaderProgramReady,
      pendingRequests: s.numberOfPendingRequests,
      processing: s.numberOfTilesProcessing,
      attempted: s.numberOfAttemptedRequests,
    };
  });
  safe('rootChildrenCount', () => tileset.root?.children?.length ?? 0);
  return out;
});

console.log('PAGE_ERRORS:', JSON.stringify(errors, null, 2));
console.log('SCENE_STATE:', JSON.stringify(state, null, 2));

// Extended US1/US2 assertions (Constitution III — diagnose must self-certify the
// new integration, not just dump state). These are best-effort reports; they do
// NOT cause the script to throw (so the orchestrator still sees the raw state).
const extended = {
  pageErrorsEmpty: errors.length === 0,
  primitivesIncludesTileset:
    typeof state.primitives === 'number' && state.primitives >= 1,
  tilesLoadedTrue: state.tilesLoaded === true,
  postProcessStagesAdded:
    typeof state.postProcessStagesLength === 'number' &&
    state.postProcessStagesLength >= 1,
  lastOcclusionIsAState: [
    'occluded',
    'marginal',
    'clear',
    'same-point',
    'unknown',
  ].includes(state.lastOcclusion),
};
console.log('EXTENDED_CHECKS:', JSON.stringify(extended, null, 2));

// Best-effort screenshot: SwiftShader can stall on a Cesium frame indefinitely
// when the post-process shader is in the loop, so wrap this so the script
// always exits cleanly with the scene-state output above.
try {
  await page.screenshot({ path: 'data/diag.png', timeout: 15000 });
} catch (e) {
  console.log('SCREENSHOT_FAILED:', e.message);
}
await browser.close();
