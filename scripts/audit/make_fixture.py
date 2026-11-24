"""
Writes tests/fixtures/accuracy-reference.json: the reference's answers that
tests/unit/accuracyAudit.test.ts holds the app to. Everything in it comes from Skyfield/DE421
and reflib's geometry; nothing from the app except the places and the landmark shapes.
Run compare_windows.py, compare_miniature.py and compare_streets_times.py first.
"""
import json
import os

import numpy as np

import reflib
from auditdata import START, END, app, coarse, iso, unix

HERE = os.path.dirname(__file__)
lm = app['landmarks']['FERNSEHTURM']
res = lambda name: json.load(open(os.path.join(HERE, 'results', name)))

# 1. Directions at chosen instants: both solstices and equinoxes, the clock changes, the named moon dates.
instants = ['2026-12-21T07:30:00Z', '2026-12-21T14:40:00Z', '2027-01-14T22:35:00Z', '2027-03-20T05:30:00Z', '2027-03-20T17:00:00Z', '2027-03-28T00:30:00Z',
            '2027-03-28T01:30:00Z', '2027-03-28T17:20:00Z', '2027-06-21T03:00:00Z', '2027-06-21T19:15:00Z', '2027-09-23T05:10:00Z', '2027-09-23T16:50:00Z',
            '2027-09-27T15:11:00Z', '2027-10-31T00:30:00Z', '2027-10-31T01:30:00Z', '2027-10-31T15:30:00Z', '2027-11-11T02:45:00Z', '2027-04-08T17:36:00Z']
t = np.array([unix(x) for x in instants])
directions = []
for body in ('sun', 'moon'):
    az, alt_true, alt_app, dist, rad = reflib.body_altaz(t, lm['lat'], lm['lon'], lm['baseOrthometric'] + reflib.GEOID_N, body)
    for i, when in enumerate(instants):
        directions.append({'body': body, 'utc': when, 'az': round(float(az[i]), 4), 'altAirless': round(float(alt_true[i]), 4), 'altApparent': round(float(alt_app[i]), 4), 'radiusDeg': round(float(rad[i]), 4)})
lit = reflib.moon_fraction(t)
moon_lit = [{'utc': w, 'fraction': round(float(f), 4)} for w, f in zip(instants, lit)]

# 2. Panel 05 from the bridge's "sued-mitte" point: every pass that covers at least 2 % of the disc with its centre above the horizon.
point = next(p['point'] for p in app['panel05'] if p['point']['id'] == 'sued-mitte')
eye = point['surfaceOrthometric'] + point['eyeHeightM']
passes = []
for body in ('sun', 'moon'):
    sil, found = reflib.find_transits(point['lat'], point['lon'], eye, lm, body, START, END, coarse=coarse(body))
    for f in found:
        if f['coveredFraction'] >= 0.02 and f['peakAlt'] > 0.3:
            passes.append({'body': body, 'start': iso(f['start']), 'end': iso(f['end']), 'peak': iso(f['peak']), 'coveredFraction': round(f['coveredFraction'], 3), 'peakAlt': round(f['peakAlt'], 3),
                           'axisCrossing': iso(f['cross']) if f['cross'] else None})
passes.sort(key=lambda p: p['peak'])
bridge = {'point': point['id'], 'bearingDeg': round(sil.bearing, 4), 'distanceM': round(sil.dist, 1), 'passes': passes}

# 3. The /plan/ date search from the same point: when the body's centre truly crosses the tower's axis.
mini = res('miniature.json')
crossings = []
for r in mini['rows']:
    if r['spot'].startswith('lichtenberger') and r['target'] == 'fernsehturm' and 'alignMinusRefS' in r and abs(r['alignMinusRefS']) < 30:
        crossings.append({'body': r['body'], 'state': r['state'], 'axisCrossing': iso(unix(r['align']) - r['alignMinusRefS'])})
spot = next(m['spot'] for m in app['miniature'] if m['spot']['id'].startswith('lichtenberger'))

