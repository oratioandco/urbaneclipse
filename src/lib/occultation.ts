/**
 * Urban-eclipse occultation core — pure math, NO Cesium (Constitution Principle I).
 *
 * WHAT AN "URBAN ECLIPSE" IS
 * -------------------------
 * The sun or moon passing BEHIND a building silhouette as seen through a telephoto
 * lens from kilometres away. The occulter is architecture, not the Earth or Moon.
 *
 * This module answers the one question the whole product is built on: given where
 * the disc is and what the structure's silhouette looks like from the observer, is
 * the disc fully hidden, partly hidden, or sitting just beside the structure?
 *
 * FRAME AND UNITS
 * ---------------
 * Everything is expressed in a LOCAL TANGENT-PLANE angular frame in DEGREES, with
 * the disc centre at the origin. Callers project both the disc direction and the
 * structure's vertices into this frame first.
 *
 * The planar (small-angle) approximation is sound here: discs are ~0.52 deg across and
 * the structures of interest subtend well under a degree, while the composition
 * tolerance the product cares about is ~0.05 deg. Distortion over such a patch is
 * orders of magnitude below that.
 *
 * WHY DISC AREA, NOT BEARING TOLERANCE
 * ------------------------------------
 * The original solver matched on "bearing within +/-0.5 deg of the target". At the moon's
 * ~0.52 deg width that only means "somewhere within a lunar diameter" — it finds near
 * misses, not compositions. Overlap AREA is the quantity a photographer actually
 * cares about, and it distinguishes full from partial from adjacent directly.
 */

/** Physical radii, km (IAU values). */
export const SUN_RADIUS_KM = 695700;
export const MOON_RADIUS_KM = 1737.4;

/** A direction in the local tangent-plane angular frame, degrees. */
export interface AngularPoint {
  x: number;
  y: number;
}

export type OccultationKind = 'full' | 'partial' | 'adjacent' | 'clear';

export interface OccultationResult {
  kind: OccultationKind;
  /** Fraction of the disc's AREA hidden by the silhouette, 0..1. */
  coveredFraction: number;
  /**
   * Degrees from the disc's LIMB to the nearest silhouette edge. Zero whenever the
   * silhouette touches the disc at all. This is what ranks "crescent beside the
   * spire" compositions.
   */
  separationDeg: number;
}

function assertFinitePositive(v: number, what: string): void {
  if (!Number.isFinite(v) || v <= 0) {
    throw new RangeError(`${what} must be a finite positive number, received ${v}`);
  }
}

/**
 * Apparent angular RADIUS of a body, degrees: asin(R / d).
 *
 * Uses asin rather than the small-angle R/d because the moon's parallax-corrected
 * distance varies enough (356500-406700 km) to move its apparent size by ~14%, which
 * is decisive at the full/partial boundary.
 */
export function angularRadiusDeg(bodyRadiusKm: number, distanceKm: number): number {
  assertFinitePositive(bodyRadiusKm, 'body radius');
  assertFinitePositive(distanceKm, 'distance');
  if (bodyRadiusKm >= distanceKm) {
    throw new RangeError('body radius must be smaller than the distance to it');
  }
  return (Math.asin(bodyRadiusKm / distanceKm) * 180) / Math.PI;
}

/**
 * The maximum observer-to-occulter range at which a disc can be FULLY hidden behind a
 * structure of the given width, metres.
 *
 * A full occultation requires the structure to subtend at least the disc's angular
 * diameter, so beyond this range the best achievable result is a partial — no date or
 * time will ever produce a complete one.
 *
 * This is a hard geometric bound and it is genuinely decision-changing. The
 * Fernsehturm is at most 32 m wide (the sphere, and the flared foot). From the
 * Lichtenberger Bruecke at 3953 m it subtends only 0.464 deg, while the moon spans
 * 0.49-0.56 deg and the sun 0.533 deg — so a FULL urban eclipse is impossible from that
 * bridge. It requires moving to roughly:
 *     < 3540 m for a mean-distance moon
 *     < 3441 m for the sun
 *     < 3283 m for a perigee (super-) moon
 * Planning tools should surface this up front rather than searching forever for a
 * configuration that cannot exist.
 */
export function maxRangeForFullOccultation(
  occulterWidthM: number,
  discAngularRadiusDeg: number,
): number {
  assertFinitePositive(occulterWidthM, 'occulter width');
  assertFinitePositive(discAngularRadiusDeg, 'disc angular radius');
  return occulterWidthM / (2 * Math.tan((discAngularRadiusDeg * Math.PI) / 180));
}

const cross = (a: AngularPoint, b: AngularPoint): number => a.x * b.y - a.y * b.x;
const dot = (a: AngularPoint, b: AngularPoint): number => a.x * b.x + a.y * b.y;

/**
 * Exact area of the intersection between a circle of radius `r` centred at the ORIGIN
 * and an arbitrary simple polygon.
 *
 * Method: decompose the polygon into origin-anchored triangles (the standard shoelace
 * decomposition) and clip each one to the circle. For every edge, the segment is split
 * at its circle crossings; sub-segments inside the circle contribute a triangle area,
 * sub-segments outside contribute a circular-sector area subtended by the same rays.
 * Summing the signed contributions and taking the magnitude gives the exact
 * intersection area, independent of winding direction and robust to the polygon
 * straddling, containing, or being contained by the circle.
 */
