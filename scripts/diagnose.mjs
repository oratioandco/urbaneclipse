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
// Let the tileset resolve + root content stream.
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
  return out;
});

console.log('PAGE_ERRORS:', JSON.stringify(errors, null, 2));
console.log('SCENE_STATE:', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'data/diag.png' });
await browser.close();
