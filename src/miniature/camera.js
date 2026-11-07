/** Moving the overview: turning and tilting it, and gliding it to a place. */
import * as THREE from 'three';
import { FOV, controls, overview } from './render.js';
import { app, invalidate, smooth } from './state.js';

export function worldHeightNow() {
  return 2 * overview.position.distanceTo(controls.target) * Math.tan((FOV * Math.PI) / 360);
}

/** Turn and tilt the overview smoothly; null keeps a value as it is. */
app.orbitAnimation = null;
export function orbitTo(polar, azimuth, ms = 700) {
  const offset = new THREE.Spherical().setFromVector3(overview.position.clone().sub(controls.target));
  let to = azimuth ?? offset.theta;
  to = offset.theta + ((((to - offset.theta) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  app.orbitAnimation = { from: offset.clone(), polar: polar ?? offset.phi, azimuth: to, start: performance.now(), ms };
  invalidate();
}

export function stepOrbit(now) {
  if (!app.orbitAnimation) return;
  const { from, polar, azimuth, start, ms } = app.orbitAnimation;
  const t = smooth(Math.min(1, (now - start) / ms), 0, 1);
  const at = new THREE.Spherical(from.radius, THREE.MathUtils.lerp(from.phi, polar, t) + 1e-4, THREE.MathUtils.lerp(from.theta, azimuth, t));
  overview.position.setFromSpherical(at).add(controls.target);
  overview.lookAt(controls.target);
  app.shadowsDirty = true;
  app.dirty = true;
  if (t >= 1) app.orbitAnimation = null;
}

app.flight = null;
export function flyTo(x, z) {
  app.flight = { from: controls.target.clone(), to: new THREE.Vector3(x, 0, z), start: performance.now() };
  invalidate();
}

export function stepFlight(now) {
  if (!app.flight) return;
  const t = Math.min(1, (now - app.flight.start) / 700);
  const eased = t * t * (3 - 2 * t);
  const next = app.flight.from.clone().lerp(app.flight.to, eased);
  const delta = next.sub(controls.target);
  controls.target.add(delta);
  app.camera.position.add(delta);
  app.shadowsDirty = true;
  app.dirty = true;
  if (t === 1) app.flight = null;
}
