/**
 * The Molecule Man's shape and place as plain numbers, free of three.js so tests can read them.
 * Jonathan Borofsky's sculpture in the Spree off the Treptowers; landmarks.js extrudes it.
 *
 * What the sources give (read 2026-11-23):
 * - Height 30 m, measured from the water ("30 m, ab Wasserfläche"), about 45 t; three flat
 *   light-metal silhouettes of men in a stride, pierced by "numerous circular holes", meeting
 *   at 120 degrees; the shortened arms run into the arms of the figures opposite; mounted on
 *   five iron pylons in the water, because the toes of two figures interlock and the third
 *   stands apart: bildhauerei-in-berlin.de/bildwerk/molecule-man-4651 (its plate thickness,
 *   "Stärke 0.25 m", is the only figure any source gives and the entry is ambiguous).
 * - "Three human form silhouettes with hundreds of holes, leaning toward each other":
 *   en.wikipedia.org/wiki/Molecule_Man_(sculpture). Perforated aluminium plates, set up in
 *   May 1999: de.wikipedia.org/wiki/Molecule_Man. Borofsky's own page dates it 1997 (the
 *   making) and gives "100 feet": borofsky.com/pastwork/public/moleculeman[germany].
 * - Place and turn: OpenStreetMap way 166268035 (tourism=artwork, height=30) is drawn as a
 *   three-armed star, each arm a strip 0.2-0.3 m wide. Its junction is 52.496962 N,
 *   13.459044 E; the arms leave it on bearings 42.8, 158.1 and 283.3 degrees and are 14.6,
 *   11.3 and 13.3 m long. Wikidata Q522248 (52.496972, 13.459056) and the Bildhauerei map
 *   pin (52.496970, 13.459028) fall within 2 m of that junction. The turn rests on OSM alone.
 *
 * So each figure is a plate standing in a vertical plane through the common axis, seen in
 * profile, walking towards the axis: the back foot far out, the front foot near the axis, the
 * trunk leaning in, one stub of an arm reaching the axis at chest height where the three fuse.
 * The outline below is read from Wikimedia Commons photographs ("Molecule Man - Berlin -
 * 2013.jpg", "202008-Molecule Man 2.jpg", "2012-03-06 Molecule Man.jpg") scaled to the 30 m
 * height, and is approximate to about half a metre; nobody publishes a drawing. Not modelled:
 * the feet differ between the figures in reality (hence five pylons, not six), here all three
 * are alike; the count and sizes of the real holes are unpublished, so the seeded scatter
 * matches the photographs' density by eye only.
 */

/** The axis the three figures share: sceneFromLatLon of the OSM star's junction. */
export const MOLECULE_MAN = {
  lat: 52.496962,
  lon: 13.459044,
  centre: [3370.3, 2653.1],
  /** Scene height of the water the 30 m are measured from (the live terrain reads -0.3 here). */
  terrain: 0,
  top: 30,
  /** Compass bearings on which the figures stand out from the axis: the OSM arms' mean turn, 120 degrees apart. */
  bearings: [41.4, 161.4, 281.4],
  /** Plate thickness in metres; the one published figure is 0.25. */
  thickness: 0.3,
  /** How high the pads under the feet stand out of the water, read from photographs. */
  pad: 0.5,
};

/**
 * One figure in profile as [u, y]: u metres out from the shared axis, y metres above the pad's
 * top on a 0-30 scale (landmarks.js squeezes it so the crown lands on 30 m above the water).
 * Runs up the front, over the head, down the back and through the legs.
 */
export const OUTLINE = [
  [0.5, 0], // front foot: the toe, a step short of the axis
  [0.45, 0.8],
  [1.7, 1.6], // the instep
  [2.3, 3.2], // the shin
  [2.5, 7.0], // the knee
  [2.8, 11.5], // the front of the thigh
  [3.2, 15.0], // the belly
  [3.0, 18.6],
  [2.3, 20.2], // under the arm
  [0, 20.6], // the hand, on the axis, where the three figures fuse
  [0, 23.8],
  [1.5, 24.7], // along the top of the arm to the shoulder
  [2.4, 25.3], // the throat
  [1.9, 26.1], // the chin
  [1.45, 27.1], // the face
  [1.3, 28.1],
  [1.6, 29.1],
  [2.4, 29.8],
  [3.3, 30], // the crown
  [4.2, 29.8],
  [4.9, 29.2],
  [5.3, 28.2], // the back of the head
  [5.15, 27.1],
  [4.7, 26.3], // the nape
  [5.0, 25.5],
  [6.6, 24.2], // the shoulder blade
  [8.0, 21.5], // the back, leaning in
  [8.7, 18.5],
  [9.3, 15.5], // the seat
  [10.1, 11.5], // the back of the thigh
  [11.1, 6.5], // the back of the knee
  [12.0, 3.2], // the calf
  [13.2, 1.0], // the heel of the back foot
  [13.4, 0],
  [9.4, 0], // its toe
  [9.3, 0.8],
  [10.2, 1.7],
  [9.6, 3.5], // up the back leg's shin
  [8.2, 7.0],
  [6.9, 10.6],
  [5.9, 12.4], // the crotch
  [5.4, 10.0], // down the back of the front leg
  [4.9, 6.5],
  [4.6, 3.5],
  [4.4, 1.0], // the front foot's heel
  [4.5, 0],
];

/** Each foot's reach along u, for the pads in the water: [from, to]. */
export const FEET = [[0.5, 4.5], [9.4, 13.4]];

const inside = (poly, x, y) => {
  let inPoly = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inPoly = !inPoly;
  }
  return inPoly;
};

/** Distance from a point to the outline's nearest edge. */
export function edgeDistance(poly, x, y) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const dx = xj - xi, dy = yj - yi;
    const t = Math.min(1, Math.max(0, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
  }
  return best;
}

/** The solid rim the holes keep from the outline, and the web they keep between each other. */
export const RIM = 0.3;
export const WEB = 0.2;

/**
 * The molecule holes of one figure, as {x, y, r} in the outline's frame: round openings of
 * mixed sizes scattered over the whole plate by rejection sampling. Seeded, so the sculpture
 * is the same on every visit; every hole lies inside the outline, RIM clear of its edge and
 * WEB clear of its neighbours.
 */
export function moleculeHoles(count = 200, seed = 1999) {
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const holes = [];
  for (let tries = 0; holes.length < count && tries < 40000; tries++) {
    const x = rand() * 13.4;
    const y = rand() * 30;
    const r = 0.17 + rand() ** 2 * 0.3;
    if (!inside(OUTLINE, x, y) || edgeDistance(OUTLINE, x, y) < r + RIM) continue;
    if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + r + WEB)) continue;
    holes.push({ x, y, r });
  }
  return holes;
}
