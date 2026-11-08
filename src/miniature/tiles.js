/** City tiles: loading levels of detail by size on screen, within a triangle budget. */
import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer';
import { CITY, CITY_VERSION, ERROR_PX, TRIANGLE_BUDGET } from './config.js';
import { buildingMaterial, controls, eyeCamera, scene } from './render.js';
import { app, invalidate, invalidateShadows } from './state.js';

export const tiles = [];
export const loading = new Set();
app.bytesLoaded = 0;

export async function loadLevel(tile, lod) {
  const response = await fetch(`${CITY}${tile.id}-${lod.level}.bin${CITY_VERSION}`);
  const data = new Uint8Array(await response.arrayBuffer());
  app.bytesLoaded += data.length;
  const head = new Uint32Array(data.buffer, 0, 2);
  const vertices = new Uint16Array(lod.vertices * 4);
  MeshoptDecoder.decodeVertexBuffer(new Uint8Array(vertices.buffer), lod.vertices, 8, data.subarray(8, 8 + head[0]));
  const indices = new Uint32Array(lod.indexCount);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), lod.indexCount, 4, data.subarray(8 + head[0], 8 + head[0] + head[1]));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(vertices, 4), 3, 0));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const size = new THREE.Vector3().fromArray(lod.max).sub(new THREE.Vector3().fromArray(lod.min)).divideScalar(lod.step);
  geometry.boundingSphere = new THREE.Sphere(size.clone().multiplyScalar(0.5), size.length() * 0.5);
  return geometry;
}

export function showLevel(tile, level, geometry) {
  if (!tile.mesh) {
    tile.mesh = new THREE.Mesh(geometry, buildingMaterial);
    tile.mesh.castShadow = true;
    tile.mesh.receiveShadow = true;
    tile.mesh.matrixAutoUpdate = false;
    scene.add(tile.mesh);
  } else {
    if (tile.mesh.geometry !== tile.coarse) tile.mesh.geometry.dispose();
    tile.mesh.geometry = geometry;
  }
  const lod = tile.lods.find((l) => l.level === level);
  tile.mesh.position.fromArray(lod.min);
  tile.mesh.scale.setScalar(lod.step);
  tile.mesh.updateMatrix();
  tile.level = level;
  invalidateShadows();
}

export function metresPerPixelAt(point) {
  return (2 * app.camera.position.distanceTo(point) * Math.tan((app.camera.fov * Math.PI) / 360)) / innerHeight;
}

/** What the view is about: the map's centre, or where the photographer stands. */
const focusPoint = () => (app.camera === eyeCamera ? eyeCamera.position : controls.target);

export const viewFrustum = new THREE.Frustum();
export const viewMatrix = new THREE.Matrix4();
export const tileSphere = new THREE.Sphere();

/** Pick each tile's level from its size on screen, then coarsen the most distant to stay in budget. */
export function updateLevels() {
  viewMatrix.multiplyMatrices(app.camera.projectionMatrix, app.camera.matrixWorldInverse);
  viewFrustum.setFromProjectionMatrix(viewMatrix);
  const wanted = [];
  let total = 0;
  for (const tile of tiles) {
    tileSphere.center.copy(tile.center);
    tileSphere.radius = tile.radius;
    const inView = viewFrustum.intersectsSphere(tileSphere);
    const coarsest = tile.lods[tile.lods.length - 1];
    let lod = coarsest;
    if (inView) {
      const metres = metresPerPixelAt(tile.center);
      lod = tile.lods.find((l) => l.error <= ERROR_PX * metres) ?? coarsest;
      total += lod.triangles;
    }
    wanted.push({ tile, lod, inView, distance: tile.center.distanceTo(focusPoint()) });
  }
  wanted.sort((a, b) => b.distance - a.distance);
  for (const entry of wanted) {
    if (total <= TRIANGLE_BUDGET) break;
    if (!entry.inView) continue;
    const at = entry.tile.lods.indexOf(entry.lod);
    if (at < entry.tile.lods.length - 1) {
      const coarser = entry.tile.lods[at + 1];
      total += coarser.triangles - entry.lod.triangles;
      entry.lod = coarser;
    }
  }
  const toLoad = wanted
    .filter((e) => e.tile.level !== e.lod.level && !loading.has(e.tile.id))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, 6 - loading.size));
  for (const { tile, lod } of toLoad) {
    if (lod === tile.lods[tile.lods.length - 1] && tile.coarse) {
      showLevel(tile, lod.level, tile.coarse);
      continue;
    }
    loading.add(tile.id);
    loadLevel(tile, lod)
      .then((geometry) => showLevel(tile, lod.level, geometry))
      .finally(() => {
        loading.delete(tile.id);
        invalidate();
      });
  }
  if (toLoad.length > 0) invalidate();
}
