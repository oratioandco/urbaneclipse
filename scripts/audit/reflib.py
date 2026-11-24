"""
Independent reference for the accuracy audit. Shares no code with the app.

Ephemeris: Skyfield with JPL DE421 (downloaded on first use to data/audit/, 17 MB).
Positions are topocentric and apparent (light time, aberration, deflection, nutation,
polar motion ignored), with Skyfield's delta-T and leap-second tables.
Refraction: Bennett's formula as implemented in skyfield.earthlib.refract at 10 degC and
1010 mbar (the "standard atmosphere" most almanacs use). The app uses Saemundsson's
inverse (Meeus 16.4); the two agree to a few arcseconds above 0 deg.
Geometry: WGS84. Bearings and distances by Vincenty's inverse formula (a geodesic), the
elevation of a landmark point by ECEF -> local ENU, so the earth's curvature is in. No
terrestrial refraction unless asked (k = 0.13 lifts a point 6.1 km away by 0.004 deg).
"""
from __future__ import annotations

import math
import os

import numpy as np
from skyfield.api import Loader, wgs84
from skyfield.earthlib import refract

CACHE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'audit')
os.makedirs(CACHE, exist_ok=True)
_load = Loader(CACHE, verbose=False)
TS = _load.timescale()
EPH = _load('de421.bsp')
EARTH, SUN, MOON = EPH['earth'], EPH['sun'], EPH['moon']
SUN_RADIUS_KM = 695_700.0
MOON_RADIUS_KM = 1_737.4
GEOID_N = 39.3  # GCG2016 around central Berlin, metres. Cancels in every relative height.

A = 6378137.0
F = 1 / 298.257223563
B = A * (1 - F)
E2 = F * (2 - F)


def ts_from_unix(seconds: np.ndarray):
    """Skyfield times from Unix seconds (UTC)."""
    # Whole days go in as calendar days and only the rest as seconds: handing Skyfield all the
    # seconds since 1970 makes it count the 27 leap seconds since then, which Unix time skips.
    seconds = np.asarray(seconds, dtype=float)
    days = np.floor(seconds / 86400.0)
    return TS.utc(1970, 1, 1 + days, 0, 0, seconds - days * 86400.0)


def body_altaz(unix_s, lat, lon, height_m, body: str, temperature_c=10.0, pressure_mbar=1010.0):
    """az (deg, from true north), airless alt, apparent alt, distance km, angular radius deg."""
    t = ts_from_unix(unix_s)
    site = EARTH + wgs84.latlon(lat, lon, elevation_m=height_m)
    target = SUN if body == 'sun' else MOON
    alt, az, dist = site.at(t).observe(target).apparent().altaz()
    alt_true = np.atleast_1d(alt.degrees)
    # refract() returns the apparent altitude itself (it iterates Bennett's formula).
    alt_app = refract(alt_true, temperature_c, pressure_mbar)
    r = SUN_RADIUS_KM if body == 'sun' else MOON_RADIUS_KM
    radius = np.degrees(np.arcsin(r / np.atleast_1d(dist.km)))
    return np.atleast_1d(az.degrees), alt_true, alt_app, np.atleast_1d(dist.km), radius


def moon_fraction(unix_s):
    """Illuminated fraction of the moon's disc, geocentric."""
    t = ts_from_unix(unix_s)
    e = EARTH.at(t)
    s = e.observe(SUN).apparent()
    m = e.observe(MOON).apparent()
    elong = s.separation_from(m).radians
    sd = s.distance().km
    md = m.distance().km
    phase_angle = np.arctan2(sd * np.sin(elong), md - sd * np.cos(elong))
    return (1 + np.cos(phase_angle)) / 2


