import { describe, it, expect } from 'vitest';
import { getPosition, getTimes } from 'suncalc';
import {
  positionToENU,
  southToNorthAzimuth,
  enuToECEF,
  sunDirectionECEF,
} from '../../src/lib/ephemerisMath';
import type { Vec3 } from '../../src/lib/ephemerisMath';

const toRad = (d: number) => (d * Math.PI) / 180;

const BERLIN_LAT = 52.5208; // Fernsehturm
const BERLIN_LON = 13.4093;

/**
 * Inverse of enuToECEF (ECEF->ENU = transpose rotation) used only to verify the
 * round-trip identity property of the forward rotation in this test file.
 * Mirrors the ENU basis-in-ECEF rows: E=[-sλ,cλ,0], N=[-sφcλ,-sφsλ,cφ], U=[cφcλ,cφsλ,sφ].
 */
function ecefToENU(v: Vec3, latRad: number, lonRad: number): Vec3 {
  const sφ = Math.sin(latRad);
  const cφ = Math.cos(latRad);
  const sλ = Math.sin(lonRad);
  const cλ = Math.cos(lonRad);
  const e = -sλ * v[0] + cλ * v[1];
  const n = -sφ * cλ * v[0] - sφ * sλ * v[1] + cφ * v[2];
  const u = cφ * cλ * v[0] + cφ * sλ * v[1] + sφ * v[2];
  return [e, n, u];
}

describe('positionToENU', () => {
  it('produces a unit vector (magnitude == 1) across the hemisphere', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [Math.PI / 2, 0],
      [Math.PI, 0],
      [(3 * Math.PI) / 2, 0],
      [0, Math.PI / 4],
      [1.2, 0.7],
      [2.3, Math.PI / 2], // zenith
    ];
    for (const [az, alt] of cases) {
      const v = positionToENU(az, alt);
      const mag = Math.hypot(v[0], v[1], v[2]);
      expect(mag, `az=${az} alt=${alt}`).toBeCloseTo(1, 6);
    }
  });

  it('solar-noon input (az=0, alt>0) -> N component < 0, U > 0, E ~= 0 (sun due south, above horizon)', () => {
    const v = positionToENU(0, toRad(45));
    expect(v[1]).toBeLessThan(0); // N negative => pointing south
    expect(v[2]).toBeGreaterThan(0); // U positive => above horizon
    expect(v[0]).toBeCloseTo(0, 6); // E ~ 0
  });

  it('west azimuth (az=PI/2) -> E component < 0 (pointing west)', () => {
    const v = positionToENU(Math.PI / 2, 0);
    expect(v[0]).toBeLessThan(0);
  });
});

describe('southToNorthAzimuth', () => {
  it('south(0) -> north(PI)', () => {
    expect(southToNorthAzimuth(0)).toBeCloseTo(Math.PI, 6);
  });
  it('west(PI/2) -> 3PI/2', () => {
    expect(southToNorthAzimuth(Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 6);
  });
  it('north(PI) -> 0 (mod 2PI)', () => {
    expect(southToNorthAzimuth(Math.PI)).toBeCloseTo(0, 6);
  });
  it('east(3PI/2) -> PI/2', () => {
    expect(southToNorthAzimuth((3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 6);
  });
  it('wraps into [0, 2PI): 5PI/2 -> 3PI/2', () => {
    expect(southToNorthAzimuth((5 * Math.PI) / 2)).toBeCloseTo((3 * Math.PI) / 2, 6);
  });
});

describe('enuToECEF', () => {
  it('at (lat=0, lon=0) applies the equator/prime-meridian axis swap [e,n,u] -> [u,e,n]', () => {
    const out = enuToECEF([1, 2, 3], 0, 0);
    expect(out[0]).toBeCloseTo(3, 6); // x = u
    expect(out[1]).toBeCloseTo(1, 6); // y = e
    expect(out[2]).toBeCloseTo(2, 6); // z = n
  });

  it('preserves magnitude (pure rotation) at Berlin', () => {
    const v: Vec3 = [3, 4, 5];
    const out = enuToECEF(v, toRad(BERLIN_LAT), toRad(BERLIN_LON));
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(Math.hypot(3, 4, 5), 6);
  });

  it('round-trip identity at Berlin: enuToECEF then inverse recovers the input', () => {
    const v: Vec3 = [0.3, -0.7, 0.9];
    const ecef = enuToECEF(v, toRad(BERLIN_LAT), toRad(BERLIN_LON));
    const back = ecefToENU(ecef, toRad(BERLIN_LAT), toRad(BERLIN_LON));
    expect(back[0]).toBeCloseTo(v[0], 6);
    expect(back[1]).toBeCloseTo(v[1], 6);
    expect(back[2]).toBeCloseTo(v[2], 6);
  });
});

describe('sunDirectionECEF (suncalc 2.0.1 bridge)', () => {
  // GOLDEN SNAPSHOT — pins suncalc 2.0.1's actual getPosition convention.
  // Fixed date/time: 2024-06-21T11:00:00.000Z, Berlin Fernsehturm (52.5208 N, 13.4093 E).
  //
  // Observed at runtime (node_modules/suncalc@2.0.1):
  //   getPosition(date, 52.5208, 13.4093) ->
  //     { azimuth: 176.09553733680377, altitude: 60.88310127227426 }
  //
  // CONVENTION (per node_modules/suncalc/index.d.ts + the probe above):
  //   * angles are in DEGREES (NOT radians)
  //   * azimuth is north-referenced clockwise (0=N, 90=E, 180=S, 270=W)
  //     — confirmed: at solar noon (2024-06-21T11:08:16.92Z) azimuth ~= 180 deg (due south),
  //       altitude ~= 60.93 deg, exactly as expected for Berlin (~52.5 N) near the solstice.
  //
  // NOTE: this INVERTS the US3 spec prose, which assumed the suncalc 1.x convention
  // ("0=south, +west, radians"). The pure primitives below keep the spec's south-referenced
  // radian contract; sunDirectionECEF performs the (deg,north) -> (rad,south) conversion
  // before delegating to positionToENU so the end-to-end Sun direction is physically correct.
  it('golden snapshot: getPosition returns the pinned 2.0.1 values (degrees, north-referenced)', () => {
    const p = getPosition(new Date('2024-06-21T11:00:00.000Z'), BERLIN_LAT, BERLIN_LON);
    expect(p.azimuth).toBeCloseTo(176.09553733680377, 6);
    expect(p.altitude).toBeCloseTo(60.88310127227426, 6);
  });

  it('end-to-end: at Berlin solar noon the ECEF direction rotates back to due-south + above-horizon', () => {
    const times = getTimes(new Date('2024-06-21T11:00:00.000Z'), BERLIN_LAT, BERLIN_LON);
    const dir = sunDirectionECEF(times.solarNoon, BERLIN_LAT, BERLIN_LON);
    const enu = ecefToENU(dir, toRad(BERLIN_LAT), toRad(BERLIN_LON));
    // Solar noon in Berlin: Sun is due south and above the horizon.
    expect(enu[0], 'E component ~ 0 (due south)').toBeCloseTo(0, 2);
    expect(enu[1], 'N component < 0 (pointing south)').toBeLessThan(0);
    expect(enu[2], 'U component > 0 (above horizon)').toBeGreaterThan(0);
  });

  it('end-to-end: result is a unit vector in ECEF', () => {
    const dir = sunDirectionECEF(new Date('2024-06-21T11:00:00.000Z'), BERLIN_LAT, BERLIN_LON);
    expect(Math.hypot(dir[0], dir[1], dir[2])).toBeCloseTo(1, 6);
  });
});
