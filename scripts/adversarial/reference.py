"""
Checks what /plan/ showed (accuracy-shots.json, written by accuracy.mjs) against the accuracy
audit's reference, scripts/audit/reflib.py: Skyfield with JPL DE421, Bennett refraction, WGS84
geodesics. Nothing here calls the app's code. Needs Python with skyfield and the DE421 kernel in
data/audit/ (see scripts/audit/run.sh).

    <python with skyfield> scripts/adversarial/reference.py <OUT>/accuracy-shots.json

For every shot that was opened it takes the instant the page then showed (its date and clock,
read as Berlin wall time) and the spot in the address, and reports where the sun or moon really
is: off the landmark's axis (degrees on the sky, metres at the landmark, and seconds until the
axis is crossed), against the sphere or antenna, against the street's bearing, and the altitude
against the row's "N° up". Writes accuracy-reference.json and a table beside the input.
"""
import json
import math
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'audit'))
import reflib  # noqa: E402

BERLIN = ZoneInfo('Europe/Berlin')
TOWER = dict(lat=52.520815, lon=13.409419, base=34.6)
SPHERE_C, SPHERE_R, SPHERE_TOP, TIP = 213.78, 16.0, 229.78, 368.03
GROUND = 36.0  # the eye's ground, metres above sea level: within a few metres anywhere in the model
EYE = GROUND + 1.6 + reflib.GEOID_N


def instant(date, clock, slider):
    """Unix seconds of the wall-clock time the page shows on that Berlin day."""
    m = re.match(r'(\d+):(\d+)(?::(\d+))?\s*([AP]M)?', clock.replace(' ', ' '))
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if m.group(4):
        h = h % 12 + (12 if m.group(4) == 'PM' else 0)
    y, mo, d = map(int, date.split('-'))
    return datetime(y, mo, d, h, mi, s, tzinfo=BERLIN).timestamp(), (h * 60 + mi + s / 60)


def clock_minutes(text):
    m = re.match(r'(\d+):(\d+)\s*([AP]M)?', text.replace(' ', ' '))
    h = int(m.group(1))
    if m.group(3):
        h = h % 12 + (12 if m.group(3) == 'PM' else 0)
    return h * 60 + int(m.group(2))


def body_at(t, lat, lon, body):
    az, _, alt, _, rad = reflib.body_altaz(np.atleast_1d(np.array(t, dtype=float)), lat, lon, EYE, body)
    return az, alt, rad