export function circlePolygonIntersectionArea(r: number, polygon: AngularPoint[]): number {
  assertFinitePositive(r, 'circle radius');
  const n = polygon.length;
  if (n < 3) return 0;

  const r2 = r * r;
  let total = 0;

  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    total += clippedWedgeArea(a, b, r, r2);
  }

  return Math.abs(total);
}

/**
 * Signed area of the origin-anchored wedge (O, a, b) clipped to the circle of radius r.
 */
function clippedWedgeArea(a: AngularPoint, b: AngularPoint, r: number, r2: number): number {
  // Parametrise P(t) = a + t*(b - a), t in [0, 1]; solve |P(t)|^2 = r^2.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const qa = dx * dx + dy * dy;

  const breakpoints: number[] = [0, 1];

  if (qa > 0) {
    const qb = 2 * (a.x * dx + a.y * dy);
    const qc = a.x * a.x + a.y * a.y - r2;
    const disc = qb * qb - 4 * qa * qc;
    if (disc > 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-qb - sq) / (2 * qa), (-qb + sq) / (2 * qa)]) {
        if (t > 0 && t < 1) breakpoints.push(t);
      }
    }
  }

  breakpoints.sort((p, q) => p - q);

  let area = 0;
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const t0 = breakpoints[i];
    const t1 = breakpoints[i + 1];
    if (t1 <= t0) continue;

    const p0: AngularPoint = { x: a.x + t0 * dx, y: a.y + t0 * dy };
    const p1: AngularPoint = { x: a.x + t1 * dx, y: a.y + t1 * dy };

    // Classify the sub-segment by its midpoint, which is unambiguous because the
    // breakpoints are exactly the circle crossings.
    const tm = (t0 + t1) / 2;
    const mx = a.x + tm * dx;
    const my = a.y + tm * dy;

    // STRICT comparison is load-bearing. A segment tangent to the circle has a
    // discriminant of exactly zero, so no split point is recorded and the midpoint IS
    // the tangent point, lying exactly on the circle. With `<=` the whole tangent edge
    // was classified as interior, which put ~80% of the disc's area into a
    // measure-zero contact. Tangency is the full/partial boundary the solver sweeps
    // through on every transit, so it has to be exact.
    if (mx * mx + my * my < r2) {
      // Inside: ordinary triangle (O, p0, p1).
      area += 0.5 * cross(p0, p1);
    } else {
      // Outside: the wedge is bounded by the circular arc between the same two rays.
      area += 0.5 * r2 * Math.atan2(cross(p0, p1), dot(p0, p1));
    }
  }

  return area;
}

/** Shortest distance from the origin to a polygon's boundary. */
function distanceOriginToBoundary(polygon: AngularPoint[]): number {
  let best = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    }
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

/**
 * Classify how a structure's silhouette occults a disc.
 *
 * @param discRadiusDeg Angular RADIUS of the sun/moon disc, degrees.
 * @param silhouette    The structure's outline in the disc-centred angular frame.
 * @param opts.adjacentWithinDeg How close the silhouette must come to the disc's limb
 *        to count as 'adjacent' rather than 'clear'. Defaults to one disc diameter,
 *        which is the natural scale for "crescent beside the tower" framing.
 * @param opts.fullEpsilon Coverage above 1 - fullEpsilon counts as 'full', absorbing
 *        floating-point residue from the polygon clip.
 */
export function classifyOccultation(
  discRadiusDeg: number,
  silhouette: AngularPoint[],
  opts: { adjacentWithinDeg?: number; fullEpsilon?: number } = {},
): OccultationResult {
  assertFinitePositive(discRadiusDeg, 'disc radius');

  const adjacentWithin = opts.adjacentWithinDeg ?? discRadiusDeg * 2;
  const fullEpsilon = opts.fullEpsilon ?? 1e-6;

  // A disjoint polygon does not clip to exactly zero: the wedge decomposition sums
  // signed sector areas that cancel to float residue (~1e-17 of the disc) rather than
  // to 0. Anything below this floor is no overlap at all, not a sliver of one.
  const OVERLAP_EPSILON = 1e-9;

  if (silhouette.length < 3) {
    return { kind: 'clear', coveredFraction: 0, separationDeg: Infinity };
  }

  const discArea = Math.PI * discRadiusDeg * discRadiusDeg;
  const overlap = circlePolygonIntersectionArea(discRadiusDeg, silhouette);
  const coveredFraction = Math.min(1, Math.max(0, overlap / discArea));

  if (coveredFraction >= 1 - fullEpsilon) {
    return { kind: 'full', coveredFraction: 1, separationDeg: 0 };
  }

  if (coveredFraction > OVERLAP_EPSILON) {
    return { kind: 'partial', coveredFraction, separationDeg: 0 };
  }

  // No overlap: measure the gap from the disc's limb to the silhouette.
  const separationDeg = Math.max(0, distanceOriginToBoundary(silhouette) - discRadiusDeg);

  return {
    kind: separationDeg <= adjacentWithin ? 'adjacent' : 'clear',
    coveredFraction: 0,
    separationDeg,
  };
}
