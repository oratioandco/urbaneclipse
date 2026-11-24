/**
 * Where to stand so the sun or moon sits behind the figure on top of a low landmark: the
 * Viktoria on the Siegessäule, the quadriga on the Brandenburger Tor. Pure maths and data,
 * no three.js, no DOM.
 *
 * The Fernsehturm's sphere hangs 213 m up, so its day paths run kilometres across the city
 * and a prebuilt viewshed says where buildings hide it (dailyPaths.ts, viewshed.ts). These
 * figures are 23 m and 63 m up. Two things follow, and both are geometry, not taste:
 *
 * 1. The disc only fits behind the figure when the body is low. A disc is 0.52° wide: from
 *    300 m that is 2.7 m, half the quadriga; from 1 km it is 9 m, a little more than the
 *    Viktoria. A stand point closer than `minDiscShare` allows is not offered: the sun there
 *    is a dot beside the figure, not behind it.
 * 2. The view is over the Tiergarten or down Unter den Linden, and trees are in neither the
 *    LoD2 buildings nor (as woods) the tree register. So stand points are kept to open
 *    ground that points at the landmark: a strip of roadway whose axis runs through it. From
 *    anywhere in such a strip the sight line to the landmark stays inside the strip. The
 *    strips are measured, not remembered (see `corridors` below), and each row says what was
 *    checked and what was not.
 *
 * Buildings are still checked, by a viewshed per landmark (scripts/build_viewshed.py
 * `--landmark`), which also asks that the sight line, carried on past the figure, reaches the
 * sky: a sun 2° up behind the quadriga can itself be behind the houses beyond it.
 *
 * Bearings here are from TRUE north (geodesic), as an ephemeris gives them. The planner's
 * scene has grid north (src/miniature/towerShots.js `gridConvergenceDeg`); a stand point
 * leaves here as latitude and longitude, which is the same place in both.
 */
import { sampleBody, type Body } from './bodyPosition.js';
import { BRANDENBURGER_TOR, SIEGESSAEULE, type RevolutionLandmark } from './landmarks.js';
import { offsetGeodetic } from './silhouette.js';

/** A strip of open ground that points at the landmark. */
export interface StandCorridor {
  /** Which side of the landmark the photographer stands on. */
  side: 'east' | 'west';
  /** The way the camera points from there. */
  looking: 'west' | 'east';
  /** The street, and its name short enough for a card. */
  street: string;
  streetShort: string;
  /** Bearing of the strip's axis from the landmark's axis, degrees clockwise from true north. */
  bearingDeg: number;
  /** The strip along its axis, metres from the landmark. */
  fromM: number;
  toM: number;
  /** Where the strip's centre line runs beside the bearing line (positive: to the right, looking out). */
  offsetM: number;
  /** Half its usable width, metres. */
  halfWidthM: number;
  /** Ground along it: (metres from the landmark, DHHN2016 metres), ascending. */
  ground: ReadonlyArray<readonly [number, number]>;
  /** What the strip is and where its numbers come from. */
  notes: string;
}

/** The figure on top of a landmark, and where one can stand to put a disc behind it. */
export interface FigureTarget {
  /** The landmark's id in landmarks.ts, and the viewshed's file name. */
  id: string;
  landmark: RevolutionLandmark;
  /** The landmark as a card names it, and what it is in a sentence ("the column"). */
  short: string;
  noun: string;
  /** The figure, and its name in a link (`shot=viktoria-sun`). */
  figure: string;
  where: string;
  /** The figure's span above the landmark's base, metres. */
  fromAgl: number;
  toAgl: number;
  /** The disc must be at least this share of the figure's height to count as behind it. */
  minDiscShare: number;
  corridors: ReadonlyArray<StandCorridor>;
  notes: string;
}

