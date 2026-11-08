#!/usr/bin/env node
/**
 * Check what the LoD2 city tiles actually contain at landmark locations.
 *
 * For each landmark: converts its lat/lon to scene metres (origin = Fernsehturm,
 * same math as build_city.mjs), fetches the OSM footprint from Overpass, decodes the
 * covering tiles' LOD0 vertex buffers and reports the max vertex height inside the
 * footprint (and within a ring around it). Compare against the real height to decide
 * whether the landmark needs hand-modelling in src/miniature/landmarks.js.
 *
 * Usage: node scripts/miniature/check_landmark_lod.mjs [name ...]
 *   With names, checks only those; otherwise checks every built-in landmark.
 *   --ring=30 sets the footprint ring radius in metres.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';

const CITY = new URL('../../public/city/', import.meta.url).pathname;
const RING = Number(process.argv.find((a) => a.startsWith('--ring='))?.split('=')[1] ?? 30);
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Same geodetic reference as build_city.mjs: Fernsehturm base, scene origin.
const TOWER = { lat: 52.520815, lon: 13.409419, orthometric: 34.6, undulation: 39.5 };
const AREA_LIMIT = 9400;

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const rad = (d) => (d * Math.PI) / 180;
function ecef(lat, lon, h) {
  const s = Math.sin(rad(lat));
  const c = Math.cos(rad(lat));
  const n = A / Math.sqrt(1 - E2 * s * s);
  return [(n + h) * c * Math.cos(rad(lon)), (n + h) * c * Math.sin(rad(lon)), (n * (1 - E2) + h) * s];
}
const origin = ecef(TOWER.lat, TOWER.lon, TOWER.orthometric + TOWER.undulation);
const sl = Math.sin(rad(TOWER.lat));
const cl = Math.cos(rad(TOWER.lat));
const so = Math.sin(rad(TOWER.lon));
const co = Math.cos(rad(TOWER.lon));

/** lat/lon (h = 0 is fine for x/z; scene y at ground is terrain, not 0) to scene x=east, y=up, z=-north. */
export function toScene(lat, lon, h = 0) {
  const [x, y, z] = ecef(lat, lon, h);
  const dx = x - origin[0];
  const dy = y - origin[1];
  const dz = z - origin[2];
  return {
    x: -so * dx + co * dy,
    y: cl * co * dx + cl * so * dy + sl * dz,
    z: -(-sl * co * dx - sl * so * dy + cl * dz),
  };
}

/** Builtin landmark candidates: name, lat, lon, expected real height (m), OSM name fragments. */
export const LANDMARKS = [
  { name: 'Brandenburger Tor', lat: 52.5163, lon: 13.3777, expected: 26, match: ['brandenburger tor', 'brandenburger'], real: 'gate ~20 m body, 26 m to quadriga top; columns and quadriga missing from LoD2' },
  { name: 'Siegessäule', lat: 52.5145, lon: 13.3501, expected: 67, match: ['siegess', 'siegessäule'], real: '67 m column on a base, Golden Victoria on top' },
  { name: 'Funkturm', lat: 52.50503, lon: 13.27814, expected: 150, match: ['funkturm', 'langer lulatsch'], real: '150 m lattice radio tower' },
  { name: 'Reichstag', lat: 52.5186, lon: 13.3762, expected: 47, match: ['reichstag'], real: 'building ~47 m, glass cupola on top to ~75 m' },
  { name: 'Berliner Dom', lat: 52.51908, lon: 13.40109, expected: 114, match: ['berliner dom', 'oberpfarr'], real: '114 m dome' },
  { name: 'Molecule Man', lat: 52.49698, lon: 13.45895, expected: 30, match: ['molecule'], real: '30 m steel sculpture in the Spree' },
  { name: 'Rotes Rathaus', lat: 52.51827, lon: 13.40783, expected: 74, match: ['rotes rathaus'], real: 'building ~33 m, central tower 74 m' },
  { name: 'Marienkirche', lat: 52.52055, lon: 13.40718, expected: 92, match: ['marienkirche', 'st. marien', 'st. marienkirche'], real: 'gothic hall church, ~92 m tower' },
  { name: 'Kaiser-Wilhelm-Gedächtniskirche', lat: 52.5048, lon: 13.3351, expected: 71, match: ['gedächtniskirche', 'gedaechtniskirche'], real: 'ruined 71 m old tower beside modern church' },
  { name: 'Park Inn / Alexa', lat: 52.5229, lon: 13.4129, expected: 125, match: ['park inn'], real: 'Park Inn hotel 125 m' },
  { name: 'Treptowers', lat: 52.49533, lon: 13.46172, expected: 125, match: ['treptowers'], real: '125 m office tower' },
  { name: 'Gasometer Schöneberg', lat: 52.48140, lon: 13.35726, expected: 78, match: ['gasometer'], real: '78 m cylindrical gas holder' },
];

