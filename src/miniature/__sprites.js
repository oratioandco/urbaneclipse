
import * as THREE from 'three';
import { scene as appScene, tower, buildingMaterial } from '/src/miniature/render.js';
import { landmarks } from '/src/miniature/landmarks.js';
import { CITY } from '/src/miniature/config.js';
import { loadLevel } from '/src/miniature/tiles.js';
import { cityUniforms } from '/src/miniature/shading.js';

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(640, 640, false);
const scn = new THREE.Scene();
scn.add(new THREE.HemisphereLight(0xffffff, 0xd8d3ca, 1.7));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(-80, 120, 160); scn.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.55); fill.position.set(120, 60, -80); scn.add(fill);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 60000);

const named = { fernsehturm: tower };
// Cluster landmark entries whose bounding boxes nearly touch, so multi-part models shoot together.
const boxes = landmarks.map((o) => new THREE.Box3().setFromObject(o));
const parent = landmarks.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const centers = boxes.map((b) => b.getCenter(new THREE.Vector3()));
for (let i = 0; i < landmarks.length; i++) for (let j = i + 1; j < landmarks.length; j++) {
  if (centers[i].distanceTo(centers[j]) < 70) parent[find(i)] = find(j);
}
const clusters = new Map();
for (let i = 0; i < landmarks.length; i++) {
  const r = find(i);
  if (!clusters.has(r)) clusters.set(r, []);
  clusters.get(r).push(landmarks[i]);
}
let k = 0;
for (const group of clusters.values()) named['cluster' + k++] = group;

window.__clusters = () => Object.entries(named).map(([name, objs]) => {
  const list = Array.isArray(objs) ? objs : [objs];
  const box = new THREE.Box3(); for (const o of list) box.union(new THREE.Box3().setFromObject(o));
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  return { name, c: c.toArray().map((v) => Math.round(v)), s: s.toArray().map((v) => Math.round(v)) };
});

window.__shoot = (name, yawDeg = 14, pitchDeg = 8, pad = 1.18, boxIn = null) => {
  const objs = named[name]; if (!objs) return 'unknown ' + name;
  const list = Array.isArray(objs) ? objs : [objs];
  for (const o of list) scn.add(o);            // re-parent out of the app scene
  const box = boxIn ?? (() => { const b = new THREE.Box3(); for (const o of list) b.union(new THREE.Box3().setFromObject(o)); return b; })();
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z);
  const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
  const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(r * 3 + 200);
  cam.position.copy(c).add(d); cam.lookAt(c); cam.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  let hw = 1, hh = 1;
  for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(cx, cy, cz).sub(c);
    hw = Math.max(hw, Math.abs(p.dot(right))); hh = Math.max(hh, Math.abs(p.dot(up)));
  }
  hw *= pad; hh *= pad;
  if (hw > hh) hh = hw * 0.82; else hw = hh * 0.82;   // crop tight, square canvas
  cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
  cam.near = 1; cam.far = r * 8 + 500;
  cam.updateProjectionMatrix();
  renderer.render(scn, cam);
  return { size: s.toArray().map((v) => Math.round(v)) };
};
window.__namePair = (newName, a, b) => { named[newName] = [].concat(named[a] || [], named[b] || []); };
window.__named = named;

// Shoot a landmark together with the LoD2 tile body it crowns (the Dom's nave, the Reichstag's
// building): the models only add what the tiles lack, so a faithful sprite needs both. The tile
// cut shader in buildingMaterial trims the roofs so the additions sit on flush.
let manifest = null;
// Scratch lever: widen/shrink one tile cut (index, x, z, half, roof) so a shot can flatten the
// landmark's surroundings the way the Reichstag's own cut square does.
window.__cut = (i, x, z, half, roof) => cityUniforms.uCuts.value[i].set(x, z, half, roof);
window.__shootFull = async (name, yawDeg = 14, pitchDeg = 8, pad = 1.18, grow = 4, yMin = -4, clipR = null) => {
  const objs = Array.isArray(named[name]) ? named[name] : [named[name]];
  const box = new THREE.Box3(); for (const o of objs) box.union(new THREE.Box3().setFromObject(o));
  const search = box.clone().expandByScalar(grow);   // hosts look at the grown box; `box` stays pure
  if (!manifest) manifest = await (await fetch(`${CITY}manifest.json`)).json();
  const hosts = [];
  for (const t of manifest.tiles) {
    const coarse = t.lods[t.lods.length - 1];
    const tb = new THREE.Box3(new THREE.Vector3().fromArray(coarse.min), new THREE.Vector3().fromArray(coarse.max));
    if (tb.intersectsBox(search)) hosts.push(t);
  }
  const added = [];
  for (const t of hosts) {
    const lod = t.lods[0]; // finest
    const mesh = new THREE.Mesh(await loadLevel(t, lod), buildingMaterial);
    mesh.position.fromArray(lod.min); mesh.scale.setScalar(lod.step); mesh.updateMatrix();
    scn.add(mesh); added.push(mesh);
  }
  // Frame on the landmark's footprint grown by `grow`, dropped to the ground: the tile body
  // under it is in, the rest of the tile is out. clipR additionally clips the tile material to
  // a square of that half-width around the frame centre, so dense neighbours stay out.
  const frame = box.clone().expandByScalar(grow);
  frame.min.y = yMin;
  let planes = null;
  if (clipR) {
    const cc = frame.getCenter(new THREE.Vector3());
    planes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), cc.x + clipR),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -cc.x + clipR),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), cc.z + clipR),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -cc.z + clipR),
    ];
    renderer.localClippingEnabled = true;
    buildingMaterial.clippingPlanes = planes;
  }
  const out = __shoot(name, yawDeg, pitchDeg, pad, frame);
  if (planes) { buildingMaterial.clippingPlanes = null; renderer.localClippingEnabled = false; }
  for (const m of added) scn.remove(m);
  return { hosts: hosts.length, size: frame.getSize(new THREE.Vector3()).toArray().map((v) => Math.round(v)), ...out };
};
