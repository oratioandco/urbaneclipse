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
    expect(landmarkScore('sun', 0.6)).toBeLessThan(1.2);
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
