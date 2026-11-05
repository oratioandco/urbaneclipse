/**
 * Everything that stays flat to the screen: street names, pills pointing to the sun and moon,
 * and where to stand on a lit-up street. A plain canvas redrawn when the view changes.
 */
import { litDiscPath } from '../../../src/lib/moonPhase.ts';
import { cssRgb, moonLook, sunLook } from '../../../src/lib/mapBodyLook.ts';

const canvas = document.getElementById('labels');
const ctx = canvas.getContext('2d');
const GRID = 14;
/** Above this many metres a pixel, a class of road is too small to name. */
const MAX_METRES_PER_PX = [11, 6, 3.2, 1.9];
const FONT = ['600 13px', '500 12.5px', '500 12px', '400 11.5px'];
const MAX_LABELS = 110;
const SAME_NAME_PX = 340;

let anchors = [];
let names = [];
const widths = new Map();
let dpr = 1;

export function resizeOverlay() {
  dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}

export function setLabels(map, groundAt) {
  names = map.names;
  anchors = map.anchors
    .map(([name, x, z, angle, run, level]) => ({ name, x, y: groundAt(x, z) + 2, z, cos: Math.cos(angle), sin: Math.sin(angle), run, level }))
    .sort((a, b) => a.level - b.level || b.run - a.run);
}

function textWidth(name, level) {
  const key = `${level}:${name}`;
  let width = widths.get(key);
  if (width === undefined) {
    ctx.font = `${FONT[level]} ui-sans-serif, system-ui, sans-serif`;
    width = ctx.measureText(names[name] ?? name).width;
    widths.set(key, width);
  }
  return width;
}

