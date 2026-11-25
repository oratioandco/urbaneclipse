/**
 * The shots of one Berlin day: the rows that `/plan/` lists and the home page's grid shows.
 * One pipeline for both, and nothing here needs the 3D scene: no three.js, no DOM, so the
 * home page loads it without the planner and Node can test it.
 *
 *   computeDayPaths(from, shed)            the day's tower paths, checked against the buildings
 *   computeLandmarkPasses(from, sheds)     the day's passes behind the Siegessäule's Viktoria and
 *                                          the Brandenburger Tor's quadriga (landmarkShots.js)
 *   collectRows(paths, moments, from, f, passes)   every shot of the day, in time order
 *   dayShots(from, { shed, views, sheds })   all of it in one call, from the city data alone
 *   withoutContinued(rows, from, before)   a list of days side by side: drop a midnight repeat
 *   shotKey(row), findShot(rows, key, t)   a shot's name in a link, and the row it names
 *   streetStatus(row, t)                   the eye-level status line under a street shot
 *   shotStillHeld(row, stoodAt, here, t)   whether the ticket's card still names the view
 *
 * A row is a shot for `shotCard` (shotCard.js). It also says where to stand and look, as
 * numbers a link can carry and the planner can fly to: `at` (lat, lon), `look` (heading and
 * pitch, degrees), `lens`, `openAt` (the instant to open at), and for the antenna the bearing
 * and distance of the stretch (`standBearingDeg`, `standDistanceM`). Flying there is the
 * planner's business (`go`, added in daylist.js).
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { applyView, compassPoint, computeDayPath, MIN_MOON_ILLUMINATION } from '../lib/dailyPaths.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { offsetGeodetic } from '../lib/silhouette.ts';
import { streetMoments } from '../lib/streets.ts';
import { sampleViewshed, VIEW_VISIBLE } from '../lib/viewshed.ts';
import { dayEndOf } from './dayMath.js';
import { formatClock } from './time.js';
import { computeLandmarkPasses, landmarkRows } from './landmarkShots.js';
import { litPercent, moonShows, paleMoon, TREES_IN_WAY, TREES_IN_WAY_NOTE, TREES_IN_WAY_SCORE, TREES_UNCHECKED } from './spectacle.js';
import { bodyAgainstTower, discOverSphere, EYE_HEIGHT, SPHERE_CENTRE_AGL, SPHERE_TOP_AGL, TIP_AGL, towerSentence, visibleMoon } from './towerShots.js';

export { computeLandmarkPasses };

export const BODY_NAME = { sun: 'Sun', moon: 'Moon' };
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const bodyAt = (body, t) => sampleBody(body, new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);

/**
 * The day's tower paths for the day that starts at `from` (a Berlin midnight, ms): where on
 * the ground the sun and the moon stand behind the tower's sphere, minute by minute, with each
 * point marked clear or not once the viewshed (`shed`, src/lib/viewshed.ts) is given.
 */
/** Whether the tower is seen from a place, by the viewshed; null without one (nothing is known). */
/** Whether the tree register puts crowns in a shot's frame from a place; null when that is not known. */
export const treesSeenFrom = (shed) => shed?.treesAt ?? null;
export const towerSeenFrom = (shed) => (shed ? (lat, lon) => sampleViewshed(shed, lat, lon) === VIEW_VISIBLE : null);

export function computeDayPaths(from, shed = null) {
  return ['sun', 'moon']
    .map((body) => computeDayPath({ body, start: new Date(from), end: new Date(dayEndOf(from)), landmark: FERNSEHTURM }))
    .filter((path) => path.body === 'sun' || path.illumination >= MIN_MOON_ILLUMINATION)
    .map((path) => (shed ? applyView(path, (lat, lon) => sampleViewshed(shed, lat, lon) === VIEW_VISIBLE) : path))
    .map(visibleMoon);
}

