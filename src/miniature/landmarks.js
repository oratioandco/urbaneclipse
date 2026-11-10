/**
 * Landmarks the LoD2 model gets wrong, modelled by hand in the same white clay, the way map apps
 * model their landmarks: the Oberbaumbrücke, which LoD2 leaves out entirely, the domes of the
 * Frankfurter Tor, which LoD2 reduces to a pyramid on each tower, the Brandenburger Tor, whose
 * colonnade LoD2 fills in as a solid block, the Siegessäule, which LoD2 flattens to a 25 m stub,
 * and the Reichstag's glass cupola, which LoD2 leaves out entirely, plus two whole towers the
 * tiles never had: the Estrel Tower and the EDGE East Side Tower. The Gendarmenmarkt trio and
 * the Holocaust-Mahnmal (2026-11-10) rebuild what LoD2 flattens: the Konzerthaus's portico,
 * pediments, dome and Apollo group, the two cathedral towers with their domes and gilded
 * figures, and Eisenman's field of stelae, which the tiles have only as stubs.
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
/** The Berlinian rises inside its own tile cut, so its clay must not carry the cut and clip itself. */
const towerUncut = shadeBuildings(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide }), { windows: true, cuts: false, name: 'city-landmarks-tower-uncut' });
/** The gilded figures: the quadriga and the Siegessäule's Viktoria, shiny where the sun catches them. */
const gold = shadeBuildings(
  new THREE.MeshPhongMaterial({ color: 0xd9a544, specular: 0xfff2cc, shininess: 70, flatShading: true, side: THREE.DoubleSide }),
  { windows: false, name: 'city-landmarks-gold' },
);
/** The Dom's dome is bare copper: the same clay white, but sheening softly where the sun catches it. */
const copper = shadeBuildings(
  new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x8c8574, shininess: 24, flatShading: true, side: THREE.DoubleSide }),
  { windows: false, name: 'city-landmarks-copper' },
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

// --- The Berlinian ---------------------------------------------------------------------------
// The topped-out (opening 2027) 146 m tower at Alexanderplatz, 350 m from the Fernsehturm
// (OSM way 1335157930, height 146): the tiles have the same building 41 m too low. A square of
// about 35 m across, turned 46 degrees to the map grid. Ground +0.6 m scene.
export const THE_BERLINIAN = { centre: [90.75, -193.65], terrain: 0.6, top: 146.6 };

function berlinian() {
  const parts = [
    box(-17.3, 17.3, 0, 58, -17.3, 17.3),
    box(-16.2, 16.2, 58, 108, -16.2, 16.2).translate(-1.2, 0, 1.2),
    box(-14.2, 14.2, 108, 142.5, -14.2, 14.2).translate(-2.4, 0, 2.4),
    box(-15, 15, 142.5, 146, -15, 15).translate(-2.4, 0, 2.4), // the crown's parapet
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), towerUncut);
  mesh.position.set(THE_BERLINIAN.centre[0], THE_BERLINIAN.terrain, THE_BERLINIAN.centre[1]);
  mesh.rotation.y = THREE.MathUtils.degToRad(46.1);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  // The stale LoD2 tower is the same footprint at 104.5 m: discard it above 45 m, inside a
  // square turned with the tower (nothing nearby stands taller than 45 m).
  cityUniforms.uCuts.value[5].set(THE_BERLINIAN.centre[0], THE_BERLINIAN.centre[1], 28, THE_BERLINIAN.terrain + 45);
  const turn = THREE.MathUtils.degToRad(46.1);
  cityUniforms.uCutTurns.value[5].set(Math.cos(turn), Math.sin(turn));
  return mesh;
}

// --- Atrium Tower ----------------------------------------------------------------------------
// The 106 m debis tower completing Potsdamer Platz's trio (Bahntower and Kollhoff are in the
// tiles): the probe found nothing over 42 m here, so a plain slab with a setback crown,
// axis-aligned with its neighbours. Ground −4.2 m scene.
export const ATRIUM_TOWER = { centre: [-2467.4, 1471.0], terrain: -4.2, top: 106 };

