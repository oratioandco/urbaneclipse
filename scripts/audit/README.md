# Accuracy audit scripts

An independent check of what the app tells photographers. The report is
`docs/accuracy-audit-2026-11.md`; the tests are `tests/unit/accuracyAudit.test.ts`.

| File | What it does |
|---|---|
| `app_dump.ts` | Calls the app's own functions for a year (23 Nov 2026 to 23 Nov 2027) and writes `data/audit/app.json` |
| `reflib.py` | The reference: Skyfield + JPL DE421, Bennett refraction, Vincenty geodesics, ECEF elevations, a brute-force pass search. Shares no code with the app |
| `compare_ephemeris.py` | Sun and moon directions every 10 minutes for the year |
| `compare_windows.py` | Panel 05: Lichtenberger Brücke to the Fernsehturm, Straße des 17. Juni to the Siegessäule |
| `compare_miniature.py` | The `/plan/` date search from nine spots |
| `compare_streets_times.py` | Street bearings and henge times, sunrise and sunset, light bands, moonrise |
| `landmarks_osm.py` | Landmark axes against OpenStreetMap (Overpass, needs network) |
| `make_fixture.py` | Writes `tests/fixtures/accuracy-reference.json` for the tests |
| `results/` | The numbers the report quotes |

Run everything with `sh scripts/audit/run.sh` from the repository root.
`AUDIT_BEFORE=1 node data/audit/app_dump.mjs` reproduces the `/plan/` search as it was before
the grid-north fix.
