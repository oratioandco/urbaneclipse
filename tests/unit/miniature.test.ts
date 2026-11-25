import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { parseTime } from '../../src/miniature/time.js';
// @ts-expect-error plain JS module
import { cloudDrift, cloudsAt, readSky, visibilityAt } from '../../src/miniature/weather.js';
// @ts-expect-error plain JS module
import { BIG_MOON_M, SPHERE_CENTRE_AGL, TIP_AGL, SPHERE_TOP_AGL, alignmentMinute, antennaRange, bodyAgainstProfile, bodyAgainstTower, discOverSphere, findShots, findTowerShots, visibleMoon } from '../../src/miniature/towerShots.js';
// @ts-expect-error plain JS module
import { TARGETS } from '../../src/miniature/targets.js';
import { BRANDENBURGER_TOR, SIEGESSAEULE, landmarkHeight, profileRadius } from '../../src/lib/landmarks.ts';
// @ts-expect-error plain JS module
import { latLonFromScene, sceneFromLatLon } from '../../src/miniature/eye.js';
// @ts-expect-error plain JS module
import { FEET, MOLECULE_MAN, OUTLINE, RIM, WEB, edgeDistance, moleculeHoles } from '../../src/miniature/moleculeManShape.js';

const TOWER = { lat: 52.520815, lon: 13.409419 };
const DEG = 180 / Math.PI;
const flat24 = (v: number) => Array.from({ length: 24 }, () => v);

describe('parseTime', () => {
  it('reads the ways people type a time', () => {
    expect(parseTime('17:50')).toBe(17 * 60 + 50);
    expect(parseTime('1750')).toBe(17 * 60 + 50);
    expect(parseTime('21.15')).toBe(21 * 60 + 15);
    expect(parseTime('5:50 pm')).toBe(17 * 60 + 50);
    expect(parseTime('7am')).toBe(7 * 60);
    expect(parseTime('12 am')).toBe(0);
    expect(parseTime('12pm')).toBe(12 * 60);
    expect(parseTime(' 9 ')).toBe(9 * 60);
    expect(parseTime('17:50:30')).toBe(17 * 60 + 50.5);
    expect(parseTime('5:50:15 pm')).toBe(17 * 60 + 50.25);
  });
  it('refuses what is not a time', () => {
    for (const text of ['', 'noon', '24:00', '13pm', '7:60', '0 am', '17:50:61']) expect(parseTime(text)).toBeNull();
  });
});

describe('weather', () => {
  const day = (low: number, mid: number, high: number, horizonLow = 0) => ({
    berlin: { low: flat24(low), mid: flat24(mid), high: flat24(high) },
    riseHorizon: { low: flat24(horizonLow) },
    setHorizon: { low: flat24(horizonLow) },
    rise: { az: 100, t: Date.UTC(2027, 2, 22, 5, 0) },
    set: { az: 260, t: Date.UTC(2027, 2, 22, 17, 0) },
    wind: { speed: flat24(5), from: flat24(270) },
    vis: flat24(24_000),
  });

  it('interpolates between hours', () => {
    const d = day(0, 0, 0);
    d.berlin.low[10] = 0;
    d.berlin.low[11] = 1;
    expect(cloudsAt(d, 10 * 60 + 30).low).toBeCloseTo(0.5);
  });

  it('reads how far you can see between hours', () => {
    const d = day(0, 0, 0);
    d.vis[10] = 24_000;
    d.vis[11] = 4_000;
    expect(visibilityAt(d, 10 * 60 + 30)).toBeCloseTo(14_000);
    expect(visibilityAt(d, 9 * 60)).toBe(24_000);
  });

  it('reads a sunset the way a photographer would', () => {
    expect(readSky(day(0.9, 0, 0), 'set').grade).toBe('poor');
    expect(readSky(day(0, 0, 0, 0.8), 'set').text).toMatch(/horizon/);
    expect(readSky(day(0.1, 0.5, 0.3), 'set').grade).toBe('good');
    expect(readSky(day(0, 0, 0), 'set').text).toMatch(/clear/);
  });

  it('drifts clouds downwind, about twice the ground wind', () => {
    const d = day(0, 0, 0);
    // From the west at 5 m/s: east (+x), 2 × 5 m/s × 3600 s an hour.
    const drift = cloudDrift(d, 60);
    expect(drift.x).toBeCloseTo(36_000, 0);
    expect(Math.abs(drift.z)).toBeLessThan(1e-6);
    d.wind.from = flat24(0);
    expect(cloudDrift(d, 30).z).toBeCloseTo(18_000, 0); // from the north: south is +z
  });
});

