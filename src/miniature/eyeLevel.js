/** Standing in the street: arriving, which way to face, the lens and camera controls. */
import * as THREE from 'three';
import { attachLook, camera as cameraFormat, compassName, EYE_HEIGHT, FIXED_FORMATS, FORMATS, fovForLens, lensRange, lookDirection, SENSOR_FORMATS, setFormat, setLens } from './eye.js';
import { instant } from './clock.js';
import { showViewHere } from './pointer.js';
import { FOV, controls, eyeCamera, overview, renderer } from './render.js';
import { sightline } from './sightlines.js';
import { app, invalidate, invalidateShadows, smooth } from './state.js';
import { nudgeKeys, showFlight } from './walk.js';

/** A full-frame focal length on the current format, for the same framing. */
export const fullFrame = (mm) => (mm * cameraFormat.format.width) / 36;
export const look = { active: false, x: 0, y: 0, z: 0, heading: 0, pitch: 0, lens: 50 };
app.photographer = null;
let transition = null;
let savedOverview = null;

function eyePose(state) {
  const position = new THREE.Vector3(state.x, state.y + EYE_HEIGHT + (state.lift ?? 0), state.z);
  const helper = new THREE.Object3D();
  helper.position.copy(position);
  helper.lookAt(position.clone().add(lookDirection(state.heading, state.pitch)));
  // Object3D.lookAt points +z at the target; cameras look down -z, so turn round.
  helper.rotateY(Math.PI);
  return { position, quaternion: helper.quaternion.clone(), fov: fovForLens(state.lens) };
}

function overviewPose() {
  return { position: overview.position.clone(), quaternion: overview.quaternion.clone(), fov: FOV };
}

/** Which way to face on arrival: down a lined-up street, else toward the sun, moon or tower. */
function chooseView(x, z) {
  const y = app.groundAt(x, z);
  const t = instant().getTime();
  const street = app.moments.find((m) => t >= m.from - 60_000 && t <= m.to + 60_000 && Math.hypot(m.view.a[0] - x, m.view.a[1] - z) < 80);
  if (street) return { heading: street.view.bearingDeg, pitch: THREE.MathUtils.clamp(street.bodyAlt * 0.9, 0, 12), lens: fullFrame(85) };
  for (const body of app.bodies) {
    if (body.alt > -1) return { heading: body.az, pitch: THREE.MathUtils.clamp(body.alt * 0.8, 0, 25), lens: body.moon ? fullFrame(85) : fullFrame(35) };
  }
  const distance = Math.hypot(x, z) || 1;
  return { heading: (Math.atan2(-x, z) * 180) / Math.PI, pitch: THREE.MathUtils.clamp((Math.atan2(200 - y, distance) * 180) / Math.PI, 0, 30), lens: fullFrame(50) };
}

/** Keep the chosen direction unless a wall is right there; then turn to the nearest open view. */
function openView(x, z, view) {
  if (sightline(x, z, view.heading) >= 60) return view;
  let best = view;
  let bestReach = 0;
  for (const turn of [30, -30, 60, -60, 90, -90, 135, -135, 180]) {
    const reach = sightline(x, z, view.heading + turn);
    if (reach > bestReach) {
      bestReach = reach;
      best = { ...view, heading: view.heading + turn, pitch: Math.min(view.pitch, 6) };
    }
    if (reach >= 150) break;
  }
  return best;
}

export function enterEye(x, z, view = openView(x, z, chooseView(x, z))) {
  const y = app.groundAt(x, z);
  Object.assign(look, { x, y, z, lift: 0, mode: 'walk', ...view, active: false });
  app.liftAnimation = null;
  app.photographer = { x, y, z, heading: look.heading };
  app.orbitAnimation = null;
  app.flight = null;
  const wasStanding = app.camera === eyeCamera;
  const from = wasStanding ? { position: eyeCamera.position.clone(), quaternion: eyeCamera.quaternion.clone(), fov: eyeCamera.fov } : overviewPose();
  if (!wasStanding) savedOverview = { position: overview.position.clone(), target: controls.target.clone() };
  controls.enabled = false;
  app.camera = eyeCamera;
  transition = { from, to: eyePose(look), start: performance.now(), ms: wasStanding ? 900 : 1700, done: () => (look.active = true) };
  if (document.body.dataset.eye !== 'true') nudgeKeys();
  showViewHere(null);
  document.body.dataset.eye = 'true';
  updateEyeBar();
  showFlight();
  invalidateShadows();
}

export function exitEye() {
  if (!savedOverview) return;
  look.active = false;
  overview.position.copy(savedOverview.position);
  controls.target.copy(savedOverview.target);
  overview.lookAt(controls.target);
  transition = {
    from: { position: eyeCamera.position.clone(), quaternion: eyeCamera.quaternion.clone(), fov: eyeCamera.fov },
    to: overviewPose(),
    start: performance.now(),
    ms: 1400,
    done: () => {
      app.camera = overview;
      controls.enabled = true;
      document.body.dataset.eye = 'false';
    },
  };
  invalidateShadows();
}