def vincenty_inverse(lat1, lon1, lat2, lon2):
    """Geodesic distance (m) and initial bearing (deg from true north) on WGS84."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    L = math.radians(lon2 - lon1)
    u1 = math.atan((1 - F) * math.tan(p1))
    u2 = math.atan((1 - F) * math.tan(p2))
    su1, cu1, su2, cu2 = math.sin(u1), math.cos(u1), math.sin(u2), math.cos(u2)
    lam = L
    for _ in range(200):
        sl, cl = math.sin(lam), math.cos(lam)
        ss = math.hypot(cu2 * sl, cu1 * su2 - su1 * cu2 * cl)
        if ss == 0:
            return 0.0, 0.0
        cs = su1 * su2 + cu1 * cu2 * cl
        sig = math.atan2(ss, cs)
        sa = cu1 * cu2 * sl / ss
        c2a = 1 - sa * sa
        c2sm = cs - 2 * su1 * su2 / c2a if c2a else 0.0
        C = F / 16 * c2a * (4 + F * (4 - 3 * c2a))
        new = L + (1 - C) * F * sa * (sig + C * ss * (c2sm + C * cs * (-1 + 2 * c2sm * c2sm)))
        if abs(new - lam) < 1e-13:
            lam = new
            break
        lam = new
    up2 = c2a * (A * A - B * B) / (B * B)
    k1 = 1 + up2 / 16384 * (4096 + up2 * (-768 + up2 * (320 - 175 * up2)))
    k2 = up2 / 1024 * (256 + up2 * (-128 + up2 * (74 - 47 * up2)))
    ds = k2 * ss * (c2sm + k2 / 4 * (cs * (-1 + 2 * c2sm ** 2) - k2 / 6 * c2sm * (-3 + 4 * ss ** 2) * (-3 + 4 * c2sm ** 2)))
    dist = B * k1 * (sig - ds)
    brg = math.degrees(math.atan2(cu2 * math.sin(lam), cu1 * su2 - su1 * cu2 * math.cos(lam))) % 360
    return dist, brg


def ecef(lat, lon, h):
    p, l = math.radians(lat), math.radians(lon)
    n = A / math.sqrt(1 - E2 * math.sin(p) ** 2)
    return np.array([(n + h) * math.cos(p) * math.cos(l), (n + h) * math.cos(p) * math.sin(l), (n * (1 - E2) + h) * math.sin(p)])


def elevation_to(lat, lon, h, tlat, tlon, th, k_refraction=0.0):
    """Elevation angle (deg) and slant range (m) from an eye to a point, heights ellipsoidal."""
    d = ecef(tlat, tlon, th) - ecef(lat, lon, h)
    p, l = math.radians(lat), math.radians(lon)
    up = np.array([math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)])
    rng = float(np.linalg.norm(d))
    alt = math.degrees(math.asin(float(d @ up) / rng))
    if k_refraction:
        alt += math.degrees(k_refraction * rng / (2 * 6_371_000))
    return alt, rng


def profile_radius(profile, h):
    hs = [p[0] for p in profile]
    rs = [p[1] for p in profile]
    if h >= hs[-1]:
        return 0.0
    return float(np.interp(h, hs, rs))


class Silhouette:
    """A landmark's outline as seen from one eye: altitude -> half-width, both in degrees."""

    def __init__(self, eye_lat, eye_lon, eye_orthometric, landmark, k_refraction=0.0, step_m=0.2):
        self.dist, self.bearing = vincenty_inverse(eye_lat, eye_lon, landmark['lat'], landmark['lon'])
        top = landmark['profile'][-1][0]
        floor = landmark['profile'][0][0]
        hs = np.arange(floor, top + 1e-9, step_m)
        alts, hws = [], []
        for hh in hs:
            alt, rng = elevation_to(eye_lat, eye_lon, eye_orthometric + GEOID_N, landmark['lat'], landmark['lon'], landmark['baseOrthometric'] + GEOID_N + hh, k_refraction)
            alts.append(alt)
            hws.append(math.degrees(math.asin(min(1.0, profile_radius(landmark['profile'], hh) / rng))))
        self.h = hs
        self.alt = np.array(alts)
        self.hw = np.array(hws)
        self.alt_min, self.alt_max = self.alt[0], self.alt[-1]

    def alt_of(self, h_agl):
        return float(np.interp(h_agl, self.h, self.alt))

    def h_of(self, alt):
        return np.interp(alt, self.alt, self.h, left=np.nan, right=np.nan)

    def covered_fraction(self, d_az, alt, radius):
        """Share of a disc (centre d_az from the axis and alt, degrees) behind the outline."""
        d_az, alt, radius = np.atleast_1d(d_az), np.atleast_1d(alt), np.atleast_1d(radius)
        x = (d_az * np.cos(np.radians(alt)))[:, None] + radius[:, None] * DISC_U[None, :]
        y = alt[:, None] + radius[:, None] * DISC_V[None, :]
        hw = np.interp(y, self.alt, self.hw, left=-1.0, right=-1.0)
        return (np.abs(x) <= hw).mean(axis=1)


