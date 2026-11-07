/**
 * Where am I: stand at the device's own position, facing the TV tower, so the line in the
 * camera card and the dates list speak for the spot you are actually on.
 */
import * as THREE from 'three';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { EYE_HEIGHT, sceneFromLatLon } from './eye.js';
import { enterEye, fullFrame } from './eyeLevel.js';
import { cityUniforms } from './shading.js';
import { toast } from './share.js';
import { standable } from './sightlines.js';
import { app } from './state.js';
import { SPHERE_CENTRE_AGL } from './towerShots.js';

const button = document.getElementById('locate');

function standHere(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const [x, z] = sceneFromLatLon(latitude, longitude, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const half = cityUniforms.uHalf.value - 100;
  if (Math.abs(x) > half || Math.abs(z) > half) {
    toast(`You are ${(Math.hypot(x, z) / 1000).toFixed(0)} km from the TV tower, beyond the model's 9 km`, 4000);
    return;
  }
  // Indoors or under a roof the position lands in a building; the nearest open street is better.
  const spot = standable(new THREE.Vector3(x, app.groundAt(x, z), z));
  const distance = Math.hypot(spot.x, spot.z) || 1;
  const heading = (THREE.MathUtils.radToDeg(Math.atan2(-spot.x, spot.z)) + 360) % 360;
  const pitch = THREE.MathUtils.radToDeg(Math.atan2(app.groundAt(0, 0) + SPHERE_CENTRE_AGL - app.groundAt(spot.x, spot.z) - EYE_HEIGHT, distance));
  enterEye(spot.x, spot.z, { heading, pitch, lens: fullFrame(50) });
  const moved = Math.hypot(spot.x - x, spot.z - z);
  toast(moved > 15 ? `Standing in the open street nearest you, ${Math.round(moved)} m away` : accuracy > 40 ? `Standing where you are, give or take ${Math.round(accuracy)} m` : 'Standing where you are, facing the TV tower');
}

button.addEventListener('click', () => {
  if (!navigator.geolocation) {
    toast('This browser cannot tell where you are');
    return;
  }
  toast('Finding where you are…', 0);
  navigator.geolocation.getCurrentPosition(standHere, (error) => toast(error.code === 1 ? 'Location is turned off for this site' : 'Could not find where you are', 3500), {
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 10_000,
  });
});