/** The sun's and the moon's apparent width, degrees, near enough for both (as towerShots.js). */
export const DISC_DEG = 0.52;
/** Eye height of a standing photographer, metres (as the planner's eye level). */
export const EYE_HEIGHT_M = 1.6;
/** Below this the body sits in horizon murk and refraction dominates (as dailyPaths.ts). */
export const MIN_ALTITUDE_DEG = 1;
/** Curvature less standard refraction over a sight line: drop = k * d^2 (as build_viewshed.py). */
const EARTH_RADIUS_M = 6_371_000;
const CURVATURE = (1 - 0.13) / (2 * EARTH_RADIUS_M);

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
/** A difference of bearings, wrapped to -180..180. */
const turn = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/**
 * SIEGESSÄULE, the Viktoria. Heights: de.wikipedia "Siegessäule (Berlin)" (read 2026-11-24)
 * gives the figure as 8.32 m and the monument as "rund 67 Meter" since 1939; the model in
 * landmarks.ts has the figure on 58.7 m, so it spans 58.7 to 67.0 m above the base (35.2 m
 * DHHN2016, DGM1). The total is a round figure: ±0.5 m here is ±0.03° from 1 km.
 *
 * Corridors, both on Straße des 17. Juni, whose two carriageways run either side of a line
 * through the column (OSM, api.openstreetmap.org map extract, 2026-11-24): east of the column
 * their centre lines bear 83.76° and 84.30° from its axis, west of it 263.0° and 264.0°.
 * OSM's mapped trees (natural=tree) stand 12.0 to 13.6 m either side of the east axis from
 * 100 m to 1.3 km, further away beyond; the strip is kept to 9 m either side, the roadway
 * and its middle, clear of the crowns. Ground from DGM1 (1 m, Geoportal Berlin, dl-de/zero-2-0;
 * sheets 386_5818 and 388_5818, median within 4 m, sampled every 50 m on 2026-11-24).
 * - East ends at 1790 m, where Platz des 18. März begins before the Brandenburger Tor.
 * - West ends at 900 m: the Stadtbahn viaduct crosses the street 955 m out (OSM ways
 *   4448413, 51268883) and is in neither LoD2 nor the viewshed, so nothing beyond it is
 *   offered. The long shots from Bismarckstraße and Kaiserdamm need the viaduct's height and
 *   terrain west of the DGM1 sheets; they are not claimed.
 * Altonaer Straße, Spreeweg and Hofjägerallee also meet at the column, but Spreeweg has trees
 * mapped inside the strip and the other two have too few mapped trees to say: left out.
 */
export const VIKTORIA: FigureTarget = {
  id: 'siegessaeule',
  landmark: SIEGESSAEULE,
  short: 'Siegessäule',
  noun: 'the column',
  figure: 'Viktoria',
  where: 'viktoria',
  fromAgl: 58.7,
  toAgl: 67.0,
  minDiscShare: 0.5,
  corridors: [
    {
      side: 'east',
      looking: 'west',
      street: 'Straße des 17. Juni',
      streetShort: 'Str. d. 17. Juni',
      bearingDeg: 84.0,
      fromM: 120,
      toM: 1790,
      offsetM: 0,
      halfWidthM: 9,
      ground: [[100, 34.1], [300, 33.82], [500, 33.67], [700, 33.51], [900, 33.64], [1100, 33.83], [1300, 34.13], [1500, 34.4], [1700, 34.67], [1800, 34.51]],
      notes: 'Roadway between the Großer Stern and Platz des 18. März; mapped trees 12 m or more either side.',
    },
    {
      side: 'west',
      looking: 'east',
      street: 'Straße des 17. Juni',
      streetShort: 'Str. d. 17. Juni',
      bearingDeg: 263.5,
      fromM: 120,
      toM: 900,
      offsetM: 0,
      halfWidthM: 9,
      ground: [[100, 34.09], [300, 34.12], [500, 34.11], [700, 34.13], [900, 34.04]],
      notes: 'Roadway between the Großer Stern and the Stadtbahn viaduct at Tiergarten station; no trees mapped within 18 m.',
    },
  ],
  notes: 'Figure 58.7-67.0 m above the base: 8.32 m figure, about 67 m in all (de.wikipedia). Stand points only on Straße des 17. Juni.',
};

