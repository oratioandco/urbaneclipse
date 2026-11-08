/** The clay logo, live: the brand scene of brand/logo_scene.py, rebuilt in Three.js and
 * turning slowly in the intro dialog. The tile and its blocks rotate round the tower while
 * the tower, the camera and the sun stay put — so the sphere keeps covering the sun's heart
 * and the ring of light holds. */
import * as THREE from 'three';

const TILE_R = 1.6; // the tile's radius (1 unit = 100 m)
const RIM = 1.52; // the blocks keep this far clear of the tile's edge
const TX = 0, TY = 0.17; // the tower's spot in the tile's plan (y is south, towards the camera)
const SPHERE = new THREE.Vector3(TX, 2.12, -TY); // the sphere's centre in scene coords (x, up, −plan-y)

// A small seeded generator, so the block layout is the same city on every visit.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A soft disc of glow, bright in the middle and gone at the rim. */
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(246, 130, 40, 0.6)');
  grad.addColorStop(0.55, 'rgba(244, 118, 34, 0.34)');
  grad.addColorStop(1, 'rgba(244, 118, 34, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build() {
  const scene = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const clay = new THREE.MeshLambertMaterial({ color: 0xefe9df });
  const towerClay = new THREE.MeshLambertMaterial({ color: 0xf4efe7 });
  const ground = new THREE.MeshLambertMaterial({ color: 0xd3c9ba });
  const park = new THREE.MeshLambertMaterial({ color: 0x7fa45a });
  const water = new THREE.MeshPhongMaterial({ color: 0x5a8cba, specular: 0x444444, shininess: 80 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x5d6270 });

  // The city turns round the tower's foot: the group's origin sits there.
  const city = new THREE.Group();
  city.position.set(TX, 0, -TY);
  // Place a city part from plan coordinates (x, y, up); the group carries the tower's offset.
  const put = (mesh, x, y, z) => {
    mesh.position.set(x, z, -y);
    city.add(mesh);
    return mesh;
  };

  put(new THREE.Mesh(new THREE.CylinderGeometry(TILE_R, TILE_R, 0.18, 128), ground), 0, 0, -0.09);
  // The Spree, a band across the front, long enough to run past the tile's rim.
  const river = put(new THREE.Mesh(box, water), 0, -0.62, 0.004);
  river.scale.set(2.8, 0.01, 0.26); // no wider than the tile, in place of the boolean trim
  river.rotation.y = (-12 * Math.PI) / 180;
  // A park round the tower's foot.
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 64), park), TX, TY, 0.006);

  // Blocks of the city: Berlin's perimeter blocks round courtyards, on a street grid, kept
  // clear of the river, the park and the tile's edge; now and then a park or a corner house.
  const CELL = 0.34;
  const rand = rng(7);
  const tan12 = Math.tan((12 * Math.PI) / 180);
  const wall = (sx, sz, h, x, y) => {
    const m = put(new THREE.Mesh(box, clay), x, y, h / 2);
    m.scale.set(sx, h, sz);
  };
  for (let gx = -5; gx <= 5; gx++) {
    for (let gy = -5; gy <= 5; gy++) {
      const x = gx * CELL, y = gy * CELL;
      const w = CELL - 0.05 - rand() * 0.015, d = CELL - 0.05 - rand() * 0.015;
      if (Math.hypot(Math.abs(x) + w / 2, Math.abs(y) + d / 2) > RIM - 0.06) continue;
      if (Math.abs(y - (-0.62 - tan12 * x)) < 0.27) continue; // in the Spree
      if (Math.hypot(x - TX, y - TY) < 0.36) continue; // in the park
      if (rand() < 0.08) {
        put(new THREE.Mesh(box, park), x, y, 0.008).scale.set(w, 0.016, d);
        continue;
      }
      const h = [0.13, 0.15, 0.16, 0.18][(rand() * 4) | 0];
      const t = 0.065; // the courtyard is the block with its middle taken out
      wall(w, t, h, x, y - (d - t) / 2);
      wall(w, t, h, x, y + (d - t) / 2);
      wall(t, d - 2 * t, h, x - (w - t) / 2, y);
      wall(t, d - 2 * t, h, x + (w - t) / 2, y);
      if (rand() < 0.12) {
        wall(0.1, 0.1, h * 1.6, x + w / 2 - 0.05, y + d / 2 - 0.05); // a taller corner house
      }
    }
  }
  scene.add(city);

  // The TV tower: shaft 32 m → 9 m wide up to 250 m, sphere 32 m across at 212 m, antenna to 368 m.
  const towerAt = (geometry, y) => {
    const m = new THREE.Mesh(geometry, towerClay);
    m.position.set(TX, y, -TY);
    scene.add(m);
    return m;
  };
  towerAt(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 6), 0.035).material = clay; // the foot pavilion
  towerAt(new THREE.CylinderGeometry(0.045, 0.12, 2.5, 64), 1.25); // the shaft
  towerAt(new THREE.SphereGeometry(0.17, 96, 48), 2.12);
  towerAt(new THREE.CylinderGeometry(0.171, 0.171, 0.035, 96), 2.15).material = glass;
  towerAt(new THREE.ConeGeometry(0.035, 1.2, 32), 3.1); // the antenna

  // Camera: low across the river, looking up at the sphere (85 mm).
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  camera.position.set(3.6, 4.4, 10.6);
  camera.lookAt(TX, 1.45, -TY);

  // The sun: a glowing disc far behind the sphere on the camera's line, several times its
  // size, so the sphere rides its middle — with a soft halo carrying the edge.
  const dir = SPHERE.clone().sub(camera.position).normalize();
  const FAR = 40;
  const sunR = ((0.17 * FAR) / SPHERE.distanceTo(camera.position)) * 2.6;
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(sunR * 1.6, 48),
    new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false }),
  );
  halo.position.copy(camera.position).addScaledVector(dir, FAR - 0.2);
  halo.lookAt(camera.position);
  halo.renderOrder = 1;
  scene.add(halo);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(sunR, 48), new THREE.MeshBasicMaterial({ color: 0xf26a12 }));
  sun.position.copy(camera.position).addScaledVector(dir, FAR);
  sun.lookAt(camera.position);
  sun.renderOrder = 2;
  scene.add(sun);

  // Warm key from behind and above, clay-soft fill all round.
  scene.add(new THREE.HemisphereLight(0xf6ebdd, 0xcabfae, 1.15));
  const key = new THREE.DirectionalLight(0xffe4c8, 2.4);
  key.position.set(-1.6, 3.0, -2.8);
  scene.add(key);

  return { scene, camera, city };
}

