/**
 * Where to stand for the sun or moon behind the Viktoria (Siegessäule) and the quadriga
 * (Brandenburger Tor): src/lib/landmarkStands.ts.
 *
 * The independent check throughout: from the stand point the code gives, the direction to the
 * middle of the figure is worked out here from scratch (WGS84 to ECEF to the observer's own
 * east-north-up frame, no code shared with the library), and compared with `sampleBody` at
 * that very point and minute. If the two agree, the disc's centre is behind the figure.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleBody } from '../../src/lib/bodyPosition';
import {
  DISC_DEG,
  EYE_HEIGHT_M,
  FIGURE_TARGETS,
  QUADRIGA,
  VIKTORIA,
  aimAgl,
  altitudeRange,
  discShare,
  figureHeight,
  figurePasses,
  groundAlong,
  minDistanceM,
  standFor,
  type FigureTarget,
} from '../../src/lib/landmarkStands';
import { BRANDENBURGER_TOR, SIEGESSAEULE, landmarkHeight } from '../../src/lib/landmarks';
import { VIEW_BUILDING, VIEW_NO_SKY, VIEW_VISIBLE, decodeViewshed, sampleViewshed } from '../../src/lib/viewshed';
import { berlinDayStart } from '../../src/miniature/berlinClock.js';

const RAD = Math.PI / 180;

/** WGS84 geodetic to earth-centred metres. */
function ecef(lat: number, lon: number, h: number): [number, number, number] {
  const a = 6378137;
  const e2 = 0.00669437999014;
  const s = Math.sin(lat * RAD);
  const n = a / Math.sqrt(1 - e2 * s * s);
  return [(n + h) * Math.cos(lat * RAD) * Math.cos(lon * RAD), (n + h) * Math.cos(lat * RAD) * Math.sin(lon * RAD), (n * (1 - e2) + h) * s];
}

/** Azimuth (from true north) and elevation of a point seen from another, degrees, on a straight line. */
function directionTo(from: { lat: number; lon: number; h: number }, to: { lat: number; lon: number; h: number }) {
  const a = ecef(from.lat, from.lon, from.h);
  const b = ecef(to.lat, to.lon, to.h);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const sl = Math.sin(from.lat * RAD), cl = Math.cos(from.lat * RAD), so = Math.sin(from.lon * RAD), co = Math.cos(from.lon * RAD);
  const east = -so * d[0] + co * d[1];
  const north = -sl * co * d[0] - sl * so * d[1] + cl * d[2];
  const up = cl * co * d[0] + cl * so * d[1] + sl * d[2];
  return { az: (Math.atan2(east, north) / RAD + 360) % 360, alt: Math.atan2(up, Math.hypot(east, north)) / RAD, range: Math.hypot(east, north) };
}

/** How far the body's centre is from the middle of the figure, seen from a stand point: degrees across and up. */
function miss(target: FigureTarget, stand: { lat: number; lon: number; groundM: number }, body: { az: number; alt: number }) {
  const figure = directionTo(
    { lat: stand.lat, lon: stand.lon, h: stand.groundM + EYE_HEIGHT_M },
    { lat: target.landmark.lat, lon: target.landmark.lon, h: target.landmark.baseOrthometric + aimAgl(target) },
  );
  const across = ((((body.az - figure.az) % 360) + 540) % 360 - 180) * Math.cos(body.alt * RAD);
  return { across, up: body.alt - figure.alt, range: figure.range };
}

const day = (date: string) => ({ from: berlinDayStart(date), to: berlinDayStart(date) + 86_400_000 });

