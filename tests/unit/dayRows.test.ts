/**
 * The day's rows, as the release gate of 2026-11 asked of them (round 5): the compass word, a
 * row's own spot and stretch, its sentence against what stands there, trees, the thin moon by
 * day, streets outside the model, and the one rule for "next".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleBody } from '../../src/lib/bodyPosition';
import { applyView, compassPoint, type DayPath } from '../../src/lib/dailyPaths';
import { FERNSEHTURM } from '../../src/lib/landmarks';
import { decodeStreets } from '../../src/lib/streets';
import { decodeViewshed, treeTest } from '../../src/lib/viewshed';
import { nextWorth } from '../../src/home/grid.js';
import { berlinDayStart } from '../../src/miniature/berlinClock.js';
import { collectRows, dayShots } from '../../src/miniature/dayShots.js';
import { sceneFromLatLon } from '../../src/miniature/eye.js';
import { rowSeen } from '../../src/miniature/rowCheck.js';
import { dayPicks, moonShows, pickTop, TREES_IN_WAY, TREES_IN_WAY_NOTE, TREES_UNCHECKED } from '../../src/miniature/spectacle.js';
import { bodyAgainstTower, discOverSphere, towerSentence } from '../../src/miniature/towerShots.js';

type Row = Record<string, any>;
const load = (id: string) => {
  const header = JSON.parse(readFileSync(`public/viewshed/${id}.json`, 'utf8'));
  return decodeViewshed(header, new Uint8Array(readFileSync(`public/viewshed/${header.binary}`)));
};
const shed = load('fernsehturm');
const sheds = { siegessaeule: load('siegessaeule'), 'brandenburger-tor': load('brandenburger-tor') };
const views = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')));
const day = (date: string, extra: Row = {}): Row[] => dayShots(berlinDayStart(date), { shed, views, sheds, ...extra });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const RAD = Math.PI / 180;
/** Where a place lies from the tower, worked out here: metres and degrees from north. */
const fromTower = (lat: number, lon: number) => {
  const north = (lat - FERNSEHTURM.lat) * RAD * 6_371_000;
  const east = (lon - FERNSEHTURM.lon) * RAD * 6_371_000 * Math.cos(FERNSEHTURM.lat * RAD);
  return { distance: Math.hypot(north, east), bearing: (Math.atan2(east, north) / RAD + 360) % 360 };
};

/** The word for a bearing, and for one a degree and a half either side: the row measures on the ellipsoid, this file on a sphere. */
const wordsNear = (bearing: number) => [compassPoint(bearing - 1.5), compassPoint(bearing), compassPoint(bearing + 1.5)];

describe('the compass word', () => {
  const WORDS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  it('names every 22.5° sector by its middle and holds to its edges', () => {
    WORDS.forEach((word, i) => {
      const middle = i * 22.5;
      expect(compassPoint(middle)).toBe(word);
      expect(compassPoint(middle - 11)).toBe(word);
      expect(compassPoint(middle + 11)).toBe(word);
      expect(compassPoint(middle + 360)).toBe(word);
      expect(compassPoint(middle - 360)).toBe(word);
    });
  });

  it('is N either side of north: 349°, 359.9°, 0°, 0.1°, 11°', () => {
    for (const bearing of [349, 355, 359.9, 360, 0, 0.1, 5, 11, -1, 719.5]) expect(compassPoint(bearing), String(bearing)).toBe('N');
    expect(compassPoint(348)).toBe('NNW');
    expect(compassPoint(12)).toBe('NNE');
    expect(compassPoint(180)).toBe('S');
  });

  it('a path point between 359° and 1° lies north, not south', () => {
    // applyView draws points between the path's solutions: across north the bearing must go
    // the short way round. A plain mix of 359 and 1 is 180.
    const point = (t: number, bearingDeg: number, lon: number) => ({ t, lat: 52.524, lon, distanceM: 352, bearingDeg, bodyAlt: 31, kind: 'full' as const, coveredFraction: 1 });
    const path: DayPath = { body: 'sun', illumination: 1, segments: [[point(0, 359, 13.4093), point(180_000, 1, 13.4095)]] };
    const dense = applyView(path, () => true).segments[0];
    expect(dense.length).toBeGreaterThan(8);
    for (const p of dense) {
      const off = Math.abs(((p.bearingDeg + 540) % 360) - 180);
      expect(off, `${p.t}: ${p.bearingDeg}`).toBeLessThanOrEqual(1.0001);
      expect(compassPoint(p.bearingDeg)).toBe('N');
    }
    // Away from north nothing changes: half way between 80 and 100 is 90.
    const east: DayPath = { body: 'sun', illumination: 1, segments: [[point(0, 80, 13.41), point(180_000, 100, 13.41)]] };
    expect(applyView(east, () => true).segments[0][6].bearingDeg).toBeCloseTo(90, 6);
  });

  it('4 March 2027, 12:15: the row north of the tower says N, as the place itself does', () => {
    for (const date of ['2027-03-03', '2027-03-04', '2027-03-07', '2027-10-22', '2027-10-25']) {
      for (const row of day(date).filter((r) => r.kind === 'tower' && !r.target)) {
        const where = fromTower(row.at[0], row.at[1]);
        const word = row.stand.split(' ').pop();
        expect(wordsNear(where.bearing), `${date} ${row.detail}`).toContain(word);
        expect(row.detail).toContain(`${word} of the tower`);
      }
    }
  });
});