/**
 * Every chance of a day, in time order: the sun or moon behind the tower's sphere, moonrise
 * and moonset behind the antenna, the sun or moon behind the figures on the Siegessäule and
 * the Brandenburger Tor, and street henges. `paths` are `computeDayPaths`'s, `moments` the
 * day's street moments (`streetMoments`, src/lib/streets.ts), `from` the day's start, `passes`
 * `computeLandmarkPasses`'s. `flags` switch kinds and bodies off (`tower`, `landmarks`,
 * `streets`, `sun`, `moon`; all on by default), and `flags.seesTower(lat, lon)` says whether
 * the tower is seen from a place (`towerSeenFrom`); with it, a moon on the antenna is listed
 * only where it can be seen. Each row carries a spectacle score, so a list
 * can rank the big moon over a short henge; a short name (the place); the shot in a few words
 * (`brief`); and for tower and landmark rows where to stand (`stand`), which is all that tells
 * two of them apart.
 */
export function collectRows(paths, moments, from, flags = {}, passes = []) {
  const { tower = true, streets = true, sun = true, moon = true, landmarks = true, seesTower = null, treesAt = null } = flags;
  const shown = (item) => (item.body === 'moon' ? moon : sun);
  const rows = [];
  if (tower) {
    for (const path of paths.filter(shown)) {
      // Stretches of the path with a clear view of the tower, each a row. A building in the
      // way for more than three minutes ends a stretch: a row is one pass from one spot, and a
      // stretch joined across gaps read "3:43 PM-6:48 PM (with breaks) · 440 m E", three hours
      // at one distance. Kept only when long enough to get to.
      const windows = [];
      for (const segment of path.segments) {
        for (const p of segment) {
          if (p.clear === false) continue;
          const last = windows[windows.length - 1];
          // (Unchecked paths come in three-minute steps: a gap is anything longer than one.)
          if (last && p.t - last.points[last.points.length - 1].t <= 200_000) last.points.push(p);
          else windows.push({ points: [p] });
        }
      }
      // The spot for an instant, worked out for that instant itself: the path's points between
      // its three-minute solutions are drawn straight and lie metres off.
      const spotAt = (t) => {
        const sky = bodyAt(path.body, t);
        const bearing = (sky.az + 180) % 360;
        const distanceM = (SPHERE_CENTRE_AGL - EYE_HEIGHT) / Math.tan(rad(sky.alt));
        const at = offsetGeodetic(FERNSEHTURM.lat, FERNSEHTURM.lon, 0, bearing, distanceM);
        return { t, sky, bearing, distanceM, lat: at.lat, lon: at.lon, eye: { x: Math.sin(rad(bearing)) * distanceM, y: EYE_HEIGHT, z: -Math.cos(rad(bearing)) * distanceM } };
      };
      const touches = (spot, t) => ['hidden', 'ring', 'edge'].includes(bodyAgainstTower(spot.eye, 0, bodyAt(path.body, t)).state);
      for (const w of windows) {
        const first = w.points[0];
        const lastPoint = w.points[w.points.length - 1];
        if (lastPoint.t - first.t < 4 * 60_000) continue;
        // The row's instant: the one nearest the middle of the stretch whose spot the viewshed
        // lets see the tower and the tree register shows no crowns from; the nearest that sees
        // the tower when trees stand in every one.
        const middle = (first.t + lastPoint.t) / 2;
        const spots = w.points
          .filter((p, i) => i % 2 === 0)
          .sort((a, b) => Math.abs(a.t - middle) - Math.abs(b.t - middle))
          .map((p) => spotAt(p.t))
          .filter((spot) => spot.sky.alt >= 1 && (!seesTower || seesTower(spot.lat, spot.lon)));
        if (!spots.length) continue;
        // The row's own spots: up to eleven minutes of the pass, nearest its middle first. The
        // row stands on the first of them the tree register leaves clear; the planner tries the
        // rest; the sweep measures them all (scripts/adversarial/rows.mjs).
        const own = spots.filter((spot, i, all) => all.findIndex((o) => Math.abs(o.t - spot.t) < 60_000) === i).slice(0, 11);
        const mid = own.find((spot) => !treesAt?.(spot.lat, spot.lon)) ?? own[0];
        const align = mid.t;
        const over = discOverSphere(mid.distanceM);
        const sky = mid.sky;
        // What the pass is from that spot at that instant, by the rule the eye-level line and
        // "From here" use (bodyAgainstTower): behind the sphere or a ring round it. One sentence
        // for it everywhere (towerSentence). The ground there is not known here and is taken
        // level with the tower's foot.
        const seen = bodyAgainstTower(mid.eye, 0, sky).state;
        const state = ['hidden', 'ring', 'edge'].includes(seen) && !(path.body === 'moon' && seen === 'hidden') ? seen : path.body === 'moon' || over > 1 ? 'ring' : 'hidden';
        // The stretch from that spot: the minutes the disc is on the sphere.
        let start = align;
        let end = align;
        while (align - start < 30 * 60_000 && touches(mid, start - 20_000)) start -= 20_000;
        while (end - align < 30 * 60_000 && touches(mid, end + 20_000)) end += 20_000;
        // Other spots serve other minutes: said when the stretch of them is long.
        const others = lastPoint.t - first.t > 20 * 60_000 ? ` · other spots ${formatClock(first.t)}–${formatClock(lastPoint.t)}` : '';
        rows.push({
          t: align,
          start,
          until: end,
          body: path.body,
          kind: 'tower',
          landmark: 'fernsehturm',
          short: 'TV tower',
          where: 'sphere',
          state,
          stand: `${distanceText(mid.distanceM)} ${compassPoint(mid.bearing)}`,
          brief: state === 'edge' ? `${BODY_NAME[path.body]} at TV tower’s edge` : path.body === 'moon' ? 'Moon behind TV tower' : state === 'ring' ? 'Sun ring at TV tower' : 'Sun behind TV tower',
          distanceM: mid.distanceM,
          // The closer the tower, the larger the body behind it: the spectacle, scored.
          // A pass that only touches the sphere's edge counts as From here counts it: 1.3 and 1.
          score: state === 'edge' ? (path.body === 'moon' ? 1.3 : 1) : path.body === 'moon' ? Math.min(2.4, 1.5 * over) : state === 'ring' ? 1.8 : 1.2,
          title: towerSentence(path.body, state, over),
          // Every row's small print starts with its own minute; its stretch follows.
          detail: `${formatClock(align)} · ${formatClock(start)}–${formatClock(end)} · ${distanceText(mid.distanceM)} ${compassPoint(mid.bearing)} of the tower · ${Math.round(sky.alt)}° up${others}`,
          openAt: align,
          at: [mid.lat, mid.lon],
          look: [sky.az, Math.max(0, sky.alt)],
          lens: 200,
          // Other minutes of the same pass, each with the spot the disc is behind the sphere
          // from at that minute: for the planner to try, tree-clear ones first and nearest in
          // time, when its full-detail check finds the row's own spot blocked (pointer.js).
          alternates: own
            .filter((spot) => spot !== mid)
            .sort((a, b) => Number(Boolean(treesAt?.(a.lat, a.lon))) - Number(Boolean(treesAt?.(b.lat, b.lon))))
            .map((spot) => ({ t: spot.t, at: [spot.lat, spot.lon] })),
        });
      }
    }
  }
  // Moonrise and moonset behind the antenna: the moon low, more than half lit, and visible
  // round the thin mast from a few kilometres out.
  if (tower && moon) {
    // Which days have the shot goes by the moon at the day's noon; what a row prints is the
    // moon of its own minute (litPercent), as every other list prints it.
    if (getMoonIllumination(new Date(from + 43_200_000)).fraction >= 0.5) {
      let open = null;
      const windows = [];
      // A pass across midnight is one shot: looked for from two hours before the day to two
      // after, whole, and listed on the day its opening minute falls in. Cut at midnight it
      // read "11:45 PM–12:00 AM" one day and came again the next (10 and 11 September 2027).
      const PAST_MIDNIGHT = 2 * 3_600_000;
      for (let t = from - PAST_MIDNIGHT; t <= dayEndOf(from) + PAST_MIDNIGHT; t += 5 * 60_000) {
        const p = bodyAt('moon', t);
        const low = p.alt >= 1 && p.alt <= 8;
        if (low && !open) windows.push((open = { start: t, end: t, samples: [] }));
        if (low) {
          open.end = t;
          open.samples.push({ t, ...p });
        } else open = null;
      }
      for (const w of windows) {
        if (w.samples.length < 2) continue;
        const rising = w.samples[w.samples.length - 1].alt > w.samples[0].alt;
        const middle = w.samples[Math.floor(w.samples.length / 2)];
        const reach = (h, alt) => Math.min(9000, (h - EYE_HEIGHT) / Math.tan(rad(alt)));
        const near = reach(SPHERE_TOP_AGL, Math.max(...w.samples.map((p) => p.alt)));
        const far = reach(TIP_AGL, Math.min(...w.samples.map((p) => p.alt)));
        // The minute to open at and the place to stand for it. At each minute the moon is behind
        // the antenna only from a stretch of the line through the tower (nearer, it stands over
        // the tip; further, behind the sphere), and the stretch moves out as the moon sinks. The
        // row opens at the minute nearest the middle of the pass that has a place on its stretch
        // from which the tower is seen (`seesTower`, the viewshed); a pass with none is not a
        // shot and is not listed. Before, the row opened at the middle of the pass on a spot found
        // along the whole line: 6.9 km out on 24 December 2026, facing a wall, the moon 1.3
        // degrees over the tip.
        let stand = null;
        for (const sample of [...w.samples].sort((a, b) => Math.abs(a.t - middle.t) - Math.abs(b.t - middle.t))) {
          const from = reach(SPHERE_TOP_AGL, sample.alt);
          const to = reach(TIP_AGL, sample.alt);
          if (to - from < 50) continue;
          const bearing = (sample.az + 180) % 360;
          const place = (d) => offsetGeodetic(FERNSEHTURM.lat, FERNSEHTURM.lon, 0, bearing, d);
          // On the mast, and off the sphere: what the eye-level line will call "behind the
          // antenna" (bodyAgainstTower), with the ground there taken 10 m either way since the
          // row does not know it. A spot near the stretch's inner end had the moon's edge on
          // the sphere: the row said antenna, the line "at the edge of the sphere".
          const onMast = (d) => {
            const x = Math.sin(rad(bearing)) * d;
            const z = -Math.cos(rad(bearing)) * d;
            return [-10, 0, 10].every((lift) => bodyAgainstTower({ x, y: EYE_HEIGHT + lift, z }, 0, sample).state === 'antenna');
          };
          // From the middle of the stretch outward both ways, so the moon sits well on the mast.
          const spots = [];
          // Every 10 m: the places the tower shows from are often a gap a house wide, and at
          // 40 m the pass of 18 November 2027 (moonrise, 9:20 PM, 2.6 km WSW) had none.
          const STEP_M = 10;
          const steps = Math.floor((to - from) / 2 / STEP_M);
          for (let k = 0; k <= steps; k++) {
            for (const d of k ? [(from + to) / 2 - k * STEP_M, (from + to) / 2 + k * STEP_M] : [(from + to) / 2]) {
              if (!onMast(d)) continue;
              const spot = place(d);
              if (!seesTower || seesTower(spot.lat, spot.lon)) spots.push({ d, spot });
            }
          }
          if (!spots.length) continue;
          // The row's own spots: the one nearest the middle and up to eleven others, well
          // apart. The row stands on the first of them the tree register leaves clear; the
          // others are for the planner to try when its full-detail check finds that one blocked
          // (pointer.js): the viewshed knows buildings on a 5 m grid, the scene knows more.
          const own = [spots[0]];
          for (const c of spots.slice(1)) {
            if (own.length < 12 && own.every((o) => Math.abs(o.d - c.d) >= 120)) own.push(c);
          }
          own.sort((a, b) => Number(Boolean(treesAt?.(a.spot.lat, a.spot.lon))) - Number(Boolean(treesAt?.(b.spot.lat, b.spot.lon))));
          const ds = spots.map((c) => c.d);
          stand = { sample, bearing, range: [Math.min(...ds), Math.max(...ds)], out: own[0].d, spot: own[0].spot, others: own.slice(1) };
          break;
        }
        if (!stand || stand.sample.t < from || stand.sample.t >= dayEndOf(from)) continue;
        const { sample: mid, bearing } = stand;
        rows.push({
          // The row's time is the minute it opens at; the stretch itself is in the detail, and
          // the shot has passed only when the stretch has.
          t: mid.t,
          start: w.start,
          until: w.end,
          body: 'moon',
          kind: 'tower',
          landmark: 'fernsehturm',
          short: 'TV antenna',
          where: 'antenna',
          // Where the row opens, not where the stretch begins: "1.6 km+" stood on rows that open
          // 6 km out. The stretch is in the small print.
          stand: `${distanceText(stand.out)} ${compassPoint(bearing)}`,
          brief: `${rising ? 'Moonrise' : 'Moonset'} on TV antenna`,
          distanceM: stand.out,
          state: 'antenna',
          score: 2,
          title: `${rising ? 'Moonrise' : 'Moonset'} behind the TV tower\u2019s antenna`,
          detail: `${formatClock(mid.t)} \u00b7 ${formatClock(w.start)}\u2013${formatClock(w.end)} \u00b7 ${distanceText(stand.out)} ${compassPoint(bearing)} of the tower${distanceText(stand.range[0]) === distanceText(stand.range[1]) ? '' : ` (anywhere ${distanceText(stand.range[0])}\u2013${distanceText(stand.range[1])} on that line)`} \u00b7 ${litPercent(mid.t)}% lit`,
          openAt: mid.t,
          at: [stand.spot.lat, stand.spot.lon],
          look: [mid.az, Math.max(0, mid.alt)],
          lens: 400,
          standBearingDeg: bearing,
          standDistanceM: stand.out,
          // Where along the line the moon is behind the antenna at `openAt`, metres from the tower.
          standRange: stand.range,
          // Other spots on the same line at the same minute (lat, lon), for the planner to try
          // if this one turns out blocked.
          standOthers: stand.others.map((c) => [c.spot.lat, c.spot.lon]),
        });
      }
    }
  }
  // The sun or moon behind the Viktoria and the quadriga: rows of the tower's kind with their
  // own landmark, so every list, card and link takes them as it takes the tower's.
  if (landmarks) rows.push(...landmarkRows(passes, { sun, moon, treesAt }));
  if (streets) {
    const seen = new Set();
    // The longest views are the ones worth a trip; the rest still show on the map and slider.
    // Equal lengths (a street's two directions) go by time, so the twelve kept are the same
    // whatever order the moments come in: `/plan/` hands them over by time, `/map` by body.
    for (const m of [...moments].filter(shown).sort((a, b) => b.view.lengthM - a.view.lengthM || a.peak - b.peak || a.body.localeCompare(b.body))) {
      const key = `${m.view.name}${m.body}`;
      if (seen.has(key) || seen.size >= 12) continue;
      seen.add(key);
      rows.push({
        t: m.peak,
        until: m.to,
        body: m.body,
        kind: 'street',
        short: m.view.name,
        brief: `${BODY_NAME[m.body]} down ${m.view.name}`,
        compact: `${BODY_NAME[m.body]} \u00b7 ${m.view.name}`,
        distanceM: m.view.lengthM,
        score: Math.min(1.6, m.view.lengthM / 800),
        title: `${BODY_NAME[m.body]} down ${m.view.name}`,
        detail: `${formatClock(m.peak)} \u00b7 street henge: the ${BODY_NAME[m.body].toLowerCase()} down the street \u00b7 ${distanceText(m.view.lengthM)} long \u00b7 ${Math.round(m.bodyAlt)}\u00b0 up`,
        openAt: m.peak,
        at: m.view.from ? [m.view.from.lat, m.view.from.lon] : null,
        look: [m.view.bearingDeg, clamp(m.bodyAlt * 0.9, 0, 12)],
        lens: 85,
        moment: m,
      });
    }
  }
  const listed = rows.filter((row) => {
    // A moon the sky of its minute does not show is not a shot (spectacle.js `moonShows`).
    if (row.body === 'moon' && !moonShows(row.t)) return false;
    // A street whose near end lies outside the 9 km of the model opens onto nothing: its
    // houses are not there to be seen or checked.
    if (row.kind === 'street' && row.at && !inModel(row.at[0], row.at[1])) return false;
    return true;
  });
  for (const row of listed) {
    // The moon by day counts for less, whatever it is behind or down (spectacle.js).
    row.score *= paleMoon(row.body, row.t);
    // Trees: unchecked everywhere; where the register shows crowns in the frame, said and scored.
    // (Not for a street: its own trees line it, and whether they close the gap at its far end
    // is not what a ray from its near end measures. A street says "trees unchecked".)
    if (row.kind !== 'street' && row.at && treesAt?.(row.at[0], row.at[1])) {
      row.caution = TREES_IN_WAY;
      row.trees = true;
      row.detail = `${row.detail} \u00b7 ${TREES_IN_WAY_NOTE}`;
      row.score *= TREES_IN_WAY_SCORE;
    } else if (!row.caution) row.caution = TREES_UNCHECKED;
  }
  listed.sort((a, b) => a.t - b.t);
  return listed;
}

