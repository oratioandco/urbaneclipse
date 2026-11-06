/**
 * Standing in the city: looking around by dragging, a lens instead of a zoom, and the maths to
 * turn a heading and a pitch into a view. Headings are compass degrees, pitch is up from level.
 */
import * as THREE from 'three';
import { SENSOR_FORMATS } from '../lib/lensScale.ts';

export { SENSOR_FORMATS };
export { EYE_HEIGHT } from './towerShots.js';

/**
 * Phones and drones: a few fixed lenses each, given as full-frame equivalents, which is how
 * they are sold and compared. Generic classes rather than models, as the line-ups change yearly.
 */
export const FIXED_FORMATS = [
  { id: 'phone', label: 'Phone', width: 36, lenses: [13, 24, 48, 77, 120], names: ['0.5\u00d7', '1\u00d7', '2\u00d7', '3\u00d7', '5\u00d7'] },
  { id: 'drone-1', label: 'Drone, one camera', width: 36, lenses: [24] },
  { id: 'drone-2', label: 'Drone, two cameras', width: 36, lenses: [24, 70] },
  { id: 'drone-3', label: 'Drone, three cameras', width: 36, lenses: [24, 70, 166] },
];
export const FORMATS = [...SENSOR_FORMATS, ...FIXED_FORMATS];

/** The camera being simulated. Full-frame unless the photographer picked another format. */
export const camera = { format: SENSOR_FORMATS.find((f) => f.id === 'ff') };

/**
 * Vertical field of view on screen, degrees. The sensor's long side runs across a landscape
 * screen and up a portrait one, as a photographer would hold the camera.
 */
export function fovForLens(mm, format = camera.format) {
  const aspect = innerWidth / innerHeight;
  const along = Math.atan(format.width / (2 * mm));
  const vertical = aspect >= 1 ? Math.atan(Math.tan(along) / aspect) : along;
  return (2 * vertical * 180) / Math.PI;
}

/** The focal length that gives a vertical field of view on screen, radians. */
export function lensForFov(fov, format = camera.format) {
  const aspect = innerWidth / innerHeight;
  const along = aspect >= 1 ? Math.atan(Math.tan(fov / 2) * aspect) : fov / 2;
  return format.width / (2 * Math.tan(along));
}

export const lensRange = (format = camera.format) => (format.lenses ? [format.lenses[0], format.lenses[format.lenses.length - 1]] : [format.minFocal, format.maxFocal]);

/** The fixed lens nearest a focal length, judged by framing (a ratio), not by millimetres. */
function nearestLens(mm, lenses) {
  return lenses.reduce((best, lens) => (Math.abs(Math.log(lens / mm)) < Math.abs(Math.log(best / mm)) ? lens : best));
}

/** One lens along for a fixed-lens camera: +1 longer, -1 wider. */
export function stepLens(state, direction, onChange) {
  const lenses = camera.format.lenses;
  if (!lenses) return;
  const i = Math.max(0, Math.min(lenses.length - 1, lenses.indexOf(nearestLens(state.lens, lenses)) + direction));
  state.lens = lenses[i];
  onChange();
}

/** Switch format, keeping the framing: the focal length scales with the sensor. */
export function setFormat(state, id, onChange) {
  const next = FORMATS.find((f) => f.id === id);
  if (!next) return;
  const mm = state.lens * (next.width / camera.format.width);
  camera.format = next;
  setLens(state, mm, onChange);
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassName = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function lookDirection(heading, pitch, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(heading);
  const p = THREE.MathUtils.degToRad(pitch);
  return out.set(Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p));
}

/** Drag to look around, wheel or pinch to change lens. Calls `onChange` after each change. */
export function attachLook(element, state, onChange) {
  const pointers = new Map();
  let pinch = 0;
  let wheelTravel = 0;
  const down = (event) => {
    if (!state.active) return;
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const move = (event) => {
    if (!state.active || !pointers.has(event.pointerId)) return;
    const last = pointers.get(event.pointerId);
    if (pointers.size === 1) {
      // Grab the scene: what is under the finger stays under it, whatever the lens.
      const degreesPerPixel = fovForLens(state.lens) / element.clientHeight;
      state.heading -= (event.clientX - last.x) * degreesPerPixel;
      state.pitch = THREE.MathUtils.clamp(state.pitch + (event.clientY - last.y) * degreesPerPixel, -35, 70);
      onChange();
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && camera.format.lenses) {
        if (spread / pinch > 1.35 || spread / pinch < 1 / 1.35) {
          stepLens(state, spread > pinch ? 1 : -1, onChange);
          pinch = spread;
        }
      } else {
        if (pinch > 0) setLens(state, state.lens * (spread / pinch), onChange);
        pinch = spread;
      }
    }
  };
  const up = (event) => {
    pointers.delete(event.pointerId);
    pinch = 0;
  };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', up);
  element.addEventListener(
    'wheel',
    (event) => {
      if (!state.active) return;
      event.preventDefault();
      if (camera.format.lenses) {
        // A fixed-lens camera clicks from lens to lens, once per deliberate scroll.
        wheelTravel += event.deltaY;
        if (Math.abs(wheelTravel) > 60) {
          stepLens(state, wheelTravel < 0 ? 1 : -1, onChange);
          wheelTravel = 0;
        }
      } else setLens(state, state.lens * Math.exp(-event.deltaY * 0.0015), onChange);
    },
    { passive: false },
  );
}

export function setLens(state, mm, onChange) {
  const [min, max] = lensRange();
  const clamped = THREE.MathUtils.clamp(mm, min, max);
  state.lens = camera.format.lenses ? nearestLens(clamped, camera.format.lenses) : clamped;
  onChange();
}

/** Latitude and longitude to scene metres, on the transverse Mercator the build scripts use. */
export function sceneFromLatLon(lat, lon, lat0, lon0) {
  const rad = Math.PI / 180;
  const a = 6378137;
  const e2 = 0.00669437999014;
  const meridian = (phi) => a * ((1 - e2 / 4 - (3 * e2 * e2) / 64) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256) * Math.sin(4 * phi));
  const phi = lat * rad;
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const across = Math.cos(phi) * (lon - lon0) * rad;
  const east = n * (across + ((1 - Math.tan(phi) ** 2) * across ** 3) / 6);
  const north = meridian(phi) - meridian(lat0 * rad) + n * Math.tan(phi) * (across ** 2 / 2);
  return [east, -north];
}

/** Scene metres back to latitude and longitude: sceneFromLatLon run backwards by correction. */
export function latLonFromScene(x, z, lat0, lon0) {
  const metresPerDegLat = 111_320;
  let lat = lat0 - z / metresPerDegLat;
  let lon = lon0 + x / (metresPerDegLat * Math.cos((lat0 * Math.PI) / 180));
  for (let i = 0; i < 4; i++) {
    const [ex, ez] = sceneFromLatLon(lat, lon, lat0, lon0);
    lat -= (z - ez) / metresPerDegLat;
    lon += (x - ex) / (metresPerDegLat * Math.cos((lat * Math.PI) / 180));
  }
  return [lat, lon];
}
