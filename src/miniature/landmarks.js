/**
 * Landmarks the LoD2 model gets wrong, modelled by hand in the same white clay, the way map apps
 * model their landmarks: the Oberbaumbrücke, which LoD2 leaves out entirely, the domes of the
 * Frankfurter Tor, which LoD2 reduces to a pyramid on each tower, the Brandenburger Tor, whose
 * colonnade LoD2 fills in as a solid block, the Siegessäule, which LoD2 flattens to a 25 m stub,
 * and the Reichstag's glass cupola, which LoD2 leaves out entirely, plus two whole towers the
 * tiles never had: the Estrel Tower and the EDGE East Side Tower.
 *
 * Positions and sizes are in scene metres, measured on 2026-11-08 from OpenStreetMap (ways
 * 288514442, 373626457/59/62, 1547500040, 1013505135/36 and 373626454-61 for the bridge;
 * 288230369, 316933471 and 288230373-76 for the towers; 518071791 for the gate; 718035022 for
 * the column) and from the LoD2 tiles: the towers' cornice is at 44 m scene height, which is
 * where the LoD2 pyramid starts; the gate's ground sits at −2.4 m scene, the column's at +0.3 m
 * (scripts/miniature/check_landmark_lod.mjs). Heights the data does not give (arch rise, arcade,
 * drum and dome, the quadriga's pose) are read from photographs and are approximate.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './render.js';
import { cityUniforms, shadeBuildings } from './shading.js';
import { app } from './state.js';

const material = shadeBuildings(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide }), { windows: false });
/** The towers get the city's own clay, so their windows light at night like the streets' houses. */
const towerMaterial = shadeBuildings(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide }), { windows: true });
/** The gilded figures: the quadriga and the Siegessäule's Viktoria, shiny where the sun catches them. */
const gold = shadeBuildings(
  new THREE.MeshPhongMaterial({ color: 0xd9a544, specular: 0xfff2cc, shininess: 70, flatShading: true, side: THREE.DoubleSide }),
  { windows: false, name: 'city-landmarks-gold' },
);

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

/**
 * A winged victory, reading as a woman from a distance: a robe, a torso, a head, two wings
 * swept back and the wreath on its staff held high, which is the figure's topmost point.
 * Built standing on y0 at (x, z), a little under h tall, facing the frame's +z unless turned.
 */