/** The model reaches 9 km from the tower each way (scripts/miniature/build_city.mjs). */
const MODEL_HALF_M = 9000;
function inModel(lat, lon) {
  const north = rad(lat - FERNSEHTURM.lat) * 6_371_000;
  const east = rad(lon - FERNSEHTURM.lon) * 6_371_000 * Math.cos(rad(FERNSEHTURM.lat));
  return Math.abs(north) <= MODEL_HALF_M && Math.abs(east) <= MODEL_HALF_M;
}

/**
 * A day's rows without those that only continue a pass from the evening before. Rows are
 * collected a day at a time, so a moon that is low across midnight is one row late in the
 * evening and a second at 00:00 the next day: side by side in a list of days that reads as two
 * shots. A row that starts at its day's very start is dropped when the day before has the same shot
 * (place, body, kind) still running at midnight (`until`). For lists of several days only: a
 * day looked at alone keeps its 00:00 row, which is all it has of that pass.
 */
export function withoutContinued(rows, from, dayBefore = []) {
  return rows.filter((row) => (row.start ?? row.t) !== from || !dayBefore.some((b) => b.kind === row.kind && b.body === row.body && b.short === row.short && (b.until ?? b.t) >= from - 60_000));
}

/**
 * A shot's name in a link (`?shot=`): which kind and body, and for a street its name.
 * "sphere-sun", "sphere-moon", "antenna-moon", "viktoria-sun", "quadriga-moon",
 * "street-sun:Sonnenallee".
 */
