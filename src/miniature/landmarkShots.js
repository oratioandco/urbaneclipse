/**
 * The sun or moon behind the Viktoria on the Siegessäule and the quadriga on the Brandenburger
 * Tor, as rows for a day: the same rows the TV tower's shots are (dayShots.js), so the cards,
 * the links (`shot=viktoria-sun`, `shot=quadriga-moon`), the planner's fly-to and the calendar
 * entry take them as they are. No three.js and no DOM.
 *
 *   computeLandmarkPasses(from, sheds)   a day's passes behind the two figures, checked against
 *                                        each landmark's viewshed (src/lib/viewshed.ts)
 *   landmarkRows(passes, flags)          the passes as rows
 *
 * The geometry, the strips of open ground one may stand on, and where every number comes from
 * are in src/lib/landmarkStands.ts. What a row has checked and what not is in its `checked`
 * and in its small print: buildings (LoD2, the viewshed) yes, trees no.
 */
import { getMoonIllumination } from 'suncalc';
import { MIN_MOON_ILLUMINATION } from '../lib/dailyPaths.ts';
import { sampleBody } from '../lib/bodyPosition.ts';
import { DISC_DEG, FIGURE_TARGETS, figureHeight, figurePasses } from '../lib/landmarkStands.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { sampleViewshed, VIEW_VISIBLE } from '../lib/viewshed.ts';
import { dayEndOf } from './dayMath.js';
import { sceneFromLatLon } from './eye.js';
import { litPercent } from './spectacle.js';
import { formatClock } from './time.js';

