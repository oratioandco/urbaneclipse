/**
 * A small map for eye level: where you stand, which way you look, and what the day
 * holds nearby. North is up, so it reads like the big map. Drawn from the painted ground map,
 * so it costs one image draw a frame.
 */
const RADIUS_M = 450;
const PATH_CSS = { sun: '#f26a12', moon: '#5b82ff' };

let base = null;
let half = 1;
const canvas = document.getElementById('minimap');
const ctx = canvas.getContext('2d');

/** Turn the ground map's channels (street glow, water, parks) into map colours, once. */
export function setMinimapGround(groundCanvas, modelHalf) {
  half = modelHalf;
  const size = Math.min(2048, groundCanvas.width);
  const work = document.createElement('canvas');
  work.width = work.height = size;
  const w = work.getContext('2d', { willReadFrequently: true });
  w.drawImage(groundCanvas, 0, 0, size, size);
  const image = w.getImageData(0, 0, size, size);
  const px = image.data;
  const ramp = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  for (let i = 0; i < px.length; i += 4) {
    const street = ramp(px[i], 70, 150);
    const water = ramp(px[i + 1], 100, 160);
    const park = ramp(px[i + 2], 100, 160) * (1 - water);
    // Blocks, then parks, water and streets on top.
    let r = 214;
    let g = 209;
    let b = 200;
    r += (182 - r) * park;
    g += (210 - g) * park;
    b += (150 - b) * park;
    r += (150 - r) * water;
    g += (194 - g) * water;
    b += (228 - b) * water;
    r += (252 - r) * street * (1 - water);
    g += (251 - g) * street * (1 - water);
    b += (247 - b) * street * (1 - water);
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  w.putImageData(image, 0, 0);
  base = work;
}

/**
 * @param view.look { x, z, heading } where you stand
 * @param view.fov horizontal field of view, degrees
 * @param view.paths, view.rays, view.spots as drawn on the big map, in scene metres
 * @param view.bodies [{ az, moon? }] above the horizon
 */
export function drawMinimap({ look, fov, paths, rays, spots, bodies, night }) {
  if (!base) return;
  const dpr = Math.min(devicePixelRatio, 2);
  const size = canvas.clientWidth;
  if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const r = size / 2;
  const scale = r / RADIUS_M;
  const toMap = (x, z) => [r + (x - look.x) * scale, r + (z - look.z) * scale];

  const corner = 14;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, corner);
  ctx.clip();
  const perMetre = base.width / (2 * half);
  ctx.filter = night ? 'invert(0.88) hue-rotate(180deg) brightness(0.9)' : 'none';
  ctx.drawImage(
    base,
    (look.x - RADIUS_M + half) * perMetre,
    (look.z - RADIUS_M + half) * perMetre,
    2 * RADIUS_M * perMetre,
    2 * RADIUS_M * perMetre,
    0,
    0,
    size,
    size,
  );
  ctx.filter = 'none';

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const ray of rays) {
    ctx.strokeStyle = PATH_CSS[ray.body];
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(...toMap(ray.base.x, ray.base.z));
    ctx.lineTo(...toMap(ray.far.x, ray.far.z));
    ctx.stroke();
  }
  for (const path of paths) {
    ctx.strokeStyle = PATH_CSS[path.body];
    for (const segment of path.segments) {
      ctx.beginPath();
      segment.forEach((p, i) => (i ? ctx.lineTo(...toMap(p.x, p.z)) : ctx.moveTo(...toMap(p.x, p.z))));
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  for (const spot of spots) {
    const [x, y] = toMap(spot.x, spot.z);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = PATH_CSS[spot.body];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // The tower, pinned to the rim when it is out of range so you can always find it.
  {
    let [x, y] = toMap(0, 0);
    const d = Math.max(Math.abs(x - r), Math.abs(y - r));
    if (d > r - 10) {
      x = r + ((x - r) / d) * (r - 10);
      y = r + ((y - r) / d) * (r - 10);
    }
    ctx.fillStyle = night ? '#ece8df' : '#24221f';
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 4, y + 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.closePath();
    ctx.fill();
  }

  // Which way you look: a cone as wide as the lens sees.
  const heading = (look.heading * Math.PI) / 180;
  const spread = (Math.min(fov, 120) * Math.PI) / 360;
  const cone = ctx.createRadialGradient(r, r, 0, r, r, r * 0.8);
  const ink = night ? '255, 240, 220' : '36, 34, 31';
  cone.addColorStop(0, `rgba(${ink}, 0.42)`);
  cone.addColorStop(1, `rgba(${ink}, 0)`);
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(r, r);
  ctx.arc(r, r, r * 0.8, heading - Math.PI / 2 - spread, heading - Math.PI / 2 + spread);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Where you stand, as on the big map.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(r, r, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#24221f';
  ctx.beginPath();
  ctx.arc(r, r, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // The rim: north, and which way the sun and moon lie.
  ctx.strokeStyle = night ? 'rgba(236, 232, 223, 0.6)' : 'rgba(255, 253, 249, 0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(1.5, 1.5, size - 3, size - 3, corner - 1.5);
  ctx.stroke();
  for (const body of bodies) {
    // On the frame, in the body's direction from where you stand.
    const a = ((body.az - 90) * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const reach = (r - 7) / Math.max(Math.abs(ux), Math.abs(uy));
    ctx.fillStyle = body.moon ? PATH_CSS.moon : PATH_CSS.sun;
    ctx.beginPath();
    ctx.arc(r + ux * reach, r + uy * reach, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = night ? 'rgba(20, 23, 38, 0.86)' : 'rgba(255, 253, 249, 0.95)';
  ctx.beginPath();
  ctx.arc(r, 9, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d6453a';
  ctx.fillText('N', r, 9.5);
}
