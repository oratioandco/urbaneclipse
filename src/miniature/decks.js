/**
 * Telling a bridge's deck from a roof. Pure: it asks its heights of whoever calls it, so the
 * planner gives it the loaded city (sightlines.js) and a test gives it a drawn one.
 *
 * The city model draws a bridge's deck as a built surface above the bare-earth terrain (the
 * river, the rail cutting under it), so a test for "is there a roof here" takes a deck for a
 * building. A deck is told from a roof by what runs over it: a street. Follow the street's
 * points away from the spot; if their surface (the built top where there is one, the terrain
 * where not) carries on without a step until it is plain ground, the built top is a deck that
 * the street comes onto from the ground. A street that passes UNDER something (a rail viaduct,
 * a house over a passage) steps down by the clearance as it comes out, and is not a deck.
 */
export const DECK_MAX_ABOVE_M = 25; // no deck stands higher over the terrain than this
export const DECK_ROAD_NEAR_M = 40; // a street point this near, on the same unbroken surface, is on the deck
export const DECK_HOP_M = 60; // street points follow each other at most this far apart
export const DECK_REACH_M = 700; // how far a deck may run before the street is on the ground
/** A street surface may change this much between two points `d` metres apart. */
export const deckStep = (d) => Math.min(2.5, 1.2 + 0.04 * d);

/**
 * The top of a bridge deck at (x, z), or null where the point is on plain ground, on a
 * building, or under something.
 * @param h.roofAt     (x, z) => the highest built surface over the point, -Infinity on open ground
 * @param h.groundAt   (x, z) => the terrain's height
 * @param h.roadsNear  (x, z, radius) => the street points within `radius`, as [x, z] pairs
 */
export function deckTop(x, z, h) {
  const top = h.roofAt(x, z);
  if (top === -Infinity || top - h.groundAt(x, z) > DECK_MAX_ABOVE_M) return null;
  const surface = (px, pz) => {
    const roof = h.roofAt(px, pz);
    return roof === -Infinity ? { y: h.groundAt(px, pz), built: false } : { y: roof, built: true };
  };
  // The street points on this same surface, right here.
  const queue = [];
  const seen = new Set();
  for (const [px, pz] of h.roadsNear(x, z, DECK_ROAD_NEAR_M)) {
    const s = surface(px, pz);
    // On the same surface: at the deck's height, with nothing but that surface in between
    // (a house beside a bridge may have its eaves at the deck's height; there is a gap between).
    const joined = [0.25, 0.5, 0.75].every((f) => {
      const between = surface(x + (px - x) * f, z + (pz - z) * f);
      return between.built && Math.abs(between.y - top) <= 1.5;
    });
    if (s.built && Math.abs(s.y - top) <= 1.5 && joined) queue.push({ x: px, z: pz, y: s.y });
    seen.add(`${px},${pz}`);
  }
  // Along the street, point to point, for as long as the surface carries on without a step.
  for (let n = 0; queue.length && n < 400; n++) {
    const at = queue.shift();
    for (const [px, pz] of h.roadsNear(at.x, at.z, DECK_HOP_M)) {
      const id = `${px},${pz}`;
      if (seen.has(id) || Math.hypot(px - x, pz - z) > DECK_REACH_M) continue;
      const s = surface(px, pz);
      if (Math.abs(s.y - at.y) > deckStep(Math.hypot(px - at.x, pz - at.z))) continue;
      // The street has come down to plain ground without a step: what we stand on is a deck.
      if (!s.built) return top;
      seen.add(id);
      queue.push({ x: px, z: pz, y: s.y });
    }
  }
  return null;
}