function atriumTower() {
  const parts = [
    box(-17, 17, 0, 94, -13, 13),
    box(-12.5, 12.5, 94, 102, -9.5, 9.5), // the setback crown
    box(-13.2, 13.2, 102, 106, -10.2, 10.2), // its parapet
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), towerMaterial);
  mesh.position.set(ATRIUM_TOWER.centre[0], ATRIUM_TOWER.terrain, ATRIUM_TOWER.centre[1]);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// --- Berliner Dom ----------------------------------------------------------------------------
// The dome LoD2 leaves off (OSM way 313670734; the tiles top the nave at 43.4 m above terrain,
// ground −2.4 m scene): the drum, the dome shell and the lantern to the real 114 m. The probe
// found the drum's ring of statues about 44 m across, centred a little east of the building's
// middle at min_height 50 — the drum rises from there.
export const BERLINER_DOM = { centre: [-561.5, 186.8], terrain: -2.4, top: 111 };

function berlinerDom() {
  // The drum belongs to the clay body; the shell, the lantern and the cross are bare copper in
  // truth, and sheen where the sun catches them, the way the real dome throws its glint.
  const body = [
    prism(16, 20.5, 46, 58), // the drum, above the crossing roof the tiles stop at
    prism(16, 21.8, 58, 59.5), // its cornice ring
  ];
  const dome = [
    new THREE.SphereGeometry(20.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 34 / 20.5, 1).translate(0, 59.5, 0), // the shell
    prism(8, 4.2, 85, 107), // the lantern, through the dome's crown
    prism(8, 5.2, 107, 108.5, 2.5),
    prism(4, 0.5, 108.5, 111.5, 0.25), // the cross's mast
    box(-1.6, 1.6, 110.4, 111.2, -0.3, 0.3), // its arm
  ];
  const place = (parts, withMaterial) => {
    const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), withMaterial);
    mesh.position.set(BERLINER_DOM.centre[0], BERLINER_DOM.terrain, BERLINER_DOM.centre[1]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  };
  // Cut the tiles' roof over the whole building above its LoD2 top; nothing nearby stands taller.
  cityUniforms.uCuts.value[6].set(-569.6, 192.35, 55, BERLINER_DOM.terrain + 43.6);
  return [place(body, material), place(dome, copper)];
}

// --- Konzerthaus am Gendarmenmarkt -----------------------------------------------------------
// Schinkel's concert hall (OSM way 217512230), which LoD2 has as flat-topped blocks: the
// portico is filled in solid, both pediments and the Apollo group are gone, and the dome over
// the hall is missing. Frame: local x runs along the 81 m facade (scene +z), local z is depth
// (scene +x), the portico faces EAST across the square at local z +29.9. Heights read from
// photographs at the facade's 81.1 m scale (portico floor 5.2, columns to 18.2, lower pediment
// apex 26.5, attic cornice 31.5-33, upper pediment apex 39.5, Apollo group to 45, wings'
// attica 23.4). Cut at 19.6: LoD2's massif tops out at 32.1 with a flat top, its wings at 23.
const KONZERTHAUS = { centre: [-1192.4, 804.85], terrain: 0.2, top: 45.3 };

/** The Apollo quadriga's dark bronze: greenish where the patina catches the light. */
const bronze = shadeBuildings(
  new THREE.MeshPhongMaterial({ color: 0x55604f, specular: 0x8f9a85, shininess: 34, flatShading: true, side: THREE.DoubleSide }),
  { windows: false, name: 'city-landmarks-bronze' },
);

