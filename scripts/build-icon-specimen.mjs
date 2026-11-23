// Builds explorations/icons-2026-11/specimen.html: one self-contained page that draws every
// planner icon, the sun and the moon with the real modules (src/miniature/icons.js, bodies.js).
// Run: node scripts/build-icon-specimen.mjs
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../explorations/icons-2026-11/', import.meta.url));
const result = await build({ entryPoints: [`${dir}specimen.src.js`], bundle: true, format: 'iife', write: false, minify: true, target: 'es2020', legalComments: 'none' });
const shell = await readFile(`${dir}specimen.shell.html`, 'utf8');
const script = result.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
await writeFile(`${dir}specimen.html`, shell.replace('<!--SCRIPT-->', () => `<script>${script}</script>`));
console.log(`specimen.html written, ${(shell.length + script.length) / 1000 | 0} kB`);
