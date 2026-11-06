#!/usr/bin/env node
/**
 * Turn the LoD2 3D Tiles into compact city geometry for the miniature viewer.
 *
 * LoD2 buildings are made of flat faces, so normals are dropped and the viewer derives
 * them per pixel. That lets vertices be welded, which is what makes the data small.
 * Each tile gets three levels of detail, compressed with meshoptimizer.
 *
 * Usage: node scripts/build_city.mjs <path to data/berlin-9km>
 * Output: public/city/manifest.json and public/city/<tile>-<lod>.bin
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(path.join(SRC, 'tileset.json'))) {
  console.error('usage: build_city.mjs <dir holding tileset.json>');
  process.exit(2);
}
const OUT = new URL('../../public/city/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// Fernsehturm base, the scene's origin. Keep in step with src/lib/landmarks.ts and elevation.ts.
const TOWER = { lat: 52.520815, lon: 13.409419, orthometric: 34.6, undulation: 39.5 };
const WELD_M = 0.02;
/** Geometric error allowed at each level, metres. Zero keeps every face. */
const LODS = [0, 1.5, 6];

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

function readTile(file) {
  const b = fs.readFileSync(file);
  const skip = 28 + b.readUInt32LE(12) + b.readUInt32LE(16) + b.readUInt32LE(20) + b.readUInt32LE(24);
  const glb = b.subarray(skip);
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const bin = glb.subarray(20 + jsonLength + 8);
  const view = (accessor) => {
    const v = gltf.bufferViews[accessor.bufferView];
    return bin.subarray((v.byteOffset ?? 0) + (accessor.byteOffset ?? 0), (v.byteOffset ?? 0) + v.byteLength);
  };
  const positions = [];
  const indices = [];
  for (const mesh of gltf.meshes) {
    for (const p of mesh.primitives) {
      const pa = gltf.accessors[p.attributes.POSITION];
      const raw = view(pa);
      const first = positions.length / 3;
      for (let i = 0; i < pa.count; i++) {
        positions.push(raw.readFloatLE(i * 12), raw.readFloatLE(i * 12 + 4), raw.readFloatLE(i * 12 + 8));
      }
      const ia = gltf.accessors[p.indices];
      const rawI = view(ia);
      const width = ia.componentType === 5125 ? 4 : 2;
      for (let i = 0; i < ia.count; i++) {
        indices.push(first + (width === 4 ? rawI.readUInt32LE(i * 4) : rawI.readUInt16LE(i * 2)));
      }
    }
  }
  return { positions, indices };
}

/** Column-major tile transform to ECEF, then to east, up, minus north about the tower. */
function toScene({ positions }, m) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    const dx = m[0] * x + m[4] * y + m[8] * z + m[12] - origin[0];
    const dy = m[1] * x + m[5] * y + m[9] * z + m[13] - origin[1];
    const dz = m[2] * x + m[6] * y + m[10] * z + m[14] - origin[2];
    out[i] = -so * dx + co * dy;
    out[i + 1] = cl * co * dx + cl * so * dy + sl * dz;
    out[i + 2] = -(-sl * co * dx - sl * so * dy + cl * dz);
  }
  return out;
}

function weld(positions, indices) {
  const seen = new Map();
  const remap = new Uint32Array(positions.length / 3);
  const kept = [];
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.round(positions[i * 3] / WELD_M)},${Math.round(positions[i * 3 + 1] / WELD_M)},${Math.round(positions[i * 3 + 2] / WELD_M)}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = kept.length / 3;
      seen.set(key, at);
      kept.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    remap[i] = at;
  }
  const welded = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]];
    if (a !== b && b !== c && a !== c) welded.push(a, b, c);
  }
  return { positions: new Float32Array(kept), indices: new Uint32Array(welded) };
}

function encode(positions, indices) {
  const triangles = indices.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const used = new Uint8Array(positions.length / 3);
  for (const i of indices) used[i] = 1;
  for (let v = 0; v < used.length; v++) {
    if (!used[v]) continue;
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[v * 3 + a]);
      max[a] = Math.max(max[a], positions[v * 3 + a]);
    }
  }
  const step = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1) / 65535;
  const reindexed = indices.slice();
  const [remap, vertexCount] = MeshoptEncoder.reorderMesh(reindexed, true, true);
  const quantised = new Uint16Array(vertexCount * 4);
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v];
    if (to === 0xffffffff) continue;
    for (let a = 0; a < 3; a++) {
      quantised[to * 4 + a] = Math.round((positions[v * 3 + a] - min[a]) / step);
    }
  }
  const vb = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(quantised.buffer), vertexCount, 8);
  const ib = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(reindexed.buffer), reindexed.length, 4);
  const header = new Uint32Array([vb.length, ib.length]);
  const file = Buffer.concat([Buffer.from(header.buffer), Buffer.from(vb), Buffer.from(ib)]);
  return { file, triangles, vertices: vertexCount, indexCount: reindexed.length, min, max, step };
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const tileset = JSON.parse(fs.readFileSync(path.join(SRC, 'tileset.json'), 'utf8'));
const tiles = [];
const totals = LODS.map(() => ({ triangles: 0, bytes: 0, gzip: 0 }));
const started = Date.now();
for (const child of tileset.root.children) {
  const uri = child.content.uri;
  const id = uri.replace('.b3dm', '');
  const source = readTile(path.join(SRC, uri));
  const welded = weld(toScene(source, child.transform), source.indices);
  if (welded.indices.length === 0) continue;
  const lods = [];
  LODS.forEach((error, level) => {
    let indices = welded.indices;
    if (error > 0) {
      const [simplified] = MeshoptSimplifier.simplify(indices, welded.positions, 3, 0, error, ['ErrorAbsolute', 'Prune']);
      indices = new Uint32Array(simplified);
    }
    if (indices.length === 0) return;
    const e = encode(welded.positions, indices);
    fs.writeFileSync(path.join(OUT, `${id}-${level}.bin`), e.file);
    totals[level].triangles += e.triangles;
    totals[level].bytes += e.file.length;
    totals[level].gzip += zlib.gzipSync(e.file, { level: 6 }).length;
    lods.push({ level, error, triangles: e.triangles, vertices: e.vertices, indexCount: e.indexCount, min: e.min, max: e.max, step: e.step, bytes: e.file.length });
  });
  tiles.push({ id, lods });
  if (tiles.length % 50 === 0) console.log(`${tiles.length} tiles, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ tiles }));
console.log(`done: ${tiles.length} tiles in ${((Date.now() - started) / 1000).toFixed(0)} s`);
totals.forEach((t, i) => console.log(`LOD${i} (${LODS[i]} m): ${(t.triangles / 1e6).toFixed(2)} M triangles, ${(t.bytes / 1e6).toFixed(1)} MB, ${(t.gzip / 1e6).toFixed(1)} MB gzipped`));
