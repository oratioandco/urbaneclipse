/**
 * Area solver — "where AND when do I stand for this shot?" Pure math, NO Cesium.
 *
 * THE PROBLEM
 * -----------
 * The original solver swept TIME at a FIXED observer position and reported instants
 * when the body came within a bearing tolerance. What a photographer actually wants is
 * the inverse: "here is the stretch of bridge / park I can reach, here is the landmark,
 * find me the best (position, time) pairs for a full / partial / adjacent composition."
 *
 * THE REDUCTION THAT MAKES IT CHEAP
 * ---------------------------------
 * Brute-forcing a 3-D grid of (lat, lon, t) is enormous and mostly wasted, because
 * almost every position is nowhere near alignment.
 *
 * But at a given instant the body's direction is effectively CONSTANT across a small
 * search area — moving 1 km shifts the moon's topocentric direction by ~0.00015 deg
 * (1 km / 384400 km) and the sun's by ~4e-7 deg, both far below the ~0.05 deg tolerance.
 *
 * So for each instant there is essentially ONE line on the ground from which the
 * landmark covers the body: the observer must lie on the bearing opposite the body's
 * azimuth from the landmark, at whatever distance makes the elevation angle to the
 * chosen feature equal the body's altitude. That turns a 3-DOF search into a 1-DOF
 * time sweep plus a direct solve — and it also yields the genuinely useful answer
 * "your area does not intersect that line; stand HERE instead."
 *
 * Distance is solved iteratively against the exact ellipsoidal azAltTo() rather than a
 * flat-earth formula, because curvature over these ranges is worth ~0.018 deg (a third of
 * the tolerance budget) and the ground elevation at the solved position feeds back into
 * the eye height.
 */
import { resolveEyeEllipsoidalHeight, orthometricToEllipsoidal } from './elevation.js';
import { landmarkHeight, type RevolutionLandmark } from './landmarks.js';
import {
  azAltTo,
  buildSilhouette,
  offsetGeodetic,
  type ObserverGeodetic,
} from './silhouette.js';
import {
  classifyOccultation,
  angularRadiusDeg,
  type OccultationKind,
} from './occultation.js';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Apparent position of the sun/moon at an instant, as seen from the search area. */
export interface BodySample {
  /** Degrees clockwise from north. */
  az: number;
  /** Degrees above the horizon. */
  alt: number;
  /** Distance to the body, km — sets its apparent size. */
  distanceKm: number;
  /** Physical radius of the body, km. */
  radiusKm: number;
}

/** Supplies ground elevation (DHHN2016 m) at a position; undefined outside coverage. */
export type GroundProvider = (pos: LatLon) => number | undefined;

export interface SolveOptions {
  landmark: RevolutionLandmark;
  /**
   * Height up the landmark to aim at, metres above its base. The sphere centre and
   * the antenna give very different shots.
   */
  featureHeightAgl: number;
  /** Photographer's eye height above the surface they stand on, metres. */
  eyeHeight: number;
  ground: GroundProvider;
  /** Convex or simple polygon of reachable camera positions. */
  area?: LatLon[];
  /** Maximum iterations for the distance solve. */
  maxIterations?: number;
}

export interface Candidate {
  when: Date;
  /** Where you must stand. */
  position: LatLon;
  /** Horizontal distance from the landmark axis, metres. */
  distanceM: number;
  kind: OccultationKind;
  coveredFraction: number;
  separationDeg: number;
  /** True when the solved position lies inside the requested area. */
  withinArea: boolean;
}

