import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { parseTime } from '../../src/miniature/time.js';
// @ts-expect-error plain JS module
import { cloudDrift, cloudsAt, readSky } from '../../src/miniature/weather.js';
// @ts-expect-error plain JS module
import { BIG_MOON_M, SPHERE_CENTRE_AGL, TIP_AGL, SPHERE_TOP_AGL, antennaRange, bodyAgainstTower, discOverSphere, visibleMoon } from '../../src/miniature/towerShots.js';
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
  });
  it('refuses what is not a time', () => {
    for (const text of ['', 'noon', '24:00', '13pm', '7:60', '0 am']) expect(parseTime(text)).toBeNull();
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
