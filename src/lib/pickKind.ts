/**
 * Classifies a Cesium pick result into the surface kinds the occlusion classifier
 * understands. Pure object-shape inspection, NO Cesium (Constitution Principle I) — it
 * decides whether ANYTHING occludes, so it must be testable without a WebGL context.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 * ---------------------------------
 * It used to live inside src/cesium/lineOfSight.ts, which reads `window.Cesium` at
 * module scope and so could never be unit-tested. It was wrong the whole time and
 * nothing caught it: every check missed the shape Cesium 1.143 actually returns, so
 * buildings classified as 'other' and NEVER occluded. tests/e2e/us1-occlusion.spec.ts
 * (SC-001) has been failing on exactly that.
 *
 * THE SHAPES CESIUM 1.143 REALLY RETURNS (captured from the live scene)
 * --------------------------------------------------------------------
 *   b3dm building   { content, primitive: <Cesium3DTileset>, detail, id }
 *   entity helper   { primitive: <Primitive|PointPrimitive>, id: <Entity>, collection? }
 *   globe / terrain  undefined                     <- no pickId is issued for the globe
 *
 * Note what is NOT there: because these tiles carry no batch table, Cesium takes its
 * `buildPickObject` path instead of producing a `Cesium3DTileFeature`. So `.tileset` is
 * undefined, `.getContent` is undefined, and the constructor is a plain `Object` — the
 * three things the old implementation tested for. The reliable discriminator is
 * `primitive.isCesium3DTileset`, which is the test Cesium itself uses internally.
 */
import type { IntersectionKind } from './occlusionMath.js';

/**
 * Pick id carried by the parametric Fernsehturm primitive (src/cesium/landmarkModel.ts).
 *
 * The landmark is the TARGET, not an obstacle: it is the default target and the entire
 * subject of the app. Counting its own geometry as an occluder would make every
 * sightline to it permanently self-blocked, because a ray aimed at the tip necessarily
 * grazes the shaft and antenna below it.
 *
 * CONSEQUENCE, stated plainly: if a user places a target elsewhere and the Fernsehturm
 * stands between, this parametric tower will not block the verdict. The LoD2 tile mass
 * at the same location still will, via the 'building' path — though it is ~114 m short,
 * so a sightline crossing the upper tower reads clear when it should not. Making this
 * conditional on "is the landmark the current target" is the fix if arbitrary targets
 * ever become a real workflow; today the Fernsehturm is the only landmark and the
 * default target, so the simple rule is the correct one.
 */
export const LANDMARK_PICK_ID = 'pv-landmark-fernsehturm';

/**
 * Classify a picked object.
 *
 * Only 'building' and 'terrain' occlude (see classifyOcclusion). Helper geometry —
 * markers, the line-of-sight polyline, the search-area ellipse — must stay 'other', or
 * the sightline would report itself as its own obstruction.
 */
export function classifyPick(picked: unknown): IntersectionKind {
  // The globe arrives as `undefined` (it issues no pickId). computeOcclusion hides the
  // globe for the pick anyway, so terrain should never reach here at all; either way it
  // must not be mistaken for an occluder.
  if (!picked || typeof picked !== 'object') return 'other';

  const p = picked as Record<string, unknown>;

  // The target landmark, before anything else — see LANDMARK_PICK_ID.
  if (p.id === LANDMARK_PICK_ID) return 'other';

  const primitive = p.primitive as { isCesium3DTileset?: boolean } | undefined;
  if (primitive != null && primitive.isCesium3DTileset === true) return 'building';

  // Belt and braces for the batched case: a Cesium3DTileFeature exposes `tileset` and
  // `getContent` directly. Not what these tiles produce today, but it costs nothing and
  // keeps the classifier correct if a batch table is ever added to the conversion.
  if (typeof p.tileset === 'object' && p.tileset !== null) return 'building';
  if (typeof p.getContent === 'function') return 'building';

  return 'other';
}
