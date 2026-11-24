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
import { litPercent, paleMoon } from './spectacle.js';
import { alignmentMinute, bodyAgainstTower, discOverSphere, EYE_HEIGHT, SPHERE_TOP_AGL, TIP_AGL, towerSentence, visibleMoon } from './towerShots.js';

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
  const { tower = true, streets = true, sun = true, moon = true, landmarks = true, seesTower = null } = flags;
  const shown = (item) => (item.body === 'moon' ? moon : sun);
  const rows = [];
  if (tower) {
    for (const path of paths.filter(shown)) {
      // Stretches with a clear view of the tower, joined across short gaps (a building in
      // the way for a few minutes), and kept only when long enough to get to.
      const windows = [];
      for (const segment of path.segments) {
        for (const p of segment) {
          if (p.clear === false) continue;
          const last = windows[windows.length - 1];
          if (last && p.t - last.points[last.points.length - 1].t <= 12 * 60_000) {
            if (p.t - last.points[last.points.length - 1].t > 4 * 60_000) last.broken = true;
            last.points.push(p);
          } else windows.push({ points: [p], broken: false });
        }
      }
      for (const w of windows) {
        const first = w.points[0];
        const lastPoint = w.points[w.points.length - 1];
        if (lastPoint.t - first.t < 4 * 60_000) continue;
        const mid = w.points[Math.floor(w.points.length / 2)];
        // The geometric alignment minute for this standpoint: when the body's azimuth crosses the
        // bearing from here to the tower, not the window's start and not a middle sample.
        // To the whole second, which is as fine as it is found: at 19:07:59.5 the card cut it to
        // 7:07 while the clock, which rounds to the second, read 7:08 (28 March 2027).
        const align = Math.round((alignmentMinute(bodyAt, path.body, (mid.bearingDeg + 180) % 360, first.t, lastPoint.t) ?? mid.t) / 1000) * 1000;
        const over = discOverSphere(mid.distanceM);
        const sky = bodyAt(path.body, align);
        // What the pass is from that spot at that instant, by the rule the eye-level line and
        // "From here" use (bodyAgainstTower): behind the sphere, a ring round it, or only at its
        // edge. One sentence for it everywhere (towerSentence). The ground there is not known
        // here and is taken level with the tower's foot.
        const rad0 = rad(mid.bearingDeg);
        const seen = bodyAgainstTower({ x: Math.sin(rad0) * mid.distanceM, y: EYE_HEIGHT, z: -Math.cos(rad0) * mid.distanceM }, 0, sky).state;
        const state = ['hidden', 'ring', 'edge'].includes(seen) && !(path.body === 'moon' && seen === 'hidden') ? seen : path.body === 'moon' || over > 1 ? 'ring' : 'hidden';
        rows.push({
          t: align,
          body: path.body,
          kind: 'tower',
          landmark: 'fernsehturm',
          short: 'TV tower',
          where: 'sphere',
          stand: `${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)}`,
          brief: state === 'edge' ? `${BODY_NAME[path.body]} at TV tower\u2019s edge` : path.body === 'moon' ? 'Moon behind TV tower' : state === 'ring' ? 'Sun ring at TV tower' : 'Sun behind TV tower',
          distanceM: mid.distanceM,
          // The closer the tower, the larger the body behind it: the spectacle, scored.
          // A pass that only touches the sphere's edge counts as From here counts it: 1.3 and 1.
          score: state === 'edge' ? (path.body === 'moon' ? 1.3 : 1) : path.body === 'moon' ? Math.min(2.4, 1.5 * over) : state === 'ring' ? 1.8 : 1.2,
          title: towerSentence(path.body, state, over),
          // Every row's small print starts with its own minute; a stretch follows it.
          detail: `${formatClock(align)} \u00b7 ${formatClock(first.t)}\u2013${formatClock(lastPoint.t)}${w.broken ? ' (with breaks)' : ''} \u00b7 ${distanceText(mid.distanceM)} ${compassPoint(mid.bearingDeg)} of the tower \u00b7 ${Math.round(mid.bodyAlt)}\u00b0 up`,
          openAt: align,
          at: [mid.lat, mid.lon],
          look: [sky.az, Math.max(0, sky.alt)],
          lens: 200,
          // Other minutes of the same pass, each with the spot the disc is behind the sphere
          // from at that minute: for the planner to try, nearest in time first, when its
          // full-detail check finds the row's own spot blocked (pointer.js).
          alternates: w.points
            .filter((p, i) => i % 4 === 0 && Math.abs(p.t - mid.t) >= 45_000)
            .sort((a, b) => Math.abs(a.t - mid.t) - Math.abs(b.t - mid.t))
            .slice(0, 10)
            .map((p) => ({ t: p.t, at: [p.lat, p.lon] })),
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
          const steps = Math.floor((to - from) / 2 / 40);
          for (let k = 0; k <= steps; k++) {
            for (const d of k ? [(from + to) / 2 - k * 40, (from + to) / 2 + k * 40] : [(from + to) / 2]) {
              if (!onMast(d)) continue;
              const spot = place(d);
              if (!seesTower || seesTower(spot.lat, spot.lon)) spots.push({ d, spot });
            }
          }
          if (!spots.length) continue;
          // The first is where the row stands. The others, well apart, are for the planner to
          // try when its full-detail check finds that one blocked (pointer.js): the viewshed
          // knows buildings on a 5 m grid, the scene knows more.
          const others = [];
          for (const c of spots.slice(1)) {
            if (others.length < 11 && [spots[0], ...others].every((o) => Math.abs(o.d - c.d) >= 120)) others.push(c);
          }
          const ds = spots.map((c) => c.d);
          stand = { sample, bearing, range: [Math.min(...ds), Math.max(...ds)], out: spots[0].d, spot: spots[0].spot, others };
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
          stand: `${distanceText(near)}+ ${compassPoint(bearing)}`,
          brief: `${rising ? 'Moonrise' : 'Moonset'} on TV antenna`,
          distanceM: (near + far) / 2,
          score: 2,
          title: `${rising ? 'Moonrise' : 'Moonset'} behind the TV tower\u2019s antenna`,
          detail: `${formatClock(mid.t)} \u00b7 ${formatClock(w.start)}\u2013${formatClock(w.end)} \u00b7 ${distanceText(near)}\u2013${distanceText(far)} ${compassPoint(bearing)} of the tower \u00b7 ${litPercent(mid.t)}% lit`,
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
  if (landmarks) rows.push(...landmarkRows(passes, { sun, moon }));
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
  // The moon by day counts for less, whatever it is behind or down (spectacle.js).
  for (const row of rows) row.score *= paleMoon(row.body, row.t);
  rows.sort((a, b) => a.t - b.t);
  return rows;
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
export function dayShots(from, { shed = null, views = [], sheds = {} } = {}) {
  const moments = streetMomentsOfDay(views, from);
  return collectRows(shed ? computeDayPaths(from, shed) : [], moments, from, { seesTower: towerSeenFrom(shed) }, computeLandmarkPasses(from, sheds));
}