describe('the moon with the tower', () => {
  it('needs about 4.4 km for a big moon behind the sphere', () => {
    expect(BIG_MOON_M).toBeGreaterThan(4300);
    expect(BIG_MOON_M).toBeLessThan(4500);
    expect(discOverSphere(BIG_MOON_M)).toBeCloseTo(1.25, 2);
  });

  it('drops the stretches of a moon path too close for the moon to show', () => {
    const p = (distanceM: number) => ({ distanceM });
    const path = { body: 'moon', segments: [[p(3000), p(5000), p(6000), p(4000), p(7000)]] };
    expect(visibleMoon(path).segments).toEqual([[p(5000), p(6000)], [p(7000)]]);
    const sun = { body: 'sun', segments: [[p(1000)]] };
    expect(visibleMoon(sun)).toBe(sun);
  });

  it('puts the antenna stretch between the sphere top and the tip', () => {
    const r = antennaRange(4)!;
    const slope = Math.tan((4 * Math.PI) / 180);
    expect(r.fromM).toBeCloseTo((SPHERE_TOP_AGL - 1.6) / slope);
    expect(r.toM).toBeCloseTo((TIP_AGL - 1.6) / slope);
    expect(antennaRange(2)!.toM).toBe(9000); // capped at the edge of the data
    expect(antennaRange(1)).toBeNull(); // the sphere top is only cleared beyond it
  });

  // Stand due south of the tower and look north.
  const base = 34;
  const at = (distance: number) => ({ x: 0, y: base + 1.6, z: distance });
  const altOf = (eye: { y: number; z: number }, height: number) => (Math.atan2(base + height - eye.y, eye.z) * 180) / Math.PI;

  it('calls a small moon dead behind a near sphere hidden', () => {
    const eye = at(1500);
    expect(bodyAgainstTower(eye, base, { az: 0, alt: altOf(eye, SPHERE_CENTRE_AGL) }).state).toBe('hidden');
  });

  it('calls the same alignment from far out a ring', () => {
    const eye = at(6000);
    expect(bodyAgainstTower(eye, base, { az: 0, alt: altOf(eye, SPHERE_CENTRE_AGL) }).state).toBe('ring');
  });

  it('sees the moon behind the antenna', () => {
    const eye = at(1500);
    expect(bodyAgainstTower(eye, base, { az: 0, alt: altOf(eye, 300) }).state).toBe('antenna');
  });

  it('says which side the moon is on, so the hint steps the right way', () => {
    const eye = at(1500);
    const right = bodyAgainstTower(eye, base, { az: 2, alt: altOf(eye, SPHERE_CENTRE_AGL) });
    expect(right.state).toBe('near');
    expect(right.signedOff).toBeGreaterThan(0);
    expect(bodyAgainstTower(eye, base, { az: 358, alt: altOf(eye, SPHERE_CENTRE_AGL) }).signedOff).toBeLessThan(0);
  });
});

