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
import { applySceneMask as applySceneMaskFor, decodeViewshed, treeTest } from '../../src/lib/viewshed';
import { nextWorth } from '../../src/home/grid.js';
import { berlinDayStart } from '../../src/miniature/berlinClock.js';
import { collectRows, coveredBy, dayCovered, dayShots } from '../../src/miniature/dayShots.js';
import { sceneFromLatLon } from '../../src/miniature/eye.js';
import { rowSeen } from '../../src/miniature/rowCheck.js';
import { crownShare, inLeaf, leafOn } from '../../src/lib/season';
import { dayPicks, moonShows, pickTop, TREES_BARE, TREES_BARE_NOTE, TREES_IN_WAY, TREES_IN_WAY_NOTE, TREES_UNCHECKED } from '../../src/miniature/spectacle.js';
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
  const SUMMER = Date.parse('2027-07-01T10:00:00Z');
  const WINTER = Date.parse('2027-01-15T10:00:00Z');

  it('one rule for the leaf season: in leaf from mid-April to mid-November, as the scene draws it', () => {
    expect(inLeaf(Date.parse('2027-04-14T12:00:00Z'))).toBe(false);
    expect(inLeaf(Date.parse('2027-04-16T12:00:00Z'))).toBe(true);
    expect(inLeaf(SUMMER)).toBe(true);
    expect(inLeaf(Date.parse('2027-11-14T12:00:00Z'))).toBe(true);
    expect(inLeaf(Date.parse('2027-11-16T12:00:00Z'))).toBe(false);
    expect(inLeaf(WINTER)).toBe(false);
    expect(leafOn(new Date(SUMMER))).toBe(1);
    expect(leafOn(new Date(WINTER))).toBe(0);
    // A bare crown is drawn, and measured, at 18 % of its width.
    expect(crownShare(0)).toBeCloseTo(0.18, 6);
    expect(crownShare(1)).toBe(1);
  });

  it('every tower, landmark and street row says trees are unchecked, or one of the two stronger things', () => {
    for (const row of day('2027-03-17')) expect([TREES_UNCHECKED, TREES_IN_WAY, TREES_BARE]).toContain(row.caution);
  });

  it('a spot the tree register closes is avoided within the pass, or said and scored down', () => {
    const plain = day('2027-06-17', { treesAt: () => 0 });
    const sphere = plain.filter((row) => row.where === 'sphere').sort((a, b) => b.alternates.length - a.alternates.length)[0];
    expect(sphere.alternates.length).toBeGreaterThan(0);
    // Trees at the row's own spot only: the row moves to another minute of the same pass.
    const moved = day('2027-06-17', { treesAt: treeTest([sphere.at]) });
    const same = moved.find((row) => row.where === 'sphere' && Math.abs(row.t - sphere.t) < 15 * 60_000)!;
    expect(same.at).not.toEqual(sphere.at);
    expect(same.caution).toBe(TREES_UNCHECKED);
    expect(same.score).toBeCloseTo(sphere.score, 6);
    // Trees from every spot of the tower's rows: the row stays, says so wherever it is shown, and counts half.
    const all = day('2027-06-17', { treesAt: (_lat: number, _lon: number, _t: number, tag?: string | number) => (tag === undefined ? 2 : 0) });
    const said = all.find((row) => row.where === 'sphere' && Math.abs(row.t - sphere.t) < 15 * 60_000)!;
    expect(said.caution).toBe(TREES_IN_WAY);
    expect(said.trees).toBe(true);
    expect(said.detail.endsWith(TREES_IN_WAY_NOTE)).toBe(true);
    expect(said.score).toBeCloseTo(sphere.score / 2, 6);
    // And such a row does not make the day's three.
    const top = pickTop(all, 3);
    expect(top.some((row: Row) => row.trees && row.kind === 'tower')).toBe(false);
  });

  it('a street is held to the same rule: trees across the sun are said and cost half', () => {
    const plain = day('2027-06-17', { treesAt: () => 0 }).filter((row) => row.kind === 'street');
    expect(plain.length).toBeGreaterThan(3);
    const street = plain[0];
    // Its entry in the list is its place and how high the body stands down it.
    const listed = day('2027-06-17', { treesAt: treeTest([[street.at[0], street.at[1], street.treeTag]]) }).filter((row) => row.kind === 'street');
    const said = listed.find((row) => row.title === street.title && row.t === street.t)!;
    expect(said.caution).toBe(TREES_IN_WAY);
    expect(said.score).toBeCloseTo(street.score / 2, 6);
    for (const row of listed.filter((r) => r !== said && (r.at[0] !== street.at[0] || r.treeTag !== street.treeTag))) expect(row.caution).toBe(TREES_UNCHECKED);
    // The same place with the body elsewhere down it is another entry.
    expect(street.treeTag).toMatch(/^-?\d+(\.5)?:-?\d+(\.\d+)?$/);
    const other = day('2027-06-17', { treesAt: treeTest([[street.at[0], street.at[1], `9${street.treeTag}`]]) }).find((row) => row.title === street.title && row.t === street.t)!;
    expect(other.caution).toBe(TREES_UNCHECKED);
  });

  it('out of leaf the same trees are bare: said, and not scored, unless bare they still cover the shot', () => {
    const plain = day('2027-01-20', { treesAt: () => 0 });
    const sphere = plain.find((row) => row.where === 'sphere')!;
    const bare = day('2027-01-20', { treesAt: () => 1 }).find((row) => row.where === 'sphere' && row.t === sphere.t)!;
    expect(bare.caution).toBe(TREES_BARE);
    expect(bare.bareTrees).toBe(true);
    expect(bare.trees).toBeUndefined();
    expect(bare.detail.endsWith(TREES_BARE_NOTE)).toBe(true);
    expect(bare.score).toBeCloseTo(sphere.score, 6);
    // The list: a place listed in leaf only is level 1 in winter and 2 in summer; one listed bare too is 2 in both.
    const test = treeTest([[52.515, 13.38], [52.52, 13.39]], [[52.52, 13.39]]);
    expect(test(52.515, 13.38, SUMMER)).toBe(2);
    expect(test(52.515, 13.38, WINTER)).toBe(1);
    expect(test(52.52, 13.39, SUMMER)).toBe(2);
    expect(test(52.52, 13.39, WINTER)).toBe(2);
    expect(test(52.53, 13.39, WINTER)).toBe(0);
  });

  it('treeTest: a listed place, to a metre, and nothing round it', () => {
    const test = treeTest([[52.515, 13.38]]);
    expect(test(52.515, 13.38, SUMMER)).toBe(2);
    expect(test(52.515003, 13.380004, SUMMER)).toBe(2); // a third of a metre off: the same spot
    expect(test(52.51508, 13.38005, SUMMER)).toBe(0); // about 10 m off: another spot, measured for itself
    expect(test(52.5154, 13.38, SUMMER)).toBe(0);
    expect(treeTest([])(52.515, 13.38, SUMMER)).toBe(0);
    // A tagged entry answers only for its tag.
    const tagged = treeTest([[52.515, 13.38, 3]]);
    expect(tagged(52.515, 13.38, SUMMER, 3)).toBe(2);
    expect(tagged(52.515, 13.38, SUMMER, 4)).toBe(0);
    expect(tagged(52.515, 13.38, SUMMER)).toBe(0);
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

describe('the days the shots are checked for', () => {
  const covered = { from: '2026-11-24', to: '2027-11-24' };

  it('no row is listed after the last covered day, or before the first', () => {
    expect(day('2027-11-24', { covered }).length).toBeGreaterThan(0);
    for (const date of ['2027-11-25', '2027-12-01', '2028-06-21', '2026-11-23']) expect(day(date, { covered }), date).toHaveLength(0);
    expect(day('2026-11-24', { covered }).length).toBeGreaterThan(0);
    // Without a range (no list loaded) nothing is held back.
    expect(day('2028-06-21', { covered: null }).length).toBeGreaterThan(0);
    expect(dayCovered(berlinDayStart('2027-03-28'), covered)).toBe(true);
    expect(dayCovered(berlinDayStart('2027-10-31'), covered)).toBe(true);
  });

  it('the mask and the tree list say which days they were measured for, the same ones, and a viewshed carries them', () => {
    const mask = JSON.parse(readFileSync('public/viewshed/fernsehturm-scene.json', 'utf8'));
    const trees = JSON.parse(readFileSync('public/viewshed/trees-in-the-way.json', 'utf8'));
    expect(mask.covered.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mask.covered.to > mask.covered.from).toBe(true);
    expect(trees.covered).toEqual(mask.covered);
    expect(Array.isArray(trees.bare)).toBe(true);
    // More than a year from its first day, so the cap is not met on the day of the release.
    expect(Date.parse(mask.covered.to) - Date.parse(mask.covered.from)).toBeGreaterThan(400 * 86_400_000);
    expect(coveredBy({ ...shed, covered: mask.covered } as any)).toEqual(mask.covered);
    // With the lists as shipped: rows on the last covered day, none the day after.
    const real = { ...shed, covered: mask.covered } as any;
    const after = new Date(Date.parse(`${mask.covered.to}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(dayShots(berlinDayStart(mask.covered.to), { shed: real, views, sheds }).length).toBeGreaterThan(0);
    expect(dayShots(berlinDayStart(after), { shed: real, views, sheds })).toHaveLength(0);
  });
});

describe('neighbouring rows that are one pass told twice', () => {
  // With the scene mask as shipped: its holes are what split a pass in two (1 November 2027:
  // 11:31 and 11:45, both "500 m N"; ten such pairs in the year).
  const masked = applySceneMaskFor(load('fernsehturm'), JSON.parse(readFileSync('public/viewshed/fernsehturm-scene.json', 'utf8')).spots);
  it('no two sphere rows of a day share body, place words and touching stretches', () => {
    let pairs = 0;
    let rows = 0;
    for (let i = 0; i < 365; i += 3) {
      const spheres = (dayShots(berlinDayStart(addDays('2026-11-24', i)), { shed: masked }) as Row[]).filter((row) => row.where === 'sphere').sort((a, b) => a.t - b.t);
      rows += spheres.length;
      for (let k = 0; k + 1 < spheres.length; k++) {
        const [a, b] = [spheres[k], spheres[k + 1]];
        if (a.body === b.body && a.stand === b.stand && a.state === b.state && b.start <= a.until + 5 * 60_000) pairs++;
      }
    }
    expect(rows).toBeGreaterThan(500);
    expect(pairs).toBe(0);
  }, 240_000);

});
