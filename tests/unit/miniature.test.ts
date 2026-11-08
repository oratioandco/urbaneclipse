import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { parseTime } from '../../src/miniature/time.js';
// @ts-expect-error plain JS module
import { cloudDrift, cloudsAt, readSky } from '../../src/miniature/weather.js';
// @ts-expect-error plain JS module
import { BIG_MOON_M, SPHERE_CENTRE_AGL, TIP_AGL, SPHERE_TOP_AGL, antennaRange, bodyAgainstProfile, bodyAgainstTower, discOverSphere, findShots, findTowerShots, visibleMoon } from '../../src/miniature/towerShots.js';
// @ts-expect-error plain JS module
import { TARGETS } from '../../src/miniature/targets.js';
import { BRANDENBURGER_TOR, SIEGESSAEULE, landmarkHeight, profileRadius } from '../../src/lib/landmarks.ts';
// @ts-expect-error plain JS module
import { latLonFromScene, sceneFromLatLon } from '../../src/miniature/eye.js';

const TOWER = { lat: 52.520815, lon: 13.409419 };
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
  });

  it('interpolates between hours', () => {
    const d = day(0, 0, 0);
    d.berlin.low[10] = 0;
    d.berlin.low[11] = 1;
    expect(cloudsAt(d, 10 * 60 + 30).low).toBeCloseTo(0.5);
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

  it('hides the sun behind the column up close, and crosses it at its edge from far out', () => {
    const target = TARGETS.find((t: { id: string }) => t.id === 'siegessaeule');
    const eyeNear = { x: target.x, y: base + 1.6, z: target.z + 500 };
    const eyeFar = { x: target.x, y: base + 1.6, z: target.z + 2000 };
    const altOf = (eye: { y: number; z: number }, height: number) => (Math.atan2(base + height - eye.y, eye.z - target.z) * 180) / Math.PI;
    const run = (eye: { x: number; y: number; z: number }, alt: number) =>
      findShots({ eye, base, start: t0, end: t0 + 90 * 60_000, targets: [target], bodyAt: sweep(alt), moonLit: () => 1 });
    const near = run(eyeNear, altOf(eyeNear, 30)).filter((s: { body: string }) => s.body === 'sun');
    expect(near.map((s: { state: string }) => s.state)).toEqual(['hidden']);
    // The column is a tall band on the sky, so the disc never rings it: it crosses at the edge.
    const far = run(eyeFar, altOf(eyeFar, 30)).filter((s: { body: string }) => s.body === 'sun');
    expect(far.map((s: { state: string }) => s.state)).toEqual(['edge']);
  });

  it('never fakes a ring of moon round the gate from far away', () => {
    const target = TARGETS.find((t: { id: string }) => t.id === 'brandenburger-tor');
    // From 3 km the disc is tiny against the 35 m gate: no ring, only an edge or nothing.
    const eye = { x: target.x, y: base + 1.6, z: target.z + 3000 };
    const alt = (Math.atan2(base + 23 - eye.y, 3000) * 180) / Math.PI; // against the quadriga band
    const moon = findShots({ eye, base, start: t0, end: t0 + 90 * 60_000, targets: [target], bodyAt: sweep(alt), moonLit: () => 1 }).filter(
      (s: { body: string }) => s.body === 'moon',
    );
    expect(moon.map((s: { state: string }) => s.state)).not.toContain('ring');
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
});