function konzerthaus() {
  const parts = [];
  const clay = (list) => parts.push(...list);
  // The wings' cornice and attica, a ring of bands on LoD2's walls cut at 19.6.
  clay([
    box(-40.5, 40.5, 19.6, 21.0, 28.9, 29.9), // east, over the facade
    box(-40.5, 40.5, 19.6, 21.0, -29.9, -28.9), // west
    box(-40.5, -39.5, 19.6, 21.0, -29.9, 29.9), // the ends
    box(39.5, 40.5, 19.6, 21.0, -29.9, 29.9),
    box(-40.0, 40.0, 21.0, 23.2, 28.4, 29.4), // the attica, set back
    box(-40.0, 40.0, 21.0, 23.2, -29.4, -28.4),
    box(-40.0, -39.0, 21.0, 23.2, -29.4, 29.4),
    box(39.0, 40.0, 21.0, 23.2, -29.4, 29.4),
  ]);
  // Statues on the wings' attica, facing the square: slim figures with heads.
  for (const u of [-34.5, -27.5, -22, 22.5, 28, 34.5]) {
    parts.push(prism(6, 0.55, 23.2, 25.7, 0.3).translate(u, 0, 28.9));
    parts.push(new THREE.SphereGeometry(0.28, 8, 6).translate(u, 26.1, 28.9));
  }
  // The central block, from the cut to the attic cornice, and the portico in front of it.
  clay([
    box(-22, 19, 19.6, 33.0, 6.5, 29.5), // the massif behind the portico
    box(-18.5, 17, 0, 5.0, 29.5, 31.8), // the stylobate under the columns
    box(-22.5, 19.5, 31.0, 33.0, 28.5, 30.0), // the attic band with the inscription
  ]);
  for (const u of [-16, -9.4, -2.8, 3.8, 10.4, 17]) {
    clay([
      prism(20, 0.95, 5.0, 18.4).translate(u, 0, 30.7),
      prism(20, 1.15, 18.4, 19.2, 1.05).translate(u, 0, 30.7), // the capital
    ]);
  }
  clay([box(-18.5, 18.5, 19.2, 20.4, 29.4, 31.0)]); // the portico's entablature
  // Both pediments, thin triangles proud of the east face: the portico's low one and the great
  // one over the attic, with the bronze Apollo group on its apex.
  clay([wall([[-18, 20.4], [17, 20.4], [-0.5, 26.4]], [], 29.4, 31.0)]);
  clay([wall([[-22.5, 33.0], [19.5, 33.0], [-1.5, 39.6]], [], 29.4, 31.0)]);
  // The dome over the hall, behind the upper pediment: drum, shallow shell, finial. It
  // sheathes in copper, not clay, so it keeps its own parts list.
  const dome = [
    prism(16, 9.5, 33.0, 36.4).translate(0, 0, 14.5),
    new THREE.SphereGeometry(9.5, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1).translate(0, 36.4, 14.5),
    prism(8, 0.75, 42.3, 44.3, 0.12).translate(0, 0, 14.5),
  ];

  const gilded = [];
  // The Apollo group: four horses abreast looking west, the chariot on two wheels, Apollo
  // standing in it with his arm raised — dark bronze, so it reads against the sky.
  gilded.push(box(-4.4, 4.4, 39.6, 40.4, 29.2, 30.8)); // the pedestal block on the apex
  for (const cx of [-3.3, -1.1, 1.1, 3.3]) {
    gilded.push(box(cx - 0.4, cx + 0.4, 40.4, 41.0, 30.0, 31.6)); // legs
    gilded.push(box(cx - 0.5, cx + 0.5, 40.8, 41.7, 28.6, 31.9)); // body
    gilded.push(box(cx - 0.14, cx + 0.14, 41.0, 41.8, 32.1, 32.7)); // tail
    gilded.push(new THREE.BoxGeometry(0.42, 0.46, 1.1).rotateX(0.75).translate(cx, 42.0, 28.0)); // neck and head, toward minus z
  }
  gilded.push(box(-3.2, 3.2, 40.4, 41.5, 26.9, 29.0)); // the chariot
  for (const wx of [-3.0, 3.0]) gilded.push(new THREE.CylinderGeometry(1.0, 1.0, 0.2, 16).rotateZ(Math.PI / 2).translate(wx, 41.2, 27.9));
  gilded.push(prism(6, 0.6, 41.5, 44.3, 0.35).translate(0.4, 0, 28.1)); // Apollo's robe
  gilded.push(new THREE.SphereGeometry(0.34, 8, 6).translate(0.4, 44.6, 28.1)); // his head
  gilded.push(prism(6, 0.1, 42.8, 45.1, 0.06).translate(1.1, 0, 28.1)); // the raised arm with the lyre

  const matrix = [0, 0, 1, KONZERTHAUS.centre[0], 0, 1, 0, KONZERTHAUS.terrain, 1, 0, 0, KONZERTHAUS.centre[1], 0, 0, 0, 1];
  const place = (list, withMaterial) => {
    const mesh = new THREE.Mesh(mergeGeometries(list.map(clean)), withMaterial);
    mesh.matrix.set(...matrix);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
    return mesh;
  };
  cityUniforms.uCuts.value[7].set(KONZERTHAUS.centre[0], KONZERTHAUS.centre[1], 42, KONZERTHAUS.terrain + 19.6);
  const domeMesh = new THREE.Mesh(mergeGeometries(dome.map(clean)), copper);
  domeMesh.matrix.set(...matrix);
  domeMesh.matrixAutoUpdate = false;
  domeMesh.matrixWorldNeedsUpdate = true;
  return [place(parts, towerUncut), place(gilded, bronze), domeMesh];
}

