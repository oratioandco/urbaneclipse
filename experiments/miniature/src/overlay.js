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
function drawPill({ text, look, moon, x, y, ux, uy, night, body }) {
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
  return { kind: 'pill', x: left, y: top, w: width, h: PILL_H, body };
}

/**
 * @param scene.bodies [{ az, alt, sunAlt, moon? }] above the horizon
 * @param scene.stands [{ x, y, z, name, colour }] lit-up streets
 * @param scene.eye { heading, pitch } when standing in the street, else null
 * @param scene.photographer { x, y, z, heading } where the photographer was put down, or null
 * @param scene.paths [{ body, faint, segments: [[{ x, y, z, t, clear, hour? }]] }] where the tower covers each body
 * @param scene.spots [{ body, x, y, z, t }] where to stand on each path at the chosen time
 * @param scene.rays [{ body, base, far, near }] the line through the tower toward each body now
 * @param scene.hourRays [{ body, hour, t, base, far }] the line through the tower at each whole hour
 * @param scene.drop { x, y, z } where a dragged photographer would land, or null
 * @returns what can be tapped: [{ kind, x, y, w, h, body?, t? }]
 */
export function drawOverlay({ camera, target, night, bodies, stands, bottomInset, eye, photographer, paths = [], spots = [], rays = [], hourRays = [], drop = null, eclipse = null, names: showNames = true }) {
  const taps = [];
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

  if (eye) {
    if (eclipse) drawEclipse(eclipse, camera, project);
    return drawEyePills({ camera, night, bodies, bottomInset, eye, taps });
  }

  const metresPerPx = (w) => (ortho ? 2 / (p11 * innerHeight) : (2 * w) / (p11 * innerHeight));
  drawHourRays(hourRays, project, night, taps, bottomInset);
  drawPaths(paths, project, night, taps);
  for (const ray of rays) drawRay(ray, project, night);
  for (const spot of spots) {
    if (!project(spot.x, spot.y, spot.z, here)) continue;
    drawGroundDisc(spot.x, spot.y, spot.z, 11 * metresPerPx(here.w), project, PATH_CSS[spot.body], 0.28);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = PATH_CSS[spot.body];
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(here.x, here.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    taps.push({ kind: 'spot', x: here.x - 16, y: here.y - 16, w: 32, h: 32, body: spot.body, t: spot.t });
  }
  if (drop && project(drop.x, drop.y, drop.z, here)) drawStandDot(drop.x, drop.y, drop.z, metresPerPx(here.w), project, night, here);

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

  for (const anchor of showNames ? anchors : []) {
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

  if (photographer && project(photographer.x, photographer.y, photographer.z, here)) {
    // A cone along the way the photographer faces, then the marker itself.
    const reach = 2 / (p11 * innerHeight) * (ortho ? 1 : here.w) * 70;
    const cone = [-18, 18].map((spread) => {
      const angle = ((photographer.heading + spread) * Math.PI) / 180;
      const end = {};
      project(photographer.x + Math.sin(angle) * reach, photographer.y, photographer.z - Math.cos(angle) * reach, end);
      return end;
    });
    ctx.fillStyle = night ? 'rgba(255, 230, 190, 0.22)' : 'rgba(40, 36, 30, 0.16)';
    ctx.beginPath();
    ctx.moveTo(here.x, here.y);
    ctx.lineTo(cone[0].x, cone[0].y);
    ctx.lineTo(cone[1].x, cone[1].y);
    ctx.closePath();
    ctx.fill();
    drawStandDot(photographer.x, photographer.y, photographer.z, 2 / (p11 * innerHeight) * (ortho ? 1 : here.w), project, night, here);
    drawPhotographer(here.x, here.y);
    taps.push({ kind: 'photographer', x: here.x - 18, y: here.y - 36, w: 36, h: 40 });
  }

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
    pills.push({ text: `${body.moon ? 'Moon' : 'Sun'} ${Math.round(body.alt)}\u00b0 up`, look, moon: body.moon, x: w2 + ux * reach, y: cy + uy * reach, ux, uy, night, body });
  }
  // Two bodies in nearly the same direction would otherwise stack.
  if (pills.length === 2 && Math.abs(pills[0].x - pills[1].x) < 130 && Math.abs(pills[0].y - pills[1].y) < PILL_H + 6) pills[1].y += pills[1].y >= pills[0].y ? PILL_H + 6 : -(PILL_H + 6);
  for (const pill of pills) taps.push(drawPill(pill));
  return taps;
}

const PATH_CSS = { sun: '#f26a12', moon: '#5b82ff' };

/** A circle lying on the ground, so it foreshortens with the view like the map under it. */
function drawGroundDisc(x, y, z, radius, project, fill, alpha) {
  const p = {};
  ctx.beginPath();
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    if (!project(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius, p)) return;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Where the photographer stands, as on a phone map: a soft halo and a ringed dot on the ground. */
function drawStandDot(x, y, z, metresPerPx, project, night, centre) {
  const ink = night ? '#ffe9c8' : '#24221f';
  drawGroundDisc(x, y, z, 28 * metresPerPx, project, ink, 0.2);
  drawGroundDisc(x, y, z, 12 * metresPerPx, project, '#fff', 1);
  drawGroundDisc(x, y, z, 8.5 * metresPerPx, project, ink, 1);
  // A dot too flat to see in a steep view still needs a centre.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The day's eclipse paths: solid where no building hides the tower, dashed where one does.
 * The hours are on the hour lines; each point here can still be tapped to go to its time.
 */
function drawPaths(paths, project, night, taps) {
  const p = {};
  for (const path of paths) {
    const colour = PATH_CSS[path.body];
    for (const segment of path.segments) {
      // Runs of one state, each drawn as its own line.
      let run = [];
      let clear = null;
      const flush = () => {
        if (run.length > 1) strokeRun(run, colour, clear, path.faint, night);
        run = [];
      };
      for (const point of segment) {
        if (!project(point.x, point.y, point.z, p) || p.x < -200 || p.x > innerWidth + 200 || p.y < -200 || p.y > innerHeight + 200) {
          flush();
          continue;
        }
        const state = point.clear !== false;
        if (state !== clear && run.length) {
          run.push({ x: p.x, y: p.y });
          flush();
        }
        clear = state;
        run.push({ x: p.x, y: p.y });
        taps.push({ kind: 'path', x: p.x - 9, y: p.y - 9, w: 18, h: 18, body: path.body, t: point.t });
      }
      flush();
    }
  }
}

/** A straight line on the ground, cut where it passes behind the camera. */
function groundLine(a, b, project) {
  const p = {};
  let open = false;
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    if (!project(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, p)) {
      open = false;
      continue;
    }
    if (open) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    open = true;
  }
}

/**
 * The hour lines: faint, each labelled where it leaves the view, so the hours sit around the
 * edge like a clock face, with the sun and moon pills, rather than on the map like names.
 */
function drawHourRays(hourRays, project, night, taps, bottomInset) {
  const top = 64;
  const bottom = innerHeight - bottomInset - 8;
  const left = 10;
  const right = innerWidth - 60;
  const placed = [];
  const p = {};
  for (const ray of hourRays) {
    groundLine(ray.base, ray.far, project);
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = PATH_CSS[ray.body];
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (ray.antenna) drawAntenna(ray.antenna, project, night, 0.45);
    // The label sits on the edge of the view in the line's direction from the tower when the
    // line runs out of view, like a clock face; otherwise on the line's end.
    if (!project(ray.base.x, ray.base.y, ray.base.z, p)) continue;
    const ox = Math.min(right - 30, Math.max(left + 30, p.x));
    const oy = Math.min(bottom - 30, Math.max(top + 30, p.y));
    const dx = ray.far.x - ray.base.x;
    const dz = ray.far.z - ray.base.z;
    const length = Math.hypot(dx, dz) || 1;
    const q = {};
    if (!project(ray.base.x + (dx / length) * 60, ray.base.y, ray.base.z + (dz / length) * 60, q)) continue;
    const sx = q.x - p.x;
    const sy = q.y - p.y;
    const s = Math.hypot(sx, sy) || 1;
    const ux = sx / s;
    const uy = sy / s;
    const reach = Math.min(ux > 0 ? (right - 16 - ox) / ux : ux < 0 ? (left + 16 - ox) / ux : Infinity, uy > 0 ? (bottom - 12 - oy) / uy : uy < 0 ? (top + 12 - oy) / uy : Infinity);
    let label = { x: ox + ux * reach, y: oy + uy * reach };
    // Where the line ends in view, the hour sits on its end: that is a real place to stand.
    const end = {};
    if (project(ray.far.x, ray.far.y, ray.far.z, end) && end.x > left + 16 && end.x < right - 16 && end.y > top + 12 && end.y < bottom - 12) {
      label = { x: end.x + ux * 14, y: end.y + uy * 14 };
    }
    if (!label || placed.some((q) => Math.hypot(q.x - label.x, q.y - label.y) < 24)) continue;
    placed.push(label);
    const text = ray.label ?? String(ray.hour).padStart(2, '0');
    ctx.font = '700 10.5px ui-sans-serif, system-ui, sans-serif';
    const width = ctx.measureText(text).width + 10;
    ctx.fillStyle = night ? 'rgba(20, 23, 38, 0.86)' : 'rgba(255, 253, 249, 0.94)';
    ctx.beginPath();
    ctx.roundRect(label.x - width / 2, label.y - 9, width, 18, 9);
    ctx.fill();
    ctx.strokeStyle = PATH_CSS[ray.body];
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = PATH_CSS[ray.body];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, label.x, label.y + 0.5);
    taps.push({ kind: 'path', x: label.x - width / 2 - 4, y: label.y - 13, w: width + 8, h: 26, body: ray.body, t: ray.t });
  }
}

/** Away from the body: bright to where the disc reaches the tower's tip. Toward it: faint. */
function drawRay(ray, project, night) {
  ctx.lineCap = 'round';
  groundLine(ray.near, ray.base, project);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = PATH_CSS[ray.body];
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  groundLine(ray.base, ray.far, project);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = night ? 'rgba(10, 12, 24, 0.6)' : 'rgba(255, 253, 248, 0.75)';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = PATH_CSS[ray.body];
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (ray.antenna) drawAntenna(ray.antenna, project, night, 1);
}

/** Where the moon sits behind the antenna and still shows: a bolder stretch with a name. */
function drawAntenna(stretch, project, night, strength) {
  groundLine(stretch.from, stretch.to, project);
  ctx.lineCap = 'round';
  ctx.strokeStyle = night ? 'rgba(10, 12, 24, 0.7)' : 'rgba(255, 253, 248, 0.85)';
  ctx.globalAlpha = strength;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = PATH_CSS.moon;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The day's path: a fine line joining where the sphere covers the body, hour by hour. */
function strokeRun(run, colour, clear, faint, night) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(run[0].x, run[0].y);
  for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
  if (clear) {
    ctx.strokeStyle = night ? 'rgba(10, 12, 24, 0.5)' : 'rgba(255, 253, 248, 0.6)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  ctx.globalAlpha = (clear ? 0.85 : 0.35) * (faint ? 0.55 : 1);
  ctx.strokeStyle = colour;
  ctx.lineWidth = clear ? 2 : 1.25;
  ctx.setLineDash(clear ? [] : [5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** The marker: a round badge with a camera, on a short stem down to the spot. */
export function drawPhotographer(x, y, context = ctx) {
  context.save();
  context.fillStyle = '#24221f';
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - 6, y - 14);
  context.lineTo(x + 6, y - 14);
  context.closePath();
  context.fill();
  context.beginPath();
  context.arc(x, y - 22, 13, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#fff';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = '#fff';
  context.beginPath();
  context.roundRect(x - 7, y - 26, 14, 9, 2);
  context.fill();
  context.fillRect(x - 3, y - 28, 6, 3);
  context.fillStyle = '#24221f';
  context.beginPath();
  context.arc(x, y - 21.5, 2.6, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/**
 * Around the sphere at eye level: a ring that tightens and brightens as the sun or moon comes
 * near, the gap in degrees beside it, and a glow once the disc is behind the sphere.
 */
function drawEclipse({ centre, radiusDeg, items }, camera, project) {
  const near = items.filter((item) => item.sepDeg < radiusDeg + 6).sort((a, b) => a.sepDeg - b.sepDeg)[0];
  const c = {};
  // Behind the antenna the sphere is beside the point; the status line says it, a ring would mislead.
  if (!near || near.state === 'antenna' || near.state === 'shaft' || !project(centre.x, centre.y, centre.z, c)) return;
  const pxPerDeg = innerHeight / camera.fov;
  const radius = (radiusDeg + 0.4) * pxPerDeg + 6;
  const colour = PATH_CSS[near.body];
  const closeness = 1 - Math.min(1, Math.max(0, (near.sepDeg - radiusDeg) / 6));
  ctx.save();
  if (near.covered) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = 22;
  }
  ctx.strokeStyle = colour;
  ctx.globalAlpha = near.covered ? 1 : 0.35 + 0.55 * closeness;
  ctx.lineWidth = near.covered ? 3.5 : 2;
  ctx.setLineDash(near.covered ? [] : [6, 6]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // The gap, written on the side the disc is on.
  const a = (near.az * Math.PI) / 180;
  const h = (near.alt * Math.PI) / 180;
  const far = {};
  if (!project(camera.position.x + Math.sin(a) * Math.cos(h) * 5000, camera.position.y + Math.sin(h) * 5000, camera.position.z - Math.cos(a) * Math.cos(h) * 5000, far)) return;
  const dx = far.x - c.x;
  const dy = far.y - c.y;
  const d = Math.hypot(dx, dy) || 1;
  const text = near.state === 'hidden' ? (near.body === 'moon' ? 'Hidden' : 'Behind the sphere') : near.state === 'ring' ? (near.body === 'moon' ? 'Sphere in front' : 'Ring of sun') : near.state === 'antenna' ? 'Behind the antenna' : near.covered ? 'At the edge' : `${(near.sepDeg - radiusDeg).toFixed(1)}\u00b0`;
  const lx = c.x + (dx / d) * (radius + 26);
  const ly = c.y + (dy / d) * (radius + 14);
  ctx.font = '700 11.5px ui-sans-serif, system-ui, sans-serif';
  const width = ctx.measureText(text).width + 14;
  ctx.fillStyle = near.covered ? colour : 'rgba(255, 253, 249, 0.92)';
  ctx.beginPath();
  ctx.roundRect(lx - width / 2, ly - 11, width, 22, 11);
  ctx.fill();
  ctx.fillStyle = near.covered ? '#fff' : colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx, ly + 0.5);
}

/** At eye level the real discs are in the sky; a pill only points to one that is out of frame. */
function drawEyePills({ camera, night, bodies, bottomInset, eye, taps }) {
  const top = 70;
  const bottom = innerHeight - bottomInset;
  const cx = innerWidth / 2;
  const cy = (top + bottom) / 2;
  const fov = camera.fov;
  const aspect = innerWidth / innerHeight;
  for (const body of bodies) {
    let yaw = (((body.az - eye.heading) % 360) + 540) % 360 - 180;
    const rise = body.alt - eye.pitch;
    const inFrame = Math.abs(yaw) < (fov * aspect) / 2 - 1 && Math.abs(rise) < fov / 2 - 1;
    if (inFrame && body.alt > -0.5) continue;
    const length = Math.hypot(yaw, rise) || 1;
    const ux = yaw / length;
    const uy = -rise / length;
    const reach = Math.min(Math.abs(ux) > 1e-3 ? (cx - 76) / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-3 ? ((bottom - top) / 2 - 24) / Math.abs(uy) : Infinity);
    const look = body.moon ? moonLook(body.alt, body.sunAlt, body.moon.fraction) : sunLook(body.alt);
    const side = Math.abs(yaw) < 2 ? '' : ` \u00b7 ${Math.round(Math.abs(yaw))}\u00b0 ${yaw > 0 ? 'right' : 'left'}`;
    taps.push(drawPill({ text: `${body.moon ? 'Moon' : 'Sun'} ${Math.round(body.alt)}\u00b0 up${side}`, look, moon: body.moon, x: cx + ux * reach, y: cy + uy * reach, ux, uy, night, body }));
  }
  return taps;
}
