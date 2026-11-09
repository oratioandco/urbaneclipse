/**
 * The Mauerweg cherry trees the city register never listed: the ~100 cherries along the
 * former death strip behind Friedhof Baumschulenweg (Kiefholzstraße, between Puder- and
 * Karpfenteichstraße) and the rows between the East Side Gallery and the Spree. The wall
 * lines are the Senatsverwaltung dataset "Verlauf der Berliner Mauer, 1989" (FIS-Broker,
 * digitised from 25 April 1989 aerials) for Kiefholzstraße, and the East Side Gallery's own
 * OSM wall ways for the gallery, whose 1989 course the sparse 1989 dataset misplaces across
 * the Spree bend. Trees in the water are dropped later against the painted map's rings.
 * Seeded jitter keeps rebuilds identical.
 *
 * scene(lat, lon) -> [x, z] is passed in so this stays in step with the build's projection.
 */

const LAT0 = 52.520815;
const LON0 = 13.409419;

// Wall course excerpts (lon, lat), west/north end first.
const KIEFHOLZ_WALL = [
  [13.461256, 52.483564],
  [13.470601, 52.477018],
];
const GALLERY_WALL = [
  [13.444518, 52.503236], [13.444728, 52.503168], [13.44491, 52.503104], [13.44515, 52.503025], [13.445395, 52.502947], [13.445556, 52.502894],
  [13.44425, 52.503338], [13.443936, 52.503447], [13.443634, 52.503554], [13.443431, 52.503626], [13.443242, 52.503693], [13.442859, 52.50383],
  [13.442697, 52.503888], [13.442434, 52.503982], [13.442226, 52.504056], [13.442016, 52.504131], [13.441508, 52.504308], [13.441289, 52.504391],
  [13.441126, 52.504452], [13.441, 52.504502], [13.440855, 52.504558], [13.440711, 52.50461], [13.440552, 52.50467], [13.440383, 52.504736],
  [13.44024, 52.50479], [13.440108, 52.504841], [13.440019, 52.504875], [13.439888, 52.504927], [13.439769, 52.504974], [13.439645, 52.505024],
  [13.439414, 52.505122], [13.4392, 52.505217], [13.438968, 52.505325], [13.43874, 52.505437], [13.438518, 52.505557], [13.438214, 52.505738],
  [13.438063, 52.505829], [13.437916, 52.505923], [13.437199, 52.506446], [13.437042, 52.506569], [13.436957, 52.506636], [13.436896, 52.506688],
  [13.436727, 52.506817], [13.436575, 52.506931], [13.43647, 52.507014], [13.436373, 52.507091], [13.436191, 52.507238], [13.436075, 52.507328],
  [13.43598, 52.507402], [13.435874, 52.507484], [13.435761, 52.507571], [13.435595, 52.507701], [13.435499, 52.507777], [13.435367, 52.507877],
  [13.435271, 52.507936], [13.43519, 52.507987], [13.435025, 52.50807], [13.434928, 52.50812], [13.434715, 52.508231], [13.434539, 52.508318],
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Resample a polyline (lon/lat) every step metres, returning scene-space points. */
function walk(polyline, step, scene) {
  const pts = polyline.map(([lon, lat]) => scene(lat, lon));
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len, (bx - ax) / len, (bz - az) / len]);
      d += step;
    }
    carry = d - len;
  }
  return out;
}

/**
 * Rows of cherries along a wall polyline. Side picks the perpendicular with a dot test
 * against a reference point known to be on that side (the cemetery, the Spree).
 */
function rows(polyline, scene, { side, spacing, offsets, jitter, seed, kinds, heights }) {
  const [rx, rz] = scene(side.ref[1], side.ref[0]);
  const rand = rng(seed);
  const trees = [];
  for (const offset of offsets) {
    for (const [x, z, dx, dz] of walk(polyline, spacing, scene)) {
      // Unit normals of the local direction; pick the half-plane the reference lies in.
      const nx = -dz;
      const nz = dx;
      const sign = (rx - x) * nx + (rz - z) * nz >= 0 ? 1 : -1;
      trees.push({
        x: x + sign * nx * offset + (rand() - 0.5) * jitter,
        z: z + sign * nz * offset + (rand() - 0.5) * jitter,
        h: heights[0] + rand() * (heights[1] - heights[0]),
        kind: rand() < kinds.early ? 3 : 4,
      });
    }
  }
  return trees;
}

export function mauerwegCherries(scene) {
  // Kiefholzstraße: ~100 cherries flanking the path on both sides of the former strip,
  // straight stretch behind the cemetery from the Puderstraße corner southeast.
  const kiefholz = rows(KIEFHOLZ_WALL, scene, {
    side: { ref: [13.465, 52.485] }, // Friedhof Baumschulenweg, the cemetery side
    spacing: 9.6,
    offsets: [7, -7],
    jitter: 3,
    seed: 19900410,
    kinds: { early: 0.85 },
    heights: [6, 10],
  });
  // East Side Gallery: rows on the Spree side of the wall, between the gallery and the water.
  const gallery = rows(GALLERY_WALL, scene, {
    side: { ref: [13.438, 52.5045] }, // the Spree off Mühlenstraße
    spacing: 8,
    offsets: [12, 24],
    jitter: 2.5,
    seed: 19900411,
    kinds: { early: 0.85 },
    heights: [6, 10],
  });
  return [...kiefholz, ...gallery];
}