// --- Französischer Dom -----------------------------------------------------------------------
// The French cathedral on the square's north side (OSM ways 28248283 and 43346292): its
// portico faces SOUTH across the square, and behind the hall rises the oval tower with its
// balustrade at 40 m and the tall swallow dome with gilded lucernes and the F on top, 65 m in
// all (de.wikipedia). LoD2 has the hall's roofs about right (16-23 m) but the tower is a plain
// prism with a crude bulge to 59 m: cut it at 38.8 and rebuild everything above. The tower
// stands at scene (-1155.5, 714.2), read from the LoD2 grid. Frame: local x east along the
// facade from (-1156, 733.2), local z SOUTH, proud of the facade.
const FRANZOESISCHER_DOM = { centre: [-1155.5, 714.2], terrain: 0.1, top: 64.5 };

function franzoesischerDom() {
  const parts = [];
  const clay = (list) => parts.push(...list);
  // The portico: stylobate, six columns, entablature, pediment, standing proud to the south.
  clay([
    box(-21, 21, 0, 3.4, -0.4, 2.2),
    box(-19, 19, 16.8, 18.6, 0.3, 1.9),
  ]);
  for (const u of [-16.5, -9.9, -3.3, 3.3, 9.9, 16.5]) {
    clay([
      prism(20, 0.85, 3.4, 16.8).translate(u, 0, 1.3),
      prism(20, 1.05, 16.8, 17.5, 0.95).translate(u, 0, 1.3),
    ]);
  }
  clay([wall([[-20, 18.6], [20, 18.6], [0, 25.8]], [], 0.3, 1.9)]);
  // Statues along the hall's roof balustrade, in front of the parapet.
  for (const u of [-42, -35, -28, -21, -7, 0, 7]) {
    clay([
      prism(6, 0.45, 21.6, 24.0, 0.25).translate(u, 0, 0.5),
      new THREE.SphereGeometry(0.22, 8, 6).translate(u, 24.3, 0.5),
    ]);
  }
  // The tower: the columned drum above the hall roof and its balustrade ring at 40 m, built
  // at the tower's centre (local x 0.5, z -19.0).
  const towerX = 0.5;
  const towerZ = -19.0;
  const tower = [prism(24, 7.4, 21.5, 38.5).translate(towerX, 0, towerZ)];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    tower.push(prism(8, 0.42, 22.5, 37.9, 0.36).translate(towerX + Math.cos(a) * 7.4, 0, towerZ + Math.sin(a) * 7.4));
  }
  tower.push(prism(24, 8.2, 38.5, 39.6).translate(towerX, 0, towerZ));
  tower.push(prism(24, 7.6, 39.6, 40.2).translate(towerX, 0, towerZ));
  for (let i = 0; i < 24; i += 2) {
    const a = (i / 24) * Math.PI * 2;
    tower.push(prism(6, 0.28, 38.3, 39.6).translate(towerX + Math.cos(a) * 7.6, 0, towerZ + Math.sin(a) * 7.6)); // balusters
  }
  tower.push(prism(24, 6.3, 40.2, 46.6).translate(towerX, 0, towerZ)); // the oculus drum
  // The swallow dome, its gilded lucernes and the F on top: copper and gold.
  const dome = [
    new THREE.SphereGeometry(6.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2.05, 1).translate(towerX, 46.6, towerZ),
    prism(8, 1.15, 59.5, 61.0).translate(towerX, 0, towerZ), // the F's plinth
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    dome.push(prism(6, 0.3, 47.2, 50.0, 0.04).translate(towerX + Math.cos(a) * 5.7, 0, towerZ + Math.sin(a) * 5.7)); // lucernes
  }
  const gold = [];
  victory(gold, { x: towerX, z: towerZ, y0: 61.0, h: 3.5 }); // the gilded F

  const matrix = [1, 0, 0, -1156.0, 0, 1, 0, FRANZOESISCHER_DOM.terrain, 0, 0, 1, 733.2, 0, 0, 0, 1];
  const place = (list, withMaterial) => {
    const mesh = new THREE.Mesh(mergeGeometries(list.map(clean)), withMaterial);
    mesh.matrix.set(...matrix);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
    return mesh;
  };
  cityUniforms.uCuts.value[8].set(FRANZOESISCHER_DOM.centre[0], FRANZOESISCHER_DOM.centre[1], 13, FRANZOESISCHER_DOM.terrain + 38.8);
  return [place([...parts, ...tower], towerUncut), place(dome, copper), place(gold, gold)];
}

