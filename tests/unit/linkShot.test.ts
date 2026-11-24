import { describe, expect, it } from 'vitest';
import { shotSeenFrom } from '../../src/miniature/linkShot.js';
import { sampleBody } from '../../src/lib/bodyPosition';
import { FERNSEHTURM } from '../../src/lib/landmarks';
import { offsetGeodetic } from '../../src/lib/silhouette';

describe('a link\u2019s place against the shot it names', () => {
  // 26 November 2026, 08:33 Berlin: the sun low in the south-east. A place 2.5 km from the tower
  // on the far side from the sun has the sun behind the tower; the independent check is the
  // bearing itself, computed here from the ephemeris and a geodetic offset.
  const t = Date.UTC(2026, 10, 26, 7, 33);
  const sun = sampleBody('sun', new Date(t), FERNSEHTURM.lat, FERNSEHTURM.lon);
  const behind = offsetGeodetic(FERNSEHTURM.lat, FERNSEHTURM.lon, 0, (sun.az + 180) % 360, 2500);
  const row = { kind: 'tower', where: 'sphere', body: 'sun', t };
  it('holds where the body is at the tower', () => {
    expect(shotSeenFrom(row, behind.lat, behind.lon)).toBe(true);
  });
  it('does not hold from a place where the tower is elsewhere in the sky', () => {
    // The tester's link: a sphere shot named from Neukölln, 52.487, 13.43.
    expect(shotSeenFrom(row, 52.487, 13.43)).toBe(false);
    const aside = offsetGeodetic(FERNSEHTURM.lat, FERNSEHTURM.lon, 0, (sun.az + 190) % 360, 2500);
    expect(shotSeenFrom(row, aside.lat, aside.lon)).toBe(false);
  });
  it('holds a street shot near its street and not across town', () => {
    const street = { kind: 'street', body: 'sun', t, at: [52.4822, 13.439], distanceM: 1900 };
    expect(shotSeenFrom(street, 52.4835, 13.4372)).toBe(true);
    expect(shotSeenFrom(street, 52.55, 13.35)).toBe(false);
  });
  it('does not judge a landmark\u2019s rows', () => {
    expect(shotSeenFrom({ kind: 'landmark', body: 'sun', t }, 52.4, 13.3)).toBe(true);
  });
});
