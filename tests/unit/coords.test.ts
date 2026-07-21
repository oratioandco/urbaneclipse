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

  it('round-trips WGS84 -> UTM 33N (EPSG:25833, the actual Berlin LoD2 CRS) -> WGS84', () => {
    const lon = 13.4093;
    const lat = 52.5208;
    const utm = transformCoord('EPSG:4326', 'EPSG:25833', [lon, lat, 0]);
    // Within Berlin's verified 1km tile-grid extent (UTM 33N): x 371-415, y 5799-5835.
    expect(utm[0]).toBeGreaterThan(370000);
    expect(utm[0]).toBeLessThan(416000);
    expect(utm[1]).toBeGreaterThan(5799000);
    expect(utm[1]).toBeLessThan(5836000);
    const back = transformCoord('EPSG:25833', 'EPSG:4326', [utm[0]!, utm[1]!, 0]);
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