describe('passes behind the tower from a spot', () => {
  const base = 34;
  const at = (distance: number) => ({ x: 0, y: base + 1.6, z: distance });
  const altOf = (eye: { y: number; z: number }, height: number) => (Math.atan2(base + height - eye.y, eye.z) * 180) / Math.PI;
  const t0 = Date.UTC(2027, 2, 22, 12);
  // A body sweeping left to right behind the tower at a fixed height, a quarter degree a minute,
  // due north at t0 + 40 min.
  const sweep = (alt: number) => (_body: string, t: number) => ({ az: (((t - t0) / 60_000) * 0.25 - 10 + 360) % 360, alt });
  const run = (eye: { x: number; y: number; z: number }, alt: number, lit = 1) =>
    findTowerShots({ eye, base, start: t0, end: t0 + 90 * 60_000, bodyAt: sweep(alt), moonLit: () => lit });

  it('finds the sun behind the sphere, at the right minute', () => {
    const eye = at(1500);
    const sun = run(eye, altOf(eye, SPHERE_CENTRE_AGL)).filter((s: { body: string }) => s.body === 'sun');
    expect(sun).toHaveLength(1);
    expect(sun[0].state).toBe('hidden');
    expect(Math.abs(sun[0].peak - (t0 + 40 * 60_000))).toBeLessThanOrEqual(60_000);
  });

  it('never lists the moon hidden behind the sphere, only at its edge', () => {
    const eye = at(1500);
    const moon = run(eye, altOf(eye, SPHERE_CENTRE_AGL)).filter((s: { body: string }) => s.body === 'moon');
    // In at one edge and out at the other: one shot.
    expect(moon).toHaveLength(1);
    expect(moon[0].state).toBe('edge');
  });

  it('lists a big moon round the sphere from far out', () => {
    const eye = at(6000);
    const moon = run(eye, altOf(eye, SPHERE_CENTRE_AGL)).filter((s: { body: string }) => s.body === 'moon');
    expect(moon.map((m: { state: string }) => m.state)).toContain('ring');
  });

  it('finds the moon behind the antenna', () => {
    const eye = at(1500);
    const moon = run(eye, altOf(eye, 300)).filter((s: { body: string }) => s.body === 'moon');
    expect(moon.map((m: { state: string }) => m.state)).toEqual(['antenna']);
  });

  it('leaves out the sun behind the antenna: the sphere is the shot', () => {
    const eye = at(1500);
    expect(run(eye, altOf(eye, 300)).filter((s: { body: string }) => s.body === 'sun')).toEqual([]);
  });

  it('leaves out a moon too thin to see', () => {
    const eye = at(1500);
    expect(run(eye, altOf(eye, SPHERE_CENTRE_AGL), 0.1).filter((s: { body: string }) => s.body === 'moon')).toEqual([]);
  });

  it('puts the alignment minute where the azimuth crosses the tower bearing', () => {
    const eye = at(1500);
    // The same sweep, started closer to the bearing: az = 0 at t0 + 8 min.
    const near = (alt: number) => (_body: string, t: number) => ({ az: (((t - t0) / 60_000) * 0.25 - 2 + 360) % 360, alt });
    const [sun] = findTowerShots({ eye, base, start: t0, end: t0 + 90 * 60_000, bodyAt: near(altOf(eye, SPHERE_CENTRE_AGL)), moonLit: () => 1 }).filter(
      (s: { body: string }) => s.body === 'sun',
    );
    expect(sun).toBeDefined();
    // Bisected on the wrapped azimuth difference, not read off the minute grid.
    expect(Math.abs(sun.align - (t0 + 8 * 60_000))).toBeLessThanOrEqual(30_000);
  });

  it('keeps the alignment minute geometric when the score would pick another minute', () => {
    const eye = at(1500);
    // Azimuth sweeps slowly (crossing at t0 + 50 min, outside the hidden stretch), altitude
    // drifts: the smallest separation — and so the score peak — sits near t0 + 9 min, while
    // the azimuth keeps closing towards the bearing to the very end of the stretch.
    const drift = (alt: number) => (_body: string, t: number) => ({
      az: (((t - t0) / 60_000) * 0.02 - 1 + 360) % 360,
      alt: alt - 0.5 + ((t - t0) / 60_000) * 0.05,
    });
    const [sun] = findTowerShots({ eye, base, start: t0, end: t0 + 90 * 60_000, bodyAt: drift(altOf(eye, SPHERE_CENTRE_AGL)), moonLit: () => 1 }).filter(
      (s: { body: string }) => s.body === 'sun',
    );
    expect(sun).toBeDefined();
    // The pass's instant is its alignment, when the body is on the tower then as well as at the
    // best-scoring minute: one instant for the card, the row and the clock (the score's own
    // minute used to stand as `peak`, more than a minute away).
    expect(sun.peak).toBe(Math.round(sun.align / 1000) * 1000);
    // The azimuth is closest to the bearing at the stretch's end: align follows the azimuth,
    // not the separation.
    expect(Math.abs(sun.align - sun.end)).toBeLessThanOrEqual(60_000);
  });
});