# 4. Street bearings: the geodesic from each view's start to its end, for a spread of streets.
streets = []
for sp in app['streetPasses']:
    v = sp['view']
    dist, brg = reflib.vincenty_inverse(v['from']['lat'], v['from']['lon'], v['to']['lat'], v['to']['lon'])
    streets.append({'name': v['name'], 'from': v['from'], 'to': v['to'], 'geodesicBearingDeg': round(brg, 3), 'storedBearingDeg': v['bearingDeg']})

# 5. Day events.
st = res('streets_times.json')
days = []
for day, row in zip(app['dayTimes'], st['days']):
    tt = np.arange(unix(day['berlinMidnight']) + 12 * 3600, unix(day['berlinMidnight']) + 25 * 3600, 10.0)
    _, alt_true, _, _, _ = reflib.body_altaz(tt, lm['lat'], lm['lon'], 75.0, 'sun')
    i = int(np.flatnonzero((alt_true[:-1] > -4.0) & (alt_true[1:] <= -4.0))[0])
    minus4 = tt[i] + 10.0 * (alt_true[i] + 4.0) / (alt_true[i] - alt_true[i + 1])
    days.append({'day': day['day'], 'sunCentre4DegDownEvening': iso(minus4), 'sunrise': iso(unix(day['sun']['sunrise']) - row['suncalc_sunrise_minusRefS']), 'sunset': iso(unix(day['sun']['sunset']) - row['suncalc_sunset_minusRefS']),
                 'moonrise': row['refMoonrise'], 'moonset': row['refMoonset']})

# 6. The Siegessaeule from the "west" point: passes where the whole disc goes behind the column's hall, with the true axis crossing.
w = res('windows.json')
audited = {(c['body'], c['refPeak']): c['appPeakWhenAudited'] for c in json.load(open(os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'accuracy-reference.json'))).get('siegessaeuleWestFullCover', [])}
column = [{'body': r['body'], 'appPeakWhenAudited': audited.get((r['body'], r['refPeak']), r['appPeak']), 'refPeak': r['refPeak'], 'refCovered': round(r['refCovered'], 3),
           'refAxisCrossing': r['refAxisCrossing'], 'refPlateauStart': r['refPlateauStart'], 'refPlateauEnd': r['refPlateauEnd']} for r in w['rows']
          if r['set'].startswith('preview') and r['point'] == 'west' and r['refCovered'] > 0.999]

# 7. Panel 05, all six bridge points: how high the reference puts the disc's centre (apparent, Bennett) at the
#    moment of each listed window. The instant is the app's listed peak; the altitude is the reference's alone.
#    Defect 3: the list must mark the ones the skyline probably hides (centre under 0.8 deg).
altitudes = [{'point': r['point'], 'body': r['body'], 'peak': r['appPeak'], 'refAltApparent': round(r['refAltAtAppPeak'], 3)} for r in w['rows'] if r['set'].startswith('panel05')]

out = {
    'source': 'Skyfield 1.55 with JPL DE421, topocentric apparent places; Bennett refraction at 10 degC / 1010 mbar; WGS84 geodesics (Vincenty). scripts/audit/make_fixture.py',
    'observer': {'lat': lm['lat'], 'lon': lm['lon']},
    'directions': directions, 'moonLit': moon_lit, 'bridge': bridge,
    'miniatureBridge': {'spot': {'lat': spot['lat'], 'lon': spot['lon'], 'eyeOrthometric': spot['groundM'] + 1.6, 'towerBaseOrthometric': lm['baseOrthometric']}, 'crossings': crossings},
    'streets': streets, 'days': days, 'siegessaeuleWestFullCover': column, 'bridgeWindowAltitudes': altitudes,
}
path = os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'accuracy-reference.json')
json.dump(out, open(path, 'w'), indent=1, ensure_ascii=False)
print(len(directions), 'directions', len(passes), 'bridge passes', len(crossings), 'crossings', len(streets), 'streets', len(days), 'days', len(column), 'column passes', len(altitudes), 'bridge window altitudes,', sum(a['refAltApparent'] < 0.8 for a in altitudes), 'under 0.8 deg,', sum(a['refAltApparent'] < 0.5 for a in altitudes), 'under 0.5 deg')
