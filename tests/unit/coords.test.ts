import { describe, it, expect } from 'vitest';
import { transformCoord } from '../../src/lib/coords';

describe('transformCoord', () => {
  it('round-trips WGS84 -> UTM 32N -> WGS84 (near-identity; ETRS89 ~= WGS84)', () => {
    // proj4 takes EPSG:4326 as [lon, lat]
    const lon = 13.4093;
    const lat = 52.5208;
    const utm = transformCoord('EPSG:4326', 'EPSG:25832', [lon, lat, 0]);
    const back = transformCoord('EPSG:25832', 'EPSG:4326', [utm[0]!, utm[1]!, 0]);
    expect(back[0]).toBeCloseTo(lon, 6);
    expect(back[1]).toBeCloseTo(lat, 6);
  });

  // EPSG:31468 (historical DHDN) path is intentionally UNVERIFIED — the +towgs84 datum
  // parameters must be confirmed against an authoritative PROJ reference before a regression
  // fixture is added. See research.md "Consolidated VERIFY-LIVE Checklist".
  it.skip('EPSG:31468 -> WGS84 datum-shift regression (VERIFY-LIVE: needs reference value)', () => {
    // Once verified, assert transformCoord('EPSG:31468','EPSG:4326',[...]) against a known point.
  });
});
