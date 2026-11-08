#!/usr/bin/env node
/**
 * Berlin's tree register (street trees and park trees, Datenlizenz Deutschland Zero 2.0) as
 * compact instances for the miniature: position, height, crown and kind, sorted into 500 m cells
 * so the viewer can draw only the cells near the camera.
 *
 * Usage: node scripts/miniature/build_trees.mjs [cache dir]
 * Output: public/city/trees.json (cells) and public/city/trees.bin
 *
 * The WFS pages are cached in the cache dir (default data/trees), so a rebuild works offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cherryKind } from '../../src/miniature/blossom.js';

const WFS = 'https://gdi.berlin.de/services/wfs/baumbestand';
const LAYERS = ['strassenbaeume', 'anlagenbaeume'];
const PAGE = 10_000;
const CACHE = process.argv[2] ?? new URL('../../data/trees/', import.meta.url).pathname;
const OUT = new URL('../../public/city/', import.meta.url).pathname;
// Fernsehturm base, the scene's origin. Keep in step with build_city.mjs and src/lib/landmarks.ts.
const LAT0 = 52.520815;
const LON0 = 13.409419;
const HALF = 9400;
const CELL = 500;
const CELLS = Math.ceil((2 * HALF) / CELL);

/** The same transverse Mercator as sceneFromLatLon in src/miniature/eye.js. */
function scene(lat, lon) {
  const rad = Math.PI / 180;
  const a = 6378137;
  const e2 = 0.00669437999014;
  const meridian = (phi) => a * ((1 - e2 / 4 - (3 * e2 * e2) / 64) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256) * Math.sin(4 * phi));
  const phi = lat * rad;
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const across = Math.cos(phi) * (lon - LON0) * rad;
  const east = n * (across + ((1 - Math.tan(phi) ** 2) * across ** 3) / 6);
  const north = meridian(phi) - meridian(LAT0 * rad) + n * Math.tan(phi) * (across ** 2 / 2);
  return [east, -north];
}

const dLat = (HALF + 200) / 111_320;
const dLon = (HALF + 200) / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const BBOX = `${LAT0 - dLat},${LON0 - dLon},${LAT0 + dLat},${LON0 + dLon},urn:ogc:def:crs:EPSG::4326`;

async function page(layer, start) {
  const file = path.join(CACHE, `${layer}-${start}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=baumbestand:${layer}&outputFormat=application/json&srsName=EPSG:4326&sortBy=gisid&count=${PAGE}&startIndex=${start}&bbox=${BBOX}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = await response.json();
      // Keep only what the build uses: the pages are large otherwise.
      const slim = {
        numberMatched: doc.numberMatched,
        features: doc.features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0], f.properties.baumhoehe, f.properties.kronedurch, f.properties.stammumfg, f.properties.art_gruppe, f.properties.art_bot, f.properties.art_dtsch]),
      };
      fs.writeFileSync(file, JSON.stringify(slim));
      return slim;
    } catch (error) {
      if (attempt >= 4) throw error;
      console.log(`${layer} ${start}: ${error.message}, retrying`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const COLUMNAR = /fastigiata|columnar|pyramidal|säulen|pyramiden|'?stricta/i;
const KIND = { broadleaf: 0, conifer: 1, columnar: 2, cherryEarly: 3, cherryOrnamental: 4, cherryLate: 5 };

/** Height and crown in metres, filling the gaps the register leaves: many park trees list neither. */
function shape(height, crown, girth, group, botanical, german) {
  const name = `${botanical ?? ''} ${german ?? ''}`;
  const cherry = cherryKind(botanical, german);
  const kind = cherry ?? (COLUMNAR.test(name) ? KIND.columnar : group === 'Nadelbäume' ? KIND.conifer : KIND.broadleaf);
  let h = Number(height) || 0;
  if (h < 2 || h > 45) h = girth > 0 ? Math.min(30, 4 + girth * 0.08) : 12;
  let c = Number(crown) || 0;
  // Cherries are compact, round-crowned trees.
  if (c < 1 || c > 30) c = kind === KIND.columnar ? h * 0.3 : kind === KIND.conifer ? h * 0.42 : cherry ? Math.min(14, Math.max(2.5, h * 0.55)) : Math.min(16, Math.max(2.5, h * 0.6));
  return { h, c, kind };
}

fs.mkdirSync(CACHE, { recursive: true });
const trees = [];
for (const layer of LAYERS) {
  let total = Infinity;
  for (let start = 0; start < total; start += PAGE) {
    const doc = await page(layer, start);
    total = doc.numberMatched;
    for (const [lat, lon, height, crown, girth, group, botanical, german] of doc.features) {
      const [x, z] = scene(lat, lon);
      if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) continue;
      trees.push({ x, z, ...shape(height, crown, girth, group, botanical, german) });
    }
    console.log(`${layer}: ${Math.min(start + PAGE, total)} of ${total}`);
  }
}

// The same tree can be in both registers; drop anything within half a metre of one already kept.
const seen = new Set();
const unique = trees.filter((t) => {
  const key = `${Math.round(t.x * 2)},${Math.round(t.z * 2)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const cellOf = (t) => Math.floor((t.z + HALF) / CELL) * CELLS + Math.floor((t.x + HALF) / CELL);
unique.sort((a, b) => cellOf(a) - cellOf(b));
const n = unique.length;
// Struct of arrays, which compresses better: x and z in half metres, height and crown in 0.2 m.
const x = new Int16Array(n);
const z = new Int16Array(n);
const h = new Uint8Array(n);
const c = new Uint8Array(n);
const kind = new Uint8Array(n);
const cells = [];
unique.forEach((t, i) => {
  x[i] = Math.round(t.x * 2);
  z[i] = Math.round(t.z * 2);
  h[i] = Math.min(255, Math.round(t.h * 5));
  c[i] = Math.min(255, Math.round(t.c * 5));
  kind[i] = t.kind;
  const cell = cellOf(t);
  if (!cells.length || cells[cells.length - 1][0] !== cell) cells.push([cell, i, 0]);
  cells[cells.length - 1][2]++;
});
fs.writeFileSync(path.join(OUT, 'trees.bin'), Buffer.concat([x, z, h, c, kind].map((a) => Buffer.from(a.buffer))));
fs.writeFileSync(path.join(OUT, 'trees.json'), JSON.stringify({ count: n, half: HALF, cell: CELL, cells: cells.map(([id, first, count]) => [id % CELLS, Math.floor(id / CELLS), first, count]) }));
const kinds = Object.keys(KIND).map((k) => `${unique.filter((t) => t.kind === KIND[k]).length} ${k}`).join(', ');
console.log(`${n} trees (${trees.length - n} duplicates dropped): ${kinds}; ${cells.length} cells, ${((n * 7) / 1e6).toFixed(1)} MB`);