describe('the alignment minute solver', () => {
  const t0 = Date.UTC(2027, 2, 22, 12);
  const bodyAt = (azOf: (t: number) => number) => (_body: string, t: number) => ({ az: azOf(t), alt: 20 });

  it('bisects a crossing that lands between grid minutes', () => {
    // Crossing due north at t0 + 10 min 30 s.
    const at = alignmentMinute(bodyAt((t) => (((t - t0) / 60_000) * 0.25 - 2.625 + 360) % 360), 'sun', 0, t0, t0 + 60 * 60_000);
    expect(Math.abs(at! - (t0 + 10.5 * 60_000))).toBeLessThanOrEqual(2_000);
  });

  it('crosses the 0/360 wrap without a false hit a half-turn away', () => {
    // Azimuth walks 358 -> 360 (=0) at t0 + 8 min; the antipodal bearing is never crossed.
    const at = alignmentMinute(bodyAt((t) => (358 + ((t - t0) / 60_000) * 0.25) % 360), 'sun', 0, t0, t0 + 60 * 60_000);
    expect(Math.abs(at! - (t0 + 8 * 60_000))).toBeLessThanOrEqual(2_000);
  });

  it('falls back to the smallest offset when no crossing lies in the stretch', () => {
    // Azimuth approaches 2 degrees but never reaches the bearing.
    const at = alignmentMinute(bodyAt((t) => 2 + 10 - ((t - t0) / 60_000) * 0.25), 'sun', 0, t0, t0 + 30 * 60_000);
    expect(Math.abs(at! - (t0 + 30 * 60_000))).toBeLessThanOrEqual(60_000);
  });
});

describe('passes behind the other landmarks', () => {
  const base = 34;
  const t0 = Date.UTC(2027, 2, 22, 12);
  // A much slower sweep than the real sky's, crossing due north (the eyes stand south of each
  // landmark): the column hides the disc for seconds at true speed, and the minute grid would
  // only ever see the edges.
  const sweep = (alt: number) => (_body: string, t: number) => ({ az: (((t - t0) / 60_000) * 0.02 - 0.9 + 360) % 360, alt });

  it('keeps the registry in step with the landmark axes', () => {
    for (const target of TARGETS) {
      const landmark = target.id === 'siegessaeule' ? SIEGESSAEULE : target.id === 'brandenburger-tor' ? BRANDENBURGER_TOR : null;
      if (!landmark) {
        expect(target.id).toBe('fernsehturm');
        expect(target.x).toBe(0);
        expect(target.z).toBe(0);
        continue;
      }
      const [x, z] = sceneFromLatLon(landmark.lat, landmark.lon, TOWER.lat, TOWER.lon);
      expect(target.x).toBeCloseTo(x, 0);
      expect(target.z).toBeCloseTo(z, 0);
      expect(target.topAGL).toBeCloseTo(landmarkHeight(landmark), 3);
    }
  });

  it('sizes the new landmarks by their profiles', () => {
    expect(landmarkHeight(SIEGESSAEULE)).toBeGreaterThan(66);
    expect(landmarkHeight(SIEGESSAEULE)).toBeLessThan(68);
    // The hall is wider than the column above it.
    expect(profileRadius(SIEGESSAEULE.profile, 5)).toBeGreaterThan(profileRadius(SIEGESSAEULE.profile, 30));
    expect(landmarkHeight(BRANDENBURGER_TOR)).toBe(26);
    expect(profileRadius(BRANDENBURGER_TOR.profile, 26)).toBe(0); // nothing above the quadriga
  });

  it('takes the sun on the Viktoria for a shot, and the sun behind the shaft for none', () => {
    const target = TARGETS.find((t: { id: string }) => t.id === 'siegessaeule');
    const eye = { x: target.x, y: 1.6, z: target.z + 1000 };
    // The scene's zero is 34.6 m; the column's base 35.2 m (landmarkShots.js, landmarkStands.ts).
    const altOf = (height: number) => (Math.atan2(35.2 - 34.6 + height - eye.y, 1000) * 180) / Math.PI;
    const run = (alt: number, from = eye) => findShots({ eye: from, base, start: t0, end: t0 + 90 * 60_000, targets: [target], bodyAt: sweep(alt), moonLit: () => 1 });
    expect(run(altOf(63)).map((s: { state: string }) => s.state)).toEqual(['figure', 'figure']); // sun and moon
    // Half way up the shaft the column hides the disc, and that is not the Viktoria.
    expect(run(altOf(30))).toEqual([]);
    // Above the figure's head by more than the disc: nothing either.
    expect(run(altOf(67) + 0.6)).toEqual([]);
  });

  it('wants the body a degree up and the spot far enough for the disc to count', () => {
    const target = TARGETS.find((t: { id: string }) => t.id === 'brandenburger-tor');
    const at = (metres: number) => ({ x: target.x, y: 1.6, z: target.z + metres });
    const altOf = (metres: number) => (Math.atan2(34.9 - 34.6 + 23 - 1.6, metres) * 180) / Math.PI;
    const run = (metres: number) => findShots({ eye: at(metres), base, start: t0, end: t0 + 90 * 60_000, targets: [target], bodyAt: sweep(altOf(metres)), moonLit: () => 1 });
    expect(run(600).length).toBe(2);
    // From 200 m the disc is a third of the quadriga: the day list offers no stand point there.
    expect(run(200)).toEqual([]);
    // From 1.5 km the quadriga stands 0.8 degrees up: the body behind it is in the murk.
    expect(altOf(1500)).toBeLessThan(1);
    expect(run(1500)).toEqual([]);
  });
});

