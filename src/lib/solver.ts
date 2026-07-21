/**
 * US5 solver — pure core (Constitution Principle I: TDD-first, Vitest).
 *
 * NO suncalc, NO Cesium. findAlignments takes an injected positionProvider so the
 * alignment-finding logic is unit-testable in isolation from any ephemeris source.
 * The real provider (built in a higher adapter layer) wraps suncalc's getPosition.
 *
 * Angle convention: az/alt are degrees on the unit sphere. az is treated consistently
 * for both arguments (a NORTH-referenced compass in the real world, but conversion to
 * ENU is the caller's job — here both inputs share one convention, so the spherical
 * distance is well-defined regardless of which reference az uses).
 */

export type CelestialBody = 'sun' | 'moon';

export interface SphericalDirection {
  az: number;
  alt: number;
}

export interface PositionProvider {
  (date: Date, body: CelestialBody): SphericalDirection;
}

export interface Alignment {
  date: Date;
  body: CelestialBody;
  az: number;
  alt: number;
  angularDistanceDeg: number;
}

/** Convert a (az, alt) direction in degrees to a 3-D unit vector on the sphere.
 *  az: compass angle around the horizon plane; alt: elevation above the horizon.
 *  Convention is applied consistently to every direction, so the resulting angular
 *  distance is invariant to the choice of azimuth reference. */
function toUnitVector(az: number, alt: number): [number, number, number] {
  const azRad = (az * Math.PI) / 180;
  const altRad = (alt * Math.PI) / 180;
  const cosAlt = Math.cos(altRad);
  return [cosAlt * Math.cos(azRad), cosAlt * Math.sin(azRad), Math.sin(altRad)];
}

/** Generate inclusive-start minute steps from start to end at stepMin resolution.
 *  Yields start, start+stepMin, ... up to but NOT including end (end is exclusive),
 *  so a 24h range at 1min resolution yields exactly 1440 steps. */
export function generateMinuteSteps(start: Date, end: Date, stepMin = 1): Date[] {
  const stepMs = stepMin * 60_000;
  const endTime = end.getTime();
  const steps: Date[] = [];
  for (let t = start.getTime(); t < endTime; t += stepMs) {
    steps.push(new Date(t));
  }
  return steps;
}

/** Great-circle (3-D unit-sphere) angular distance in degrees between two (az, alt)
 *  directions. dot product is clamped to [-1, 1] before acos to prevent NaN from
 *  floating-point drift near identical/opposite directions. */
export function angularDistanceDeg(
  az1: number,
  alt1: number,
  az2: number,
  alt2: number,
): number {
  const [x1, y1, z1] = toUnitVector(az1, alt1);
  const [x2, y2, z2] = toUnitVector(az2, alt2);
  const dot = x1 * x2 + y1 * y2 + z1 * z2;
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/** Find the steps where a celestial body's direction is within toleranceDeg of the
 *  target direction. positionProvider is injected (pure / testable). Default
 *  tolerance is 0.5deg. Results preserve input order. */
export function findAlignments(
  steps: Date[],
  body: CelestialBody,
  target: SphericalDirection,
  toleranceDeg: number,
  positionProvider: PositionProvider,
): Alignment[] {
  const tolerance = toleranceDeg ?? 0.5;
  const alignments: Alignment[] = [];
  for (const date of steps) {
    const pos = positionProvider(date, body);
    const dist = angularDistanceDeg(pos.az, pos.alt, target.az, target.alt);
    if (dist <= tolerance) {
      alignments.push({
        date,
        body,
        az: pos.az,
        alt: pos.alt,
        angularDistanceDeg: dist,
      });
    }
  }
  return alignments;
}