describe('the figures and the strips to stand on', () => {
  it('the figures are the tops of the models in landmarks.ts, with the published sizes', () => {
    // de.wikipedia: Viktoria 8.32 m on a monument of about 67 m; gate 20.3 m, quadriga tip about 26 m.
    expect(VIKTORIA.landmark).toBe(SIEGESSAEULE);
    expect(figureHeight(VIKTORIA)).toBeCloseTo(8.3, 1);
    expect(VIKTORIA.toAgl).toBe(landmarkHeight(SIEGESSAEULE));
    expect(QUADRIGA.landmark).toBe(BRANDENBURGER_TOR);
    expect(QUADRIGA.fromAgl).toBe(20.3);
    expect(QUADRIGA.toAgl).toBe(landmarkHeight(BRANDENBURGER_TOR));
    expect(aimAgl(VIKTORIA)).toBeCloseTo(62.85, 2);
    expect(aimAgl(QUADRIGA)).toBeCloseTo(23.15, 2);
  });

  it('the disc is half the figure from the nearest stand point, and wider than it from far out', () => {
    // 0.52° at 457 m is 4.15 m, half of 8.3 m; at 314 m it is 2.85 m, half of 5.7 m.
    expect(minDistanceM(VIKTORIA)).toBeCloseTo(457, 0);
    expect(minDistanceM(QUADRIGA)).toBeCloseTo(314, 0);
    expect(discShare(VIKTORIA, minDistanceM(VIKTORIA))).toBeCloseTo(0.5, 6);
    expect(discShare(VIKTORIA, 1000)).toBeCloseTo((2 * 1000 * Math.tan((DISC_DEG / 2) * RAD)) / 8.3, 6);
    expect(discShare(VIKTORIA, 1000)).toBeGreaterThan(1);
    expect(discShare(QUADRIGA, 1000)).toBeGreaterThan(1.5);
  });

  it('the gate and the column stand on one street: each is on the other’s strip', () => {
    // Straße des 17. Juni runs from one to the other. The bearing between the two axes (OSM
    // centroids, worked out here on the ellipsoid) is the strips' own, to a third of a degree.
    const there = directionTo({ lat: SIEGESSAEULE.lat, lon: SIEGESSAEULE.lon, h: 0 }, { lat: BRANDENBURGER_TOR.lat, lon: BRANDENBURGER_TOR.lon, h: 0 });
    const back = directionTo({ lat: BRANDENBURGER_TOR.lat, lon: BRANDENBURGER_TOR.lon, h: 0 }, { lat: SIEGESSAEULE.lat, lon: SIEGESSAEULE.lon, h: 0 });
    expect(there.range).toBeGreaterThan(1850);
    expect(there.range).toBeLessThan(1900);
    expect(Math.abs(there.az - VIKTORIA.corridors.find((c) => c.side === 'east')!.bearingDeg)).toBeLessThan(0.35);
    expect(Math.abs(back.az - QUADRIGA.corridors.find((c) => c.side === 'west')!.bearingDeg)).toBeLessThan(0.35);
  });

  it('every strip says which side it is on, which way one looks, and is flat ground', () => {
    for (const target of FIGURE_TARGETS) {
      for (const c of target.corridors) {
        expect(c.looking).toBe(c.side === 'east' ? 'west' : 'east');
        expect(c.side).toBe(c.bearingDeg < 180 ? 'east' : 'west');
        expect(c.toM).toBeGreaterThan(minDistanceM(target));
        // DGM1 along the strips: 33.5 to 34.9 m, nowhere a slope.
        for (const [, h] of c.ground) {
          expect(h).toBeGreaterThan(33.4);
          expect(h).toBeLessThan(35);
        }
        expect(groundAlong(c, c.ground[0][0] - 50)).toBe(c.ground[0][1]);
        expect(groundAlong(c, (c.ground[0][0] + c.ground[1][0]) / 2)).toBeCloseTo((c.ground[0][1] + c.ground[1][1]) / 2, 9);
        const range = altitudeRange(target, c);
        expect(range.min).toBeGreaterThanOrEqual(1);
        expect(range.max).toBeLessThan(8);
        expect(range.max).toBeGreaterThan(range.min);
      }
    }
    // The column's west strip stops short of the Stadtbahn viaduct, 955 m out.
    expect(VIKTORIA.corridors.find((c) => c.side === 'west')!.toM).toBeLessThan(955);
  });
});