/**
 * BRANDENBURGER TOR, the quadriga. Heights: de.wikipedia "Brandenburger Tor" (read
 * 2026-11-24): "Das Bauwerk ist 20,3 m hoch, die Spitze der Quadriga reicht bis zu einer Höhe
 * von etwa 26 m"; OSM way 518071791 has height=26. So the figure spans 20.3 to 26.0 m above
 * the ground in the passages, 34.9 m DHHN2016 (DGM1 at the axis, 34.89-34.97 within 5 m).
 *
 * The gate has a strong axis: its face runs north-south (34.8 m, OSM), the passages east-west.
 * - West side, looking east: Straße des 17. Juni, carriageway centre lines 263.2-263.7° and
 *   264.3-264.7° from the gate's axis (OSM), mapped trees 12 m or more either side from 600 m
 *   out. The quadriga faces east, so from here it is seen from behind.
 * - East side, looking west: the middle promenade of Unter den Linden, beyond Pariser Platz.
 *   OSM's mapped lindens stand 7.0-8.5 m north and 5.6-6.7 m south of the 83.8° line from 136 m
 *   to 1 km, so the strip is 4 m either side of a centre line 1 m north of it: the walk
 *   between the tree rows. The lindens' crowns are not in any data here; in leaf they may
 *   narrow that view.
 * Pariser Platz itself is too close: from its far edge (about 135 m) the disc is 1.2 m wide
 * against a 5.7 m figure. Ground from DGM1 as above (sheet 388_5818).
 */
export const QUADRIGA: FigureTarget = {
  id: 'brandenburger-tor',
  landmark: BRANDENBURGER_TOR,
  short: 'Brandenburger Tor',
  noun: 'the gate',
  figure: 'Quadriga',
  where: 'quadriga',
  fromAgl: 20.3,
  toAgl: 26.0,
  minDiscShare: 0.5,
  corridors: [
    {
      side: 'west',
      looking: 'east',
      street: 'Straße des 17. Juni',
      streetShort: 'Str. d. 17. Juni',
      bearingDeg: 264.0,
      fromM: 90,
      toM: 1250,
      offsetM: 0,
      halfWidthM: 9,
      ground: [[100, 34.56], [300, 34.55], [500, 34.26], [700, 33.91], [900, 33.71], [1100, 33.54], [1250, 33.53]],
      notes: 'Roadway west of Platz des 18. März; mapped trees 12 m or more either side.',
    },
    {
      side: 'east',
      looking: 'west',
      street: 'Unter den Linden',
      streetShort: 'Unter den Linden',
      bearingDeg: 83.8,
      fromM: 140,
      toM: 1000,
      offsetM: -1,
      halfWidthM: 4,
      ground: [[150, 34.62], [250, 34.25], [350, 33.99], [450, 34.17], [550, 34.4], [650, 34.89], [750, 34.81], [850, 34.53], [950, 34.34], [1000, 34.17]],
      notes: 'Middle promenade east of Pariser Platz, between the linden rows.',
    },
  ],
  notes: 'Figure 20.3-26.0 m above the ground: gate 20.3 m, quadriga tip about 26 m (de.wikipedia). Stand points on the gate\'s axis only.',
};

export const FIGURE_TARGETS: ReadonlyArray<FigureTarget> = [VIKTORIA, QUADRIGA];

