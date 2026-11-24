"""
Audit E and F: street bearings and henge times, sunrise and sunset, light phases, moonrise.

Streets: every stored bearing in public/streets/berlin.json against the geodesic from the
view's `from` to its `to`; then, for the dumped passes, where the reference puts the body
at the minute the app shows.
Times: on the solstices, equinoxes, both clock changes and the two named moon dates.
Writes results/streets_times.json.
"""
import json
import math
import os

import numpy as np

import reflib
from auditdata import app, iso, unix

HERE = os.path.dirname(__file__)
out = {}

# --- street bearings
d = []
for v in app['streetViews']:
    dist, brg = reflib.vincenty_inverse(v['from']['lat'], v['from']['lon'], v['to']['lat'], v['to']['lon'])
    d.append((float(reflib.wrap180(v['bearingDeg'] - brg)), dist - v['lengthM'], v['name'], v['lengthM'], v['toleranceDeg']))
db = np.array([x[0] for x in d])
out['streetBearings'] = {'n': len(d), 'meanDeg': float(db.mean()), 'rmsDeg': float(np.sqrt((db ** 2).mean())), 'maxAbsDeg': float(np.abs(db).max()),
                         'over0p1deg': int((np.abs(db) > 0.1).sum()), 'over0p25deg': int((np.abs(db) > 0.25).sum()),
                         'worst': [dict(name=x[2], storedMinusGeodesicDeg=x[0], lengthM=x[3], toleranceDeg=x[4]) for x in sorted(d, key=lambda x: -abs(x[0]))[:8]]}
print('street bearings', {k: v for k, v in out['streetBearings'].items() if k != 'worst'})
for w in out['streetBearings']['worst']:
    print('   ', w)

# --- street passes
rows = []
for sp in app['streetPasses']:
    v = sp['view']
    _, brg = reflib.vincenty_inverse(v['from']['lat'], v['from']['lon'], v['to']['lat'], v['to']['lon'])
    for body in ('sun', 'moon'):
        for p in sp[body]:
            t0 = unix(p['peak'])
            tt = np.arange(t0 - 180, t0 + 181, 2.0)
            az, _, alt, _, rad = reflib.body_altaz(tt, v['from']['lat'], v['from']['lon'], 75.0, body)
            dd = reflib.wrap180(az - v['bearingDeg'])
            i0 = len(tt) // 2
            sg = np.flatnonzero(np.sign(dd[:-1]) != np.sign(dd[1:]))
            cross = float(tt[sg[0]] + 2.0 * dd[sg[0]] / (dd[sg[0]] - dd[sg[0] + 1])) if len(sg) else None
            rows.append({'street': v['name'], 'bearingDeg': v['bearingDeg'], 'body': body, 'peak': p['peak'], 'appOffAxisDeg': p['offAxisDeg'], 'refOffAxisDeg': float(dd[i0]),
                         'appAlt': p['bodyAlt'], 'refAlt': float(alt[i0]), 'aboveSkylineDeg': float(alt[i0]) - v['skylineDeg'], 'toleranceDeg': v['toleranceDeg'],
                         'shownMinusCrossS': (t0 - cross) if cross else None, 'storedMinusGeodesicDeg': float(reflib.wrap180(v['bearingDeg'] - brg))})
for body in ('sun', 'moon'):
    sel = [r for r in rows if r['body'] == body]
    if sel:
        az = np.abs([r['refOffAxisDeg'] - (r['appOffAxisDeg'] if abs(r['refOffAxisDeg'] - r['appOffAxisDeg']) < abs(r['refOffAxisDeg'] + r['appOffAxisDeg']) else -r['appOffAxisDeg']) for r in sel])
        al = np.abs([r['appAlt'] - r['refAlt'] for r in sel])
        cr = np.abs([r['shownMinusCrossS'] for r in sel if r['shownMinusCrossS'] is not None])
        s = {'n': len(sel), 'azErrMaxDeg': float(az.max()), 'altErrMedianDeg': float(np.median(al)), 'altErrMaxDeg': float(al.max()),
             'shownMinusAxisCrossingS': {'median': float(np.median(cr)), 'p90': float(np.percentile(cr, 90)), 'max': float(cr.max()), 'withCrossing': int(len(cr))},
             'refOutsideTolerance': int(sum(abs(r['refOffAxisDeg']) > r['toleranceDeg'] + 0.02 for r in sel))}
        out[f'streetPasses_{body}'] = s
        print('street passes', body, s)
out['streetPassRows'] = rows


# --- sun times
def crossing(t, y, level, rising):
    s = (y[:-1] - level) * (y[1:] - level) <= 0
    idx = [i for i in np.flatnonzero(s) if (y[i + 1] > y[i]) == rising]
    return [float(t[i] + (t[i + 1] - t[i]) * (level - y[i]) / (y[i + 1] - y[i])) for i in idx]