describe('scene coordinates', () => {
  it('turn back into the same latitude and longitude', () => {
    for (const [lat, lon] of [[52.5163, 13.3777], [52.4984, 13.4095], [52.55, 13.3]]) {
      const [x, z] = sceneFromLatLon(lat, lon, TOWER.lat, TOWER.lon);
      const [lat2, lon2] = latLonFromScene(x, z, TOWER.lat, TOWER.lon);
      expect(lat2).toBeCloseTo(lat, 6);
      expect(lon2).toBeCloseTo(lon, 6);
    }
  });
});

describe('dynamic resolution', () => {
  it('steps down on slow frames, holds, then climbs back on fast ones', async () => {
    Object.assign(globalThis, { devicePixelRatio: 2, innerWidth: 1440, innerHeight: 900, location: { search: '' } });
    const { quality, sampleFrame } = await import('../../src/miniature/quality.js');
    const start = quality.ratio;
    expect(start).toBeLessThan(2); // 1440×900 at 2× is over the starting pixel budget
    let changed = null;
    for (let i = 0; i < 30; i++) changed = sampleFrame(33, 1000 + i * 33) ?? changed;
    expect(changed).not.toBeNull();
    expect(quality.ratio).toBeLessThan(start);
    const low = quality.ratio;
    // Fast frames right after a step down do not undo it.
    for (let i = 0; i < 30; i++) sampleFrame(10, 2000 + i * 10);
    expect(quality.ratio).toBe(low);
    // Later they do, but never past the screen's density.
    for (let k = 0; k < 20; k++) for (let i = 0; i < 30; i++) sampleFrame(10, 20_000 + k * 1000 + i);
    expect(quality.ratio).toBe(2);
    // Gaps while the renderer idles are not frame times.
    for (let i = 0; i < 30; i++) expect(sampleFrame(500, 40_000 + i)).toBeNull();
  });

  it('thins the shadow redraws before it gives up sharpness', async () => {
    const { quality, sampleFrame } = await import('../../src/miniature/quality.js');
    const ratio = quality.ratio;
    expect(quality.shadowEvery).toBe(1);
    // A drag: every frame redraws the shadow map and misses the refresh; the GPU is what is slow.
    for (let i = 0; i < 30; i++) expect(sampleFrame(33, 100_000 + i * 33, { main: 6, shadowed: true })).toBeNull();
    expect(quality.shadowEvery).toBe(2);
    expect(quality.ratio).toBe(ratio);
    // Still slow with every second frame spared: now the pixels go.
    let changed = null;
    for (let i = 0; i < 30; i++) changed = sampleFrame(33, 102_000 + i * 33, { main: 6, shadowed: i % 2 === 0 }) ?? changed;
    expect(changed).toBeLessThan(ratio);
    expect(quality.shadowEvery).toBe(2);
  });

  it('keeps the resolution when the main thread is what is slow', async () => {
    const { quality, sampleFrame } = await import('../../src/miniature/quality.js');
    const ratio = quality.ratio;
    // Most of each frame goes by inside the frame function: fewer pixels would not help.
    for (let k = 0; k < 4; k++) for (let i = 0; i < 30; i++) expect(sampleFrame(40, 200_000 + k * 2000 + i * 40, { main: 34, shadowed: i % 2 === 0 })).toBeNull();
    expect(quality.ratio).toBe(ratio);
    expect(quality.shadowEvery).toBe(2);
    // Shadow frames at twice the slow mark: every third.
    for (let i = 0; i < 30; i++) sampleFrame(i % 2 === 0 ? 60 : 30, 300_000 + i * 45, { main: i % 2 === 0 ? 52 : 26, shadowed: i % 2 === 0 });
    expect(quality.shadowEvery).toBe(3);
    expect(quality.ratio).toBe(ratio);
  });

  it('gives the shadows back once their frames keep pace at full sharpness', async () => {
    const { quality, sampleFrame } = await import('../../src/miniature/quality.js');
    for (let k = 0; k < 30; k++) for (let i = 0; i < 30; i++) sampleFrame(12, 400_000 + k * 1000 + i * 12, { main: 4, shadowed: i % 2 === 0 });
    expect(quality.ratio).toBe(2);
    expect(quality.shadowEvery).toBe(1);
  });
});