/** The middle of the figure above the landmark's base, metres: what the disc's centre sits behind. */
export const aimAgl = (target: FigureTarget) => (target.fromAgl + target.toAgl) / 2;
/** The figure's height, metres. */
export const figureHeight = (target: FigureTarget) => target.toAgl - target.fromAgl;
/** How wide the disc is at the figure from a distance, as a share of the figure's height. */
export const discShare = (target: FigureTarget, distanceM: number) => (2 * distanceM * Math.tan(rad(DISC_DEG / 2))) / figureHeight(target);
/** The nearest stand point: closer, the disc is under `minDiscShare` of the figure. */
export const minDistanceM = (target: FigureTarget) => (target.minDiscShare * figureHeight(target)) / (2 * Math.tan(rad(DISC_DEG / 2)));

/** Ground height along a corridor, metres DHHN2016, linear between its samples. */
export function groundAlong(corridor: StandCorridor, distanceM: number): number {
  const g = corridor.ground;
  if (distanceM <= g[0][0]) return g[0][1];
  for (let i = 1; i < g.length; i++) {
    if (distanceM <= g[i][0]) return g[i - 1][1] + ((g[i][1] - g[i - 1][1]) * (distanceM - g[i - 1][0])) / (g[i][0] - g[i - 1][0]);
  }
  return g[g.length - 1][1];
}

/** The highest and lowest a body can stand and still give a stand point in a corridor. */
export function altitudeRange(target: FigureTarget, corridor: StandCorridor): { min: number; max: number } {
  const at = (d: number) => deg(Math.atan2(target.landmark.baseOrthometric + aimAgl(target) - CURVATURE * d * d - groundAlong(corridor, d) - EYE_HEIGHT_M, d));
  return { min: Math.max(MIN_ALTITUDE_DEG, at(corridor.toM)), max: at(Math.max(corridor.fromM, minDistanceM(target))) };
}

export interface Stand {
  lat: number;
  lon: number;
  /** Along the ground from the landmark's axis, metres. */
  distanceM: number;
  /** Bearing from the landmark to the stand point, degrees clockwise from true north. */
  bearingDeg: number;
  corridor: StandCorridor;
  /** Off the corridor's centre line, metres (positive: to the right, looking out from the landmark). */
  acrossM: number;
  /** The disc's width at the figure as a share of the figure's height. */
  discShare: number;
  /** Ground at the stand point, metres DHHN2016. */
  groundM: number;
}

/**
 * The one point on the ground from which a body at (az, alt) has its centre behind the middle
 * of the figure, if that point lies in one of the target's corridors and is far enough for the
 * disc to count; else null. `az` and `alt` are as seen from the stand point itself (within a
 * hair, from the landmark): apparent altitude, azimuth from true north.
 */
export function standFor(target: FigureTarget, body: { az: number; alt: number }, eyeHeightM = EYE_HEIGHT_M): Stand | null {
  if (!(body.alt >= MIN_ALTITUDE_DEG)) return null;
  const back = (body.az + 180) % 360;
  const slope = Math.tan(rad(body.alt));
  const top = target.landmark.baseOrthometric + aimAgl(target);
  for (const corridor of target.corridors) {
    if (Math.abs(turn(back, corridor.bearingDeg)) > 30) continue;
    // The eye's height depends on where it stands, and the sight line drops with distance: a few rounds settle both.
    let d = (top - groundAlong(corridor, corridor.fromM) - eyeHeightM) / slope;
    for (let i = 0; i < 4; i++) d = (top - CURVATURE * d * d - groundAlong(corridor, d * Math.cos(rad(turn(back, corridor.bearingDeg)))) - eyeHeightM) / slope;
    // The body's azimuth is measured at the eye, the bearing to the eye at the landmark, and
    // the two norths are not parallel: meridians converge, by 0.02° over 1.8 km east-west here.
    const convergence = -deg((d * Math.sin(rad(back)) * Math.tan(rad(target.landmark.lat))) / EARTH_RADIUS_M);
    const bearing = (back + convergence + 360) % 360;
    const off = turn(bearing, corridor.bearingDeg);
    const along = d * Math.cos(rad(off));
    const across = d * Math.sin(rad(off)) - corridor.offsetM;
    if (along < corridor.fromM || along > corridor.toM || Math.abs(across) > corridor.halfWidthM) continue;
    const share = discShare(target, d);
    if (share < target.minDiscShare) continue;
    const at = offsetGeodetic(target.landmark.lat, target.landmark.lon, 0, bearing, d);
    return { lat: at.lat, lon: at.lon, distanceM: d, bearingDeg: bearing, corridor, acrossM: across, discShare: share, groundM: groundAlong(corridor, along) };
  }
  return null;
}

