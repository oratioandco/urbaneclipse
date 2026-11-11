/**
 * From here, at a glance: the horizon as a strip above the camera rows. Your facing holds
 * the middle; the cardinal points scroll past as you turn, the sun and moon sit at their
 * bearings — height on the strip is height in the sky — and the tower carries its distance,
 * so "which way and how far" is one look while framing. A tap on any of the three turns to
 * face it. Nothing here is only for looking.
 */
import { controls, eyeCamera } from './render.js';
import { look } from './eyeLevel.js';
import { compassName } from './eye.js';
import { app } from './state.js';

const canvas = document.getElementById('horizon');
const SPAN = 130; // Degrees of horizon the strip shows; the facing stays at the middle.
const H = 30;

/** The view's compass bearing: the look's heading at eye level, the orbit's the other way round. */
const viewHeading = () =>
  app.camera === eyeCamera
    ? ((look.heading % 360) + 360) % 360
    : (((-controls.getAzimuthalAngle() * 180) / Math.PI) % 360 + 360) % 360;

/** Where "here" is, in scene metres. */
const here = () => (app.camera === eyeCamera ? look : controls.target);

let pick = null;
/** eyeLevel registers the turn; this module stays out of the look machinery. */
export function setPickHandler(fn) {
  pick = fn;
}

let hits = [];

export function renderHorizon() {
  if (!canvas || canvas.clientWidth === 0) return; // Plan mode hides the camera rows.
  const w = canvas.clientWidth;
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  const css = getComputedStyle(document.body);
  const ink = css.getPropertyValue('--ink').trim() || '#24221f';
  const muted = css.getPropertyValue('--muted').trim() || '#6f6a62';
  const sunCol = css.getPropertyValue('--sun').trim() || '#f26a12';
  const moonCol = css.getPropertyValue('--moon').trim() || '#5b82ff';
  const heading = viewHeading();
  const px = w / SPAN;
  const mid = w / 2;
  const wrap = (deg) => ((((deg - heading) % 360) + 540) % 360) - 180;
  const fade = (delta) => 1 - Math.min(1, Math.abs(delta) / (SPAN / 2)) ** 2.4;

  // The cardinals, scrolling with the view.
  ctx.textAlign = 'center';
  for (let deg = 0; deg < 360; deg += 15) {
    const delta = wrap(deg);
    if (Math.abs(delta) > SPAN / 2) continue;
    const x = mid + delta * px;
    const a = fade(delta);
    const cardinal = deg % 90 === 0;
    ctx.globalAlpha = a * (cardinal ? 0.9 : 0.45);
    ctx.fillStyle = ink;
    const top = cardinal ? 4 : deg % 45 === 0 ? 7 : 9;
    ctx.fillRect(x - 0.5, top, 1, cardinal ? 6 : 4);
    if (cardinal) {
      ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(['N', 'E', 'S', 'W'][deg / 90], x, 19);
    } else if (deg % 45 === 0) {
      ctx.font = '500 7.5px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = muted;
      ctx.fillText(['NE', 'SE', 'SW', 'NW'][(deg - 45) / 90], x, 19);
    }
  }

  // A notch for the facing, at the strip's middle.
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ink;
  ctx.fillRect(mid - 0.5, 0, 1, 4);

  hits = [];
  const mark = (x, y, draw_, kind, az, label) => {
    hits.push({ x, y, kind, az });
    draw_(x, y);
    if (label) {
      ctx.font = '600 8.5px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(label, x, H - 1.5);
    }
  };

  // The sun and moon, at their bearings; high in the sky sits high on the strip.
  for (const body of app.bodies) {
    const delta = wrap(body.az);
    if (Math.abs(delta) > SPAN / 2) continue;
    const x = mid + delta * px;
    const y = 15 - Math.min(1, Math.max(0, body.alt) / 60) * 8;
    ctx.globalAlpha = fade(delta);
    if (body.moon) {
      mark(x, y, (cx, cy) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = moonCol;
        ctx.fill();
      }, 'moon', body.az, null);
    } else {
      mark(x, y, (cx, cy) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = sunCol;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }, 'sun', body.az, null);
    }
  }

  // The tower, with its distance: the one landmark every shot is measured against.
  const p = here();
  const dx = -p.x;
  const dz = -p.z;
  const dist = Math.hypot(dx, dz);
  const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  const delta = wrap(bearing);
  const label = dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(1)} km`;
  const clamped = Math.abs(delta) > SPAN / 2 - 8;
  const x = mid + Math.max(-SPAN / 2 + 8, Math.min(SPAN / 2 - 8, delta)) * px;
  ctx.globalAlpha = clamped ? 0.55 : 0.95;
  mark(x, 12, (cx, cy) => {
    ctx.beginPath();
    if (clamped) {
      // Off the strip: a chevron says which side it lies on.
      const dir = delta > 0 ? 1 : -1;
      ctx.moveTo(cx - 3 * dir, cy - 3.5);
      ctx.lineTo(cx + 1.5 * dir, cy);
      ctx.lineTo(cx - 3 * dir, cy + 3.5);
    } else {
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx + 3.5, cy + 3);
      ctx.lineTo(cx - 3.5, cy + 3);
    }
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
  }, 'tower', bearing, label);

  ctx.globalAlpha = 1;
  const rel = (deg) => {
    const d = Math.round(Math.abs(wrap(deg)));
    const side = wrap(deg) < 0 ? 'left' : 'right';
    return d < 6 ? 'ahead' : `${d}° to your ${side}`;
  };
  const parts = [];
  for (const body of app.bodies) parts.push(`${body.moon ? 'moon' : 'sun'} ${rel(body.az)}`);
  parts.push(`tower ${label}, ${rel(bearing)} (${compassName(bearing)})`);
  canvas.setAttribute('aria-label', `Horizon from here: ${parts.join('; ')}`);
}

const NEAR = 16;
canvas.addEventListener('click', (e) => {
  const box = canvas.getBoundingClientRect();
  const x = e.clientX - box.left;
  const y = e.clientY - box.top;
  let best = null;
  let bestD = NEAR;
  for (const hit of hits) {
    const d = Math.hypot(hit.x - x, hit.y - y);
    if (d < bestD) {
      bestD = d;
      best = hit;
    }
  }
  if (best) pick?.(best.kind, best.az);
});

controls.addEventListener('change', () => renderHorizon());