export function stepTransition(now) {
  if (!transition) return false;
  const { from, to, start, ms } = transition;
  const raw = Math.min(1, (now - start) / ms);
  const t = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
  eyeCamera.position.lerpVectors(from.position, to.position, t);
  eyeCamera.quaternion.slerpQuaternions(from.quaternion, to.quaternion, t);
  eyeCamera.fov = THREE.MathUtils.lerp(from.fov, to.fov, t);
  if (raw >= 1) {
    const done = transition.done;
    transition = null;
    done();
  }
  return true;
}

export function placeEyeCamera() {
  if (!look.active) return;
  const pose = eyePose(look);
  eyeCamera.position.copy(pose.position);
  eyeCamera.quaternion.copy(pose.quaternion);
  eyeCamera.fov = pose.fov;
  app.photographer.heading = look.heading;
}

const lensInput = document.getElementById('lens');
const formatSelect = document.getElementById('format');
for (const [label, group] of [['Camera', SENSOR_FORMATS], ['Phone and drone', FIXED_FORMATS]]) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = label;
  for (const format of group) optgroup.append(new Option(format.label, format.id));
  formatSelect.append(optgroup);
}
const lensChips = document.getElementById('lens-chips');
let chipsFor = null;
/** A fixed-lens camera picks a lens with buttons; the others zoom with the slider. */
function showLensControl() {
  const format = cameraFormat.format;
  const fixed = Boolean(format.lenses);
  lensInput.hidden = fixed;
  lensLabel.hidden = fixed;
  lensChips.hidden = !fixed;
  if (fixed && chipsFor !== format.id) {
    chipsFor = format.id;
    lensChips.replaceChildren(
      ...format.lenses.map((mm, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.mm = String(mm);
        chip.innerHTML = format.names ? `${format.names[i]}<small>${mm}</small>` : `${mm}<small>mm</small>`;
        chip.addEventListener('click', () => setLens(look, mm, () => {
          updateEyeBar();
          invalidate();
        }));
        return chip;
      }),
    );
  }
  for (const chip of lensChips.children) chip.setAttribute('aria-pressed', String(Number(chip.dataset.mm) === look.lens));
}
try {
  const saved = localStorage.getItem('miniature.format');
  if (FORMATS.some((f) => f.id === saved)) cameraFormat.format = FORMATS.find((f) => f.id === saved);
} catch {}
formatSelect.value = cameraFormat.format.id;
formatSelect.addEventListener('change', () => {
  setFormat(look, formatSelect.value, () => {
    updateEyeBar();
    invalidate();
  });
  try {
    localStorage.setItem('miniature.format', formatSelect.value);
  } catch {}
});
const lensLabel = document.getElementById('lens-label');
const facingLabel = document.getElementById('facing');
export function updateEyeBar() {
  const [lensMin, lensMax] = lensRange();
  lensInput.value = String((Math.log(look.lens / lensMin) / Math.log(lensMax / lensMin)) * 1000);
  formatSelect.value = cameraFormat.format.id;
  showLensControl();
  lensLabel.textContent = `${Math.round(look.lens)} mm`;
  const heading = ((look.heading % 360) + 360) % 360;
  facingLabel.textContent = `Facing ${compassName(heading)} ${Math.round(heading)}\u00b0`;
  const lift = look.lift ?? 0;
  if (look.mode === 'drone') facingLabel.textContent += ` \u00b7 ${Math.round(lift)} m up`;
  else if (lift >= 1) facingLabel.textContent += ` \u00b7 on a roof, ${Math.round(lift)} m up`;
}

attachLook(renderer.domElement, look, () => {
  updateEyeBar();
  invalidateShadows();
});
lensInput.addEventListener('input', () => setLens(look, lensRange()[0] * (lensRange()[1] / lensRange()[0]) ** (Number(lensInput.value) / 1000), () => {
  updateEyeBar();
  invalidateShadows();
}));
document.getElementById('back').addEventListener('click', exitEye);

app.lookAnimation = null;
export function turnTo(heading, pitch) {
  const delta = ((((heading - look.heading) % 360) + 540) % 360) - 180;
  app.lookAnimation = { from: [look.heading, look.pitch], to: [look.heading + delta, pitch], start: performance.now() };
  invalidate();
}
export function stepLook(now) {
  if (!app.lookAnimation) return;
  const t = smooth(Math.min(1, (now - app.lookAnimation.start) / 600), 0, 1);
  look.heading = THREE.MathUtils.lerp(app.lookAnimation.from[0], app.lookAnimation.to[0], t);
  look.pitch = THREE.MathUtils.lerp(app.lookAnimation.from[1], app.lookAnimation.to[1], t);
  updateEyeBar();
  app.shadowsDirty = true;
  app.dirty = true;
  if (t >= 1) app.lookAnimation = null;
}