describe('Molecule Man', () => {
  // Independent check, OpenStreetMap way 166268035 read through Overpass on 2026-11-23: a
  // three-armed star whose junction nodes are 52.4969618/13.4590427, 52.4969624/13.4590453 and
  // 52.4969633/13.4590433, and whose arm tips are the three points below. Wikidata Q522248
  // puts the sculpture at 52.496972, 13.459056, within 2 m of that junction.
  const ARM_TIPS = [[52.4970586, 13.4591895], [52.4968683, 13.4591059], [52.49699, 13.4588535]];

  it('stands on the junction of the three plates OpenStreetMap draws', () => {
    const [x, z] = sceneFromLatLon(MOLECULE_MAN.lat, MOLECULE_MAN.lon, TOWER.lat, TOWER.lon);
    expect(Math.hypot(x - MOLECULE_MAN.centre[0], z - MOLECULE_MAN.centre[1])).toBeLessThan(0.1);
    const [wx, wz] = sceneFromLatLon(52.496972, 13.459056, TOWER.lat, TOWER.lon);
    expect(Math.hypot(wx - MOLECULE_MAN.centre[0], wz - MOLECULE_MAN.centre[1])).toBeLessThan(2);
  });

  it('turns its figures onto the mapped arms, 120 degrees apart, and reaches as far', () => {
    const reach = Math.max(...OUTLINE.map(([u]: number[]) => u));
    ARM_TIPS.forEach(([lat, lon], i) => {
      const [x, z] = sceneFromLatLon(lat, lon, TOWER.lat, TOWER.lon);
      const dx = x - MOLECULE_MAN.centre[0];
      const dz = z - MOLECULE_MAN.centre[1];
      const bearing = (DEG * Math.atan2(dx, -dz) + 360) % 360;
      expect(Math.abs(bearing - MOLECULE_MAN.bearings[i])).toBeLessThan(4); // the mapped arms are 116-124 degrees apart
      expect(Math.abs(Math.hypot(dx, dz) - reach)).toBeLessThan(2.2); // mapped 11.3, 13.3 and 14.6 m
    });
    expect(MOLECULE_MAN.bearings[1] - MOLECULE_MAN.bearings[0]).toBeCloseTo(120, 6);
    expect(MOLECULE_MAN.bearings[2] - MOLECULE_MAN.bearings[1]).toBeCloseTo(120, 6);
  });

  it('is 30 m of profile from the feet to the crown, the hand on the shared axis', () => {
    const ys = OUTLINE.map(([, y]: number[]) => y);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(30);
    expect(MOLECULE_MAN.top - MOLECULE_MAN.terrain).toBe(30); // "30 m, ab Wasserfläche"
    expect(OUTLINE.filter(([u]: number[]) => u === 0).length).toBe(2); // the hand's two corners
    expect(OUTLINE.every(([u]: number[]) => u >= 0)).toBe(true); // no figure crosses the axis
    for (const [from, to] of FEET) expect(OUTLINE.filter(([u, y]: number[]) => y === 0 && (u === from || u === to)).length).toBe(2);
  });

  it('scatters the same holes every time, each clear of the rim and of its neighbours', () => {
    const holes = moleculeHoles();
    expect(holes).toEqual(moleculeHoles());
    expect(holes.length).toBe(200); // "hundreds of holes" over three figures
    for (const [i, h] of holes.entries()) {
      expect(edgeDistance(OUTLINE, h.x, h.y)).toBeGreaterThanOrEqual(h.r + RIM);
      for (const o of holes.slice(i + 1)) expect(Math.hypot(h.x - o.x, h.y - o.y)).toBeGreaterThanOrEqual(h.r + o.r + WEB);
    }
  });
});

