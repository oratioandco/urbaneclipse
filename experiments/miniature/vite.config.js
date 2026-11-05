import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { fs: { allow: ['../..'] } },
  // Shared maths in src/lib imports suncalc, which is installed here for this experiment.
  resolve: { alias: { suncalc: fileURLToPath(new URL('./node_modules/suncalc', import.meta.url)) } },
});
