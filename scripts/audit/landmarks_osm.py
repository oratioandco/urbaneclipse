"""
Audit: landmark axis positions in src/lib/landmarks.ts against OpenStreetMap, fetched live
from the Overpass API (the centre of each object's bounding box, and of its node ring).
Prints the offset of the app's axis from OSM in metres. Needs network; no key.

Heights are not in OSM in any trustworthy form; the document lists the published sources.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request

APP = {
    'fernsehturm': (52.520815, 13.409419, 'nwr(around:60,52.5208,13.4094)["name"~"Fernsehturm"];'),
    'siegessaeule': (52.514513, 13.350099, 'way(718035022);'),
    'siegessaeule-column': (52.514513, 13.350099, 'nwr(around:60,52.5145,13.3501)["name"~"Siegess"];'),
    'brandenburger-tor': (52.516273, 13.377704, 'way(518071791);'),
    'berliner-dom': (52.5190822, 13.4010942, 'way(313670734);'),
    'lichtenberger-bruecke': (52.5111010, 13.4991829, 'way(1335772137);'),
}


def fetch(query):
    data = urllib.parse.urlencode({'data': f'[out:json][timeout:25];({query});out geom tags;'}).encode()
    last = None
    for attempt in range(6):
        host = ('https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter')[attempt % 2]
        try:
            req = urllib.request.Request(host, data=data, headers={'User-Agent': 'accuracy-audit-script/1.0'})
            return json.load(urllib.request.urlopen(req, timeout=40))
        except Exception as err:  # noqa: BLE001
            last = err
            time.sleep(4)
    raise last


def metres(lat, lon, lat0, lon0):
    return ((lon - lon0) * 111_320 * math.cos(math.radians(lat0)), (lat - lat0) * 111_132)


out = {}
for name, (lat, lon, q) in APP.items():
    try:
        res = fetch(q)
    except Exception as err:  # noqa: BLE001
        print(name, 'FAILED', err, file=sys.stderr)
        continue
    for el in res['elements']:
        if el['type'] == 'node':
            pts = [(el['lat'], el['lon'])]
        elif 'geometry' in el:
            pts = [(p['lat'], p['lon']) for p in el['geometry']]
        else:
            b = el['bounds']
            pts = [(b['minlat'], b['minlon']), (b['maxlat'], b['maxlon'])]
        ring = pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts
        clat = sum(p[0] for p in ring) / len(ring)
        clon = sum(p[1] for p in ring) / len(ring)
        blat = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
        blon = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2
        e, n = metres(lat, lon, blat, blon)
        tags = {k: v for k, v in el.get('tags', {}).items() if k in ('name', 'height', 'ele', 'man_made', 'building', 'tourism', 'historic', 'bridge', 'layer')}
        row = {'osm': f"{el['type']}/{el['id']}", 'nodes': len(ring), 'bboxCentre': [blat, blon], 'nodeMean': [clat, clon], 'appMinusBboxCentreM': [round(e, 2), round(n, 2)], 'tags': tags}
        out.setdefault(name, []).append(row)
        print(name, json.dumps(row, ensure_ascii=False))
json.dump(out, open(__file__.replace('landmarks_osm.py', 'results/landmarks_osm.json'), 'w'), indent=1, ensure_ascii=False)