describe('a tower row is one pass from one spot', () => {
  // A year of rows, every day: the sentence is what stands there, the words are the spot's.
  const year: Array<{ date: string; row: Row }> = [];
  for (let i = 0; i < 365; i++) {
    const date = addDays('2026-11-24', i);
    for (const row of dayShots(berlinDayStart(date), { shed, sheds })) if (row.kind === 'tower' && !row.target) year.push({ date, row });
  }
  const eyeOf = (row: Row) => {
    const [x, z] = sceneFromLatLon(row.at[0], row.at[1], FERNSEHTURM.lat, FERNSEHTURM.lon);
    return { x, y: 1.6, z };
  };

  it('over a year, the title’s state is the status line’s state at the row’s instant', () => {
    expect(year.length).toBeGreaterThan(3000);
    for (const { date, row } of year) {
      const seen = rowSeen(row, eyeOf(row), 0);
      expect(seen.ok, `${date} ${row.title} | ${row.detail}: ${seen.sees}`).toBe(true);
      const state = bodyAgainstTower(eyeOf(row), 0, sampleBody(row.body, new Date(row.openAt), FERNSEHTURM.lat, FERNSEHTURM.lon)).state;
      expect(row.state, `${date} ${row.detail}`).toBe(state);
      if (row.where === 'sphere') expect(row.title).toBe(towerSentence(row.body, state, discOverSphere(row.distanceM)));
      else expect(state).toBe('antenna');
      // On the sphere's middle, never just at its edge: the spot is worked out for the instant.
      expect(state).not.toBe('edge');
    }
  });

  it('the words give the spot the row opens at: its distance and its side', () => {
    for (const { date, row } of year) {
      const where = fromTower(row.at[0], row.at[1]);
      const text = where.distance < 1000 ? `${Math.round(where.distance / 10) * 10} m` : `${(where.distance / 1000).toFixed(1)} km`;
      // To the rounding of the words (the row measures on the ellipsoid, this on a sphere).
      const said = row.stand.replace(/ [A-Z]+$/, '');
      const metres = said.endsWith('km') ? Number(said.slice(0, -3)) * 1000 : Number(said.slice(0, -2));
      expect(Math.abs(metres - where.distance), `${date} ${row.stand} for ${text}`).toBeLessThan(said.endsWith('km') ? 110 : 25);
      expect(wordsNear(where.bearing), `${date} ${row.stand}`).toContain(row.stand.split(' ').pop());
      expect(row.stand).not.toContain('+');
      expect(row.distanceM).toBeCloseTo(where.distance, -2);
    }
    // The antenna's rows open kilometres out and say so (268 of 338 said "1.6 km+").
    const antenna = year.filter(({ row }) => row.where === 'antenna');
    expect(antenna.filter(({ row }) => /^1\.[67] km/.test(row.stand)).length).toBeLessThan(antenna.length / 10);
  });

  it('a row’s stretch is the minutes from its spot, not hours of other spots', () => {
    for (const { date, row } of year.filter(({ row }) => row.where === 'sphere')) {
      expect(row.detail, date).not.toContain('with breaks');
      expect(row.until - row.start, `${date} ${row.detail}`).toBeLessThan(40 * 60_000);
      expect(row.start).toBeLessThanOrEqual(row.t);
      expect(row.until).toBeGreaterThanOrEqual(row.t);
    }
  });
});