function victory(parts, { x, z, y0, h, turn = 0 }) {
  const put = (g) => parts.push(turn ? g.rotateY(turn).translate(x, 0, z) : g.translate(x, 0, z));
  put(prism(8, 0.11 * h, y0, y0 + 0.42 * h, 0.04 * h)); // robe
  put(prism(6, 0.05 * h, y0 + 0.42 * h, y0 + 0.68 * h, 0.035 * h)); // torso
  put(new THREE.SphereGeometry(0.055 * h, 8, 6).translate(0, y0 + 0.75 * h, 0)); // head
  for (const side of [-1, 1]) {
    put(new THREE.BoxGeometry(0.3 * h, 0.03 * h, 0.16 * h).rotateZ(-side * 0.55).rotateY(side * 0.5).translate(side * 0.1 * h, y0 + 0.6 * h, -0.05 * h));
  }
  put(prism(6, 0.015 * h, y0 + 0.5 * h, y0 + 0.97 * h).translate(0.09 * h, 0, 0.04 * h)); // the staff
  put(prism(16, 0.08 * h, y0 + 0.9 * h, y0 + 0.97 * h, 0.08 * h).translate(0.09 * h, 0, 0.04 * h)); // the wreath
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

// --- Brandenburger Tor ----------------------------------------------------------------------
// Frame: x along the gate's face (34.8 m, OSM way 518071791), y up from its ground (−2.4 m
// scene), z through the five passages toward Pariser Platz. The face's half-width 17.4 and the
// half-depth 8.3; the passages run 6.54 m in the middle, 4.44 m either side of it, with 1.75 m
// piers between, and the chariot looks east. LoD2 has the whole thing as a solid block: cut it
// away above its plinth inside a square turned with the gate.
const GATE = {
  centre: [-2153.0, 505.0],
  ground: -2.4,
  along: [0.108, 0.994],
  across: [0.994, -0.108],
  half: 17.6,
};

/** Where the six piers and their columns stand along the face, from the passage widths. */
function gatePiers() {
  const piers = [];
  let x = -17.4;
  for (const passage of [4.44, 4.44, 6.54, 4.44, 4.44]) {
    piers.push([x, x + 1.75]);
    x += 1.75 + passage;
  }
  piers.push([x, x + 1.75]);
  return piers;
}

function brandenburgerTor() {
  const parts = [];
  // The piers between the passages, full depth, and the free columns in front of and behind them.
  for (const [a, b] of gatePiers()) {
    parts.push(box(a, b, 0, 14.6, -6.6, 6.6));
    for (const z of [-7.35, 7.35]) {
      parts.push(prism(20, 0.95, 0, 13.7).translate((a + b) / 2, 0, z));
      parts.push(prism(20, 1.1, 13.7, 14.6, 1.25).translate((a + b) / 2, 0, z));
    }
  }
  // Architrave and frieze, a wider cornice, the attic.
  parts.push(box(-17.4, 17.4, 14.6, 16.3, -8.3, 8.3));
  parts.push(box(-17.9, 17.9, 16.3, 17.5, -8.9, 8.9));
  parts.push(box(-16.6, 16.6, 17.5, 20.5, -6.9, 6.9));
  // The quadriga, gilded, so it reads as one up close: four horses abreast with necks,
  // heads and tails, the chariot on two wheels, and the victory standing in it.
  const gilded = [];
  gilded.push(box(-3.6, 3.6, 20.5, 21.2, -2.3, 2.3));
  for (const cx of [-2.7, -0.9, 0.9, 2.7]) {
    gilded.push(box(cx - 0.35, cx + 0.35, 21.2, 21.65, 0.5, 1.9)); // legs
    gilded.push(box(cx - 0.45, cx + 0.45, 21.55, 22.3, 0.1, 2.35)); // body
    gilded.push(box(cx - 0.12, cx + 0.12, 21.75, 22.4, -0.4, 0.05)); // tail
    gilded.push(new THREE.BoxGeometry(0.36, 0.4, 0.95).rotateX(-0.75).translate(cx, 22.55, 2.5)); // neck and head
  }
  gilded.push(box(-2.75, 2.75, 21.2, 22.15, -2.2, -0.1)); // chariot
  for (const wx of [-2.6, 2.6]) gilded.push(new THREE.CylinderGeometry(0.85, 0.85, 0.18, 16).rotateZ(Math.PI / 2).translate(wx, 22.05, -1.15));
  victory(gilded, { x: 0, z: -1.15, y0: 22.15, h: 3.8 });
  const { centre, ground, along, across, half } = GATE;
  const matrix = [along[0], 0, -across[0], centre[0], 0, 1, 0, ground, along[1], 0, -across[1], centre[1], 0, 0, 0, 1];
  const place = (parts, mat) => {
    const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), mat);
    mesh.matrix.set(...matrix);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
    return mesh;
  };
  // Cut the LoD2 block above its plinth, inside a square turned with the gate.
  cityUniforms.uCuts.value[2].set(centre[0], centre[1], half, ground + 0.5);
  cityUniforms.uCutTurns.value[2].set(along[0], along[1]);
  return [place(parts, material), place(gilded, gold)];
}

// --- Siegessäule ----------------------------------------------------------------------------
// A solid of revolution on its ground at +0.3 m scene: the round terrace (OSM way 718035022,
// about 60 m across), the square colonnaded hall, the tapering column, the viewing platform's
// ring and the gilded Viktoria to 67 m. LoD2 has a 25 m stub here: cut it at ground level.
const COLUMN = { centre: [-4027.1, 699.6], ground: 0.3, half: 31 };

function siegessaeule() {
  const parts = [
    prism(48, 30, -0.2, 1.1), // the terrace
    prism(48, 29.6, 1.1, 1.9), // its ring wall
    prism(4, 10.2, 1.1, 12.8), // the hall, square, flats to the axes
    prism(4, 10.9, 12.8, 13.5), // the hall's cornice
    prism(32, 3.0, 13.5, 48.9, 2.45), // the column, tapering
    prism(32, 3.7, 48.9, 50.7), // the platform's ring
    prism(32, 3.55, 50.7, 51.9, 3.55), // its railing band
    prism(32, 2.35, 51.9, 58.7, 2.25), // the shaft above the platform
  ];
  const { centre, ground, half } = COLUMN;
  // The Viktoria, gilded, facing the city: robe, wings and the wreath held high.
  const gilded = [];
  victory(gilded, { x: 0, z: 0, y0: 58.7, h: 8.4, turn: Math.PI / 2 });
  const place = (parts, mat) => {
    const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), mat);
    mesh.position.set(centre[0], ground, centre[1]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  };
  cityUniforms.uCuts.value[3].set(centre[0], centre[1], half, ground + 0.5);
  return [place(parts, material), place(gilded, gold)];
}

