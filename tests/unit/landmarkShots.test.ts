/**
 * The Siegessäule's and the Brandenburger Tor's shots as rows of a day: landmarkShots.js and
 * its hooks in dayShots.js, the one pipeline of `/plan/`'s lists and the home page's grid.
 * The geometry under it is tested in landmarkStands.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleBody } from '../../src/lib/bodyPosition';
import { FIGURE_TARGETS, QUADRIGA, VIKTORIA, figurePasses } from '../../src/lib/landmarkStands';
import { decodeViewshed } from '../../src/lib/viewshed';
import { planLink } from '../../src/home/grid.js';
import { berlinDayStart } from '../../src/miniature/berlinClock.js';
import { collectRows, computeLandmarkPasses, dayShots, findShot, shotKey, withoutContinued } from '../../src/miniature/dayShots.js';
import { LANDMARK_CHECK, figureView, landmarkRows, landmarkScore, lensFor } from '../../src/miniature/landmarkShots.js';
import { sceneFromLatLon } from '../../src/miniature/eye.js';
import { FERNSEHTURM } from '../../src/lib/landmarks';
import { SPRITE } from '../../src/miniature/shotCard.js';
import { kindOf, moreStreets, paleMoon, paleMoonFactor, pickTop } from '../../src/miniature/spectacle.js';
import { spectacle } from '../../src/miniature/fromHere.js';
import { decodeStreets } from '../../src/lib/streets';
import { formatClock } from '../../src/miniature/time.js';
import { discOverSphere, towerSentence } from '../../src/miniature/towerShots.js';
import { TARGETS } from '../../src/miniature/targets.js';
import { rowSeen } from '../../src/miniature/rowCheck.js';
import { litPercent } from '../../src/miniature/spectacle.js';
import { streetMomentsOfDay } from '../../src/miniature/dayShots.js';

const load = (id: string) => {
  const header = JSON.parse(readFileSync(`public/viewshed/${id}.json`, 'utf8'));
  return decodeViewshed(header, new Uint8Array(readFileSync(`public/viewshed/${header.binary}`)));
};
const sheds = { siegessaeule: load('siegessaeule'), 'brandenburger-tor': load('brandenburger-tor') };
const tower = load('fernsehturm');

type Row = Record<string, any>;
const landmarkOnly = (rows: Row[]) => rows.filter((row) => row.target);

describe('a day’s rows for the two landmarks', () => {
  // 17 March 2027: the sun sets down Straße des 17. Juni behind the column, and down Unter den
  // Linden behind the gate, minutes apart.
  const from = berlinDayStart('2027-03-17');
  const rows: Row[] = dayShots(from, { sheds });
  const column = rows.find((row) => row.target === 'siegessaeule' && row.body === 'sun')!;
  const gate = rows.find((row) => row.target === 'brandenburger-tor' && row.body === 'sun')!;

  it('come out of dayShots beside the others, in time order', () => {
    expect(column).toBeTruthy();
    expect(gate).toBeTruthy();
    expect(rows.map((row) => row.t)).toEqual([...rows.map((row) => row.t)].sort((a, b) => a - b));
    // With the tower's viewshed too, its rows and theirs share the list.
    const all: Row[] = dayShots(from, { shed: tower, sheds });
    expect(all.some((row) => row.landmark === 'fernsehturm')).toBe(true);
    expect(landmarkOnly(all)).toHaveLength(landmarkOnly(rows).length);
  });

  it('carry what a tower row carries, so cards, links and the fly-to take them as they are', () => {
    for (const row of [column, gate]) {
      expect(row.kind).toBe('tower');
      expect(typeof row.t).toBe('number');
      expect(row.openAt).toBe(row.t);
      expect(row.at).toHaveLength(2);
      expect(row.look).toHaveLength(2);
      expect(row.lens).toBeGreaterThanOrEqual(85);
      expect(row.lens).toBeLessThanOrEqual(600);
      expect(row.score).toBeGreaterThan(0);
      expect(row.distanceM).toBeGreaterThan(300);
      for (const key of ['short', 'stand', 'brief', 'compact', 'title', 'detail']) expect(typeof row[key], key).toBe('string');
      // The card draws the landmark's own sprite, framed on its figure.
      expect(Object.keys(SPRITE)).toContain(row.landmark);
    }
    expect(column.landmark).toBe('siegessaeule');
    expect(column.where).toBe('viktoria');
    expect(column.short).toBe('Siegessäule');
    expect(gate.landmark).toBe('brandenburger_tor');
    expect(gate.where).toBe('quadriga');
    expect(gate.short).toBe('Brandenburger Tor');
  });

  it('say where to stand, which side, which way to look, and what was checked', () => {
    // Sunset: east of each landmark, looking west.
    expect(column.side).toBe('east');
    expect(column.stand).toMatch(/^1\.\d km east$/);
    expect(column.caution).toBe('trees unchecked');
    expect(gate.stand).toMatch(/^\d+ m east$/);
    expect(gate.caution).toBe('trees unchecked');
    expect(column.detail).toContain('on Straße des 17. Juni');
    expect(column.detail).toContain('east of the column, looking west');
    expect(gate.side).toBe('east');
    expect(gate.detail).toContain('on Unter den Linden');
    expect(gate.detail).toContain('east of the gate, looking west');
    for (const row of [column, gate]) {
      expect(row.detail.endsWith(LANDMARK_CHECK)).toBe(true);
      expect(row.checked).toEqual({ buildings: true, trees: false });
      // The stand point is east of the landmark, and the camera looks at the sun.
      const target = FIGURE_TARGETS.find((t) => t.id === row.target)!;
      expect(row.at[1]).toBeGreaterThan(target.landmark.lon);
      const sun = sampleBody('sun', new Date(row.t), row.at[0], row.at[1]);
      expect(row.look[0]).toBeCloseTo(sun.az, 3);
      expect(row.look[1]).toBeCloseTo(sun.alt, 3);
      expect(sun.az).toBeGreaterThan(255);
      expect(sun.az).toBeLessThan(270);
    }
  });

  it('are the search’s passes, at the minute nearest the middle of the street', () => {
    const [pass] = figurePasses(VIKTORIA, 'sun', from, from + 86_400_000);
    expect(column.t).toBe(pass.best.t);
    expect(column.at).toEqual([pass.best.lat, pass.best.lon]);
    expect(column.distanceM).toBe(pass.best.distanceM);
    // From 1.1 km the disc is a little wider than the Viktoria is tall.
    expect(column.discShare).toBeGreaterThan(1);
    expect(column.discShare).toBeLessThan(1.3);
  });

  it('have names for links that find them again', () => {
    expect(shotKey(column)).toBe('viktoria-sun');
    expect(shotKey(gate)).toBe('quadriga-sun');
    for (const row of landmarkOnly(rows)) {
      expect(findShot(rows, shotKey(row), row.t)).toBe(row);
      // A link written a few minutes off still names it; one from the morning does not.
      expect(findShot(rows, shotKey(row), row.t + 20 * 60_000)).toBe(row);
      expect(findShot(rows, shotKey(row), row.t - 6 * 3_600_000)).toBeNull();
    }
    // The home page's link carries the key, the spot, the look and the lens.
    const link = planLink(column);
    expect(link).toContain('date=2027-03-17');
    expect(link).toContain('shot=viktoria-sun');
    expect(link).toContain(`at=${column.at[0].toFixed(6)},${column.at[1].toFixed(6)}`);
    expect(link).toContain(`lens=${column.lens}`);
    expect(planLink(gate)).toContain('shot=quadriga-sun');
  });

  it('are not a midnight repeat of anything', () => {
    expect(landmarkOnly(withoutContinued(rows, from, rows))).toHaveLength(landmarkOnly(rows).length);
  });
});

describe('switches and honesty', () => {
  const from = berlinDayStart('2027-03-17');
  const passes = computeLandmarkPasses(from, sheds);

  it('without a landmark’s viewshed it has no rows: an unchecked spot is not offered', () => {
    expect(landmarkOnly(dayShots(from, {}))).toHaveLength(0);
    expect(computeLandmarkPasses(from, {})).toHaveLength(0);
    const onlyGate: Row[] = dayShots(from, { sheds: { 'brandenburger-tor': sheds['brandenburger-tor'] } });
    expect(landmarkOnly(onlyGate).length).toBeGreaterThan(0);
    expect(landmarkOnly(onlyGate).every((row) => row.target === 'brandenburger-tor')).toBe(true);
  });

  it('the Landmarks switch takes them out and leaves the rest; Tower leaves them in', () => {
    const count = (flags: Record<string, boolean>) => landmarkOnly(collectRows([], [], from, flags, passes)).length;
    expect(count({})).toBeGreaterThan(0);
    expect(count({ landmarks: false })).toBe(0);
    expect(count({ tower: false })).toBe(count({}));
    expect(count({ streets: false })).toBe(count({}));
    expect(count({ sun: false })).toBeLessThan(count({}));
    // Rows collected without passes are as they were before.
    expect(landmarkOnly(collectRows([], [], from))).toHaveLength(0);
  });

  it('the sun and moon switches are theirs too', () => {
    const day = berlinDayStart('2026-12-16'); // a 47% moon sets behind both figures
    const moonPasses = computeLandmarkPasses(day, sheds);
    const both: Row[] = landmarkRows(moonPasses);
    expect(both.some((row) => row.body === 'moon')).toBe(true);
    expect(landmarkRows(moonPasses, { moon: false }).some((row: Row) => row.body === 'moon')).toBe(false);
    const moon = both.find((row) => row.body === 'moon' && row.target === 'siegessaeule')!;
    expect(moon.detail).toMatch(/\d+% lit/);
    expect(moon.title).toMatch(/^Big moon behind the Siegessäule’s Viktoria, 1\.\d× the figure$/);
  });

  it('a thin moon is left out', () => {
    // 2027-01-10: the moon is 9% lit when it lines up west of the column.
    let thin = 0;
    for (let i = 0; i < 60; i++) {
      const day = berlinDayStart('2026-12-01') + i * 86_400_000;
      for (const row of landmarkRows(computeLandmarkPasses(day, sheds)) as Row[]) {
        if (row.body !== 'moon') continue;
        const lit = Number(row.detail.match(/(\d+)% lit/)![1]);
        if (lit < 25) thin++;
      }
    }
    expect(thin).toBe(0);
  });
});

describe('rank and lens', () => {
  it('a landmark shot never outranks the tower’s best of its kind', () => {
    // dayShots.js: tower sun 1.2 plain and 1.8 as a ring, big moon up to 2.4, antenna 2, street up to 1.6.
    expect(landmarkScore('sun', 0.5)).toBeCloseTo(1.1, 9);
    expect(landmarkScore('sun', 0.5)).toBeLessThan(1.2);
    // As wide as the figure is tall: over the longest street (1.6), under the tower's ring (1.8).
    expect(landmarkScore('sun', 1)).toBeCloseTo(1.7, 9);
    expect(landmarkScore('sun', 1)).toBeGreaterThan(1.6);
    expect(landmarkScore('sun', 1.9)).toBeLessThan(1.8);
    expect(landmarkScore('sun', 1.9)).toBeGreaterThan(landmarkScore('sun', 0.6));
    expect(landmarkScore('moon', 0.5)).toBeCloseTo(0.6, 9);
    expect(landmarkScore('moon', 3)).toBe(2);
    expect(landmarkScore('moon', 3)).toBeLessThan(2.4);
    expect(landmarkScore('moon', 1.5)).toBeGreaterThan(landmarkScore('moon', 0.8));
  });

  it('the lens gives the figure and the disc room: longer from further out', () => {
    expect(lensFor(VIKTORIA, 460)).toBe(200);
    expect(lensFor(VIKTORIA, 1000)).toBe(400);
    expect(lensFor(VIKTORIA, 1700)).toBe(400);
    expect(lensFor(QUADRIGA, 320)).toBe(200);
    expect(lensFor(QUADRIGA, 900)).toBe(400);
    for (const d of [320, 500, 800, 1200]) expect(lensFor(QUADRIGA, d)).toBeGreaterThanOrEqual(lensFor(QUADRIGA, d - 100 > 314 ? d - 100 : d));
  });
});

describe('how many there are', () => {
  it('March 2027: the equinox sunsets behind the column, a run of days on end', () => {
    // Counted by the pipeline itself, kept here so a change to the strips or the rules shows.
    let column = 0;
    let gate = 0;
    const days: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = `2027-03-${String(d).padStart(2, '0')}`;
      for (const row of landmarkRows(computeLandmarkPasses(berlinDayStart(date), sheds)) as Row[]) {
        if (row.body !== 'sun') continue;
        if (row.target === 'siegessaeule') (column++, days.push(date));
        else gate++;
      }
    }
    expect(days[0]).toBe('2027-03-15');
    expect(days[days.length - 1]).toBe('2027-03-27');
    expect(column).toBe(13);
    // 13 to 18 March from Unter den Linden, 31 March from Straße des 17. Juni; the single
    // minute of 19 March is not a pass.
    expect(gate).toBe(7);
  });
});

describe('at eye level: the open landmark shot seen in the planner’s scene (figureView)', () => {
  // The scene samples the sun at the TV tower and measures bearings from grid north; a row's
  // spot is true geodesy. The two must agree, or the planner's line would deny its own shot.
  const from = berlinDayStart('2027-03-17');
  const rows: Row[] = dayShots(from, { sheds });
  const cases = rows.filter((row) => row.target && row.body === 'sun');
  const seen = (row: Row, t: number) => {
    const target = FIGURE_TARGETS.find((item) => item.id === row.target)!;
    const [x, z] = sceneFromLatLon(target.landmark.lat, target.landmark.lon, FERNSEHTURM.lat, FERNSEHTURM.lon);
    const [ex, ez] = sceneFromLatLon(row.at[0], row.at[1], FERNSEHTURM.lat, FERNSEHTURM.lon);
    // The eye on the strip's DGM1 ground, as a scene height (zero at 34.6 m).
    const pass = figurePasses(target, 'sun', from, from + 86_400_000)[0]!;
    const eye = { x: ex, y: pass.best.groundM - 34.6 + 1.6, z: ez };
    return figureView(target, eye, { x, z }, sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon));
  };

  it('the stretch in a row’s words is the minutes the scene has the disc on the figure from its spot', () => {
    // The row, the eye-level line and "From here" give one stretch: before, the row measured
    // in the landmark's own frame and said 5:47-5:50 where the other two said 5:47-5:51.
    for (const row of cases) {
      const [, first, last] = row.detail.match(/· (\S+ [AP]M)–(\S+ [AP]M) ·/)!;
      const on: number[] = [];
      for (let t = row.t - 15 * 60_000; t <= row.t + 15 * 60_000; t += 60_000) if (seen(row, t).covered) on.push(t);
      expect(formatClock(on[0])).toBe(first);
      expect(formatClock(on[on.length - 1])).toBe(last);
    }
    expect(cases.find((row) => row.where === 'viktoria')!.detail).toContain('5:47 PM–5:51 PM');
  });

  it('at the row’s spot and minute the disc is on the figure', () => {
    expect(cases).toHaveLength(2);
    for (const row of cases) {
      const view = seen(row, row.t);
      expect(view.covered).toBe(true);
      // The flat scene and the tower's sun differ from the row's own geometry by under 0.05°.
      expect(Math.abs(view.across)).toBeLessThan(0.05);
      expect(Math.abs(view.up)).toBeLessThan(0.05);
      expect(Math.abs(view.distanceM - row.distanceM)).toBeLessThan(2);
      expect(view.discShare).toBeCloseTo(row.discShare, 1);
    }
  });

  it('five minutes on it is not, and says which way it went', () => {
    for (const row of cases) {
      const view = seen(row, row.t + 5 * 60_000);
      expect(view.covered).toBe(false);
      // The evening sun moves right and down.
      expect(view.across).toBeGreaterThan(0.5);
      expect(view.up).toBeLessThan(-0.3);
    }
  });

  it('every row carries a name short enough for the ticket', () => {
    expect(cases.map((row) => row.shortest).sort()).toEqual(['Brandenb. Tor', 'Siegessäule']);
  });
});

describe('one rule for the moon by day, and one form for a row’s small print', () => {
  const views = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')));

  it('the moon by day counts for less along a ramp, not at a step; the sun and a night moon count whole', () => {
    const noon = Date.UTC(2027, 2, 17, 11, 0);
    const night = Date.UTC(2027, 2, 17, 23, 0);
    expect(paleMoon('moon', night)).toBe(1);
    expect(paleMoon('sun', noon)).toBe(1);
    // The ramp: whole to 3° under the horizon, the floor from 9° up, monotone between.
    expect(paleMoonFactor(-3, 1)).toBe(1);
    expect(paleMoonFactor(-10, 0.3)).toBe(1);
    expect(paleMoonFactor(9, 1)).toBeCloseTo(0.7, 9);
    expect(paleMoonFactor(40, 1)).toBeCloseTo(0.7, 9);
    expect(paleMoonFactor(40, 0.25)).toBeCloseTo(0.55, 9);
    let last = 1;
    for (let alt = -3; alt <= 9; alt += 0.25) {
      const f = paleMoonFactor(alt, 0.8);
      expect(f).toBeLessThanOrEqual(last);
      // No cliff: a quarter of a degree of sun never costs more than 1.5% of a score.
      expect(last - f).toBeLessThan(0.015);
      last = f;
    }
    // A fuller moon holds its own better against the same sky.
    expect(paleMoonFactor(6, 1)).toBeGreaterThan(paleMoonFactor(6, 0.3));
    // The midday moon of that day (60% lit, sun 35° up) by the rule, and "From here" by the same.
    expect(paleMoon('moon', noon)).toBeGreaterThan(0.55);
    expect(paleMoon('moon', noon)).toBeLessThan(0.7);
    const found = { kind: 'street', body: 'moon', lengthM: 800 };
    expect(spectacle({ ...found, t: noon })).toBeCloseTo(paleMoon('moon', noon), 9);
    expect(spectacle({ ...found, t: night })).toBe(1);
  });

  it('25 November 2026: the big moon at 08:54 stays above the antenna’s moonset at 08:35 and above a henge', () => {
    const rows: Row[] = dayShots(berlinDayStart('2026-11-25'), { shed: tower, views, sheds });
    const big = rows.find((row) => /^Big moon behind the TV tower/.test(row.title))!;
    const antenna = rows.find((row) => row.where === 'antenna' && row.t < big.t)!;
    // Both lose to the morning sky, the later one a little more; the order of the two holds.
    expect(big.score).toBeLessThan(2.4);
    expect(antenna.score).toBeLessThan(2);
    expect(big.score).toBeGreaterThan(antenna.score);
    expect(big.score).toBeGreaterThan(1.6);
  });

  it('in a day’s rows a midday moon henge ranks under the evening sun on the Viktoria', () => {
    // 16 March 2027: the moon rises late in the morning down several long streets (1.6 each
    // before the rule) while "Big sun behind the Viktoria, 1.4×" waits for the evening.
    const from = berlinDayStart('2027-03-16');
    const rows: Row[] = dayShots(from, { shed: tower, views, sheds });
    const viktoria = rows.find((row) => row.target === 'siegessaeule' && row.body === 'sun')!;
    expect(viktoria.title).toMatch(/^Big sun behind the Siegessäule’s Viktoria, 1\.4× the figure$/);
    expect(viktoria.score).toBeCloseTo(1.7, 9);
    const dayMoonStreets = rows.filter((row) => row.kind === 'street' && row.body === 'moon' && paleMoon('moon', row.t) < 1);
    // (Those the midday sky does not show at all are not listed: spectacle.js `moonShows`.)
    for (const row of dayMoonStreets) expect(row.score).toBeLessThan(1.6);
    // The three a day's cards show, by score: the night's big moon and moonset at the tower stay.
    const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 3).map((row) => row.title);
    expect(top[0]).toMatch(/^Big moon behind the TV tower/);
    expect(top[1]).toBe('Moonset behind the TV tower’s antenna');
    expect(top[2]).toBe(viktoria.title);
  });

  it('every row’s small print starts with its own minute, whatever its kind', () => {
    for (const date of ['2027-03-16', '2026-12-16']) {
      const rows: Row[] = dayShots(berlinDayStart(date), { shed: tower, views, sheds });
      const kinds = new Set(rows.map((row) => (row.target ? 'landmark' : row.kind === 'street' ? 'street' : row.where)));
      expect(kinds.has('landmark') && kinds.has('street') && kinds.has('sphere')).toBe(true);
      for (const row of rows) expect(row.detail.startsWith(`${formatClock(row.t)} · `), row.title).toBe(true);
    }
  });
});

describe('the few of a day (pickTop)', () => {
  const street = (name: string, t: number, bearingDeg: number, score: number, body = 'sun') => ({ kind: 'street', body, t, score, title: name, moment: { view: { bearingDeg } } });
  const t0 = Date.UTC(2027, 0, 14, 7, 0);

  it('henges on parallel streets within minutes are one sight, the best standing for the rest', () => {
    const rows = [street('A', t0, 120, 1.6), street('B', t0 + 3 * 60_000, 122, 1.6), street('C', t0 + 7 * 60_000, 118, 1.5), { kind: 'tower', where: 'sphere', body: 'sun', t: t0 + 3_600_000, score: 1.2, title: 'tower' }];
    const top = pickTop(rows, 3);
    expect(top.map((row: Row) => row.title)).toEqual(['A', 'tower']);
    expect(top[0].more).toBe(2);
    expect(moreStreets(top[0])).toBe('and 2 more streets');
    expect(moreStreets(top[1])).toBe('');
  });

  it('a street across them, another body, or an hour later is its own sight', () => {
    const rows = [street('A', t0, 120, 1.6), street('across', t0 + 60_000, 210, 1.5), street('moon', t0 + 60_000, 121, 1.4, 'moon'), street('later', t0 + 3_600_000, 120, 1.3)];
    expect(pickTop(rows, 4).map((row: Row) => row.title)).toEqual(['A', 'across', 'moon', 'later']);
    expect(pickTop(rows, 4).some((row: Row) => row.more)).toBe(false);
  });

  it('prefers another kind when scores are close, and never over a clearly better shot', () => {
    const tower = { kind: 'tower', where: 'sphere', body: 'sun', t: t0, score: 1.5, title: 'tower' };
    const far = (name: string, i: number, score: number) => street(name, t0 + i * 3_600_000, 40 * i, score);
    // Three henges at 1.6 and a tower shot at 1.5: the tower comes third, not fourth.
    expect(pickTop([far('a', 1, 1.6), far('b', 2, 1.6), far('c', 3, 1.6), tower], 3).map((row: Row) => row.title)).toEqual(['a', 'b', 'tower']);
    // Against henges at 2.0 it waits its turn.
    expect(pickTop([far('a', 1, 2), far('b', 2, 2), far('c', 3, 2), { ...tower, score: 1.2 }], 3).map((row: Row) => row.title)).toEqual(['a', 'b', 'c']);
    expect(kindOf(tower)).toBe('sphere');
    expect(kindOf({ kind: 'tower', target: 'siegessaeule', where: 'viktoria' })).toBe('landmark');
  });

  it('weighs by what it is given: a forecast can turn the order', () => {
    const rows = [street('clear', t0, 10, 1.2), street('cloudy', t0 + 3_600_000, 100, 1.6)];
    expect(pickTop(rows, 1, (row: Row) => row.score * (row.title === 'cloudy' ? 0.5 : 1))[0].title).toBe('clear');
  });
});

describe('one event, one name, in the day list and in From here', () => {
  it('the tower’s sentences are one function’s', () => {
    expect(towerSentence('sun', 'hidden')).toBe('Sun behind the TV tower’s sphere');
    expect(towerSentence('sun', 'ring')).toBe('Ring of sun round the TV tower’s sphere');
    expect(towerSentence('sun', 'edge')).toBe('Sun at the edge of the TV tower’s sphere');
    expect(towerSentence('moon', 'ring', 1.72)).toBe('Big moon behind the TV tower, 1.7× the sphere');
    expect(towerSentence('moon', 'antenna')).toBe('Moon behind the TV tower’s antenna');
    const fromHere = TARGETS.find((target: Row) => target.id === 'fernsehturm')!.stateText;
    for (const state of ['hidden', 'ring', 'edge', 'antenna']) expect(fromHere.sun[state]).toBe(towerSentence('sun', state));
    for (const state of ['edge', 'antenna']) expect(fromHere.moon[state]).toBe(towerSentence('moon', state));
  });

  it('a sphere row’s sentence is what stands there at its minute, and its lit share the moon’s of that minute', () => {
    const views = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')));
    for (const date of ['2026-11-26', '2026-12-20', '2027-03-17']) {
      const rows: Row[] = dayShots(berlinDayStart(date), { shed: tower, views, sheds });
      for (const row of rows.filter((r) => r.kind === 'tower' && !r.target)) {
        const seen = rowSeen(row, { x: sceneFromLatLon(row.at[0], row.at[1], FERNSEHTURM.lat, FERNSEHTURM.lon)[0], y: 1.6, z: sceneFromLatLon(row.at[0], row.at[1], FERNSEHTURM.lat, FERNSEHTURM.lon)[1] }, 0);
        expect(seen.ok, `${date} ${row.title}: ${seen.sees}`).toBe(true);
        if (row.where === 'antenna') {
          expect(row.detail).toContain(`${litPercent(row.t)}% lit`);
          expect(seen.sees).toBe('antenna');
        } else expect(row.title).toBe(towerSentence(row.body, seen.sees, discOverSphere(row.distanceM)));
      }
    }
  });
});

describe('a henge across midnight is one row, on the day of its peak', () => {
  it('12 and 13 February 2027: no street at 23:59 one day and 00:00 the next', () => {
    const views = decodeStreets(JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')));
    const a = berlinDayStart('2027-02-12');
    const b = berlinDayStart('2027-02-13');
    const first = streetMomentsOfDay(views, a);
    const second = streetMomentsOfDay(views, b);
    for (const m of [...first, ...second]) expect(m.peak >= (first.includes(m) ? a : b) && m.peak < (first.includes(m) ? b : b + 86_400_000)).toBe(true);
    // One view of a street (two streets can share a name, and a street has two directions).
    const key = (m: Row) => `${m.view.from.lat},${m.view.from.lon},${m.view.bearingDeg}|${m.body}`;
    // The same street and body on both days only when the two moments are hours apart.
    for (const m of first) for (const n of second.filter((x: Row) => key(x) === key(m))) expect(n.peak - m.peak).toBeGreaterThan(3 * 3_600_000);
  });
});