// --- Deutscher Dom ---------------------------------------------------------------------------
// The German cathedral on the square's south side (OSM ways 43347270 and 43347597), mirroring
// the French one: portico facing NORTH, the round tower (dome about 13 m across, de.wikipedia)
// with its own swell dome and gilded figure to about 62 m, and the hall's great flat dome of
// about 23 m diameter with a balustraded arcade drum, which LoD2 has as a 27 m mound. Frame:
// local x east from (-1163.5, 881.5), local z SOUTH into the building.
const DEUTSCHER_DOM = { centre: [-1136.5, 896.0], terrain: -0.15, top: 61.5 };

function deutscherDom() {
  const parts = [];
  const clay = (list) => parts.push(...list);
  // The portico, like the French one but a little squatter.
  clay([
    box(-19, 19, 0, 3.2, -2.4, 0.2),
    box(-17, 17, 16.5, 18.3, -2.0, -0.3),
  ]);
  for (const u of [-15.5, -9.3, -3.1, 3.1, 9.3, 15.5]) {
    clay([
      prism(20, 0.8, 3.2, 16.5).translate(u, 0, -1.2),
      prism(20, 1.0, 16.5, 17.2, 0.9).translate(u, 0, -1.2),
    ]);
  }
  clay([wall([[-18, 18.3], [18, 18.3], [0, 25.4]], [], -2.0, -0.3)]);
  for (const u of [-16.5, -13.5, 13.5, 16.5]) {
    clay([
      prism(6, 0.4, 24.2, 26.4, 0.22).translate(u, 0, -1.2), // the pediment's corner statues
      new THREE.SphereGeometry(0.2, 8, 6).translate(u, 26.7, -1.2),
    ]);
  }
  // The tower: columned drum, balustrade, oculus drum, built at the tower's centre.
  const towerX = 27.0; // scene -1136.5
  const towerZ = 14.5; // scene 896.0
  clay([prism(24, 7.0, 21.5, 36.0).translate(towerX, 0, towerZ)]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    clay([prism(8, 0.4, 22.5, 35.4, 0.34).translate(towerX + Math.cos(a) * 7.0, 0, towerZ + Math.sin(a) * 7.0)]);
  }
  clay([
    prism(24, 7.7, 36.0, 37.0).translate(towerX, 0, towerZ),
    prism(24, 7.1, 37.0, 37.6).translate(towerX, 0, towerZ),
  ]);
  for (let i = 0; i < 24; i += 2) {
    const a = (i / 24) * Math.PI * 2;
    clay([prism(6, 0.26, 35.8, 37.0).translate(towerX + Math.cos(a) * 7.1, 0, towerZ + Math.sin(a) * 7.1)]);
  }
  clay([prism(24, 6.0, 37.6, 43.4).translate(towerX, 0, towerZ)]);
  // The hall's great dome: an arcaded drum with its balustrade walkway, then the shell.
  const hallX = 3.5; // scene -1160
  const hallZ = 18.5; // scene 900
  clay([
    prism(32, 11.3, 21.3, 25.6).translate(hallX, 0, hallZ),
    prism(32, 12.1, 25.6, 26.6).translate(hallX, 0, hallZ),
    prism(32, 11.5, 26.6, 27.2).translate(hallX, 0, hallZ),
  ]);
  const hallDome = [
    new THREE.SphereGeometry(11.3, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.56, 1).translate(hallX, 27.2, hallZ),
    prism(8, 0.9, 33.5, 35.3, 0.6).translate(hallX, 0, hallZ), // the lantern
  ];
  // The tower's dome, lucernes, lantern and gilded figure.
  const towerDome = [
    new THREE.SphereGeometry(6.0, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.3, 1).translate(towerX, 43.4, towerZ),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    towerDome.push(prism(6, 0.28, 44.0, 46.6, 0.04).translate(towerX + Math.cos(a) * 5.4, 0, towerZ + Math.sin(a) * 5.4));
  }
  towerDome.push(prism(8, 1.1, 51.2, 52.6).translate(towerX, 0, towerZ));
  const goldParts = [];
  victory(goldParts, { x: towerX, z: towerZ, y0: 52.6, h: 4.0 });

  const dx = -1163.5;
  const dz = 881.5;
  const matrix = [1, 0, 0, dx, 0, 1, 0, DEUTSCHER_DOM.terrain, 0, 0, 1, dz, 0, 0, 0, 1];
  const place = (list, withMaterial) => {
    const mesh = new THREE.Mesh(mergeGeometries(list.map(clean)), withMaterial);
    mesh.matrix.set(...matrix);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldNeedsUpdate = true;
    return mesh;
  };
  cityUniforms.uCuts.value[9].set(-1136.5, 896.0, 12, DEUTSCHER_DOM.terrain + 36.15);
  cityUniforms.uCuts.value[10].set(-1160.0, 900.0, 13, DEUTSCHER_DOM.terrain + 21.65);
  return [place(parts, towerUncut), place(hallDome, copper), place(towerDome, copper), place(goldParts, gold)];
}

