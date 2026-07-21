// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vitePluginCesium from 'vite-plugin-cesium';
import tailwindcss from '@tailwindcss/vite';

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
  integrations: [react()],
  vite: {
    plugins: [vitePluginCesium(), tailwindcss()],
    ssr: {
      external: ['cesium'],
    },
    optimizeDeps: {
      exclude: ['cesium'],
    },
  },
});