def _disc_points(rings=28):
    """Equal-area sample points on the unit disc."""
    us, vs = [0.0], [0.0]
    for i in range(1, rings + 1):
        r = (i - 0.5) / rings
        n = 6 * i
        for j in range(n):
            a = 2 * math.pi * (j + 0.5 * (i % 2)) / n
            us.append(r * math.cos(a))
            vs.append(r * math.sin(a))
    return np.array(us), np.array(vs)


DISC_U, DISC_V = _disc_points()


def wrap180(d):
    return (np.asarray(d) + 180.0) % 360.0 - 180.0


def find_transits(eye_lat, eye_lon, eye_orthometric, landmark, body, start_s, end_s, coarse=None, min_alt=-1.0, k_refraction=0.0, fine_s=5):
    """
    Every pass of a body's disc behind a landmark from one eye, by brute force: a 60 s sweep
    of the whole stretch to find when the body is near the outline, then 5 s samples there.
    Returns one dict per pass with start, end, peak (Unix s), the largest covered share, and
    the instant the centre crosses the axis bearing.
    """
    sil = Silhouette(eye_lat, eye_lon, eye_orthometric, landmark, k_refraction)
    h_eye = eye_orthometric + GEOID_N
    if coarse is None:
        t = np.arange(start_s, end_s, 60.0)
        az, _, alt, _, _ = body_altaz(t, eye_lat, eye_lon, h_eye, body)
    else:
        t, az, alt = coarse
    near = (np.abs(wrap180(az - sil.bearing)) < 1.5) & (alt > sil.alt_min - 0.6) & (alt < sil.alt_max + 0.6) & (alt > min_alt)
    idx = np.flatnonzero(near)
    out = []
    if not len(idx):
        return sil, out
    groups = np.split(idx, np.flatnonzero(np.diff(idx) > 3) + 1)
    for g in groups:
        tf = np.arange(t[g[0]] - 120, t[g[-1]] + 120 + fine_s, fine_s)
        azf, _, altf, _, radf = body_altaz(tf, eye_lat, eye_lon, h_eye, body)
        d = wrap180(azf - sil.bearing)
        frac = sil.covered_fraction(d, altf, radf)
        frac = np.where(altf > min_alt, frac, 0.0)
        hit = np.flatnonzero(frac > 1e-9)
        if not len(hit):
            continue
        k = int(hit[np.argmax(frac[hit])])
        # Centre of the plateau when the maximum is held for several samples.
        top = np.flatnonzero(frac >= frac[k] - 1e-12)
        top = top[(top >= hit[0]) & (top <= hit[-1])]
        kp = int(top[len(top) // 2])
        cross = None
        sgn = np.flatnonzero(np.sign(d[:-1]) != np.sign(d[1:]))
        if len(sgn):
            i = int(sgn[0])
            cross = float(tf[i] + fine_s * d[i] / (d[i] - d[i + 1]))
        out.append({
            'body': body,
            'start': float(tf[hit[0]]),
            'end': float(tf[hit[-1]]),
            'peak': float(tf[kp]),
            'coveredFraction': float(frac[k]),
            'peakAz': float(azf[kp]),
            'peakAlt': float(altf[kp]),
            'peakOffDeg': float(d[kp] * math.cos(math.radians(altf[kp]))),
            'radiusDeg': float(radf[kp]),
            'cross': cross,
            'crossAlt': float(np.interp(cross, tf, altf)) if cross else None,
            'crossHeightAgl': float(sil.h_of(np.interp(cross, tf, altf))) if cross else None,
            # The stretch over which the largest cover is held (one sample long for an ordinary pass).
            'plateauStart': float(tf[top[0]]),
            'plateauEnd': float(tf[top[-1]]),
        })
    return sil, out