describe('standFor: the one point a body lines up from', () => {
  it('puts the eye where the line through the figure meets the ground', () => {
    for (const target of FIGURE_TARGETS) {
      for (const c of target.corridors) {
        const { min, max } = altitudeRange(target, c);
        for (const alt of [min + 0.05, (min + max) / 2, max - 0.05]) {
          // A tenth of a degree either way stays on the narrowest strip (1.7 m at 1 km).
          for (const turn of [-0.1, 0, 0.1]) {
            const body = { az: (c.bearingDeg + 180 + turn) % 360, alt };
            const stand = standFor(target, body);
            expect(stand, `${target.id} ${c.side} ${alt}`).not.toBeNull();
            const off = miss(target, stand!, body);
            // Within a hundredth of a degree both ways: 0.2 m at a kilometre. The straight line
            // of the check has no refraction; over these distances that is 0.001°.
            expect(Math.abs(off.across)).toBeLessThan(0.01);
            expect(Math.abs(off.up)).toBeLessThan(0.01);
            expect(off.range).toBeCloseTo(stand!.distanceM, 0);
            expect(stand!.corridor).toBe(c);
          }
        }
      }
    }
  });

  it('gives no point when the body is too high, too low, or off the strip', () => {
    const east = VIKTORIA.corridors.find((c) => c.side === 'east')!;
    const look = (east.bearingDeg + 180) % 360;
    expect(standFor(VIKTORIA, { az: look, alt: 4 })).not.toBeNull();
    // 12° up: the line comes down 290 m from the column, where the disc is a third of the figure.
    expect(standFor(VIKTORIA, { az: look, alt: 12 })).toBeNull();
    // Under 1° the body is in the murk; at 1.5° the point would lie past the strip's end.
    expect(standFor(VIKTORIA, { az: look, alt: 0.8 })).toBeNull();
    expect(standFor(VIKTORIA, { az: look, alt: 1.5 })).toBeNull();
    // 2° off the street's direction is 30 m beside it at 860 m: among the trees.
    expect(standFor(VIKTORIA, { az: look + 2, alt: 4 })).toBeNull();
    expect(standFor(VIKTORIA, { az: look - 2, alt: 4 })).toBeNull();
    // North or south of the column there is no strip at all.
    expect(standFor(VIKTORIA, { az: 180, alt: 4 })).toBeNull();
    expect(standFor(VIKTORIA, { az: 0, alt: 4 })).toBeNull();
    // The promenade of Unter den Linden is 8 m wide: 1° off at 500 m is 9 m beside it.
    const linden = QUADRIGA.corridors.find((c) => c.side === 'east')!;
    expect(standFor(QUADRIGA, { az: (linden.bearingDeg + 180) % 360, alt: 2.5 })).not.toBeNull();
    expect(standFor(QUADRIGA, { az: (linden.bearingDeg + 181) % 360, alt: 2.5 })).toBeNull();
  });

  it('says which side: east of the column looking west, west of the gate looking east', () => {
    const evening = standFor(VIKTORIA, { az: 264, alt: 3 })!;
    expect(evening.corridor.side).toBe('east');
    expect(evening.lon).toBeGreaterThan(SIEGESSAEULE.lon);
    const morning = standFor(QUADRIGA, { az: 84, alt: 2 })!;
    expect(morning.corridor.side).toBe('west');
    expect(morning.lon).toBeLessThan(BRANDENBURGER_TOR.lon);
  });
});

describe('figurePasses: real days, against sampleBody at the stand point', () => {
  // Days found by the search itself; what is tested is that on them the body really is behind
  // the figure, by the independent line of sight above.
  const cases: Array<[FigureTarget, 'sun' | 'moon', string, 'east' | 'west']> = [
    [VIKTORIA, 'sun', '2027-03-17', 'east'], // equinox sunset down Straße des 17. Juni
    [VIKTORIA, 'sun', '2027-04-10', 'west'], // sunrise from the Tiergarten side
    [VIKTORIA, 'moon', '2026-12-16', 'east'],
    [QUADRIGA, 'sun', '2027-04-02', 'west'], // sunrise through the gate's axis
    [QUADRIGA, 'sun', '2027-03-14', 'east'], // sunset seen from Unter den Linden
    [QUADRIGA, 'moon', '2027-01-14', 'west'],
  ];
  for (const [target, body, date, side] of cases) {
    it(`${body} behind the ${target.figure} on ${date}, from the ${side}`, () => {
      const { from, to } = day(date);
      const passes = figurePasses(target, body, from, to).filter((p) => p.corridor.side === side);
      expect(passes).toHaveLength(1);
      const pass = passes[0];
      expect(pass.points.length).toBeGreaterThan(0);
      for (const p of pass.points) {
        const seen = sampleBody(body, new Date(p.t), p.lat, p.lon);
        const off = miss(target, p, seen);
        // The disc is 0.52° wide: its centre is within a fiftieth of that of the figure's middle.
        expect(Math.abs(off.across), `${date} across`).toBeLessThan(0.01);
        expect(Math.abs(off.up), `${date} up`).toBeLessThan(0.01);
        expect(p.t % 60_000).toBe(0);
        expect(Math.abs(p.acrossM)).toBeLessThanOrEqual(p.corridor.halfWidthM);
        expect(p.discShare).toBeGreaterThanOrEqual(target.minDiscShare);
        expect(seen.alt).toBeGreaterThanOrEqual(1);
      }
      // The minute offered is the one nearest the middle of the strip.
      expect(Math.abs(pass.best.acrossM)).toBe(Math.min(...pass.points.map((p) => Math.abs(p.acrossM))));
      // Minutes run on without a gap.
      for (let i = 1; i < pass.points.length; i++) expect(pass.points[i].t - pass.points[i - 1].t).toBe(60_000);
    });
  }

  it('a minute before or after, from the same spot, the disc has moved on', () => {
    const { from, to } = day('2027-03-17');
    const [pass] = figurePasses(VIKTORIA, 'sun', from, to);
    const p = pass.best;
    const later = miss(VIKTORIA, p, sampleBody('sun', new Date(p.t + 3 * 60_000), p.lat, p.lon));
    // Three minutes on the sun is over half a degree away: the minute matters.
    expect(Math.hypot(later.across, later.up)).toBeGreaterThan(0.5);
  });

  it('midwinter and midsummer have no sun behind either figure: it rises and sets far off the street', () => {
    for (const date of ['2026-12-21', '2027-06-21']) {
      const { from, to } = day(date);
      for (const target of FIGURE_TARGETS) expect(figurePasses(target, 'sun', from, to)).toHaveLength(0);
    }
  });

  it('drops what the viewshed hides', () => {
    const { from, to } = day('2027-03-17');
    expect(figurePasses(VIKTORIA, 'sun', from, to, { isClear: () => false })).toHaveLength(0);
    const all = figurePasses(VIKTORIA, 'sun', from, to)[0];
    const half = figurePasses(VIKTORIA, 'sun', from, to, { isClear: (lat, lon) => lon > all.best.lon })[0];
    expect(half.points.length).toBeLessThan(all.points.length);
    expect(half.points.every((p) => p.lon > all.best.lon)).toBe(true);
  });
});

