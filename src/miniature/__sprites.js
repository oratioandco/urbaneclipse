
import * as THREE from 'three';
import { scene as appScene, tower } from '/src/miniature/render.js';
import { landmarks } from '/src/miniature/landmarks.js';

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

window.__shoot = (name, yawDeg = 14, pitchDeg = 8, pad = 1.18) => {
  const objs = named[name]; if (!objs) return 'unknown ' + name;
  const list = Array.isArray(objs) ? objs : [objs];
  for (const o of list) scn.add(o);            // re-parent out of the app scene
  const box = new THREE.Box3(); for (const o of list) box.union(new THREE.Box3().setFromObject(o));
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
