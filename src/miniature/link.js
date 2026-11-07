/**
 * The address holds the day, the time and, at eye level, where you stand, so a link opens the
 * same shot: ?date=2027-03-22&time=1020&at=52.5,13.4&look=268,2&lens=200&cam=ff
 */
import * as THREE from 'three';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { cityUniforms } from './shading.js';
import { camera as cameraFormat, FORMATS, latLonFromScene, lensRange, sceneFromLatLon } from './eye.js';
import { dateInput, timeInput } from './clock.js';
import { params } from './config.js';
import { enterEye, look } from './eyeLevel.js';
import { eyeCamera } from './render.js';
import { app } from './state.js';

// Shared links open the same view: ?date=2027-03-22&time=1020&at=52.5,13.4&look=268,2&lens=200&cam=ff
let lastLink = '';
let lastLinkCheck = 0;
function linkQuery() {
  const q = new URLSearchParams();
  q.set('date', dateInput.value);
  q.set('time', timeInput.value);
  if (app.camera === eyeCamera && look.active) {
    const [lat, lon] = latLonFromScene(look.x, look.z, FERNSEHTURM.lat, FERNSEHTURM.lon);
    q.set('at', `${lat.toFixed(6)},${lon.toFixed(6)}`);
    q.set('look', `${Math.round((((look.heading % 360) + 360) % 360) * 10) / 10},${Math.round(look.pitch * 10) / 10}`);
    q.set('lens', String(Math.round(look.lens)));
    q.set('cam', cameraFormat.format.id);
  }
  // Developer options stay put.
  for (const key of ['nointro', 'stats', 'shadow', 'budget', 'mirror', 'samples', 'blur']) if (params.has(key)) q.set(key, params.get(key));
  return q.toString().replace(/%2C/g, ',').replace(/=(&|$)/g, '$1');
}
export function syncLink(now) {
  if (now - lastLinkCheck < 400 || !window.__ready) return;
  lastLinkCheck = now;
  const query = linkQuery();
  if (query === lastLink) return;
  lastLink = query;
  history.replaceState(null, '', `${location.pathname}?${query}`);
}
/** Open the view a shared link names, once the city is there to stand in. */
export function openLinkedView() {
  const at = params.get('at')?.split(',').map(Number);
  if (!at || at.length !== 2 || at.some((v) => !Number.isFinite(v))) return;
  const [x, z] = sceneFromLatLon(at[0], at[1], FERNSEHTURM.lat, FERNSEHTURM.lon);
  const half = cityUniforms.uHalf.value;
  if (Math.abs(x) > half || Math.abs(z) > half) return;
  const cam = FORMATS.find((f) => f.id === params.get('cam'));
  if (cam) cameraFormat.format = cam;
  const [heading, pitch] = (params.get('look') ?? '').split(',').map(Number);
  const [lensMin, lensMax] = lensRange();
  const lens = THREE.MathUtils.clamp(Number(params.get('lens')) || 50, lensMin, lensMax);
  enterEye(x, z, { heading: Number.isFinite(heading) ? heading : 0, pitch: Number.isFinite(pitch) ? pitch : 0, lens });
}
