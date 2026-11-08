/**
 * Landmarks the LoD2 model gets wrong, modelled by hand in the same white clay, the way map apps
 * model their landmarks: the Oberbaumbrücke, which LoD2 leaves out entirely, and the domes of the
 * Frankfurter Tor, which LoD2 reduces to a pyramid on each tower.
 *
 * Positions and sizes are in scene metres, measured on 2026-11-08 from OpenStreetMap (ways
 * 288514442, 373626457/59/62, 1547500040, 1013505135/36 and 373626454-61 for the bridge;
 * 288230369, 316933471 and 288230373-76 for the towers) and from the LoD2 tiles: the towers'
 * cornice is at 44 m scene height, which is where the LoD2 pyramid starts. Heights the data does
 * not give (arch rise, arcade, drum and dome) are read from photographs and are approximate.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './render.js';
import { cityUniforms, shadeBuildings } from './shading.js';
import { app } from './state.js';

const material = shadeBuildings(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide }), { windows: false });

/** Drops the attributes flat shading does not need, so every part merges with every other. */
function clean(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

/** A regular prism standing on y0, rotated so a flat side faces the frame's axes. */
function prism(sides, radius, y0, y1, topRadius = radius) {
  return new THREE.CylinderGeometry(topRadius, radius, y1 - y0, sides, 1, false, Math.PI / sides).translate(0, (y0 + y1) / 2, 0);
}

function box(x0, x1, y0, y1, z0, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** A semi-elliptical arch opening from a to b, springing at y0 and rising to y1, as a hole. */
function archHole(a, b, y0, y1, pointed = false) {
  const hole = new THREE.Path();
  const mid = (a + b) / 2;
  const rx = (b - a) / 2;
  const ry = y1 - y0;
  hole.moveTo(a, y0);
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI - (i / steps) * Math.PI;
    let x = mid + rx * Math.cos(t);
    let y = y0 + ry * Math.sin(t);
    if (pointed) y = y0 + ry * Math.pow(Math.sin(t), 0.6) * (1 - 0.18 * Math.abs(Math.cos(t)));
    hole.lineTo(x, y);
  }
  hole.lineTo(b, y0);
  hole.lineTo(a, y0);
  return hole;
}

/** An outline in the frame's length and height, with holes, extruded across from z0 to z1. */
function wall(outline, holes, z0, z1) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(...holes);
  return new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z0);
}

// --- Oberbaumbrücke -------------------------------------------------------------------------
// Frame: x along the bridge (OSM way 288514442's long axis), y up, z across it. Minus z is the
// river side, where the U-Bahn viaduct runs and the towers stand.
const BRIDGE = {
  centre: [2461.85, 2125.58],
  along: [-0.61566, 0.78801],
  /** Toward the viaduct side. */
  across: [0.78801, 0.61566],
  from: -77.2,
  to: 73.5,
  /** Across, in frame z: the deck's river and road edges, and the viaduct's road side. */
  river: -12.3,
  road: 16.8,
  viaduct: -4.8,
  deck: 3.2,
  /** The ramps down to the streets, on land beyond each end. */
  ramp: 14,
};
/** Arch openings along the bridge: the wide middle one between the towers, three either side. */
const ARCHES = [
  [-71.1, -55.6],
  [-51.1, -35.6],
  [-31.1, -15.6],
  [-11.1, 8.9],
  [13.4, 28.9],
  [33.4, 48.9],
  [53.4, 68.9],
];
/** The two towers, 34 m overall (Wikipedia, via OSM), 29 m apart either side of the middle arch. */
const TOWERS = [-15.8, 13.6];
/** The small towers along the viaduct: where along, and their height (OSM). */
const TURRETS = [
  [-75.6, 18],
  [-61.8, 18],
  [59.8, 18],
  // Not in OSM, where its partner at the other end is: the bridge is symmetrical.
  [72.6, 18],
  [-41.7, 12],
  [39.4, 12],
];

/** The road's height along the bridge: the deck, ramping down to the streets beyond each end. */
function roadHeight(x) {
  const { from, to, deck, ramp } = BRIDGE;
  const beyond = x < from ? from - x : x > to ? x - to : 0;
  return deck - (deck - 0.3) * Math.min(1, beyond / ramp);
}

