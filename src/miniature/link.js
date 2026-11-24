/**
 * The address holds the day, the time and, at eye level, where you stand, so a link opens the
 * same shot: ?date=2027-03-22&time=1020&at=52.5,13.4&look=268,2&lens=200&cam=ff
 */
import * as THREE from 'three';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { cityUniforms } from './shading.js';
import { camera as cameraFormat, FORMATS, latLonFromScene, lensRange, sceneFromLatLon } from './eye.js';
import { dateInput, instant, setFine, timeInput } from './clock.js';
import { findShot, shotKey } from './dayShots.js';
import { currentRows, dayVerdict, openShot, showTicket, ticketShotRow } from './daylist.js';
import { getViewshed, landmarksSettled } from './plan.js';
import { setPanelMode } from './planmode.js';
import { params } from './config.js';
import { enterEye, look } from './eyeLevel.js';
import { eyeCamera } from './render.js';
import { app } from './state.js';
import { showFlight } from './walk.js';

// Shared links open the same view: ?date=2027-03-22&time=1020&at=52.5,13.4&look=268,2&lens=200&cam=ff
let lastLink = '';
let lastLinkCheck = 0;
function linkQuery() {
  const q = new URLSearchParams();
  q.set('date', dateInput.value);
  q.set('time', String(Math.round(Number(timeInput.value) * 12) / 12).replace(/(\.\d{3})\d+$/, '$1'));
  if (app.camera === eyeCamera && look.active) {
    const [lat, lon] = latLonFromScene(look.x, look.z, FERNSEHTURM.lat, FERNSEHTURM.lon);
    q.set('at', `${lat.toFixed(6)},${lon.toFixed(6)}`);
    q.set('look', `${Math.round((((look.heading % 360) + 360) % 360) * 10) / 10},${Math.round(look.pitch * 10) / 10}`);
    q.set('lens', String(Math.round(look.lens)));
    q.set('cam', cameraFormat.format.id);
    if (look.mode === 'drone') q.set('fly', String(Math.round(look.lift ?? 0)));
    // Which shot this view was opened for, so a reload or a shared link shows its card again.
    // `here` says the spot in `at` is the one to stand on (it was searched for, or walked to).
    const shot = ticketShotRow();
    if (shot) {
      q.set('shot', shotKey(shot));
      q.set('here', '1');
    }
  }
  // Developer options stay put.
  for (const key of ['nointro', 'stats', 'shadow', 'budget', 'mirror', 'samples', 'blur', 'glass']) if (params.has(key)) q.set(key, params.get(key));
  return q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/=(&|$)/g, '$1');
}
export function syncLink(now) {
  if (now - lastLinkCheck < 400 || !window.__ready) return;
  lastLinkCheck = now;
  const query = linkQuery();
  if (query === lastLink) return;
  lastLink = query;
  history.replaceState(null, '', `${location.pathname}?${query}`);
}
/**
 * A link that names its shot (`shot=sphere-sun`, `antenna-moon`, `viktoria-sun`, `street-sun:Sonnenallee`; the
 * home page's cards) opens it as a tap on its card would: the planner finds the day's row,
 * searches for a confirmed clear spot to stand on and puts the shot's card on the ticket.
 * False when the day has no such row (the layer is switched off, or the link is old): the
 * link's own `at` and `look` then open the view as before.
 */
async function openLinkedShot(key) {
  // The rows are checked against the buildings once the viewsheds are in: wait for them, briefly.
  for (let i = 0; i < 40 && !(app.dayReady && getViewshed() && landmarksSettled()); i++) await new Promise((resolve) => setTimeout(resolve, 150));
  const row = findShot(currentRows(), key, instant().getTime());
  if (!row) return false;
  setPanelMode('shoot');
  openShot(row, dayVerdict(row));
  return true;
}

/** The card of a link's shot on the ticket, once the day's rows are there; the view is the link's own. */
async function nameLinkedShot(key) {
  for (let i = 0; i < 40 && !(app.dayReady && getViewshed() && landmarksSettled()); i++) await new Promise((resolve) => setTimeout(resolve, 150));
  const row = findShot(currentRows(), key, instant().getTime());
  if (row) showTicket(row, dayVerdict(row));
}

/** Open the view a shared link names, once the city is there to stand in. */
export async function openLinkedView() {
  const shot = params.get('shot');
  // The planner's own links carry the spot it stood on (`here`): open there, and name the shot.
  if (shot && !params.has('here') && (await openLinkedShot(shot))) return;
  if (shot && params.has('here')) nameLinkedShot(shot);
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
  // A drone link opens in the air, at its height (the EU open category's 120 m at most).
  const fly = Math.min(120, Math.max(0, Number(params.get('fly')) || 0));
  enterEye(x, z, { heading: Number.isFinite(heading) ? heading : 0, pitch: Number.isFinite(pitch) ? pitch : 0, lens, ...(params.has('fly') ? { mode: 'drone', lift: fly } : {}) });
  if (params.has('fly')) showFlight();
  // A time to the second came from fine timing; open it that way.
  if (!Number.isInteger(Number(params.get('time')))) setFine(true);
}
