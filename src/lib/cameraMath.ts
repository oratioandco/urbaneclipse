/**
 * Pure camera math — NO Cesium dependency (Constitution Principle I: TDD-first, Vitest).
 *
 * Sensor/focal -> horizontal FOV, and the conversion to the value assigned to
 * Cesium's PerspectiveFrustum.fov.
 *
 * ASSUMPTION (fovToCesium): Cesium's PerspectiveFrustum.fov is a *vertical* FOV.
 * For landscape/portrait framing we therefore:
 *   - return the horizontal FOV unchanged when aspectRatio >= 1 (landscape/square:
 *     horizontal FOV is the wider dimension and is what we want to author against), and
 *   - convert horizontal -> vertical FOV when aspectRatio < 1 (portrait), using
 *     vfov = 2*atan(tan(hfov/2) * aspectRatio), so the assigned vertical FOV reproduces
 *     the authored horizontal FOV under the portrait aspect.
 */

/**
 * Horizontal field of view (radians) from sensor dimensions and focal length.
 *
 * Formula: 2 * atan(sensorWidthMm / (2 * focalLengthMm))
 *
 * @throws if sensorWidthMm <= 0 or focalLengthMm <= 0
 */
export function computeHorizontalFov(
  sensorWidthMm: number,
  focalLengthMm: number,
): number {
  if (sensorWidthMm <= 0) {
    throw new RangeError(
      `computeHorizontalFov: sensorWidthMm must be > 0 (got ${sensorWidthMm})`,
    );
  }
  if (focalLengthMm <= 0) {
    throw new RangeError(
      `computeHorizontalFov: focalLengthMm must be > 0 (got ${focalLengthMm})`,
    );
  }
  return 2 * Math.atan(sensorWidthMm / (2 * focalLengthMm));
}

/**
 * Convert a horizontal FOV (radians) to the value that should be assigned to
 * Cesium's `PerspectiveFrustum.fov`.
 *
 * ASSUMPTION: PerspectiveFrustum.fov is interpreted as the *vertical* FOV.
 *   - aspectRatio >= 1 (landscape/square): return `hfovRadians` unchanged.
 *   - aspectRatio <  1 (portrait): convert to vertical FOV via
 *     vfov = 2 * atan(tan(hfovRadians / 2) * aspectRatio), which is strictly
 *     smaller than `hfovRadians`.
 */
export function fovToCesium(
  hfovRadians: number,
  aspectRatio: number,
): number {
  if (aspectRatio >= 1) {
    return hfovRadians;
  }
  return 2 * Math.atan(Math.tan(hfovRadians / 2) * aspectRatio);
}