function oberbaumbruecke() {
  const { from, to, river, road, viaduct, deck, ramp } = BRIDGE;
  const parts = [];
  // The deck and its arches, with the ramps.
  const outline = [[from - ramp, -1], [to + ramp, -1], [to + ramp, roadHeight(to + ramp)], [to, deck], [from, deck], [from - ramp, roadHeight(from - ramp)]];
  parts.push(wall(outline, ARCHES.map(([a, b]) => archHole(a, b, -0.6, 2.2)), river, road));
  // The road side's parapet.
  parts.push(box(from, to, deck, deck + 1.1, road - 0.5, road));
  // The viaduct: an arcade under the U-Bahn, open through on both sides, solid at the towers.
  const solid = [...TOWERS.map((t) => [t - 6.5, t + 6.5]), ...TURRETS.map(([t]) => [t - 2.4, t + 2.4])];
  const arcadeHoles = [];
  for (let x = from + 4; x + 3 < to - 4; x += 4.2) {
    if (solid.some(([a, b]) => x + 3 > a && x < b)) continue;
    arcadeHoles.push(archHole(x, x + 3, deck + 0.3, deck + 4.6, true));
  }
  parts.push(wall([[from + 1, deck - 0.2], [to - 1, deck - 0.2], [to - 1, deck + 6.6], [from + 1, deck + 6.6]], arcadeHoles, river, viaduct));
  // The track bed on top, a little wider, with its parapets.
  parts.push(box(from + 1, to - 1, deck + 6.6, deck + 7.4, river - 0.4, viaduct + 0.4));
  parts.push(box(from + 1, to - 1, deck + 7.4, deck + 8.4, river - 0.4, river - 0.1));
  parts.push(box(from + 1, to - 1, deck + 7.4, deck + 8.4, viaduct + 0.1, viaduct + 0.4));
  // The towers: square base, an octagonal storey, a round shaft with a battlement, a brick cone.
  for (const x of TOWERS) {
    const tower = [
      box(-4.5, 4.5, -0.6, 14.6, -4.5, 4.5),
      prism(8, 5.2, 14.6, 19.6),
      prism(8, 5.2, 19.6, 20.8, 3.2),
      prism(16, 2.8, 19.6, 25.0),
      prism(16, 3.15, 24.6, 25.8),
      prism(16, 3.0, 25.8, 33.6, 0.05),
    ];
    for (const g of tower) parts.push(g.translate(x, 0, -14.6));
  }
  for (const [x, height] of TURRETS) {
    const roof = height > 12 ? 4 : 2;
    parts.push(prism(8, 1.5, -0.6, height - 0.6 - roof).translate(x, 0, -12.6));
    parts.push(prism(8, 1.6, height - 0.6 - roof, height - 0.6, 0.05).translate(x, 0, -12.6));
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), material);
  const { centre, along, across } = BRIDGE;
  // Frame x along the bridge, y up, z = minus across: a proper rotation, so faces keep their winding.
  mesh.matrix.set(along[0], 0, -across[0], centre[0], 0, 1, 0, 0, along[1], 0, -across[1], centre[1], 0, 0, 0, 1);
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldNeedsUpdate = true;
  return mesh;
}

/** The road's height where it crosses the bridge, for standing on it, or null off the road. */
function deckAt(x, z) {
  const dx = x - BRIDGE.centre[0];
  const dz = z - BRIDGE.centre[1];
  const along = dx * BRIDGE.along[0] + dz * BRIDGE.along[1];
  const frameZ = -(dx * BRIDGE.across[0] + dz * BRIDGE.across[1]);
  if (along < BRIDGE.from - BRIDGE.ramp || along > BRIDGE.to + BRIDGE.ramp || frameZ < BRIDGE.viaduct || frameZ > BRIDGE.road) return null;
  return roadHeight(along);
}

// --- Frankfurter Tor ------------------------------------------------------------------------
// Each tower's square body is about 15.8 m across, turned 8.7 degrees; LoD2 has it up to the
// cornice at 44 m. Above that: a terrace, a colonnaded drum, a dome and a lantern.
const GATE_TOWERS = [
  [2940.6, 479.1],
  [2925.4, 573.4],
];
const GATE_TURN = THREE.MathUtils.degToRad(8.7);
const CORNICE = 44;

function gateTower() {
  const y = CORNICE;
  const parts = [
    box(-8.3, 8.3, y - 0.6, y + 0.4, -8.3, 8.3),
    // The terrace's balustrade.
    box(-8.3, 8.3, y + 0.4, y + 1.3, -8.3, -7.9),
    box(-8.3, 8.3, y + 0.4, y + 1.3, 7.9, 8.3),
    box(-8.3, -7.9, y + 0.4, y + 1.3, -7.9, 7.9),
    box(7.9, 8.3, y + 0.4, y + 1.3, -7.9, 7.9),
    prism(24, 6.0, y + 0.4, y + 1.0),
    prism(24, 4.3, y + 1.0, y + 7.2),
    prism(24, 6.0, y + 7.0, y + 8.0),
    prism(24, 5.0, y + 8.0, y + 9.0),
    new THREE.SphereGeometry(4.6, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.15, 1).translate(0, y + 9.0, 0),
    prism(12, 0.95, y + 13.8, y + 16.4),
    prism(12, 1.2, y + 16.4, y + 17.4, 0.05),
    prism(6, 0.12, y + 17.4, y + 19.0, 0.02),
  ];
  // Sixteen columns round the drum.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(prism(6, 0.32, y + 1.0, y + 7.0).translate(Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4));
  }
  return mergeGeometries(parts.map(clean));
}

function frankfurterTor() {
  const geometry = gateTower();
  return GATE_TOWERS.map(([x, z], i) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0, z);
    // Three turns x toward minus z for a positive angle; the tower turns x toward plus z.
    mesh.rotation.y = -GATE_TURN;
    // Cut the LoD2 pyramid above the cornice, inside the square.
    cityUniforms.uCuts.value[i].set(x, z, 8.2, CORNICE + 0.2);
    cityUniforms.uCutTurns.value[i].set(Math.cos(GATE_TURN), Math.sin(GATE_TURN));
    return mesh;
  });
}

export const landmarks = [oberbaumbruecke(), ...frankfurterTor()];
for (const mesh of landmarks) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** Once the terrain is in: the ground under the bridge's road is its deck, for standing there. */
export function liftOntoLandmarks() {
  const ground = app.groundAt;
  app.groundAt = (x, z) => {
    const below = ground(x, z);
    const deck = deckAt(x, z);
    return deck === null ? below : Math.max(deck, below);
  };
}