// --- geometry helpers ---

function polygonArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    s += p.x * q.z - q.x * p.z;
  }
  return s / 2;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

function distToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, distToSegment(x, z, ring[i].x, ring[i].z, ring[j].x, ring[j].z));
  }
  return best;
}

// --- OSM footprints ---
// Overpass (overpass-api.de) returns 406 through this environment's network, so the
// footprints come from the OSM API 0.6 map call instead: same data, XML, small bboxes.

async function fetchFootprint(lat, lon, radius = 180) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos(rad(lat)));
  const bbox = `${(lon - dLon).toFixed(6)},${(lat - dLat).toFixed(6)},${(lon + dLon).toFixed(6)},${(lat + dLat).toFixed(6)}`;
  const CACHE = new URL(`./check_landmark_lod.cache/${bbox}.json`, import.meta.url);
  if (fs.existsSync(CACHE)) {
    const xml = fs.readFileSync(CACHE, 'utf8');
    return parseOsm(xml);
  }
  const xml = await fetchOsmXml(bbox);
  fs.mkdirSync(new URL('./check_landmark_lod.cache/', import.meta.url), { recursive: true });
  fs.writeFileSync(CACHE, xml);
  return parseOsm(xml);
}

async function fetchOsmXml(bbox) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`);
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    throw new Error(`OSM API ${res.status}`);
  }
  return res.text();
}

function parseOsm(xml) {
  const nodes = new Map();
  for (const m of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = m[1].match(/\bid="(\d+)"/)?.[1];
    const la = m[1].match(/\blat="([-\d.]+)"/)?.[1];
    const lo = m[1].match(/\blon="([-\d.]+)"/)?.[1];
    const tags = {};
    for (const t of (m[2] ?? '').matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (id && la) nodes.set(id, { lat: Number(la), lon: Number(lo), tags });
  }
  const ways = [];
  for (const m of xml.matchAll(/<way\b([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const id = m[1].match(/\bid="(\d+)"/)?.[1];
    const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map((r) => r[1]);
    const tags = {};
    for (const t of m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (id && refs.length > 0) ways.push({ id, refs, tags });
  }
  // Multipolygon buildings (the Reichstag, the Gedächtniskirche ruin) are relations of ways;
  // stitch their outer members into rings and treat each as a way.
  const wayById = new Map(ways.map((w) => [w.id, w]));
  for (const m of xml.matchAll(/<relation\b([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const id = m[1].match(/\bid="(\d+)"/)?.[1];
    const tags = {};
    for (const t of m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (!id || !(tags.building || tags['building:part'] || tags.man_made)) continue;
    const outerRefs = [...m[2].matchAll(/<member\b([^>]*)>/g)]
      .map((a) => ({ type: a[1].match(/type="(\w+)"/)?.[1], ref: a[1].match(/ref="(\d+)"/)?.[1], role: a[1].match(/role="(\w*)"/)?.[1] }))
      .filter((mem) => mem.type === 'way' && mem.role !== 'inner' && wayById.has(mem.ref))
      .map((mem) => wayById.get(mem.ref).refs.slice());
    const rings = stitchRings(outerRefs);
    for (const ring of rings) ways.push({ id: `r${id}-${rings.indexOf(ring)}`, refs: ring, tags: { ...tags, relation: id } });
  }
  return { nodes, ways };
}

/** Join open way node-sequences sharing endpoints into closed rings. */
function stitchRings(seqs) {
  const rings = [];
  while (seqs.length > 0) {
    let cur = seqs.pop();
    let changed = cur[0] !== cur[cur.length - 1];
    while (changed) {
      changed = false;
      for (let i = 0; i < seqs.length; i++) {
        const s = seqs[i];
        if (s[s.length - 1] === cur[0]) { cur = s.concat(cur.slice(1)); }
        else if (cur[cur.length - 1] === s[0]) { cur = cur.concat(s.slice(1)); }
        else if (s[0] === cur[0]) { cur = s.reverse().concat(cur.slice(1)); }
        else if (cur[cur.length - 1] === s[s.length - 1]) { cur = cur.concat(s.reverse().slice(1)); }
        else continue;
        seqs.splice(i, 1);
        changed = cur[0] !== cur[cur.length - 1];
        break;
      }
    }
    if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
  }
  return rings;
}

/** Turn OSM ways into scene-space rings, keeping those near the landmark. */
function waysNear({ nodes, ways }, px, pz, keep = 120) {
  const out = [];
  for (const way of ways) {
    if (!way.tags.building && !way.tags['building:part'] && !way.tags.man_made) continue;
    const ring = way.refs.filter((r) => nodes.has(r)).map((r) => toScene(nodes.get(r).lat, nodes.get(r).lon));
    if (ring.length < 3) continue;
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    const dist = Math.hypot(cx - px, cz - pz);
    if (dist > keep) continue;
    out.push({ id: way.id, tags: way.tags, ring, dist, area: Math.abs(polygonArea(ring)) });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

function nodesNear({ nodes }, px, pz, keep = 60) {
  const interesting = (t) =>
    (t.man_made && !['manhole', 'surveillance', 'street_cabinet', 'pole'].includes(t.man_made)) ||
    t.artwork || t.artwork_type || t.tourism === 'artwork' || t.historic;
  return [...nodes.values()]
    .filter((n) => interesting(n.tags))
    .map((n) => ({ tags: n.tags, ...toScene(n.lat, n.lon) }))
    .map((n) => ({ ...n, dist: Math.hypot(n.x - px, n.z - pz) }))
    .filter((n) => n.dist <= keep);
}

// --- tile decoding ---

const manifest = JSON.parse(fs.readFileSync(path.join(CITY, 'manifest.json'), 'utf8'));

/** Tiles whose LOD0 bbox intersects the axis-aligned box around (cx, cz) with half-size r. */
function coveringTiles(cx, cz, r) {
  const hits = [];
  for (const tile of manifest.tiles) {
    const lod = tile.lods.find((l) => l.level === 0);
    if (!lod) continue;
    const [minX, , minZ] = lod.min;
    const [maxX, , maxZ] = lod.max;
    if (minX > cx + r || maxX < cx - r || minZ > cz + r || maxZ < cz - r) continue;
    hits.push(tile);
  }
  return hits;
}

async function decodeTileLod0(tile) {
  await MeshoptDecoder.ready;
  const lod = tile.lods.find((l) => l.level === 0);
  const data = new Uint8Array(fs.readFileSync(path.join(CITY, `${tile.id}-0.bin`)));
  const head = new Uint32Array(data.buffer, 0, 2);
  const vertices = new Uint16Array(lod.vertices * 4);
  MeshoptDecoder.decodeVertexBuffer(new Uint8Array(vertices.buffer), lod.vertices, 8, data.subarray(8, 8 + head[0]));
  const indices = new Uint32Array(lod.indexCount);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), lod.indexCount, 4, data.subarray(8 + head[0], 8 + head[0] + head[1]));
  const used = new Uint8Array(lod.vertices);
  for (const i of indices) used[i] = 1;
  const positions = [];
  for (let v = 0; v < lod.vertices; v++) {
    if (!used[v]) continue;
    positions.push(
      lod.min[0] + vertices[v * 4] * lod.step,
      lod.min[1] + vertices[v * 4 + 1] * lod.step,
      lod.min[2] + vertices[v * 4 + 2] * lod.step,
    );
  }
  return positions;
}

/** Per-way LoD2 vertex heights inside each footprint, plus the ring around all of them. */
function measureHeight(positions, ways, px, pz, ringR) {
  for (const w of ways) {
    w.max = -Infinity;
    w.count = 0;
  }
  let ringMax = -Infinity;
  let ringCount = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    let inAny = false;
    for (const w of ways) {
      if (pointInRing(w.ring, x, z)) {
        w.max = Math.max(w.max, y);
        w.count++;
        inAny = true;
      }
    }
    if (!inAny) {
      let dist = Infinity;
      for (const w of ways) dist = Math.min(dist, distToRing(w.ring, x, z));
      if (dist <= ringR) {
        ringMax = Math.max(ringMax, y);
        ringCount++;
      }
    }
  }
  return { ringMax, ringCount };
}

/** Max vertex height within `r` metres of a point. */
function measureRing(positions, px, pz, r) {
  let max = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.hypot(positions[i] - px, positions[i + 2] - pz) <= r) max = Math.max(max, positions[i + 1]);
  }
  return max;
}

/** Ground level near the landmark: lowest vertex within the ring, a rough terrain reference. */
function groundLevel(positions, px, pz, keep = 60) {
  let min = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.hypot(positions[i] - px, positions[i + 2] - pz) <= keep) min = Math.min(min, positions[i + 1]);
  }
  return min === Infinity ? null : min;
}

// --- main ---

const known = [
  // Frankfurter Tor is not listed here: landmarks.js puts its towers at scene [2940.6, 479.1] and
  // [2925.4, 573.4], and probing the tiles finds 44-52 m tower geometry exactly there (and nothing
  // 30 m+ at the coordinates often quoted for it), so the tile frame matches landmarks.js directly.
  { name: 'Oberbaumbrücke (check)', lat: 52.5015, lon: 13.4455, x: 2461.85, z: 2125.58 },
  { name: 'Fernsehturm (origin)', lat: TOWER.lat, lon: TOWER.lon, x: 0, z: 0 },
];
console.log('== conversion self-check ==');
for (const k of known) {
  const s = toScene(k.lat, k.lon);
  console.log(`${k.name}: scene [${s.x.toFixed(1)}, ${s.z.toFixed(1)}] expected [${k.x}, ${k.z}] -> d=${Math.hypot(s.x - k.x, s.z - k.z).toFixed(1)} m`);
}

const results = [];
const names = only.length > 0 ? only : LANDMARKS.map((l) => l.name);
for (const name of names) {
  const lm = LANDMARKS.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!lm) {
    console.error(`unknown landmark: ${name}`);
    continue;
  }
  const s = toScene(lm.lat, lm.lon);
  const inArea = Math.abs(s.x) < AREA_LIMIT && Math.abs(s.z) < AREA_LIMIT;
  const out = { name: lm.name, scenePos: `x=${s.x.toFixed(1)}, y~terrain, z=${s.z.toFixed(1)}`, inArea, footprint: null, lod2MaxHeight: null, expectedHeight: lm.expected, notes: [] };
  console.log(`\n== ${lm.name} == scene [${s.x.toFixed(1)}, ${s.z.toFixed(1)}], inArea=${inArea}`);

  let elements;
  try {
    elements = await fetchFootprint(lm.lat, lm.lon);
  } catch (err) {
    out.notes.push(`Overpass fetch failed: ${err.message}`);
    results.push(out);
    continue;
  }
  const ways = waysNear(elements, s.x, s.z);
  const nodes = nodesNear(elements, s.x, s.z);
  if (ways.length > 12) console.log(`  (${ways.length} OSM ways within 120 m, showing the 12 nearest)`);
  for (const w of ways.slice(0, 12)) {
    const h = w.tags.height ?? w.tags['building:height'] ?? w.tags['building:part:height'] ?? '?';
    console.log(`  way ${w.id}: d=${w.dist.toFixed(0)} m, area=${w.area.toFixed(0)} m2, height tag=${h}, ${w.tags.name ?? ''} ${w.tags.building ?? w.tags['building:part'] ?? w.tags.man_made ?? ''}`);
  }
  for (const n of nodes) {
    console.log(`  node: d=${n.dist.toFixed(0)} m, tags: ${JSON.stringify(n.tags).slice(0, 120)}`);
  }

  if (!inArea) {
    out.notes.push('outside the 9400 m area — tiles do not cover it');
    results.push(out);
    continue;
  }

  const tiles = coveringTiles(s.x, s.z, 250);
  if (tiles.length === 0) {
    out.notes.push('no city tile covers this position');
    results.push(out);
    continue;
  }
  let positions = [];
  for (const tile of tiles) {
    try {
      positions = positions.concat(Array.from(await decodeTileLod0(tile)));
    } catch (err) {
      out.notes.push(`decode of ${tile.id}-0.bin failed: ${err.message}`);
    }
  }
  if (positions.length === 0) {
    results.push(out);
    continue;
  }
  const measured = measureHeight(positions, ways, s.x, s.z, RING);
  const ground = groundLevel(positions, s.x, s.z);
  const g = ground ?? 0;
  const withVerts = ways
    .filter((w) => w.count > 0)
    .map((w) => ({ ...w, above: +(w.max - g).toFixed(1) }))
    .sort((a, b) => b.above - a.above);
  console.log(`  tiles: ${tiles.map((t) => t.id).join(', ')}`);
  console.log(`  terrain y=${ground?.toFixed(1)}; ways with LoD2 vertices inside, tallest first:`);
  for (const w of withVerts.slice(0, 8)) {
    console.log(`    ${w.above.toFixed(1)} m — way ${w.id}, d=${w.dist.toFixed(0)} m, area=${w.area.toFixed(0)} m2, ${w.count} verts, osm height tag=${w.tags.height ?? '?'}, ${w.tags.name ?? w.tags['building:part'] ?? w.tags.building ?? ''}`);
  }
  const ringMax = Number.isFinite(measured.ringMax) ? +(measured.ringMax - g).toFixed(1) : null;
  // The landmark's own footprint: prefer a way whose name matches, else the tallest way with a
  // substantial footprint, else the tallest footprint holding LoD2 geometry.
  const norm = (t) => (t ?? '').toLowerCase().replace(/[^a-zäöüß]/g, '');
  const byName = lm.match.flatMap((m) => withVerts.filter((w) => norm(w.tags.name).includes(norm(m))));
  const substantial = withVerts.filter((w) => w.area >= 150);
  let primary = byName.sort((a, b) => b.above - a.above)[0]
    ?? substantial.sort((a, b) => b.above - a.above)[0]
    ?? withVerts[0];
  // No footprint at the landmark itself (a statue, a mast): fall back to the heights in a
  // ring around the point rather than quote a nearby building.
  const pointMax = measureRing(positions, s.x, s.z, RING);
  const pointAbove = Number.isFinite(pointMax) ? +(pointMax - g).toFixed(1) : null;
  if ((primary?.dist ?? Infinity) > 60) {
    out.footprint = `ring ${RING} m around the point (nearest footprint way ${primary?.id ?? 'none'} is ${primary?.dist.toFixed(0) ?? '—'} m away)`;
    out.lod2MaxHeight = pointAbove;
    out.notes.push(`no OSM footprint within 60 m; max LoD2 height within ${RING} m of the point: ${pointAbove ?? 'none'} m above terrain (terrain y=${g.toFixed(1)}); real: ${lm.real}`);
    results.push(out);
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  if (primary) {
    out.footprint = `way ${primary.id} (d=${primary.dist.toFixed(0)} m, ${primary.area.toFixed(0)} m2${primary.tags.height ? `, osm height ${primary.tags.height} m` : ''})`;
    out.lod2MaxHeight = primary.above;
    const top3 = withVerts.slice(0, 3).map((w) => `${w.above} m @${w.dist.toFixed(0)}m`).join(', ');
    out.notes.push(`LoD2 max in landmark footprint: ${primary.above} m above terrain (terrain y=${g.toFixed(1)}, ${primary.count} verts); tallest nearby LoD2: ${top3}; OSM way height tag: ${primary.tags.height ?? 'none'}; real: ${lm.real}`);
  } else if (ways.length > 0) {
    out.footprint = `${ways.length} OSM way(s) nearby, none with LoD2 vertices inside`;
    out.lod2MaxHeight = ringMax;
    out.notes.push(`no LoD2 vertices inside any footprint; max within ${RING} m ring: ${ringMax ?? 'none'} m; real: ${lm.real}`);
  } else {
    out.footprint = 'point only';
    out.lod2MaxHeight = ringMax;
    out.notes.push(`no OSM footprint; max LoD2 height within ${RING} m of point: ${ringMax ?? 'none'} m; real: ${lm.real}`);
  }
  results.push(out);
  await new Promise((r) => setTimeout(r, 2000));
}

fs.writeFileSync(new URL('./check_landmark_lod.results.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\nwrote ${results.length} results to scripts/miniature/check_landmark_lod.results.json`);