// --- Holocaust-Mahnmal ---------------------------------------------------------------------------
// Eisenman's field of 2711 stelae (OSM way 172234733), which the tiles have only as scattered
// two-metre stubs: 2.38 m by 0.95 m slabs in a strict grid over the sunken field, their
// heights swinging between 0.2 and 4.7 m in long undulations. The field's terrain was probed
// from the live mini on 2026-11-10 (a 7x7 grid, metres scene) and baked below, so every slab
// stands on the ground it should. Cut -2.3: below everything, so the stubs go.
const HOLOCAUST_MAHNMAL = { centre: [-2084.5, 769.1], terrain: -2.2, top: 4.7 };
/** The field's edge, OSM way 172234733 converted to scene metres — 19,182 m² inside, matching
 * the real field's published area, so the pitch below lands within a few of the real 2,711. */
const HOLOCAUST_POLYGON = [
  [-2061.2, 693.5], [-2152.5, 703.2], [-2171.2, 848.9], [-2171.5, 852.2], [-1997.6, 796.4], [-1999.0, 791.6],
  [-2010.9, 752.5], [-2013.1, 745.4], [-2023.6, 713.3], [-2032.6, 686.0], [-2050.3, 691.1],
];
/** The field's ground, probed on a 7x7 grid from x -2160..-2000, z 695..845. */
const FIELD_GROUND = [
  [-0.4, -0.4, -0.4, -0.4, -0.4, -0.5, -0.6],
  [-0.5, -0.7, -0.9, -1.1, -1.6, -1.2, -0.6],
  [-0.7, -1.2, -1.4, -1.7, -2.2, -1.5, -0.6],
  [-0.9, -1.9, -1.9, -2.0, -2.2, -1.4, -0.6],
  [-0.6, -1.1, -1.1, -1.1, -1.2, -0.8, -0.3],
  [-0.5, -0.6, -0.6, -0.6, -0.6, -0.3, -0.1],
  [-0.7, -0.5, -0.5, -0.4, -0.3, 0.0, 0.1],
];

