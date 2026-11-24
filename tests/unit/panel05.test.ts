/**
 * Panel 05 on /classic: low passes, Berlin time (audit defects 3 and 7,
 * docs/accuracy-audit-2026-11.md).
 *
 * INDEPENDENT CHECK. `bridgeWindowAltitudes` in tests/fixtures/accuracy-reference.json holds,
 * for each of the 203 windows the panel lists from the six points on the Lichtenberger Brücke
 * over twelve months, the apparent altitude of the disc's centre from Skyfield with JPL DE421
 * and Bennett's refraction (scripts/audit/make_fixture.py). The app's own altitude comes from
 * suncalc with Sæmundsson's formula; the two part by up to 0.09 deg at the very horizon.
 * The skyline figure of 0.5 deg is the app's street data for Frankfurter Allee looking west
 * from the foot of the bridge, read here from public/streets/berlin.json.
 * Clock changes follow the EU rule (01:00 UTC on 28 March and 31 October 2027).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleBody } from '../../src/lib/bodyPosition';
import { LICHTENBERGER_BRUECKE } from '../../src/lib/vantages';
import { berlinZoneName, formatWhenDe } from '../../src/lib/berlinTime';
import { DISC_RADIUS_DEG, LOW_PASS_CENTRE_DEG, SKYLINE_TOWARD_TOWER_DEG, formatAltitudeDe, isLowPass, lowPassNote } from '../../src/lib/lowPass';

interface Row { point: string; body: 'sun' | 'moon'; peak: string; refAltApparent: number }
const rows = (JSON.parse(readFileSync('tests/fixtures/accuracy-reference.json', 'utf8')) as { bridgeWindowAltitudes: Row[] }).bridgeWindowAltitudes;
/** What the panel does with a row: the app's own altitude at the listed moment, from the standing point. */
const appAltitude = (r: Row) => {
  const p = LICHTENBERGER_BRUECKE.points.find((x) => x.id === r.point)!;
  return sampleBody(r.body, new Date(r.peak), p.lat, p.lon).alt;
};

describe('panel 05: passes the skyline probably hides', () => {
  it('takes its threshold from the street data: 0.5 deg skyline plus the 0.27 deg disc, rounded to 0.8', () => {
    const streets = JSON.parse(readFileSync('public/streets/berlin.json', 'utf8')) as { fields: string[]; views: Array<Array<string | number>> };
    const col = (name: string) => streets.fields.indexOf(name);
    // Frankfurter Allee westward from the bridge's foot: the same line of sight as the tower's (279 deg).
    const west = streets.views.find((v) => v[col('name')] === 'Frankfurter Allee' && Math.abs((v[col('bearingDeg')] as number) - 279.4) < 1)!;
    expect(west[col('skylineDeg')]).toBe(SKYLINE_TOWARD_TOWER_DEG);
    expect(Math.abs((west[col('fromLat')] as number) - LICHTENBERGER_BRUECKE.points[0]!.lat)).toBeLessThan(0.002);
    expect(LOW_PASS_CENTRE_DEG).toBeCloseTo(SKYLINE_TOWARD_TOWER_DEG + DISC_RADIUS_DEG, 1);
  });

  it('marks the windows the reference puts under 0.8 deg, and no others', () => {
    expect(rows.length).toBe(203);
    let marked = 0;
    for (const r of rows) {
      const low = isLowPass(appAltitude(r));
      if (low) marked++;
      // Within 0.1 deg of the line the two refraction formulas may fall on either side of it.
      if (Math.abs(r.refAltApparent - LOW_PASS_CENTRE_DEG) > 0.1) expect(low, `${r.point} ${r.body} ${r.peak} ref ${r.refAltApparent}`).toBe(r.refAltApparent < LOW_PASS_CENTRE_DEG);
    }
    const reference = rows.filter((r) => r.refAltApparent < LOW_PASS_CENTRE_DEG).length;
    // The audit counted 60 of 203; this fixture's run counts 61 (one window sits on the line).
    expect(reference).toBeGreaterThanOrEqual(58);
    expect(reference).toBeLessThanOrEqual(62);
    expect(Math.abs(marked - reference)).toBeLessThanOrEqual(2);
  });

  it("marks the audit's case: sued-mitte, 4 April 2027, 19:42, sun 0.14 deg up behind the tower's foot", () => {
    const r = rows.find((x) => x.point === 'sued-mitte' && x.body === 'sun' && x.peak.startsWith('2027-04-04T17:4'))!;
    expect(r.refAltApparent).toBeGreaterThan(0);
    expect(r.refAltApparent).toBeLessThan(0.3);
    expect(formatWhenDe(new Date(r.peak))).toMatch(/4\. Apr\.?, 19:4[12]$/);
    const alt = appAltitude(r);
    expect(isLowPass(alt)).toBe(true);
    expect(Math.abs(alt - r.refAltApparent)).toBeLessThan(0.1);
    expect(lowPassNote(alt)).toMatch(/^tief, Scheibenmitte 0,[012]° hoch · wahrscheinlich von Häusern verdeckt$/);
  });

  it('leaves a clear pass alone, and writes altitudes the German way', () => {
    const clear = rows.find((x) => x.refAltApparent > 1.5)!;
    expect(isLowPass(appAltitude(clear))).toBe(false);
    expect(formatAltitudeDe(0.14)).toBe('0,1°');
    expect(formatAltitudeDe(-0.33)).toBe('−0,3°');
    expect(formatAltitudeDe(-0.04)).toBe('0,0°');
    expect(formatAltitudeDe(1.26)).toBe('1,3°');
    expect(lowPassNote(-0.33)).toBe('tief, Scheibenmitte 0,3° unter dem Horizont · wahrscheinlich von Häusern verdeckt');
    expect(lowPassNote(0.5)).toBe('tief, Scheibenmitte 0,5° hoch · wahrscheinlich von Häusern verdeckt');
  });
});

describe('panel 05: times are Berlin time, wherever the browser is', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it.each(['America/New_York', 'Asia/Tokyo', 'Europe/Berlin', 'UTC'])('prints the same Berlin time with the device in %s', (deviceZone) => {
    process.env.TZ = deviceZone;
    // 28 March 2027 is the day the clocks go forward, 31 October the day they go back.
    const spring = new Date('2027-03-28T17:35:00Z');
    const autumn = new Date('2027-10-31T15:40:00Z');
    expect(formatWhenDe(spring)).toMatch(/^So\.?, 28\. März, 19:35$/);
    expect(berlinZoneName(spring)).toBe('MESZ');
    expect(formatWhenDe(autumn)).toMatch(/^So\.?, 31\. Okt\.?, 16:40$/);
    expect(berlinZoneName(autumn)).toBe('MEZ');
    // Either side of the spring change, and a time after midnight that is the day before in UTC.
    expect(berlinZoneName(new Date('2027-03-28T00:59:59Z'))).toBe('MEZ');
    expect(berlinZoneName(new Date('2027-03-28T01:00:00Z'))).toBe('MESZ');
    expect(formatWhenDe(new Date('2027-03-26T23:18:49Z'))).toMatch(/^Sa\.?, 27\. März, 00:18$/);
  });

  it('what the panel printed before, in the device zone, was hours off abroad', () => {
    process.env.TZ = 'America/New_York';
    const old = new Date('2027-03-28T17:35:00Z').toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    expect(old).toBe('13:35');
  });
});
