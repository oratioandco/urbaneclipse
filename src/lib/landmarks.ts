/**
 * Parametric landmark models — pure data + math, NO Cesium.
 *
 * WHY THESE EXIST (measured, not assumed)
 * ---------------------------------------
 * The Berlin LoD2 building data CANNOT represent the Fernsehturm well enough to plan
 * an urban eclipse. Measured directly from the shipped tile_392_5820.b3dm geometry:
 *
 *   - The sphere is NOT modelled. Its 36.12 m plan outline is extruded as a straight
 *     vertical prism from the ground up — the radius is constant to 4 significant
 *     figures across 216 vertical metres (a sphere would vary as sqrt(r^2 - dz^2)).
 *   - The tapered shaft is NOT modelled: a constant 18 m cylinder.
 *   - The antenna mast is ABSENT. The model tops out at 288.11 m DHHN2016; the real
 *     tip is ~402.6 m. 114.5 m missing.
 *
 * That is LoD2 working as specified (footprint-faithful, generalised roof, no curved
 * or varying-section walls) — it is simply the wrong tool for this target.
 *
 * Consequences at the 3953 m range from Lichtenberger Bruecke, where 1 deg = 69.0 m:
 * silhouette half-width errors of +0.127 deg to +0.184 deg below the sphere — 3-4x the
 * ~0.05 deg composition tolerance. The LoD2 model claims a 0.52 deg-wide obstacle (the
 * disc's own width) where the real shaft is 0.16-0.27 deg wide, so it would report
 * "fully behind the tower" for a disc that actually straddles the shaft with open sky
 * on both sides. Above 253.5 m AGL it reports clear sky through the real antenna.
 *
 * So the tower is modelled analytically here instead, as a solid of revolution.
 * Surrounding LoD2 city geometry remains fine for foreground occlusion.
 */

/** A landmark modelled as a vertical solid of revolution. */
export interface RevolutionLandmark {
  id: string;
  name: string;
  /** Axis position, WGS84 degrees. */
  lat: number;
  lon: number;
  /** Ground elevation at the axis, DHHN2016 orthometric metres. */
  baseOrthometric: number;
  /**
   * Radius profile as (heightAboveBase, radius) pairs in metres, ascending by height.
   * Radius is linearly interpolated between samples. The sphere is sampled finely
   * enough that interpolation error stays far below the angular tolerance.
   */
  profile: ReadonlyArray<readonly [number, number]>;
  /** Provenance and confidence, so downstream accuracy claims stay honest. */
  notes: string;
}

/**
 * Sample a sphere's radius profile, unioned with the surrounding shaft.
 * r(h) = sqrt(R^2 - (h - centre)^2) over the sphere's vertical span.
 */
function sphereSamples(
  centreHeight: number,
  sphereRadius: number,
  shaftRadiusAt: (h: number) => number,
  steps = 16,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const h = centreHeight - sphereRadius + (2 * sphereRadius * i) / steps;
    const dz = h - centreHeight;
    const r = Math.sqrt(Math.max(0, sphereRadius * sphereRadius - dz * dz));
    out.push([h, Math.max(r, shaftRadiusAt(h))]);
  }
  return out;
}

/** Shaft taper: 16 m dia flare at the foot -> 8 m radius by 20 m -> 4.5 m at the top. */
function fernsehturmShaftRadius(h: number): number {
  if (h <= 0) return 16;
  if (h < 20) return 16 + ((8 - 16) * h) / 20; // flared foot
  if (h < 248.78) return 8 + ((4.5 - 8) * (h - 20)) / (248.78 - 20);
  if (h <= 368.03) return 3.0 + ((0.9 - 3.0) * (h - 248.78)) / (368.03 - 248.78); // antenna
  return 0;
}

const SPHERE_CENTRE_AGL = 213;
const SPHERE_RADIUS = 16; // 32 m diameter

/**
 * Berliner Fernsehturm, modelled from published dimensions.
 *
 * Axis: EPSG:25833 E 392080.49, N 5820156.85 — the measured centroid of the LoD2
 * ground ring (+/-1 m), converted to WGS84. Base ground 34.6 m DHHN2016, taken from the
 * LoD2 GroundSurface so it stays consistent with the rest of the scene rather than
 * with Wikipedia's 32 m ue. NHN.
 *
 * SENSITIVITY at 3953 m (1 deg = 69.0 m, tolerance ~0.05 deg):
 *   sphere centre height +/-1 m  -> +/-0.014 deg
 *   axis position       +/-1 m  -> +/-0.014 deg
 *   antenna base dia    +/-2 m  -> +/-0.015 deg  (the one low-confidence figure)
 * All comfortably inside tolerance. Only the sphere diameter (32 m) and total height
 * (368.03 m) need precision, and both are high-confidence published values.
 */
export const FERNSEHTURM: RevolutionLandmark = {
  id: 'fernsehturm',
  name: 'Berliner Fernsehturm',
  lat: 52.520815,
  lon: 13.409419,
  baseOrthometric: 34.6,
  profile: [
    [0, 16.0], // flared foot, 32 m diameter
    [10, 12.0],
    [20, 8.0], // shaft taper begins, 16 m diameter
    [100, 6.77],
    [196, 5.3], // just below the sphere
    ...sphereSamples(SPHERE_CENTRE_AGL, SPHERE_RADIUS, fernsehturmShaftRadius),
    [230, 4.8], // above the sphere, back to shaft
    [248.78, 4.5], // top of the concrete shaft, 9 m diameter
    [248.79, 3.0], // antenna base (LOW CONFIDENCE: ~5-6 m dia estimated)
    [368.03, 0.9], // antenna tip, 1.8 m diameter
  ]
    .slice()
    .sort((a, b) => a[0] - b[0]) as ReadonlyArray<readonly [number, number]>,
  notes:
    'Parametric solid of revolution. LoD2 geometry measured unusable: no sphere ' +
    '(prism extruded from ground), no shaft taper, antenna absent (114.5 m short). ' +
    'Total height 368.03 m and sphere diameter 32 m are high-confidence published ' +
    'values; antenna base diameter is estimated and is the largest uncertainty.',
};

/**
 * Radius of a landmark at a given height above its base, linearly interpolated.
 * Returns 0 at or above the top, and the base radius below the base.
 */
export function radiusAtHeight(landmark: RevolutionLandmark, heightAboveBase: number): number {
  const p = landmark.profile;
  if (p.length === 0) return 0;
  if (!Number.isFinite(heightAboveBase)) {
    throw new RangeError(`height must be finite, received ${heightAboveBase}`);
  }
  if (heightAboveBase <= p[0][0]) return p[0][1];
  const top = p[p.length - 1];
  if (heightAboveBase >= top[0]) return 0;

  for (let i = 1; i < p.length; i++) {
    const [h1, r1] = p[i];
    if (heightAboveBase <= h1) {
      const [h0, r0] = p[i - 1];
      const span = h1 - h0;
      if (span <= 0) return r1;
      return r0 + ((r1 - r0) * (heightAboveBase - h0)) / span;
    }
  }
  return 0;
}

/** Total height of the landmark above its base, metres. */
export function landmarkHeight(landmark: RevolutionLandmark): number {
  const p = landmark.profile;
  return p.length === 0 ? 0 : p[p.length - 1][0];
}
