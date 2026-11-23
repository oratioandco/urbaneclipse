#!/bin/sh
# The accuracy audit, end to end. Run from the repository root:  sh scripts/audit/run.sh
# Needs Node (npm ci done) and Python 3.10+ with Skyfield:
#   python3 -m venv .venv && .venv/bin/pip install skyfield
# First run downloads JPL's DE421 kernel (17 MB) into data/audit/ (gitignored).
# Takes 10 to 20 minutes; the year's reference sweep is cached in data/audit/.
set -e
mkdir -p data/audit scripts/audit/results
npx esbuild scripts/audit/app_dump.ts --bundle --platform=node --format=esm --outfile=data/audit/app_dump.mjs --log-level=warning
node data/audit/app_dump.mjs
PY=${PYTHON:-.venv/bin/python}
$PY scripts/audit/compare_ephemeris.py
$PY scripts/audit/compare_windows.py
$PY scripts/audit/compare_miniature.py
$PY scripts/audit/compare_streets_times.py
$PY scripts/audit/make_fixture.py
# Optional, needs network (Overpass): $PY scripts/audit/landmarks_osm.py