function fieldGroundAt(x, z) {
  const gx = THREE.MathUtils.clamp((x + 2160) / 26.67, 0, 6.999);
  const gz = THREE.MathUtils.clamp((z - 695) / 25.0, 0, 6.999);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const g = FIELD_GROUND;
  return (g[i][j] * (1 - fx) + g[i + 1][j] * fx) * (1 - fz) + (g[i][j + 1] * (1 - fx) + g[i + 1][j + 1] * fx) * fz;
}

function insideHolocaust(x, z) {
  let inPoly = false;
  const poly = HOLOCAUST_POLYGON;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inPoly = !inPoly;
  }
  return inPoly;
}

function holocaustMahnmal() {
  const parts = [];
  // A long swell and a short one, so the heights swing in waves the way the real field does.
  const wave = (x, z) => {
    const u = x + 2084.5, v = z - 769.1;
    const h = 2.1 + 2.2 * Math.sin(0.8 + u * 0.11 + v * 0.05) + 1.0 * Math.sin(u * 0.27 - v * 0.18 + 2.1);
    return THREE.MathUtils.clamp(h, 0.2, 4.7);
  };
  for (let x = -2168; x <= -2002; x += 3.4) {
    for (let z = 690; z <= 849; z += 2.08) {
      if (!insideHolocaust(x, z)) continue;
      const ground = fieldGroundAt(x, z);
      const h = wave(x, z);
      parts.push(box(x - 1.19, x + 1.19, ground - 0.35, ground + h, z - 0.475, z + 0.475));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), material);
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldNeedsUpdate = true;
  cityUniforms.uCuts.value[11].set(-2085, 771, 80, -2.3);
  return mesh;
}

// --- Molecule Man ----------------------------------------------------------------------------
// Jonathan Borofsky's 30 m sculpture standing in the Spree by the Treptowers, which the tiles
// never had: three identical walking figures facing each other across a meeting point, every
// one of them a thin aluminium silhouette shot through with small round holes — the molecule
// motif. Each figure is an extruded profile with the holes cut through; the sampler that
// places them is seeded, so the sculpture is the same on every visit.
export const MOLECULE_MAN = { centre: [3363.9, 2651.1], terrain: 0, top: 30 };

/** The sculpture's aluminium, through the city's lighting, with a soft metal sheen and no windows. */
const steel = shadeBuildings(new THREE.MeshPhongMaterial({ color: 0xc2c6cd, specular: 0x555555, shininess: 16, flatShading: true, side: THREE.DoubleSide }), { windows: false, name: 'city-landmarks-steel' });

