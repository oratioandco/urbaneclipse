/**
 * Pure camera math — NO Cesium dependency (Constitution Principle I: TDD-first, Vitest).
 *
 * Sensor/focal -> horizontal FOV, and the conversion to the value assigned to
 * Cesium's PerspectiveFrustum.fov.
 *
 * Cesium's PerspectiveFrustum.fov applies to the frame's longer side: horizontal in
 * landscape, vertical in portrait. A sensor's width is its long side, and a photographer
 * turns the camera for a portrait frame, so the angle carries over unchanged either way.
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
 * The value for Cesium's `PerspectiveFrustum.fov`, given the angle across the sensor's
 * long side. Takes no aspect ratio because Cesium already applies it to the frame's
 * long side.
 */
export function fovToCesium(longSideFovRadians: number): number {
  return longSideFovRadians;
}
