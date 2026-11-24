"""
Sunrise, sunset, moonrise and moonset at the Fernsehturm on one Berlin day, from the audit's
reference (scripts/audit/reflib.py), to hold against the weather line and the moon header of
/plan/. Rise and set by the almanac's convention: the upper limb on a horizon with 34' of
refraction (centre at -0.833 deg for the sun; for the moon its own radius and parallax are in).

    <python with skyfield> scripts/adversarial/riseset.py 2026-11-24 [more days]
"""
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'audit'))
import reflib  # noqa: E402

BERLIN = ZoneInfo('Europe/Berlin')
LAT, LON, H = 52.520815, 13.409419, 36.0 + reflib.GEOID_N

for day in sys.argv[1:]:
    y, m, d = map(int, day.split('-'))
    start = datetime(y, m, d, tzinfo=BERLIN)
    end = (start + timedelta(days=1, hours=2)).replace(hour=0)
    ts = np.arange(start.timestamp(), end.timestamp(), 10.0)
    print(day)
    for body in ('sun', 'moon'):
        _, alt_true, _, _, radius = reflib.body_altaz(ts, LAT, LON, H, body)
        limb = alt_true + radius + 34 / 60  # upper limb, lifted by standard refraction
        for i in np.where(np.sign(limb[:-1]) != np.sign(limb[1:]))[0]:
            t = ts[i] + 10 * limb[i] / (limb[i] - limb[i + 1])
            print(f"  {body} {'rises' if limb[i + 1] > 0 else 'sets '} {datetime.fromtimestamp(t, BERLIN).strftime('%H:%M:%S')}")