export const shotKey = (row) => (row.kind === 'street' ? `street-${row.body}:${row.short}` : `${row.where ?? 'sphere'}-${row.body}`);

/**
 * The row a link's `shot` names among a day's rows, or null: the one of that kind, body and
 * street whose minute is nearest the linked instant `t`, within three hours (a tower shot can
 * come twice a day; the link's time says which).
 */
export function findShot(rows, key, t) {
  let best = null;
  for (const row of rows) {
    if (shotKey(row) !== key) continue;
    const off = Math.min(Math.abs(row.t - t), Math.abs((row.openAt ?? row.t) - t));
    if (off <= 3 * 3_600_000 && (!best || off < best.off)) best = { row, off };
  }
  return best ? best.row : null;
}

/** How far one may walk from where a shot's card was put up, and how long before or after it, and it is still that shot. */
export const SHOT_HELD_M = 40;
export const SHOT_HELD_MS = 10 * 60_000;
/**
 * Whether the card on the eye-level ticket still names what is on screen: `row` is the shot,
 * `stoodAt` where one stood when its card went up and `here` where one stands now (scene
 * metres, { x, z }), `t` the clock. Walk further than 40 m or move the clock more than ten
 * minutes outside the shot's stretch, and it is another view: the ticket, the address and the
 * calendar entry must stop calling it that shot.
 */
