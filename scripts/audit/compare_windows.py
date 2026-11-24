"""
Audit B and C: panel 05's calendars (Lichtenberger Bruecke -> Fernsehturm, and the
Strasse des 17. Juni -> Siegessaeule preview) against a brute-force reference: Skyfield
positions every 5 s wherever a body is within 1.5 deg of the landmark, and the share of its
disc behind the landmark's outline counted on 4,500 points of the disc.

Writes results/windows.json. Times are compared in seconds; "off" is where the disc's
centre sits beside the axis at the app's peak, in degrees and in metres at the landmark.
"""
import json
import math
import os

import numpy as np

import reflib

from auditdata import START, END, app, coarse, iso, unix

HERE = os.path.dirname(__file__)


def compare(entries, landmark, label):
    rows, summary = [], {}
    for entry in entries:
        p = entry['point']
        eye = p['surfaceOrthometric'] + p['eyeHeightM']
        ref = []
        for body in ('sun', 'moon'):
            sil, found = reflib.find_transits(p['lat'], p['lon'], eye, landmark, body, START, END, coarse=coarse(body))
            ref += found
        used = set()
        per = {'point': p['id'], 'distanceM': sil.dist, 'bearingDeg': sil.bearing, 'appBearingDeg': p['bearingToLandmarkDeg'], 'appDistanceM': p['distanceToLandmarkM'],
               'altBaseDeg': sil.alt_min, 'altTopDeg': sil.alt_max, 'app': len(entry['windows']), 'ref': len(ref), 'matched': 0, 'appOnly': [], 'refOnly': []}
        for w in entry['windows']:
            tp = unix(w['peak'])
            best = None
            for i, r in enumerate(ref):
                if r['body'] == w['body'] and i not in used and r['start'] - 1800 <= tp <= r['end'] + 1800:
                    if best is None or abs(r['peak'] - tp) < abs(ref[best]['peak'] - tp):
                        best = i
            if best is None:
                per['appOnly'].append({'body': w['body'], 'peak': w['peak'], 'coveredFraction': w['coveredFraction']})
                continue
            used.add(best)
            r = ref[best]
            per['matched'] += 1
            # Where the reference puts the disc at the app's own peak instant.
            az, _, alt, _, rad = reflib.body_altaz(np.array([tp]), p['lat'], p['lon'], eye + reflib.GEOID_N, w['body'])
            off = float(reflib.wrap180(az[0] - sil.bearing) * math.cos(math.radians(alt[0])))
            rows.append({
                'set': label, 'point': p['id'], 'body': w['body'], 'appPeak': w['peak'], 'refPeak': iso(r['peak']),
                'dPeakS': tp - r['peak'], 'dStartS': unix(w['start']) - r['start'], 'dEndS': unix(w['end']) - r['end'],
                'refDurationS': r['end'] - r['start'], 'appCovered': w['coveredFraction'], 'refCovered': r['coveredFraction'],
                'refCoveredAtAppPeak': float(sil.covered_fraction(np.array([reflib.wrap180(az[0] - sil.bearing)]), alt, rad)[0]),
                'offAtAppPeakDeg': off, 'offAtAppPeakM': off * math.pi / 180 * sil.dist, 'refAltAtAppPeak': float(alt[0]),
                'refCrossHeightAgl': r['crossHeightAgl'],
                'refAxisCrossing': iso(r['cross']) if r['cross'] else None, 'refPlateauStart': iso(r['plateauStart']), 'refPlateauEnd': iso(r['plateauEnd']),
                'dPeakFromAxisCrossingS': (tp - r['cross']) if r['cross'] else None,
            })
        for i, r in enumerate(ref):
            if i not in used:
                per['refOnly'].append({'body': r['body'], 'peak': iso(r['peak']), 'coveredFraction': r['coveredFraction'], 'durationS': r['end'] - r['start'], 'peakAlt': r['peakAlt'], 'offDeg': r['peakOffDeg']})
        summary[p['id']] = per
    return rows, summary


out = {}
allrows = []
for label, entries, lm in (('panel05-fernsehturm', app['panel05'], app['landmarks']['FERNSEHTURM']), ('preview-siegessaeule', app['siegessaeule'], app['landmarks']['SIEGESSAEULE'])):
    rows, summary = compare(entries, lm, label)
    allrows += rows
    stat = {}
    for body in ('sun', 'moon'):
        sel = [r for r in rows if r['body'] == body]
        if not sel:
            continue
        q = lambda key: np.array([r[key] for r in sel])
        stat[body] = {
            'n': len(sel),
            'peakAbsS': {'median': float(np.median(np.abs(q('dPeakS')))), 'p90': float(np.percentile(np.abs(q('dPeakS')), 90)), 'max': float(np.abs(q('dPeakS')).max())},
            'startAbsS': {'median': float(np.median(np.abs(q('dStartS')))), 'max': float(np.abs(q('dStartS')).max())},
            'endAbsS': {'median': float(np.median(np.abs(q('dEndS')))), 'max': float(np.abs(q('dEndS')).max())},
            'offAtAppPeakDeg': {'median': float(np.median(np.abs(q('offAtAppPeakDeg')))), 'max': float(np.abs(q('offAtAppPeakDeg')).max())},
            'coveredDiff': {'median': float(np.median(np.abs(q('appCovered') - q('refCovered')))), 'max': float(np.abs(q('appCovered') - q('refCovered')).max())},
            'refDurationS': {'median': float(np.median(q('refDurationS'))), 'min': float(q('refDurationS').min()), 'max': float(q('refDurationS').max())},
        }
    out[label] = {'stats': stat, 'points': summary}
    print(label)
    for body, s in stat.items():
        print(' ', body, json.dumps(s))
    for pid, per in summary.items():
        print(f"  {pid}: app {per['app']} ref {per['ref']} matched {per['matched']} appOnly {len(per['appOnly'])} refOnly {len(per['refOnly'])} | bearing app {per['appBearingDeg']:.4f} ref {per['bearingDeg']:.4f} dist app {per['appDistanceM']:.1f} ref {per['distanceM']:.1f}")
        for x in per['appOnly']:
            print('     app only', x)
        for x in per['refOnly']:
            print('     ref only', x)
out['rows'] = allrows
json.dump(out, open(os.path.join(HERE, 'results', 'windows.json'), 'w'), indent=1)