def check(kind, row, after, source):
    lat, lon = after['at']
    t, wall = instant(after['dateInput'], after['clock'], after['slider'])
    body = row['body']
    az, alt, rad = body_at(t, lat, lon, body)
    az, alt, rad = float(az[0]), float(alt[0]), float(rad[0])
    out = {
        'source': source,
        'row': f"{row.get('time') or row['title']} {row.get('title', '') if row.get('time') else ''} | {row.get('detail', '')}".strip(),
        'body': body,
        'shown': f"{after['dateInput']} {after['clock']}",
        'utc': datetime.utcfromtimestamp(t).isoformat() + 'Z',
        'spot': [lat, lon],
        'refAz': round(az, 3),
        'refAlt': round(alt, 3),
        'discRadius': round(rad, 3),
        'facingShown': after['facing'],
        'headingMinusRefAz': round(float(reflib.wrap180(after['heading'] - az)), 2),
        'statusShown': after['eclipse'],
    }
    # The clock against the slider and the address: one time, three places.
    out['sliderMinusClockS'] = round((after['slider'] - wall) * 60, 1)
    out['urlMinusClockS'] = round((after['urlTime'] - wall) * 60, 1)
    row_time = row.get('time') or row['title'].split('·')[-1].strip()
    out['rowTime'] = row_time
    out['clockMinusRowS'] = round((wall - clock_minutes(row_time)) * 60)
    up = re.search(r'(-?\d+)° up', row.get('detail', ''))
    if up:
        # The row's altitude is for the row's own minute.
        t_row = t - out['clockMinusRowS']
        _, alt_row, _ = body_at(t_row, lat, lon, body)
        out['rowAlt'] = int(up.group(1))
        out['refAltAtRowTime'] = round(float(alt_row[0]), 2)
    if kind == 'tower':
        dist, bearing = reflib.vincenty_inverse(lat, lon, TOWER['lat'], TOWER['lon'])
        elev = lambda h: reflib.elevation_to(lat, lon, EYE, TOWER['lat'], TOWER['lon'], TOWER['base'] + h + reflib.GEOID_N)[0]
        off = float(reflib.wrap180(az - bearing)) * math.cos(math.radians(alt))
        r_sphere = math.degrees(math.asin(SPHERE_R / dist))
        sep = math.hypot(off, alt - elev(SPHERE_C))
        out.update(
            distanceM=round(dist),
            bearingToTower=round(bearing, 3),
            offAxisDeg=round(off, 3),
            offAxisM=round(off * math.pi / 180 * dist, 1),
            sphereCentreAlt=round(elev(SPHERE_C), 3),
            sphereRadius=round(r_sphere, 3),
            sepFromSphereCentre=round(sep, 3),
            antennaAlt=[round(elev(SPHERE_TOP), 2), round(elev(TIP), 2)],
        )
        if sep + rad <= r_sphere:
            state = 'disc wholly behind the sphere'
        elif sep + r_sphere <= rad:
            state = 'sphere wholly inside the disc (ring)'
        elif sep < r_sphere + rad:
            state = 'disc overlaps the sphere'
        elif abs(off) < rad and elev(SPHERE_TOP) - rad < alt < elev(TIP) + rad:
            state = 'disc on the antenna'
        elif abs(off) < rad + 0.08 and alt < elev(SPHERE_C):
            state = 'disc on the shaft, below the sphere'
        else:
            state = 'disc clear of the tower'
        out['refState'] = state
        # When does the disc's centre cross the tower's axis?
        ts = t + np.arange(-45 * 60, 45 * 60 + 1, 5.0)
        azs, alts, _ = body_at(ts, lat, lon, body)
        d = reflib.wrap180(azs - bearing)
        cross = np.where(np.sign(d[:-1]) != np.sign(d[1:]))[0]
        if len(cross):
            i = cross[np.argmin(np.abs(ts[cross] - t))]
            tc = ts[i] + 5 * d[i] / (d[i] - d[i + 1])
            out['axisCrossingMinusShownS'] = round(float(tc - t))
            out['altAtCrossing'] = round(float(alts[i]), 2)
            out['crossingLocal'] = datetime.fromtimestamp(float(tc), BERLIN).strftime('%H:%M:%S')
        m = re.search(r'([\d.]+) (k?m)\+? (\w+) of the tower|([\d.]+) (k?m)\+? (\w+)$', row.get('detail', ''))
        if m:
            out['rowStand'] = m.group(0)
            out['refStand'] = f"{dist / 1000:.2f} km, bearing from tower {(bearing + 180) % 360:.0f}°"
    else:
        street = after['look'][0]
        out['streetBearingShown'] = street
        out['refAzMinusStreet'] = round(float(reflib.wrap180(az - street)), 2)
    return out


path = sys.argv[1]
data = json.load(open(path))
results = []
for day in data['dayList']:
    for o in day['opened']:
        if o['after']['at']:
            results.append(check(o['row']['kind'], o['row'], o['after'], f"day list {day['date']}"))
for o in data.get('dates', []):
    if o['after']['at']:
        kind = 'street' if o['row']['heading'].lower().startswith('down ') else 'tower'
        results.append(check(kind, o['row'], o['after'], f"dates from {data.get('datesSpot')}"))

out = os.path.join(os.path.dirname(path), 'accuracy-reference.json')
json.dump(results, open(out, 'w'), indent=1, ensure_ascii=False)
for r in results:
    print(f"\n{r['source']} | {r['row']}")
    print(f"  shown {r['shown']} (clock - row {r['clockMinusRowS']} s; slider - clock {r['sliderMinusClockS']} s; address - clock {r['urlMinusClockS']} s)")
    print(f"  reference: {r['body']} az {r['refAz']}  alt {r['refAlt']}  | facing shown: {r['facingShown']} (heading - az {r['headingMinusRefAz']}°) | row alt {r.get('rowAlt')} vs ref at row time {r.get('refAltAtRowTime')}")
    if 'offAxisDeg' in r:
        print(f"  tower: {r['distanceM']} m, bearing {r['bearingToTower']}; off axis {r['offAxisDeg']}° = {r['offAxisM']} m; sphere centre at {r['sphereCentreAlt']}°, r {r['sphereRadius']}°, disc r {r['discRadius']}°, sep {r['sepFromSphereCentre']}°, antenna {r['antennaAlt']}")
        print(f"  reference says: {r['refState']} | page says: {r['statusShown']} | axis crossing {r.get('axisCrossingMinusShownS')} s after shown ({r.get('crossingLocal')}, alt {r.get('altAtCrossing')})")
        if 'rowStand' in r:
            print(f"  stand: row '{r['rowStand']}' vs reference {r['refStand']}")
    else:
        print(f"  street bearing shown {r['streetBearingShown']}°; body az minus street {r['refAzMinusStreet']}°")
print('\nwrote', out)
