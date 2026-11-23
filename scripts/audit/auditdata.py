"""The app's dumped answers (data/audit/app.json) and the year's coarse reference sweep, shared by the comparisons."""
import json
import os

import numpy as np

import reflib

app = json.load(open(os.path.join(reflib.CACHE, 'app.json')))
unix = lambda iso: float(np.datetime64(iso.replace('Z', '')).astype('datetime64[ms]').astype(float) / 1000)
START, END = unix(app['range'][0]), unix(app['range'][1])
iso = lambda s: str(np.datetime64(int(round(s)), 's')) + 'Z'


def coarse(body):
    """One 60 s sweep of the year per body at the Fernsehturm: across the city the direction differs by under 0.1 deg, and it only gates the 5 s search (1.5 deg wide)."""
    path = os.path.join(reflib.CACHE, f'coarse_{body}.npz')
    if os.path.exists(path):
        z = np.load(path)
        return z['t'], z['az'], z['alt']
    t = np.arange(START, END, 60.0)
    lm = app['landmarks']['FERNSEHTURM']
    az, _, alt, _, _ = reflib.body_altaz(t, lm['lat'], lm['lon'], 75.0, body)
    np.savez(path, t=t, az=az, alt=alt)
    return t, az, alt