describe('Molecule Man', () => {
  // Independent check, OpenStreetMap way 166268035 read through Overpass on 2026-11-23: a
  // three-armed star whose junction nodes are 52.4969618/13.4590427, 52.4969624/13.4590453 and
  // 52.4969633/13.4590433, and whose arm tips are the three points below. Wikidata Q522248
  // puts the sculpture at 52.496972, 13.459056, within 2 m of that junction.
  const ARM_TIPS = [[52.4970586, 13.4591895], [52.4968683, 13.4591059], [52.49699, 13.4588535]];

  it('stands on the junction of the three plates OpenStreetMap draws', () => {
    const [x, z] = sceneFromLatLon(MOLECULE_MAN.lat, MOLECULE_MAN.lon, TOWER.lat, TOWER.lon);
    expect(Math.hypot(x - MOLECULE_MAN.centre[0], z - MOLECULE_MAN.centre[1])).toBeLessThan(0.1);
    const [wx, wz] = sceneFromLatLon(52.496972, 13.459056, TOWER.lat, TOWER.lon);
    expect(Math.hypot(wx - MOLECULE_MAN.centre[0], wz - MOLECULE_MAN.centre[1])).toBeLessThan(2);
  });

  it('turns its figures onto the mapped arms, 120 degrees apart, and reaches as far', () => {
    const reach = Math.max(...OUTLINE.map(([u]: number[]) => u));
    ARM_TIPS.forEach(([lat, lon], i) => {
      const [x, z] = sceneFromLatLon(lat, lon, TOWER.lat, TOWER.lon);
      const dx = x - MOLECULE_MAN.centre[0];
      const dz = z - MOLECULE_MAN.centre[1];
      const bearing = (DEG * Math.atan2(dx, -dz) + 360) % 360;
      expect(Math.abs(bearing - MOLECULE_MAN.bearings[i])).toBeLessThan(4); // the mapped arms are 116-124 degrees apart
      expect(Math.abs(Math.hypot(dx, dz) - reach)).toBeLessThan(2.2); // mapped 11.3, 13.3 and 14.6 m
    });
    expect(MOLECULE_MAN.bearings[1] - MOLECULE_MAN.bearings[0]).toBeCloseTo(120, 6);
    expect(MOLECULE_MAN.bearings[2] - MOLECULE_MAN.bearings[1]).toBeCloseTo(120, 6);
  });

  it('is 30 m of profile from the feet to the crown, the hand on the shared axis', () => {
    const ys = OUTLINE.map(([, y]: number[]) => y);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(30);
    expect(MOLECULE_MAN.top - MOLECULE_MAN.terrain).toBe(30); // "30 m, ab Wasserfläche"
    expect(OUTLINE.filter(([u]: number[]) => u === 0).length).toBe(2); // the hand's two corners
    expect(OUTLINE.every(([u]: number[]) => u >= 0)).toBe(true); // no figure crosses the axis
    for (const [from, to] of FEET) expect(OUTLINE.filter(([u, y]: number[]) => y === 0 && (u === from || u === to)).length).toBe(2);
  });

  it('scatters the same holes every time, each clear of the rim and of its neighbours', () => {
    const holes = moleculeHoles();
    expect(holes).toEqual(moleculeHoles());
    expect(holes.length).toBe(200); // "hundreds of holes" over three figures
    for (const [i, h] of holes.entries()) {
      expect(edgeDistance(OUTLINE, h.x, h.y)).toBeGreaterThanOrEqual(h.r + RIM);
      for (const o of holes.slice(i + 1)) expect(Math.hypot(h.x - o.x, h.y - o.y)).toBeGreaterThanOrEqual(h.r + o.r + WEB);
    }
  });
});