function moleculeMan() {
  // A seeded generator, so the holes are the same constellation every time.
  const rand = ((seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  })(1912);

  // The right half of the front profile, bottom to top; the left mirrors it.
  const half = [
    [1.05, 0], // the right foot's inner edge
    [2.6, 0], // its outer edge
    [2.95, 6.5], // the outer leg
    [3.25, 15.2], // the hip
    [2.45, 18.6], // the waist
    [2.6, 21.5], // the chest's side
    [3.05, 23.1], // the armpit
    [3.55, 19.6], // down the inner arm, the sliver of light between arm and body
    [3.25, 15.2],
    [3.15, 12.4], // the hand's inner edge
    [4.25, 12.1], // the hand's tip
    [4.75, 15.6], // up the arm's outer edge
    [5.25, 21.4],
    [4.95, 24.5], // the shoulder
    [2.85, 26.3], // the trapezius
    [1.15, 27.0], // the neck
    [1.45, 27.9], // the cheek
    [1.3, 28.9],
    [0.7, 29.75],
    [0, 30], // the crown of the head
  ];
  const outline = [
    [-2.6, 0], // the left foot's outer edge
    [-1.05, 0], // its inner edge
    [-0.6, 11.8], // up the left leg's inner edge
    [0, 13.2], // the crotch
    [0.6, 11.8], // down the right leg's inner edge
    ...half, // and around the right half to the crown
  ];
  for (let i = half.length - 1; i >= 1; i--) outline.push([-half[i][0], half[i][1]]); // down the left half
  const profile = new THREE.Shape();
  profile.moveTo(...outline[0]);
  for (let i = 1; i < outline.length; i++) profile.lineTo(...outline[i]);
  profile.closePath();

  // The molecule holes: small round openings scattered over the body, each kept clear of the
  // outline and of its neighbours. Rejection sampling over the profile's bounding box.
  const inside = (poly, x, y) => {
    let inPoly = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inPoly = !inPoly;
    }
    return inPoly;
  };
  const edgeDist = (poly, x, y) => {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      const dx = xj - xi, dy = yj - yi;
      const t = Math.min(1, Math.max(0, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
    }
    return best;
  };
  const holes = [];
  for (let tries = 0; holes.length < 30 && tries < 800; tries++) {
    const band = rand();
    const y = band < 0.5 ? 13.5 + rand() * 11 : band < 0.78 ? 1 + rand() * 11.5 : band < 0.92 ? 26.8 + rand() * 2.6 : 12 + rand() * 9; // torso, legs, head, arms
    const x = (rand() * 2 - 1) * 4.6;
    const r = 0.14 + rand() * rand() * 0.36;
    if (!inside(outline, x, y) || edgeDist(outline, x, y) < r + 0.28) continue;
    if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + r + 0.22)) continue;
    holes.push({ x, y, r });
  }
  for (const { x, y, r } of holes) {
    const p = new THREE.Path();
    p.absarc(x, y, r, 0, Math.PI * 2, true); // against the profile's run
    profile.holes.push(p);
  }

  // Three figures facing each other across a meeting point: each stands ~2.7 m out from it,
  // turned to face it, so the hands of neighbours meet a whisker short of the halfway angles
  // (hand reach 5.0 m from the point, ±57.6 degrees against 60) — fused, like the real one,
  // with the three heads clearly apart and each figure on its own base in the water.
  const geo = new THREE.ExtrudeGeometry(profile, { depth: 0.8, bevelEnabled: false }).translate(0, 0, -0.4);
  return [0, 1, 2].map((i) => {
    const a = (i * 2 * Math.PI) / 3;
    const mesh = new THREE.Mesh(geo, steel);
    mesh.position.set(MOLECULE_MAN.centre[0] + Math.sin(a) * 2.7, MOLECULE_MAN.terrain, MOLECULE_MAN.centre[1] + Math.cos(a) * 2.7);
    mesh.rotation.y = a + Math.PI; // local +z, the face, towards the meeting point
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  });
}

// --- 030BLN ----------------------------------------------------------------------------------
// The ALX Tower ("030BLN"), topped out at 133 m next to the Berlinian at Alexanderplatz
// (OSM way 1362022530, height 130; completion 2027 per entwicklungsstadt.de): the structure
// already stands over the tiles' 14 m building-site stub, so the shell goes in — a square of
// about 37 m across turned 37 degrees. Ground +2.2 m scene. No cut: the stub hides inside.
export const ALX_TOWER = { centre: [332.2, -195.9], terrain: 2.2, top: 135.2 };

function alxTower() {
  const parts = [
    box(-18, 18, 0, 70, -18, 18),
    box(-16.5, 16.5, 70, 105, -16.5, 16.5).translate(1.5, 0, -1.5),
    box(-14, 14, 105, 129, -14, 14).translate(3, 0, -3),
    box(-14.8, 14.8, 129, 133, -14.8, 14.8).translate(3, 0, -3), // the crown's parapet
  ];
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(clean)), towerMaterial);
  mesh.position.set(ALX_TOWER.centre[0], ALX_TOWER.terrain, ALX_TOWER.centre[1]);
  mesh.rotation.y = -THREE.MathUtils.degToRad(37.3);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export const landmarks = [oberbaumbruecke(), ...frankfurterTor(), ...brandenburgerTor(), ...siegessaeule(), reichstag(), estrelTower(), edgeEastSide(), berlinian(), atriumTower(), ...berlinerDom(), ...moleculeMan(), alxTower(), ...konzerthaus(), ...franzoesischerDom(), ...deutscherDom(), holocaustMahnmal()];
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
