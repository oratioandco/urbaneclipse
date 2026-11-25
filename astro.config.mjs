// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vitePluginCesium from 'vite-plugin-cesium';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// The shots are checked against the scene for a stretch of days (public/viewshed/
// fernsehturm-scene.json `covered`: scripts/adversarial/crawl.test.ts writes it). Past its end
// the site lists no shots, so a build near the end says so.
try {
  const { covered } = JSON.parse(readFileSync(new URL('./public/viewshed/fernsehturm-scene.json', import.meta.url), 'utf8'));
  const left = covered ? Math.floor((Date.parse(`${covered.to}T12:00:00Z`) - Date.now()) / 86_400_000) : null;
  if (left === null) console.warn('[urbaneclipse] The scene mask names no covered days: shots are listed for any date, unchecked. Run scripts/adversarial/crawl.test.ts.');
  else if (left < 60) console.warn(`[urbaneclipse] Shots are checked up to ${covered.to}: ${left < 0 ? 'that has passed and no shots are listed' : `${left} days from now`}. Re-crawl: see scripts/adversarial/README.md (crawl.test.ts, under an hour).`);
} catch (error) {
  console.warn('[urbaneclipse] Could not read the scene mask\u2019s covered days:', String(error));
}

// Plaster Void — Astro + React + Cesium scaffold.
//
// Output is 'static': pages are server-rendered shells at build time, interactive
// UI ships as client:only islands (Constitution: no Cesium in the SSR graph).
//
// vite-plugin-esium (rebuildCesium:false, default) serves Cesium's prebuilt UMD
// bundle from /cesium/ at dev time and copies {Assets,ThirdParty,Workers,Widgets}
// into dist/cesium/ at build time, externalizing the `cesium` import as a global so
// the heavy WebGL library never enters any client chunk. We additionally pin cesium
// as SSR-external and excluded from optimizeDeps (defensive belts; client:only keeps
// it out of the server graph regardless).
export default defineConfig({
  output: 'static',
  // One-time asset namespace bump: the previous deployment marked an entry chunk
  // immutable even though its generated filename was reused. A new directory forces
  // every returning browser onto the corrected Lichtenberger scene immediately.
  build: {
    assets: '_urban-eclipse-v2',
  },
  integrations: [react()],
  vite: {
    plugins: [vitePluginCesium(), tailwindcss()],
    ssr: {
      external: ['cesium'],
    },
    optimizeDeps: {
      // Cesium is consumed as a UMD GLOBAL (window.Cesium) — see
      // src/components/react/CesiumViewer.tsx — NOT imported as a module, so it stays out
      // of Vite's dep-optimization entirely. (Importing the npm cesium ESM breaks dev on
      // Cesium's CommonJS deps: mersenne-twister default-export error, then 504 loops.)
      exclude: ['cesium'],
    },
  },
});
