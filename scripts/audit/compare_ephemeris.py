"""
Audit A: the app's sun and moon directions (suncalc through sampleBody) against Skyfield/DE421,
every 10 minutes for a year at the Fernsehturm. Writes results/ephemeris.json.

An azimuth error is given on the sky (times cos altitude), which is what moves a disc
sideways against a landmark. 0.25 deg/min is a typical azimuth rate near the horizon in
Berlin, so 0.01 deg is about 2.4 s of transit time.
"""
import json
import os

import numpy as np

import reflib

HERE = os.path.dirname(__file__)
app = json.load(open(os.path.join(reflib.CACHE, 'app.json')))
e = app['ephem']
n = len(e['sun'])
t0 = np.datetime64(e['start'].replace('Z', '')).astype('datetime64[s]').astype(float)
t = t0 + np.arange(n) * e['stepMin'] * 60.0
H = app['landmarks']['FERNSEHTURM']['baseOrthometric'] + reflib.GEOID_N


def stats(x):
    x = np.asarray(x)
    return {'n': int(x.size), 'mean': float(x.mean()), 'rms': float(np.sqrt((x ** 2).mean())), 'p99abs': float(np.percentile(np.abs(x), 99)), 'maxabs': float(np.abs(x).max())}


out = {}
for body in ('sun', 'moon'):
    a = np.array(e[body])
    az, alt_true, alt_app, dist, radius = reflib.body_altaz(t, e['lat'], e['lon'], H, body)
    daz = reflib.wrap180(a[:, 0] - az) * np.cos(np.radians(alt_app))
    dalt = a[:, 1] - alt_app
    app_radius = np.degrees(np.arcsin((reflib.SUN_RADIUS_KM if body == 'sun' else reflib.MOON_RADIUS_KM) / a[:, 2]))
    res = {}
    for name, lo, hi in (('horizon_0_to_5', 0, 5), ('low_5_to_20', 5, 20), ('high_above_20', 20, 90), ('below_minus1_to_0', -1, 0), ('twilight_minus12_to_minus1', -12, -1)):
        m = (alt_app >= lo) & (alt_app < hi)
        if m.sum():
            res[name] = {'azOnSkyDeg': stats(daz[m]), 'altDeg': stats(dalt[m]), 'discRadiusDeg': stats((app_radius - radius)[m])}
    worst = int(np.argmax(np.where((alt_app > 0) & (alt_app < 20), np.abs(daz), 0)))
    res['worstLowAz'] = {'utc': str(np.datetime64(int(t[worst]), 's')), 'appAz': float(a[worst, 0]), 'refAz': float(az[worst]), 'alt': float(alt_app[worst])}
    out[body] = res

lit = np.array(e['lit'])
ref_lit = reflib.moon_fraction(t)
out['moonIlluminatedFraction'] = stats(lit - ref_lit)

# How much the weather moves the low sun: refraction at a cold high and a hot low against standard.
alts = np.array([0.0, 0.5, 1.0, 2.0, 3.5, 5.0, 10.0])
std = reflib.refract(alts, 10.0, 1010.0) - alts
out['refractionSensitivity'] = {
    'altDeg': alts.tolist(),
    'standardDeg': std.tolist(),
    'winterHigh_minus10C_1035mbar': (reflib.refract(alts, -10.0, 1035.0) - alts - std).tolist(),
    'summerLow_30C_995mbar': (reflib.refract(alts, 30.0, 995.0) - alts - std).tolist(),
}

os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
json.dump(out, open(os.path.join(HERE, 'results', 'ephemeris.json'), 'w'), indent=1)
for body in ('sun', 'moon'):
    for k, v in out[body].items():
        if k != 'worstLowAz':
            print(f"{body:4s} {k:28s} az rms {v['azOnSkyDeg']['rms']:.4f} max {v['azOnSkyDeg']['maxabs']:.4f} | alt mean {v['altDeg']['mean']:+.4f} rms {v['altDeg']['rms']:.4f} max {v['altDeg']['maxabs']:.4f} | radius max {v['discRadiusDeg']['maxabs']:.4f}")
    print(body, out[body]['worstLowAz'])
print('moon lit fraction', out['moonIlluminatedFraction'])
print('refraction', out['refractionSensitivity'])
