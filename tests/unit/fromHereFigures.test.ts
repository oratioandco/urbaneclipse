/**
 * From here and the day list must agree about the Viktoria and the quadriga: the year's search
 * from a spot (targets.js through findShots) against the day list's stand points
 * (landmarkStands.ts). The band check below is worked out here, from heights and distance
 * alone, not with the code under test.
 */
import { describe, expect, it } from 'vitest';
import { sampleBody } from '../../src/lib/bodyPosition';
import { FERNSEHTURM } from '../../src/lib/landmarks';
import { DISC_DEG, EYE_HEIGHT_M, FIGURE_TARGETS, MIN_ALTITUDE_DEG, figurePasses, minDistanceM } from '../../src/lib/landmarkStands';
// @ts-expect-error plain JS module
import { sceneFromLatLon } from '../../src/miniature/eye.js';
// @ts-expect-error plain JS module
import { asShot } from '../../src/miniature/fromHere.js';
// @ts-expect-error plain JS module
import { landmarkRows } from '../../src/miniature/landmarkShots.js';
// @ts-expect-error plain JS module
import { TARGETS } from '../../src/miniature/targets.js';
// @ts-expect-error plain JS module
import { findShots, gridConvergenceDeg } from '../../src/miniature/towerShots.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 25);
/** The scene's zero in DHHN2016 metres (landmarkShots.js). */
const SCENE_ZERO_M = 34.6;
const deg = (r: number) => (r * 180) / Math.PI;

type Body = 'sun' | 'moon';
interface Shot { target: string; body: Body; start: number; end: number; peak: number; state: string; alt: number }

/** The year's search from a spot on the ground, as dates.js asks for it. */
function searchFrom(lat: number, lon: number, groundM: number, id: string, start: number, end: number): Shot[] {
  const [x, z] = sceneFromLatLon(lat, lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
  return findShots({
    eye: { x, y: groundM - SCENE_ZERO_M + EYE_HEIGHT_M, z },
    base: 0,
    start,
    end,
    targets: TARGETS.filter((t: { id: string }) => t.id === id),
    bodyAt: (body: Body, t: number) => sampleBody(body, new Date(t), lat, lon),
    moonLit: () => 1,
    northOffsetDeg: gridConvergenceDeg(lat, lon, FERNSEHTURM.lon),
  });
}

/** The first pass of a body behind a figure after START that lasts a few minutes: a day-list shot. */
function dayPass(target: (typeof FIGURE_TARGETS)[number], body: Body) {
  for (let day = 0; day < 370; day += 10) {
    const pass = figurePasses(target, body, START + day * DAY, START + (day + 10) * DAY).find((p) => p.points.length >= 3);
    if (pass) return pass;
  }
  throw new Error(`no ${body} pass behind ${target.id} in a year`);
}

describe('from here against the day list: the Viktoria and the quadriga', () => {
  for (const target of FIGURE_TARGETS) {
    for (const body of ['sun', 'moon'] as const) {
      it(`${target.id}, ${body}: finds the day list’s shot from its stand point, at its minute`, () => {
        const pass = dayPass(target, body);
        const { best } = pass;
        const found = searchFrom(best.lat, best.lon, best.groundM, target.id, best.t - 6 * 3_600_000, best.t + 6 * 3_600_000).filter((s) => s.body === body);
        const same = found.find((s) => best.t >= s.start - MINUTE && best.t <= s.end + MINUTE);
        expect(same, `${new Date(best.t).toISOString()} from ${best.distanceM.toFixed(0)} m; found ${found.map((s) => new Date(s.peak).toISOString())}`).toBeTruthy();
        expect(same!.state).toBe('figure');
        // And says it in the day row's words, under the same name in a link.
        const row = landmarkRows([pass])[0];
        const shot = asShot({ t: same!.peak, body, kind: 'tower', target: target.id, state: same!.state, distanceM: best.distanceM, fromDeg: best.bearingDeg, at: [best.lat, best.lon], look: [0, 0], detail: 'x' });
        expect(shot.title).toBe(row.title);
        expect([shot.where, shot.landmark, shot.short, shot.caution, shot.stand, shot.lens]).toEqual([row.where, row.landmark, row.short, row.caution, row.stand, row.lens]);
        expect(shot.at).toEqual([best.lat, best.lon]);
      });
    }

    it(`${target.id}: lists no date on which the disc misses the figure’s height, or the body is under ${MIN_ALTITUDE_DEG}°`, () => {
      // A stand point of the day list, and the same line 300 m further out: two real spots.
      const { best } = dayPass(target, 'moon');
      const corridor = best.corridor;
      const spots = [best.distanceM, Math.min(corridor.toM, best.distanceM + 300)].map((distanceM) => {
        const out = distanceM / best.distanceM;
        return { lat: target.landmark.lat + (best.lat - target.landmark.lat) * out, lon: target.landmark.lon + (best.lon - target.landmark.lon) * out, groundM: best.groundM, distanceM };
      });
      let listed = 0;
      for (const spot of spots) {
        const band = (h: number) => deg(Math.atan2(target.landmark.baseOrthometric + h - spot.groundM - EYE_HEIGHT_M, spot.distanceM));
        const [low, high] = [band(target.fromAgl), band(target.toAgl)];
        for (const shot of searchFrom(spot.lat, spot.lon, spot.groundM, target.id, START, START + 120 * DAY)) {
          listed++;
          const at = sampleBody(shot.body, new Date(shot.peak), spot.lat, spot.lon);
          const when = `${shot.body} ${new Date(shot.peak).toISOString()} at ${at.alt.toFixed(2)}°, figure ${low.toFixed(2)}–${high.toFixed(2)}° from ${spot.distanceM.toFixed(0)} m`;
          expect(at.alt, when).toBeGreaterThanOrEqual(MIN_ALTITUDE_DEG);
          // The disc reaches into the figure's band (0.05° for the earth's curve and the grid).
          expect(at.alt + DISC_DEG / 2, when).toBeGreaterThan(low - 0.05);
          expect(at.alt - DISC_DEG / 2, when).toBeLessThan(high + 0.05);
        }
      }
      expect(listed).toBeGreaterThan(0);
    });

    it(`${target.id}: offers nothing from closer than the disc counts`, () => {
      const corridor = target.corridors[0]!;
      const near = minDistanceM(target) * 0.5;
      const east = corridor.side === 'east' ? 1 : -1;
      const lon = target.landmark.lon + (east * near) / 111_320 / Math.cos((target.landmark.lat * Math.PI) / 180);
      expect(searchFrom(target.landmark.lat, lon, 34, target.id, START, START + 60 * DAY)).toEqual([]);
      const entry = TARGETS.find((t: { id: string }) => t.id === target.id);
      expect(entry.none(near)).toMatch(/^Too close/);
      expect(entry.none(minDistanceM(target) + 50)).toMatch(/^Neither/);
    });
  }
});