lm = app['landmarks']['FERNSEHTURM']
days = []
for day in app['dayTimes']:
    t0 = unix(day['berlinMidnight'])
    t = np.arange(t0, t0 + 25 * 3600 + 1, 10.0)
    az, alt_true, alt_app, _, rad = reflib.body_altaz(t, lm['lat'], lm['lon'], 75.0, 'sun')
    ref = {
        'sunrise': crossing(t, alt_true, -0.8333, True)[:1], 'sunset': crossing(t, alt_true, -0.8333, False)[:1],
        'centreOnHorizonRise': crossing(t, alt_app, 0.0, True)[:1], 'centreOnHorizonSet': crossing(t, alt_app, 0.0, False)[:1],
        'goldenMorningEnd_6': crossing(t, alt_app, 6.0, True)[:1], 'goldenEveningStart_6': crossing(t, alt_app, 6.0, False)[:1],
        'goldenToBlueEvening_minus4_true': crossing(t, alt_true, -4.0, False)[:1], 'blueToTwilightEvening_minus8_true': crossing(t, alt_true, -8.0, False)[:1],
        'twilightToNightEvening_minus12_true': crossing(t, alt_true, -12.0, False)[:1],
    }
    row = {'day': day['day']}
    for name, key in (('sunrise', 'sunrise'), ('sunset', 'sunset')):
        if ref[name]:
            row[f'suncalc_{name}_minusRefS'] = unix(day['sun'][key]) - ref[name][0]
    if ref['sunrise'] and day['weatherLine']['rise']:
        row['weatherLine_sunrise_minusRefS'] = unix(day['weatherLine']['rise']) - ref['sunrise'][0]
    if ref['sunset'] and day['weatherLine']['set']:
        row['weatherLine_sunset_minusRefS'] = unix(day['weatherLine']['set']) - ref['sunset'][0]
    # Evening band edges as the app draws them (1-minute samples).
    b = [x for x in day['bands'] if unix(x['to']) > t0 + 12 * 3600]
    edge = lambda a, c: next((unix(x['to']) for x, y in zip(b, b[1:]) if x['phase'] == a and y['phase'] == c), None)
    for a, c, key in (('day', 'golden', 'goldenEveningStart_6'), ('golden', 'blue', 'goldenToBlueEvening_minus4_true'), ('blue', 'twilight', 'blueToTwilightEvening_minus8_true'), ('twilight', 'night', 'twilightToNightEvening_minus12_true')):
        e = edge(a, c)
        if e is not None and ref[key]:
            row[f'band_{a}_to_{c}_minusRefS'] = e - ref[key][0]
        elif e is None and ref[key]:
            row[f'band_{a}_to_{c}_minusRefS'] = 'app has no such edge'
        elif e is not None:
            row[f'band_{a}_to_{c}_minusRefS'] = 'reference: sun never gets that low'
    # Moonrise and moonset: upper limb on the horizon with 34 arcmin of refraction.
    azm, altm_true, _, _, radm = reflib.body_altaz(t, lm['lat'], lm['lon'], 75.0, 'moon')
    limb = altm_true + radm + 34 / 60
    mr, ms = crossing(t, limb, 0.0, True), crossing(t, limb, 0.0, False)
    row['refMoonrise'] = [iso(x) for x in mr]
    row['refMoonset'] = [iso(x) for x in ms]
    row['suncalcMoon'] = day['moon']
    for key, refs in (('rise', mr), ('set', ms)):
        if day['moon'].get(key):
            near = min(refs, key=lambda x: abs(x - unix(day['moon'][key])), default=None)
            row[f'moon{key}_minusNearestRefS'] = (unix(day['moon'][key]) - near) if near is not None else 'not in this Berlin day'
    # The Berlin day's own rises and sets (lib/moonTimes.ts, since the fix of defect 13) against the reference's.
    t1 = unix(day['berlinMidnightNext'])
    mine = day.get('berlinDayMoon')
    if mine:
        for key, refs, found in (('rises', mr, mine['rises']), ('sets', ms, mine['sets'])):
            inday = [x for x in refs if t0 <= x < t1]
            row[f'berlinDay_{key}_refCount'] = len(inday)
            row[f'berlinDay_{key}_appCount'] = len(found)
            row[f'berlinDay_{key}_maxAbsS'] = max((min(abs(unix(f) - x) for f in found) for x in inday), default=0.0) if found or not inday else 'missed'
    for key, refs in (('rise', mr), ('set', ms)):
        inday = [x for x in refs if t0 <= x < t1]
        shown = day['moon'].get(key)
        row[f'headerBefore_{key}'] = 'ok' if (not inday and not shown) or (inday and shown and min(abs(unix(shown) - x) for x in inday) < 120) else ('missed' if inday else 'shows one from another day')
    days.append(row)
    print(json.dumps(row))
out['days'] = days
json.dump(out, open(os.path.join(HERE, 'results', 'streets_times.json'), 'w'), indent=1)
