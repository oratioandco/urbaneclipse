/** What every module shares: the redraw flags, and state that several of them change. */
import * as THREE from 'three';

/** State that several modules change. */
export const app = {};

export const smooth = THREE.MathUtils.smoothstep;

export const toDirection = (out, az, alt) => {
  const a = THREE.MathUtils.degToRad(az);
  const h = THREE.MathUtils.degToRad(alt);
  return out.set(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h));
};

app.dirty = true;
app.shadowsDirty = true;
export function invalidate() {
  app.dirty = true;
}
export function invalidateShadows() {
  app.shadowsDirty = true;
  app.dirty = true;
}

export const stats = { texel: 0, ms: 0, frames: 0, triangles: 0, calls: 0 };
