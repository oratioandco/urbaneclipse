"""
Audit D: the /plan/ date search (src/miniature/towerShots.js findShots, as dates.worker.js
calls it) against the reference, from nine spots across the city.

For every shot the app lists it asks the reference: where is the disc really, at the minute
the app shows (peak) and at its alignment instant (align)? "off" is the disc centre's
distance from the landmark's axis, on the sky and in metres at the landmark. The reference
bearing is a geodesic from the spot's true latitude and longitude; the app's is taken in
its flat scene, a transverse Mercator centred on the Fernsehturm.

It also runs the reference's own brute-force search (5 s) for the Fernsehturm's sphere and
antenna and reports the passes the app does not list, and the app's that do not happen.
Writes results/miniature.json.
"""
import json
import math
import os

import numpy as np

import reflib
from auditdata import START, END, app, coarse, iso, unix

HERE = os.path.dirname(__file__)
LM = {'fernsehturm': app['landmarks']['FERNSEHTURM'], 'siegessaeule': app['landmarks']['SIEGESSAEULE'], 'brandenburger-tor': app['landmarks']['BRANDENBURGER_TOR']}
TOWER = LM['fernsehturm']
SPHERE_C, SPHERE_R = 213.78, 16.0
sphere = dict(TOWER, profile=[[SPHERE_C - SPHERE_R + 32 * i / 64, math.sqrt(max(0.0, SPHERE_R ** 2 - (32 * i / 64 - SPHERE_R) ** 2))] for i in range(65)])
antenna = dict(TOWER, profile=[p for p in TOWER['profile'] if p[0] >= 229.78])


def grid_convergence_deg(lat, lon):
    """Angle from true north to the scene's grid north at a point (scene meridian = the tower's)."""
    return (lon - TOWER['lon']) * math.sin(math.radians(lat))