/** Ray-casting point-in-polygon. Returns false for degenerate polygons. */
export function isInsideArea(pos: LatLon, area: LatLon[]): boolean {
  if (area.length < 3) return false;
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const xi = area[i].lon;
    const yi = area[i].lat;
    const xj = area[j].lon;
    const yj = area[j].lat;
    const intersects =
      yi > pos.lat !== yj > pos.lat &&
      pos.lon < ((xj - xi) * (pos.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Solve for the observer position from which `featureHeightAgl` on the landmark sits
 * exactly in the body's direction.
 *
 * Returns null when the body is at or below the horizon (no such position exists in
 * front of the landmark) or the solve fails to converge.
 */
export function solveObserverPosition(
  body: Pick<BodySample, 'az' | 'alt'>,
  opts: SolveOptions,
): { position: LatLon; distanceM: number; eyeEllipsoidalHeight: number } | null {
  const { landmark, featureHeightAgl, eyeHeight, ground } = opts;
  const maxIterations = opts.maxIterations ?? 12;

  // A body on or below the horizon cannot be seen behind the landmark from any
  // sensible ground position: the required distance diverges.
  if (!(body.alt > 0.05)) return null;

  const featureEllipsoidal =
    orthometricToEllipsoidal(landmark.baseOrthometric) + featureHeightAgl;

  // The observer stands on the bearing OPPOSITE the body's azimuth, measured from the
  // landmark: looking back along that bearing puts the landmark in front of the body.
  const bearingFromLandmark = (body.az + 180) % 360;

  const targetAltRad = (body.alt * Math.PI) / 180;

  // Flat-earth first guess; the loop corrects for curvature and terrain.
  let groundGuess = ground({ lat: landmark.lat, lon: landmark.lon }) ?? landmark.baseOrthometric;
  let eyeEllipsoidal = orthometricToEllipsoidal(groundGuess) + eyeHeight;
  let d = Math.max(1, (featureEllipsoidal - eyeEllipsoidal) / Math.tan(targetAltRad));

  let position: LatLon = { lat: landmark.lat, lon: landmark.lon };

  for (let i = 0; i < maxIterations; i++) {
    const p = offsetGeodetic(landmark.lat, landmark.lon, 0, bearingFromLandmark, d);
    position = { lat: p.lat, lon: p.lon };

    const g = ground(position);
    const resolved = resolveEyeEllipsoidalHeight({
      groundOrthometric: g,
      eyeHeight,
    });
    eyeEllipsoidal = resolved;

    const observer: ObserverGeodetic = {
      lat: position.lat,
      lon: position.lon,
      ellipsoidalHeight: eyeEllipsoidal,
    };
    const actual = azAltTo(observer, landmark.lat, landmark.lon, featureEllipsoidal);

    if (Math.abs(actual.alt - body.alt) < 1e-4) {
      return { position, distanceM: d, eyeEllipsoidalHeight: eyeEllipsoidal };
    }

    // Elevation falls as distance grows, so scale by the tangent ratio.
    const actualTan = Math.tan((actual.alt * Math.PI) / 180);
    const targetTan = Math.tan(targetAltRad);
    if (!Number.isFinite(actualTan) || actualTan <= 0 || targetTan <= 0) return null;

    const next = d * (actualTan / targetTan);
    if (!Number.isFinite(next) || next <= 0) return null;
    // Damp the step so terrain feedback cannot make the iteration oscillate.
    d = d + 0.7 * (next - d);
  }

  return { position, distanceM: d, eyeEllipsoidalHeight: eyeEllipsoidal };
}

/**
 * Evaluate the actual composition at a solved position — the exact silhouette
 * classification, not just the alignment that produced the position.
 */
export function evaluateCandidate(
  when: Date,
  body: BodySample,
  opts: SolveOptions,
): Candidate | null {
  const solved = solveObserverPosition(body, opts);
  if (!solved) return null;

  const observer: ObserverGeodetic = {
    lat: solved.position.lat,
    lon: solved.position.lon,
    ellipsoidalHeight: solved.eyeEllipsoidalHeight,
  };

  const reference = { az: body.az, alt: body.alt };
  const silhouette = buildSilhouette(observer, opts.landmark, reference);
  const discRadius = angularRadiusDeg(body.radiusKm, body.distanceKm);
  const result = classifyOccultation(discRadius, silhouette);

  return {
    when,
    position: solved.position,
    distanceM: solved.distanceM,
    kind: result.kind,
    coveredFraction: result.coveredFraction,
    separationDeg: result.separationDeg,
    withinArea: opts.area ? isInsideArea(solved.position, opts.area) : true,
  };
}

export interface SearchRequest extends SolveOptions {
  start: Date;
  end: Date;
  stepMinutes: number;
  /** Positions of the body over time. */
  bodyAt: (t: Date) => BodySample;
  /** Which compositions to keep. Defaults to full and partial. */
  wanted?: OccultationKind[];
  /** Keep only candidates inside the area. Defaults to true when an area is given. */
  requireWithinArea?: boolean;
  /** Cap on returned candidates, best first. */
  limit?: number;
}

/**
 * Rank candidates. Full occultations first, then by how much of the disc is covered;
 * for adjacent framings, closer to the silhouette is better.
 */
function score(c: Candidate): number {
  if (c.kind === 'full') return 1000;
  if (c.kind === 'partial') return 100 + c.coveredFraction * 100;
  if (c.kind === 'adjacent') return 50 - Math.min(c.separationDeg, 50);
  return 0;
}

/**
 * Sweep the time window, solving the required observer position at each step and
 * classifying the resulting composition.
 *
 * Cost is linear in the number of time steps — the position is SOLVED, never searched.
 */
export function findCompositions(req: SearchRequest): Candidate[] {
  const {
    start,
    end,
    stepMinutes,
    bodyAt,
    wanted = ['full', 'partial'],
    limit = 100,
  } = req;

  if (!(stepMinutes > 0)) {
    throw new RangeError(`stepMinutes must be positive, received ${stepMinutes}`);
  }
  if (end.getTime() < start.getTime()) {
    throw new RangeError('end must not precede start');
  }

  const requireWithinArea = req.requireWithinArea ?? req.area !== undefined;
  const stepMs = stepMinutes * 60_000;
  const out: Candidate[] = [];

  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const when = new Date(t);
    const candidate = evaluateCandidate(when, bodyAt(when), req);
    if (!candidate) continue;
    if (!wanted.includes(candidate.kind)) continue;
    if (requireWithinArea && !candidate.withinArea) continue;
    out.push(candidate);
  }

  out.sort((a, b) => score(b) - score(a));
  return out.slice(0, limit);
}

/**
 * Report whether the requested composition is possible AT ALL for this landmark and
 * body, independent of date, time or position.
 *
 * A full occultation requires the landmark to subtend at least the disc's angular
 * diameter. Beyond the corresponding range it is geometrically impossible — as it is
 * for the Fernsehturm from the Lichtenberger Bruecke, where the 32 m-wide tower spans
 * 0.298 deg against a ~0.518 deg moon. Surfacing this beats searching forever.
 */
export function feasibility(
  landmark: RevolutionLandmark,
  body: Pick<BodySample, 'distanceKm' | 'radiusKm'>,
  observedFromM: number,
): { fullPossible: boolean; maxRangeForFullM: number; landmarkWidthDeg: number } {
  let widest = 0;
  const total = landmarkHeight(landmark);
  for (const [h, r] of landmark.profile) {
    if (h <= total) widest = Math.max(widest, r * 2);
  }
  const discRadius = angularRadiusDeg(body.radiusKm, body.distanceKm);
  const maxRangeForFullM = widest / (2 * Math.tan((discRadius * Math.PI) / 180));
  return {
    fullPossible: observedFromM <= maxRangeForFullM,
    maxRangeForFullM,
    landmarkWidthDeg: (Math.atan2(widest / 2, observedFromM) * 2 * 180) / Math.PI,
  };
}