describe('the moon the sky does not show is not a shot', () => {
  it('by day it takes more of the moon than by night', () => {
    // 10 June 2027, 12:13: a 39% moon at noon. 16 December 2026, 23:20: a 47% moon at night.
    expect(moonShows(Date.UTC(2027, 5, 10, 10, 13))).toBe(false);
    expect(moonShows(Date.UTC(2026, 11, 16, 22, 20))).toBe(true);
    // A full moon by day still shows.
    expect(moonShows(Date.UTC(2026, 10, 25, 7, 54))).toBe(true);
  });

  it('10 June 2027 lists no moon behind the quadriga at noon; no row of a year shows a moon the rule hides', () => {
    expect(day('2027-06-10').some((row) => row.target === 'brandenburger-tor' && row.body === 'moon')).toBe(false);
    for (let i = 0; i < 365; i += 9) for (const row of day(addDays('2026-11-24', i))) if (row.body === 'moon') expect(moonShows(row.t)).toBe(true);
  }, 120_000);
});

describe('trees', () => {
  it('every tower, landmark and street row says trees are unchecked, or the stronger thing', () => {
    for (const row of day('2027-03-17')) expect([TREES_UNCHECKED, TREES_IN_WAY]).toContain(row.caution);
  });

  it('a spot the tree register closes is avoided within the pass, or said and scored down', () => {
    const plain = day('2027-03-17');
    const sphere = plain.filter((row) => row.where === 'sphere').sort((a, b) => b.alternates.length - a.alternates.length)[0];
    expect(sphere.alternates.length).toBeGreaterThan(0);
    // Trees at the row's own spot only: the row moves to another minute of the same pass.
    const moved = day('2027-03-17', { treesAt: treeTest([sphere.at]) });
    const same = moved.find((row) => row.where === 'sphere' && Math.abs(row.t - sphere.t) < 15 * 60_000)!;
    expect(same.at).not.toEqual(sphere.at);
    expect(same.caution).toBe(TREES_UNCHECKED);
    expect(same.score).toBeCloseTo(sphere.score, 6);
    // Trees everywhere: the row stays, says so wherever it is shown, and counts half.
    const all = day('2027-03-17', { treesAt: () => true });
    const said = all.find((row) => row.where === 'sphere' && Math.abs(row.t - sphere.t) < 15 * 60_000)!;
    expect(said.caution).toBe(TREES_IN_WAY);
    expect(said.trees).toBe(true);
    expect(said.detail.endsWith(TREES_IN_WAY_NOTE)).toBe(true);
    expect(said.score).toBeCloseTo(sphere.score / 2, 6);
    // A street keeps "trees unchecked": its own trees line it.
    for (const row of all.filter((r) => r.kind === 'street')) expect(row.caution).toBe(TREES_UNCHECKED);
    // And such a row does not make the day's three.
    const top = pickTop(all, 3);
    expect(top.some((row: Row) => row.trees && row.kind === 'tower')).toBe(false);
  });

  it('treeTest: a listed place, to a metre, and nothing round it', () => {
    const test = treeTest([[52.515, 13.38]]);
    expect(test(52.515, 13.38)).toBe(true);
    expect(test(52.515003, 13.380004)).toBe(true); // a third of a metre off: the same spot
    expect(test(52.51508, 13.38005)).toBe(false); // about 10 m off: another spot, measured for itself
    expect(test(52.5154, 13.38)).toBe(false);
    expect(treeTest([])(52.515, 13.38)).toBe(false);
  });

  it('the list of places is a list of places in the model', () => {
    const header = JSON.parse(readFileSync('public/viewshed/fernsehturm.json', 'utf8'));
    expect(header.treeSpots).toBe('trees-in-the-way.json');
    const list = JSON.parse(readFileSync(`public/viewshed/${header.treeSpots}`, 'utf8'));
    for (const [lat, lon] of list.spots) expect(fromTower(lat, lon).distance).toBeLessThan(13_000);
  });
});