rows, spots_out = [], {}
for m in app['miniature']:
    s = m['spot']
    eye = s['groundM'] + 1.6
    sils = {k: reflib.Silhouette(s['lat'], s['lon'], eye, lm) for k, lm in LM.items()}
    sph = reflib.Silhouette(s['lat'], s['lon'], eye, sphere)
    info = {'convergenceDeg': grid_convergence_deg(s['lat'], s['lon']), 'targets': {}}
    for k, sil in sils.items():
        tx = next(t for t in app['targets'] if t['id'] == k)
        scene_bearing = math.degrees(math.atan2(tx['x'] - s['x'], -(tx['z'] - s['z']))) % 360
        info['targets'][k] = {'distanceM': sil.dist, 'trueBearingDeg': sil.bearing, 'sceneBearingDeg': scene_bearing, 'sceneMinusTrueDeg': float(reflib.wrap180(scene_bearing - sil.bearing)),
                              'sceneMinusTrueM': float(reflib.wrap180(scene_bearing - sil.bearing)) * math.pi / 180 * sil.dist}
    for shot in m['shots']:
        sil = sils[shot['target']]
        out = {'spot': s['id'], 'target': shot['target'], 'body': shot['body'], 'state': shot['state'], 'peak': shot['peak'], 'align': shot['align'], 'distanceM': sil.dist}
        for key in ('peak', 'align'):
            t = np.array([unix(shot[key])])
            az, _, alt, _, rad = reflib.body_altaz(t, s['lat'], s['lon'], eye + reflib.GEOID_N, shot['body'])
            d = float(reflib.wrap180(az[0] - sil.bearing))
            off = d * math.cos(math.radians(alt[0]))
            out[key + 'OffDeg'] = off
            out[key + 'OffM'] = off * math.pi / 180 * sil.dist
            out[key + 'Alt'] = float(alt[0])
            out[key + 'Covered'] = float(sil.covered_fraction(np.array([d]), alt, rad)[0])
            out[key + 'AppAzErr'] = None
            if key == 'peak':
                out['radiusDeg'] = float(rad[0])
                out['appAltMinusRef'] = shot['alt'] - float(alt[0])
                out['heightOnAxisAgl'] = float(sil.h_of(alt[0]))
                if shot['target'] == 'fernsehturm':
                    c_alt = sph.alt_of(SPHERE_C)
                    r_s = math.degrees(math.asin(SPHERE_R / math.hypot(sil.dist, 1)))
                    sep = math.hypot(off, alt[0] - c_alt)
                    out['sphereSepDeg'] = sep
                    out['sphereRadiusDeg'] = r_s
                    if sep + rad[0] <= r_s:
                        ref_state = 'hidden'
                    elif sep + r_s <= rad[0]:
                        ref_state = 'ring'
                    elif sep < r_s + rad[0]:
                        ref_state = 'edge'
                    elif out['peakCovered'] > 0 and alt[0] > sph.alt_of(229.78):
                        ref_state = 'antenna'
                    elif out['peakCovered'] > 0:
                        ref_state = 'shaft'
                    else:
                        ref_state = 'miss'
                    out['refState'] = ref_state
                    out['gapDeg'] = sep - r_s - rad[0] if ref_state not in ('hidden', 'ring', 'edge') else 0.0
        # The true instant the centre crosses the axis, by 1 s samples around the app's align.
        t0 = unix(shot['align'])
        tt = np.arange(t0 - 240, t0 + 241, 2.0)
        az, _, alt, _, _ = reflib.body_altaz(tt, s['lat'], s['lon'], eye + reflib.GEOID_N, shot['body'])
        d = reflib.wrap180(az - sil.bearing)
        sg = np.flatnonzero(np.sign(d[:-1]) != np.sign(d[1:]))
        if len(sg):
            i = int(sg[np.argmin(np.abs(tt[sg] - t0))])
            cross = float(tt[i] + 2.0 * d[i] / (d[i] - d[i + 1]))
            out['alignMinusRefS'] = t0 - cross
            out['peakMinusRefS'] = unix(shot['peak']) - cross
        rows.append(out)

    # The reference's own search for the tower: sphere touches, and antenna crossings.
    ref_events = []
    for body in ('sun', 'moon'):
        for part, lm in (('sphere', sphere), ('antenna', antenna)):
            if body == 'sun' and part == 'antenna':
                continue  # the app leaves the sun on the antenna out on purpose
            _, found = reflib.find_transits(s['lat'], s['lon'], eye, lm, body, START, END, coarse=coarse(body), min_alt=0.0)
            for f in found:
                if body == 'moon' and float(reflib.moon_fraction(np.array([f['peak']]))[0]) < 0.25:
                    continue
                ref_events.append(dict(f, part=part))
    app_tower = [x for x in m['shots'] if x['target'] == 'fernsehturm']
    missed = []
    for f in ref_events:
        if not any(x['body'] == f['body'] and unix(x['start']) - 900 <= f['peak'] <= unix(x['end']) + 900 for x in app_tower):
            missed.append({'body': f['body'], 'part': f['part'], 'peak': iso(f['peak']), 'coveredFraction': f['coveredFraction'], 'durationS': f['end'] - f['start'], 'alt': f['peakAlt'], 'offDeg': f['peakOffDeg']})
    phantom = [{'body': x['body'], 'state': x['state'], 'peak': x['peak']} for x in app_tower
               if not any(x['body'] == f['body'] and f['start'] - 900 <= unix(x['peak']) <= f['end'] + 900 for f in ref_events)]
    info.update({'appTowerShots': len(app_tower), 'refTowerEvents': len(ref_events), 'missedByApp': missed, 'notInReference': phantom})
    spots_out[s['id']] = info
    print(s['id'], 'conv', round(info['convergenceDeg'], 4), {k: (round(v['distanceM']), round(v['sceneMinusTrueDeg'], 4), round(v['sceneMinusTrueM'], 1)) for k, v in info['targets'].items()})
    print('   tower: app', len(app_tower), 'ref', len(ref_events), 'missed', len(missed), 'not in ref', len(phantom))
    for x in missed:
        print('     missed', x)
    for x in phantom:
        print('     phantom', x)

json.dump({'spots': spots_out, 'rows': rows}, open(os.path.join(HERE, 'results', 'miniature.json'), 'w'), indent=1)

print('\nper target: |peak off| deg, |align - true crossing| s, |shown minute - true crossing| s')
for tgt in LM:
    for body in ('sun', 'moon'):
        sel = [r for r in rows if r['target'] == tgt and r['body'] == body]
        if not sel:
            continue
        po = np.abs([r['peakOffDeg'] for r in sel])
        al = np.abs([r['alignMinusRefS'] for r in sel if 'alignMinusRefS' in r])
        pk = np.abs([r['peakMinusRefS'] for r in sel if 'peakMinusRefS' in r])
        print(f"{tgt:18s} {body:4s} n={len(sel):3d} peakOff med {np.median(po):.3f} p90 {np.percentile(po, 90):.3f} max {po.max():.3f} | align med {np.median(al):.0f} p90 {np.percentile(al, 90):.0f} max {al.max():.0f} | peak med {np.median(pk):.0f} p90 {np.percentile(pk, 90):.0f} max {pk.max():.0f} | zeroCover {sum(1 for r in sel if r['peakCovered'] == 0)}")
print('\ntower state: app vs reference')
from collections import Counter
print(Counter((r['body'], r['state'], r['refState']) for r in rows if r['target'] == 'fernsehturm'))
