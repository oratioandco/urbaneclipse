/**
 * Pure line-of-sight occlusion classifier — NO Cesium dependency
 * (Constitution Principle I: TDD-first, pure math, Vitest-covered).
 *
 * Consumed by the (future) raycasting adapter that turns Cesium scene.pickRay /
 * 3D-tiles intersection ranges into the {@link Intersection} shape below. All
 * branching logic lives here so it can be exercised without a WebGL context.
 */

export type Vec3 = [number, number, number];

/** Kind of surface a ray hit. Only 'building' and 'terrain' can occlude. */
export type IntersectionKind = 'building' | 'terrain' | 'other';

/** A single ray intersection: a scalar range from the observer plus a surface kind. */
export interface Intersection {
  distance: number;
  kind: IntersectionKind;
}

export type OcclusionResult = 'occluded' | 'marginal' | 'clear' | 'same-point';

/** Euclidean distance between two 3D points. */
export function distance(a: Vec3, b: Vec3): number {
  const dx = a[0]! - b[0]!;
  const dy = a[1]! - b[1]!;
  const dz = a[2]! - b[2]!;
  return Math.hypot(dx, dy, dz);
}

/** Unit direction vector from observer toward target.
 *  Returns [0,0,0] for coincident points (degenerate ray; the caller should have
 *  already short-circuited via classifyOcclusion's 'same-point' branch). */
export function rayDirection(observer: Vec3, target: Vec3): Vec3 {
  const dx = target[0]! - observer[0]!;
  const dy = target[1]! - observer[1]!;
  const dz = target[2]! - observer[2]!;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return [0, 0, 0];
  return [dx / len, dy / len, dz / len];
}

/**
 * Classify whether the line of sight from observer to target is blocked, given
 * the set of ray intersections along that segment.
 *
 * Decision order (priority high -> low):
 *   1. 'same-point'  — targetDistance < epsilon (degenerate segment).
 *   2. 'occluded'    — ANY building/terrain intersection strictly inside the
 *                      before-window  (epsilon < distance < targetDistance - epsilon).
 *   3. 'marginal'    — no occluder, but a building/terrain intersection grazes the
 *                      target (|distance - targetDistance| <= epsilon).
 *   4. 'clear'       — otherwise (incl. all 'other'-kind intersections, which never
 *                      occlude, and intersections beyond the target).
 *
 * The 'occluded' short-circuit makes the scan order-independent: any occluder wins
 * no matter where it appears in the list.
 */
export function classifyOcclusion(
  observer: Vec3,
  target: Vec3,
  intersections: Intersection[],
  epsilon = 0.5,
): OcclusionResult {
  const targetDistance = distance(observer, target);
  if (targetDistance < epsilon) return 'same-point';

  let marginal = false;
  for (const x of intersections) {
    // 'other' surfaces (atmosphere, helpers, selection billboards, ...) never occlude.
    if (x.kind === 'other') continue;

    const d = x.distance;
    // Strictly before the target and clear of the observer end -> hard occlusion.
    if (epsilon < d && d < targetDistance - epsilon) return 'occluded';
    // Grazing the target plane within the tolerance band -> marginal.
    if (Math.abs(d - targetDistance) <= epsilon) marginal = true;
  }

  return marginal ? 'marginal' : 'clear';
}
