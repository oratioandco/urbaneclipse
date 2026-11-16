#!/usr/bin/env python3
"""Print the DOM1 surface heights around standing points (bridge-deck provenance).

This is the measurement behind the Lichtenberger Bruecke deck heights in
src/lib/vantages.ts (sampled 2026-11-12): for each standing point, every DOM1
(digital SURFACE model, so it sees the deck, unlike bare-earth DGM1) point
within R metres is collected and printed sorted, so the deck plateau can be read
off by eye and its median taken. Coordinates are EPSG:25833 metres.

Needs data/dom1/DOM1_398_5818.zip (Berlin geoportal DOM1 sheet, gitignored;
fetch from https://gdi.berlin.de/data/dom1/atom like scripts/fetch_dgm1.py does
for DGM1). Run from the repo root:  .venv/bin/python scripts/sample_dom1_points.py
"""
import statistics
import zipfile

PTS = [
    ("nord-west", 398095, 5818998),
    ("nord-mitte", 398088, 5818995),
    ("nord-knick", 398039, 5818969),
    ("sued-west", 398037, 5818965),
    ("sued-mitte", 398149, 5818945),
    ("sued-ost", 398179, 5818940),
]
R = 3.0

buckets: dict[str, list[float]] = {i: [] for i, _, _ in PTS}
with zipfile.ZipFile("data/dom1/DOM1_398_5818.zip") as z:
    with z.open(z.namelist()[0]) as f:
        for line in f:
            try:
                e, n, h = line.split()
            except ValueError:
                continue
            e = float(e)
            n = float(n)
            for i, E, N in PTS:
                if abs(e - E) <= R and abs(n - N) <= R:
                    buckets[i].append(float(h))

for i, _, _ in PTS:
    v = sorted(buckets[i])
    med = statistics.median(v) if v else float("nan")
    print(f"{i} n={len(v)} median={med:.2f}")
    print("  sorted:", " ".join(f"{h:.1f}" for h in v))