export interface StandPoint extends Stand {
  t: number;
  bodyAz: number;
  bodyAlt: number;
}

/** One run of minutes in which the stand point crosses a corridor. */
export interface FigurePass {
  target: FigureTarget;
  body: Body;
  corridor: StandCorridor;
  /** A stand point per minute, each exact for its own minute. */
  points: StandPoint[];
  /** The minute whose stand point is nearest the corridor's centre line. */
  best: StandPoint;
}

const MINUTE = 60_000;
/** The coarse scan: a body moves at most about 1.2° of azimuth and 0.7° of altitude in it. */
const COARSE = 4 * MINUTE;

/**
 * Every pass of a body behind a target's figure between two instants, in time order: the runs
 * of whole minutes for which `standFor` gives a point, each point solved with the body as seen
 * from that very point. `isClear(lat, lon)` drops the points buildings hide (the landmark's
 * viewshed); without it nothing is dropped, and the caller must not call the result checked.
 * `bodyAt` is for tests (default: `sampleBody`).
 */
export function figurePasses(
  target: FigureTarget,
  body: Body,
  start: number,
  end: number,
  { isClear, bodyAt = (b, t, lat, lon) => sampleBody(b, new Date(t), lat, lon) }: {
    isClear?: (lat: number, lon: number) => boolean;
    bodyAt?: (body: Body, t: number, lat: number, lon: number) => { az: number; alt: number };
  } = {},
): FigurePass[] {
  const { lat, lon } = target.landmark;
  const ranges = target.corridors.map((corridor) => ({ corridor, ...altitudeRange(target, corridor), look: (corridor.bearingDeg + 180) % 360 }));
  const near = (p: { az: number; alt: number }, margin: number) =>
    ranges.some((r) => p.alt >= r.min - margin && p.alt <= r.max + margin && Math.abs(turn(p.az, r.look)) <= 2.5 + margin * 2);
  const passes: FigurePass[] = [];
  let current: FigurePass | null = null;
  const first = Math.ceil(start / MINUTE) * MINUTE;
  let nearNow = first < end && near(bodyAt(body, first, lat, lon), 1);
  for (let coarse = first; coarse < end; coarse += COARSE) {
    // Look closer only when the body is anywhere near a corridor's direction and height at
    // either end of the stretch.
    const nearBefore = nearNow;
    nearNow = near(bodyAt(body, coarse + COARSE, lat, lon), 1);
    if (!nearBefore && !nearNow) continue;
    for (let t = coarse; t < Math.min(coarse + COARSE, end); t += MINUTE) {
      // From the landmark first, then from the point that gives: over 2 km the sun stands 0.02° elsewhere.
      let stand = standFor(target, bodyAt(body, t, lat, lon));
      let seen = stand ? bodyAt(body, t, stand.lat, stand.lon) : null;
      if (stand && seen) stand = standFor(target, seen);
      if (!stand || !seen || (isClear && !isClear(stand.lat, stand.lon))) continue;
      const point: StandPoint = { ...stand, t, bodyAz: seen.az, bodyAlt: seen.alt };
      if (current && current.corridor === stand.corridor && t - current.points[current.points.length - 1].t <= 2 * MINUTE) current.points.push(point);
      else passes.push((current = { target, body, corridor: stand.corridor, points: [point], best: point }));
      if (Math.abs(point.acrossM) < Math.abs(current.best.acrossM)) current.best = point;
    }
  }
  return passes;
}