function drawName(text, x, y, angle, font, fill, halo) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `${font} ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawDisc(look, x, y, radius, moon) {
  if (moon) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radius, radius);
    ctx.fillStyle = '#20263a';
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cssRgb(look.core);
    ctx.fill(new Path2D(litDiscPath(moon.fraction, moon.waxing)));
    ctx.restore();
    return;
  }
  const disc = ctx.createRadialGradient(x, y, 0, x, y, radius);
  disc.addColorStop(0, cssRgb(look.core));
  disc.addColorStop(0.65, cssRgb(look.core));
  disc.addColorStop(1, cssRgb(look.limb));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

const PILL_H = 30;

/**
 * A compass pill, not a sun in the scene: the arrow says which way the body lies, whereas a
 * disc on the map would be read as a position that the shadows then seem to contradict.
 */
function drawPill({ text, look, moon, x, y, ux, uy, night }) {
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  const width = 40 + ctx.measureText(text).width + 12;
  const left = x - width / 2;
  const top = y - PILL_H / 2;
  ctx.fillStyle = night ? 'rgba(20, 23, 38, 0.86)' : 'rgba(255, 253, 249, 0.92)';
  ctx.beginPath();
  ctx.roundRect(left, top, width, PILL_H, PILL_H / 2);
  ctx.fill();
  drawDisc(look, left + 16, y, 7.5, moon);
  ctx.fillStyle = night ? '#ece8df' : '#24221f';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 29, y + 0.5);
  // The arrow sits on the pill's rim on the side the body lies.
  const reach = Math.min(Math.abs(ux) > 1e-3 ? width / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-3 ? PILL_H / 2 / Math.abs(uy) : Infinity);
  ctx.save();
  ctx.translate(x + ux * (reach + 7), y + uy * (reach + 7));
  ctx.rotate(Math.atan2(uy, ux));
  ctx.fillStyle = night ? '#ece8df' : '#24221f';
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-4, -6);
  ctx.lineTo(-4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * @param scene.bodies [{ az, alt, sunAlt, moon? }] above the horizon
 * @param scene.stands [{ x, y, z, name, colour }] lit-up streets
 */
export function drawOverlay({ camera, target, night, bodies, stands, bottomInset }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements;
  const w2 = innerWidth / 2;
  const h2 = innerHeight / 2;
  const ortho = camera.isOrthographicCamera;
  const p11 = camera.projectionMatrix.elements[5];
  const project = (x, y, z, out) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    out.w = w;
    if (w <= 0) return false;
    out.x = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * w2;
    out.y = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * h2;
    return true;
  };
  const fill = night ? 'rgba(255, 240, 222, 0.92)' : 'rgba(46, 42, 36, 0.92)';
  const halo = night ? 'rgba(10, 12, 24, 0.8)' : 'rgba(255, 253, 248, 0.86)';
  const taken = new Set();
  const placed = [];
  const here = {};
  const a = {};
  const b = {};

  const reserve = (x, y, cos, sin, half) => {
    const cells = [];
    for (let s = -half; s <= half; s += GRID * 0.7) {
      for (const n of [-7, 7]) {
        const key = (Math.floor((x + cos * s - sin * n) / GRID) * 8192) + Math.floor((y + sin * s + cos * n) / GRID);
        if (taken.has(key)) return false;
        cells.push(key);
      }
    }
    for (const key of cells) taken.add(key);
    return true;
  };

  for (const s of stands) {
    if (!project(s.x, s.y, s.z, here)) continue;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = s.css;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(here.x, here.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    reserve(here.x, here.y - 18, 1, 0, 60);
    drawName(s.name, here.x, here.y - 18, 0, '700 13px', fill, halo);
  }

  for (const anchor of anchors) {
    if (placed.length >= MAX_LABELS) break;
    if (!project(anchor.x, anchor.y, anchor.z, here)) continue;
    if (here.x < -40 || here.x > innerWidth + 40 || here.y < 0 || here.y > innerHeight - bottomInset) continue;
    const metres = ortho ? 2 / (p11 * innerHeight) : (2 * here.w) / (p11 * innerHeight);
    if (metres > MAX_METRES_PER_PX[anchor.level]) continue;
    const half = anchor.run / 2;
    if (!project(anchor.x - anchor.cos * half, anchor.y, anchor.z - anchor.sin * half, a)) continue;
    if (!project(anchor.x + anchor.cos * half, anchor.y, anchor.z + anchor.sin * half, b)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const width = textWidth(anchor.name, anchor.level);
    if (length < width * 1.05) continue;
    const cos = dx / length;
    const sin = dy / length;
    if (placed.some((p) => p.name === anchor.name && Math.hypot(p.x - here.x, p.y - here.y) < SAME_NAME_PX)) continue;
    if (!reserve(here.x, here.y, cos, sin, width / 2 + 4)) continue;
    const angle = Math.atan2(sin, cos);
    const upright = angle > Math.PI / 2 ? angle - Math.PI : angle < -Math.PI / 2 ? angle + Math.PI : angle;
    placed.push({ name: anchor.name, x: here.x, y: here.y, angle: upright, level: anchor.level });
  }
  for (const label of placed) drawName(names[label.name], label.x, label.y, label.angle, FONT[label.level], fill, halo);

  if (project(0, 395, 0, here)) drawName('Fernsehturm', here.x, here.y - 14, 0, '700 13px', fill, halo);

  // Each pill sits on the view's edge, on the line from its centre toward the body.
  const pills = [];
  for (const body of bodies) {
    const az = (body.az * Math.PI) / 180;
    if (!project(target.x, target.y, target.z, a)) continue;
    if (!project(target.x + Math.sin(az) * 50, target.y, target.z - Math.cos(az) * 50, b)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const cy = (innerHeight - bottomInset) / 2;
    const reach = Math.min(Math.abs(ux) > 1e-3 ? (w2 - 76) / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-3 ? (cy - 34) / Math.abs(uy) : Infinity);
    const look = body.moon ? moonLook(body.alt, body.sunAlt, body.moon.fraction) : sunLook(body.alt);
    pills.push({ text: `${body.moon ? 'Moon' : 'Sun'} ${Math.round(body.alt)}\u00b0 up`, look, moon: body.moon, x: w2 + ux * reach, y: cy + uy * reach, ux, uy, night });
  }
  // Two bodies in nearly the same direction would otherwise stack.
  if (pills.length === 2 && Math.abs(pills[0].x - pills[1].x) < 130 && Math.abs(pills[0].y - pills[1].y) < PILL_H + 6) pills[1].y += pills[1].y >= pills[0].y ? PILL_H + 6 : -(PILL_H + 6);
  for (const pill of pills) drawPill(pill);
}