describe('streets outside the model are not listed', () => {
  it('no street row starts more than 9 km east, west, north or south of the tower', () => {
    let rows = 0;
    for (let i = 0; i < 365; i += 7) {
      for (const row of day(addDays('2026-11-24', i)).filter((r) => r.kind === 'street')) {
        rows++;
        const north = (row.at[0] - FERNSEHTURM.lat) * RAD * 6_371_000;
        const east = (row.at[1] - FERNSEHTURM.lon) * RAD * 6_371_000 * Math.cos(FERNSEHTURM.lat * RAD);
        expect(Math.max(Math.abs(north), Math.abs(east)), row.title).toBeLessThanOrEqual(9000);
      }
    }
    expect(rows).toBeGreaterThan(300);
    // 27 December 2026 had one 12.5 km out.
    expect(views.some((view: Row) => fromTower(view.from.lat, view.from.lon).distance > 12_000)).toBe(true);
  }, 120_000);
});

describe('one rule for "next"', () => {
  const t0 = Date.UTC(2026, 11, 19, 23, 30);
  const row = (title: string, minutes: number, score: number, extra: Row = {}) => ({ kind: 'tower', where: 'sphere', body: 'moon', t: t0 + minutes * 60_000, score, title, ...extra });

  it('the next shot is the earliest of the few a day shows, at home as in the planner', () => {
    // 20 December 2026, 00:30: home said 3:05, the planner's line 3:15, its list's top row 3:26.
    const rows = [row('antenna 3:15', 225, 2, { where: 'antenna' }), row('big moon 3:26', 236, 2.4), row('ring of sun', 546, 1.8, { body: 'sun' }), row('a small one at 3:05', 215, 0.9)];
    const picks = dayPicks(rows.map((r) => ({ row: r, grade: null })));
    // In time order: the list's first row is the next shot.
    expect(picks.map((r: Row) => r.title)).toEqual(['antenna 3:15', 'big moon 3:26', 'ring of sun']);
    const group = { i: 0, worth: rows.map((r) => ({ shot: r, verdict: null })) };
    const next = nextWorth([group]);
    expect(next.shot.title).toBe('antenna 3:15');
    expect(next.shot).toBe(rows[0]);
    expect(next.day).toBe(group);
    expect(nextWorth([{ i: 0, worth: [] }])).toBeNull();
  });

  it('a forecast weighs the choice, and a henge that stands for others brings them along', () => {
    const street = (title: string, minutes: number, bearingDeg: number) => ({ kind: 'street', body: 'sun', t: t0 + minutes * 60_000, score: 1.6, title, moment: { view: { bearingDeg } } });
    const rows = [street('A', 600, 120), street('B', 603, 121), street('C', 606, 119), row('tower', 700, 1.2, { body: 'sun' })];
    const picks = dayPicks(rows.map((r) => ({ row: r, grade: 'good' })));
    expect(picks.map((r: Row) => r.title)).toEqual(['A', 'tower']);
    expect(picks[0].more).toBe(2);
    expect(picks[0].others.map((r: Row) => r.title)).toEqual(['B', 'C']);
    expect(picks[0].source).toBe(rows[0]);
    // A Skip-weight forecast on the henges lets the tower shot lead by value, though not by the clock.
    const graded = dayPicks(rows.map((r) => ({ row: r, grade: r.kind === 'street' ? 'poor' : 'good' })), 1);
    expect(graded[0].title).toBe('tower');
  });
});

describe('collectRows without the checks is as before', () => {
  it('no viewshed, no trees: rows still come, each saying trees are unchecked', () => {
    const rows: Row[] = collectRows([], [], berlinDayStart('2027-03-17'));
    for (const row of rows) expect(row.caution).toBe(TREES_UNCHECKED);
  });
});