// --- Reichstag -------------------------------------------------------------------------------
// The glass cupola LoD2 leaves out entirely: the building's flat roof tops out at 35.2 m scene
// (terrain −1.4), where the real roof over the chamber rises to about 47 m and the cupola to
// about 70 m (centre of OSM relation 2201742; the dome is roughly 38 m across and 23.5 m high,
// over the plenary chamber). Cut the flat roof inside a square over the chamber and add the
// raised hall, the drum, the meridian ribs, and the skewed mirror funnel inside.
const REICHSTAG = { centre: [-2262.0, 245.5], terrain: -1.4, roof: 35.2, half: 26 };

function reichstag() {
  const parts = [];
  const { centre, terrain, roof, half } = REICHSTAG;
  const hall = 42.0; // the roof the cupola stands on, above the scene's zero
  parts.push(box(-21, 21, roof - 0.4, hall, -18, 18)); // the raised hall over the chamber
  parts.push(prism(32, 19.6, hall, hall + 2.0)); // the drum
  parts.push(new THREE.SphereGeometry(19.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 23.5 / 19.6, 1).translate(0, hall + 2.0, 0)); // the shell
  for (let i = 0; i < 12; i++) {
    parts.push(new THREE.TorusGeometry(19.4, 0.35, 6, 24, Math.PI).scale(1, 23.5 / 19.6, 1).rotateY((i / 12) * Math.PI).translate(0, hall + 2.0, 0)); // ribs
  }
  parts.push(new THREE.CylinderGeometry(1.0, 2.8, 22, 16, 1, true).rotateZ(0.1).translate(1.2, hall + 12, 0)); // the funnel
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), material);
  mesh.position.set(centre[0], terrain, centre[1]);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  cityUniforms.uCuts.value[4].set(centre[0], centre[1], half, roof + 0.2);
  return mesh;
}

// --- Estrel Tower ----------------------------------------------------------------------------
// Berlin's tallest building (176 m, opened 2026), which the tiles never had at all: the probe
// found flat ground here. A slender slab with an elliptical plan on the Spree bank, out of a low
// podium (Wikidata Q109285710 puts the shaft at this point; its OSM site, way 32664053, is still
// landuse=construction). The ground sits at −4.4 m scene (check_landmark_lod.mjs).
export const ESTREL_TOWER = { centre: [3328.9, 5442.7], terrain: -4.4, top: 176 };

function estrelTower() {
  const parts = [
    box(-30, 30, 0, 6.5, -20, 20), // the podium
    new THREE.CylinderGeometry(1, 1.03, 166, 24, 1).scale(21, 1, 11.5).translate(0, 6.5 + 83, 0), // the shaft
    new THREE.CylinderGeometry(1, 1, 3.5, 24, 1).scale(21.8, 1, 12.3).translate(0, 174.25, 0), // the crown's parapet
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), towerMaterial);
  mesh.position.set(ESTREL_TOWER.centre[0], ESTREL_TOWER.terrain, ESTREL_TOWER.centre[1]);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// --- EDGE East Side Tower --------------------------------------------------------------------
// The "Amazon Tower" — AWS is the headline tenant, and OSM way 1364133390 carries the alt_name —
// 142 m on the bend where the Spree turns at Warschauer Straße, also absent from the tiles. A
// rectangular slab that steps in twice as it rises, turned 10° to the map grid (its footprint's
// long axis, 64.8 × 43.1 m from the way). Ground −5.7 m scene; the upper volumes lean toward
// the river, a few metres north-west as they climb.
export const EDGE_EAST_SIDE = { centre: [2657.6, 1646.1], terrain: -5.7, top: 142 };

function edgeEastSide() {
  const parts = [
    box(-32.4, 32.4, 0, 22, -21.6, 21.6),
    box(-29, 29, 22, 92, -19.5, 19.5).translate(-1, 0, -1.5),
    box(-25, 25, 92, 120, -17, 17).translate(-2.5, 0, -3),
    box(-21, 21, 120, 140.5, -14.5, 14.5).translate(-4, 0, -4.5),
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), towerMaterial);
  mesh.position.set(EDGE_EAST_SIDE.centre[0], EDGE_EAST_SIDE.terrain, EDGE_EAST_SIDE.centre[1]);
  // Ten degrees turns x toward plus z: the footprint's long axis runs east-south-east.
  mesh.rotation.y = -THREE.MathUtils.degToRad(10);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export const landmarks = [oberbaumbruecke(), ...frankfurterTor(), ...brandenburgerTor(), ...siegessaeule(), reichstag(), estrelTower(), edgeEastSide()];
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