export function shotStillHeld(row, stoodAt, here, t) {
  if (Math.hypot(here.x - stoodAt.x, here.z - stoodAt.z) > SHOT_HELD_M) return false;
  const start = row.kind === 'street' ? (row.moment?.from ?? row.t) : (row.start ?? row.t);
  const end = row.until ?? row.t;
  return t >= Math.min(start, row.t) - SHOT_HELD_MS && t <= Math.max(end, row.t) + SHOT_HELD_MS;
}

/**
 * What the eye-level status line says of a street shot at the instant `t`: the body down the
 * street now, in so many minutes, or so many minutes ago. `row` is a street row; the result is
 * the words, the line's state ('now' or 'soon') and the instant a tap on it goes to (the
 * peak), or null for a row that is not a street's. The line under a street shot spoke only
 * of the tower ("Nothing lines up with the tower from here") while the sun stood in the street.
 */
export function streetStatus(row, t) {
  const m = row?.kind === 'street' ? row.moment : null;
  if (!m) return null;
  const what = `${BODY_NAME[m.body]} down ${m.view.name}`;
  if (t >= m.from - 30_000 && t <= m.to + 30_000) return { text: `${what} now`, state: 'now', body: m.body, jumpTo: null };
  const minutes = Math.max(1, Math.round(Math.abs((t < m.from ? m.from : m.to) - t) / 60_000));
  const span = minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
  return {
    text: t < m.from ? `${what} in ${span} (${formatClock(m.peak)})` : `${BODY_NAME[m.body]} was down ${m.view.name} ${span} ago (${formatClock(m.peak)})`,
    state: 'soon',
    body: m.body,
    jumpTo: m.peak,
  };
}