export const introLogo = (() => {
  let state = null; // { renderer, scene, camera, city, canvas, raf, resize }
  let t0 = 0;

  const render = () => state.renderer.render(state.scene, state.camera);

  const frame = (now) => {
    if (!state) return;
    // One slow turn in four minutes, measured from the first frame.
    if (!t0) t0 = now;
    state.city.rotation.y = ((now - t0) / 1000) * ((2 * Math.PI) / 240);
    render();
    state.raf = requestAnimationFrame(frame);
  };

  return {
    start() {
      const canvas = document.getElementById('intro-logo');
      if (!canvas || state?.raf) return;
      try {
        if (!state) {
          const { scene, camera, city } = build();
          const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
          renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
          state = { renderer, scene, camera, city, canvas, raf: 0 };
          state.resize = () => {
            const w = canvas.clientWidth || 960, h = canvas.clientHeight || 540;
            const pw = w * renderer.getPixelRatio(), ph = h * renderer.getPixelRatio();
            if (!w || !h || (renderer.domElement.width === pw && renderer.domElement.height === ph)) return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            render();
          };
          new ResizeObserver(() => state && state.resize()).observe(canvas);
        }
        state.resize();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
          render(); // a still logo for stillness
          return;
        }
        t0 = 0;
        state.raf = requestAnimationFrame(frame);
      } catch {
        if (canvas) canvas.style.display = 'none'; // no WebGL: the intro works without it
      }
    },
    stop() {
      if (!state) return;
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    },
  };
})();