/** Each landmark's picture in public/landmark-sprites (shotCard.js `SPRITE`). */
const SPRITE_OF = { siegessaeule: 'siegessaeule', 'brandenburger-tor': 'brandenburger_tor' };
const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const distanceText = (m) => (m < 995 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** What every one of these rows has and has not been checked against: in full, and for a card's one line. */
export const LANDMARK_CHECK = 'buildings checked, trees not';
export const LANDMARK_CAUTION = 'trees unchecked';

/**
 * A day's passes behind the two figures, for the day that starts at `from` (a Berlin midnight,
 * ms). `sheds` holds each landmark's viewshed by its id (`siegessaeule`, `brandenburger-tor`).
 * A landmark without its viewshed gives no passes: an unchecked standing point is not offered
 * as a shot. A moon under a quarter lit is too faint to read behind a figure and is left out,
 * and so is a pass of a single minute: that is the stand point touching the very end or edge
 * of the strip, not a place to set up a tripod.
 */
export function computeLandmarkPasses(from, sheds = {}) {
  const to = dayEndOf(from);
  const passes = [];
  for (const target of FIGURE_TARGETS) {
    const shed = sheds?.[target.id];
    if (!shed) continue;
    const isClear = (lat, lon) => sampleViewshed(shed, lat, lon) === VIEW_VISIBLE;
    for (const body of ['sun', 'moon']) {
      for (const pass of figurePasses(target, body, from, to, { isClear })) {
        if (pass.points.length < 2) continue;
        if (body === 'moon' && getMoonIllumination(new Date(pass.best.t)).fraction < MIN_MOON_ILLUMINATION) continue;
        passes.push(pass);
      }
    }
  }
  return passes;
}

/** Each landmark's name where a line has no room for it whole: shortened on purpose, never cut by an ellipsis. */
export const SHORTEST_NAME = { siegessaeule: 'Siegess\u00e4ule', 'brandenburger-tor': 'Brandenb. Tor' };
/** The figure as a sentence names it. */
export const figureWord = (target) => (target.figure === 'Quadriga' ? 'quadriga' : target.figure);
/** The scene's zero is the TV tower's foot, 34.6 m DHHN2016 (scripts/miniature/build_city.mjs). */
const SCENE_ZERO_M = 34.6;

/**
 * How a body stands against a target's figure from an eye point in the planner's scene (x east,
 * z south, y up, metres; azimuths from the scene's north): for the line and the caption at eye
 * level. `axis` is the landmark's axis in the scene, `{ x, z }`.
 *
 * @returns distanceM along the ground; figureDeg, the figure's height as seen; discShare, the
 *   disc's width as a share of the figure's height; across and up, degrees from the middle of
 *   the figure to the disc's centre (positive: right, above); covered, whether the disc
 *   overlaps the figure (its outline taken as a third as wide as it is tall, either side).
 */
export function figureView(target, eye, axis, body) {
  const dx = axis.x - eye.x;
  const dz = axis.z - eye.z;
  const distanceM = Math.hypot(dx, dz);
  const base = target.landmark.baseOrthometric - SCENE_ZERO_M;
  const angleTo = (h) => deg(Math.atan2(base + h - eye.y, distanceM));
  const mid = angleTo((target.fromAgl + target.toAgl) / 2);
  const figureDeg = angleTo(target.toAgl) - angleTo(target.fromAgl);
  const bearing = (deg(Math.atan2(dx, -dz)) + 360) % 360;
  const across = (((((body.az - bearing) % 360) + 540) % 360) - 180) * Math.cos(rad(body.alt));
  const up = body.alt - mid;
  const halfWide = deg(Math.atan2(figureHeight(target) / 3, distanceM));
  const covered = body.alt > 0 && Math.abs(up) < figureDeg / 2 + DISC_DEG / 2 && Math.abs(across) < halfWide + DISC_DEG / 2;
  return { distanceM, figureDeg, discShare: DISC_DEG / figureDeg, across, up, covered };
}

const LENSES = [85, 105, 135, 200, 300, 400, 500, 600];
/**
 * A lens (35 mm equivalent) that gives the figure and the disc room: about seven times the
 * larger of the two across the frame's short side, as the nearest common focal length.
 */
export function lensFor(target, distanceM) {
  const figureDeg = deg(2 * Math.atan(figureHeight(target) / 2 / distanceM));
  const focal = 12 / Math.tan(rad((7 * Math.max(figureDeg, DISC_DEG)) / 2));
  return LENSES.reduce((best, f) => (Math.abs(Math.log(f / focal)) < Math.abs(Math.log(best / focal)) ? f : best));
}

/**
 * The spectacle of a pass, on the scale the tower's and the streets' rows use (dayShots.js):
 * the further out, the larger the disc against the figure. The sun runs from 1.1 at half the
 * figure (under the tower's plain 1.2) to 1.7 once it is as wide as the figure is tall: over
 * the longest street's 1.6, under the tower's ring of sun (1.8). The moon runs from 0.6 at half
 * the figure to 2.0, under the tower's big moon (2.4). By day the moon counts 0.6 times, as
 * every row's does (spectacle.js, applied in dayShots.js `collectRows`).
 */
export const landmarkScore = (body, share) => (body === 'moon' ? Math.min(2, 1.2 * share) : Math.min(1.7, Math.max(1.1, 1.1 + 1.2 * (share - 0.5))));

/**
 * The passes as rows, in time order. `flags` switch bodies off (`sun`, `moon`; both on by
 * default). A row's minute is the one whose stand point is nearest the middle of the strip; its
 * small print gives the whole stretch, since every minute of it has a stand point of its own.
 */
/**
 * The minutes round `t` in which the disc is on the figure from one spot: the stretch a
 * photographer standing there has, and what "From here" lists for the same spot (targets.js
 * asks `figureView` too). In the planner's scene, as the eye-level line and "From here" judge
 * it: the scene's north is the TV tower's, three hundredths of a degree off the Siegessäule's
 * own, which is ten seconds of the sun's way and moved a stretch's last minute (17 March 2027:
 * the row said 5:47-5:50, the line and "From here" 5:47-5:51).
 */
export function figureWindow(target, body, point) {
  const [ax, az] = sceneFromLatLon(target.landmark.lat, target.landmark.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const [ex, ez] = sceneFromLatLon(point.lat, point.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  const eye = { x: ex, y: point.groundM - SCENE_ZERO_M + 1.6, z: ez };
  const on = (t) => figureView(target, eye, { x: ax, z: az }, sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon)).covered;
  let start = point.t;
  let end = point.t;
  while (point.t - start < 20 * 60_000 && on(start - 60_000)) start -= 60_000;
  while (end - point.t < 20 * 60_000 && on(end + 60_000)) end += 60_000;
  return { start, end };
}

export function landmarkRows(passes, flags = {}) {
  const { sun = true, moon = true, treesAt = null } = flags;
  const rows = [];
  for (const pass of passes) {
    if (pass.body === 'moon' ? !moon : !sun) continue;
    const { target, body, corridor } = pass;
    // The minute nearest the middle of the strip from whose spot the tree register shows no
    // crowns in the frame; the nearest of all when it shows them from every one.
    // (Its own spots: up to nine minutes of the pass, which the sweep measures.)
    const byMiddle = [...pass.points].sort((a, b) => Math.abs(a.acrossM) - Math.abs(b.acrossM)).slice(0, 9);
    const treed = (p) => treesAt?.(p.lat, p.lon, p.t) ?? 0;
    const best = byMiddle.find((p) => treed(p) === 0) ?? byMiddle.find((p) => treed(p) === 1) ?? byMiddle[0];
    // The stretch is the one from that spot, as every list gives it; the strip's own minutes,
    // each with its own spot, are the pass.
    const { start: firstT, end: lastT } = figureWindow(target, body, best);
    const first = { t: firstT };
    const last = { t: lastT };
    const big = best.discShare >= 1.25;
    const place = `${target.short}’s ${figureWord(target)}`;
    rows.push({
      t: best.t,
      body,
      kind: 'tower',
      landmark: SPRITE_OF[target.id],
      target: target.id,
      short: target.short,
      // For the eye-level ticket's one line (shotCard.js).
      shortest: SHORTEST_NAME[target.id],
      where: target.where,
      side: corridor.side,
      // Where to stand, as short as the tower's "5.3 km SE": the side in a word, since east or
      // west of a gate is the whole question. The street and the way to look are in the detail.
      stand: `${distanceText(best.distanceM)} ${corridor.side}`,
      // What is not checked, for the card that has no room for the detail (shotCard.js).
      caution: LANDMARK_CAUTION,
      brief: `${BODY_NAME[body]} behind ${target.short}`,
      compact: `${BODY_NAME[body]} · ${target.short}`,
      distanceM: best.distanceM,
      score: landmarkScore(body, best.discShare),
      title: big ? `Big ${body} behind the ${place}, ${best.discShare.toFixed(1)}× the figure` : `${BODY_NAME[body]} behind the ${place}`,
      detail:
        `${formatClock(best.t)} · ${formatClock(first.t)}–${formatClock(last.t)} · ` +
        `on ${corridor.street}, ${distanceText(best.distanceM)} ${corridor.side} of ${target.noun}, looking ${corridor.looking} · ` +
        `${Math.round(best.bodyAlt)}° up${body === 'moon' ? ` · ${litPercent(best.t)}% lit` : ''} · ${LANDMARK_CHECK}`,
      checked: { buildings: true, trees: false },
      discShare: best.discShare,
      openAt: best.t,
      at: [best.lat, best.lon],
      look: [best.bodyAz, Math.max(0, best.bodyAlt)],
      lens: lensFor(target, best.distanceM),
      // Other minutes of the pass, each with its own spot, tree-clear ones first: for the planner
      // to try when its full-detail check finds this one blocked or behind trees (pointer.js).
      alternates: byMiddle
        .filter((p) => p !== best)
        .sort((a, b) => treed(a) - treed(b))
        .slice(0, 8)
        .map((p) => ({ t: p.t, at: [p.lat, p.lon] })),
      standBearingDeg: best.bearingDeg,
      standDistanceM: best.distanceM,
    });
  }
  return rows.sort((a, b) => a.t - b.t);
}