/**
 * The street henges of the day that starts at `from`, sun and moon, by time. A henge that runs
 * across midnight is one moment: it is looked for from two hours before the day to two after,
 * whole, and belongs to the day its peak falls in. Cut at midnight it was a row at 23:59 on
 * one day and the same street again at 00:00 on the next (12 and 13 February 2027).
 */
export function streetMomentsOfDay(views, from) {
  const to = dayEndOf(from);
  const pad = 2 * 3_600_000;
  return ['sun', 'moon']
    .flatMap((body) => streetMoments(views, body, from - pad, to + pad, FERNSEHTURM.lat, FERNSEHTURM.lon))
    .filter((m) => m.peak >= from && m.peak < to)
    .sort((a, b) => a.peak - b.peak);
}

/**
 * Every shot of the day that starts at `from`, from the city data alone: `shed` is the tower's
 * viewshed (src/lib/viewshed.ts), `views` the street views (src/lib/streets.ts), `sheds` the
 * other landmarks' viewsheds by id (`siegessaeule`, `brandenburger-tor`). Without a viewshed
 * nothing says where a landmark can be seen from, so no rows are given for it: an unchecked
 * standing point is not offered as a shot.
 */
export function dayShots(from, { shed = null, views = [], sheds = {}, treesAt = treesSeenFrom(shed) } = {}) {
  const moments = streetMomentsOfDay(views, from);
  return collectRows(shed ? computeDayPaths(from, shed) : [], moments, from, { seesTower: towerSeenFrom(shed), treesAt }, computeLandmarkPasses(from, sheds));
}