describe('the landmarks’ viewsheds (scripts/build_viewshed.py --landmark)', () => {
  const load = (id: string) => {
    const header = JSON.parse(readFileSync(`public/viewshed/${id}.json`, 'utf8'));
    return { header, shed: decodeViewshed(header, new Uint8Array(readFileSync(`public/viewshed/${header.binary}`))) };
  };

  it('aim at the middle of each figure and reach past every strip', () => {
    for (const target of FIGURE_TARGETS) {
      const { header } = load(target.id);
      expect(header.landmark).toBe(target.id);
      expect(header.aimHeightAglM).toBeCloseTo(aimAgl(target), 2);
      expect(header.rangeM).toBeGreaterThan(Math.max(...target.corridors.map((c) => c.toM)));
      expect(header.values.noSky).toBe(VIEW_NO_SKY);
    }
  });

  it('no LoD2 building stands on a strip or between it and the figure', () => {
    // Along each strip's centre line, every 25 m of its usable length: visible, and the sky behind.
    for (const target of FIGURE_TARGETS) {
      const { shed } = load(target.id);
      for (const c of target.corridors) {
        const { min, max } = altitudeRange(target, c);
        for (let alt = min + 0.02; alt < max; alt += 0.1) {
          // The stand point of a body straight down the strip's centre line.
          const centre = (c.bearingDeg + 180 + (Math.asin(c.offsetM / 600) / RAD)) % 360;
          const stand = standFor(target, { az: centre, alt });
          if (!stand) continue;
          expect(sampleViewshed(shed, stand.lat, stand.lon), `${target.id} ${c.side} ${Math.round(stand.distanceM)} m`).toBe(VIEW_VISIBLE);
        }
      }
    }
  });

  it('know a building from a street, and a figure seen against houses from one against the sky', () => {
    const gate = load('brandenburger-tor').shed;
    // The Reichstag (centre of OSM relation 2201742, as src/miniature/landmarks.js) is a building.
    expect(sampleViewshed(gate, 52.51862, 13.37618)).toBe(VIEW_BUILDING);
    // Some of the ground that sees the quadriga sees it against buildings: the gate is low.
    let noSky = 0;
    let visible = 0;
    for (const cell of gate.cells) {
      if (cell === VIEW_NO_SKY) noSky++;
      else if (cell === VIEW_VISIBLE) visible++;
    }
    expect(noSky).toBeGreaterThan(1000);
    expect(visible).toBeGreaterThan(1000);
    // The Viktoria is 63 m up: nothing built stands behind it from anywhere near.
    const column = load('siegessaeule').shed;
    expect([...column.cells].filter((cell) => cell === VIEW_NO_SKY).length).toBeLessThan(visible / 20);
  });
});
