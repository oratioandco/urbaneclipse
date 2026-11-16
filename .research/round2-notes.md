# Round 2 implementation notes (facts carried from recon, do not re-derive)

Branch: task/berliner-dom-landmark (already checked out).

## Sources (.research/, fetched previous run)
- dom-nominatim.json: Berliner Dom, OSM way 313670734, node/centroid 52.5190822, 13.4010942.
- friedrichs.json: Friedrichsbrücke way 339201182, 52.5205529, 13.4003017 → CANONICAL vantage.
- monbijou.json: Südliche Monbijoubrücke way 195397546, 52.5218860, 13.3936274 (not used for goldens).
- dom-de.wiki: infobox HÖHE 98 m (current building); dome Durchmesser 33 m; building 114 m long × 73 m wide.
- dom-en.wiki: 114 m tall until 1975 demolition of northern memorial hall; 115 m outer until 1944.
  → DISAGREEMENT recorded; model claims CURRENT 98 m, never 114/115.
- dom-geom.json: FAILED fetch (406) — ignored.

## Computed offline (node, no network)
- DGM1 (public/heightmap/berlin-dgm1.bin/.json, bilinear): ground at Dom axis = 35.26 m NHN;
  ground at Friedrichsbrücke = 30.80 m NHN.
- Vincenty inverse (WGS84) Friedrichsbrücke → Dom: distance 172.270 m, bearing 161.8036°.
- Eye 1.6 m: apex (98 m) elevation from vantage ≈ 30.35°; dome half-width (16.5 m) ≈ 5.48°.
- Sun geometry sanity: at az ≈ 162° the sun is ≈ 26° high near δ ≈ −10° (late Feb / mid Oct)
  → inside dome band; ≈ 12.7° at winter solstice (below drum); ≈ 46° in April (above apex).

## Repo API facts
- GEOID_UNDULATION_BERLIN = 39.5 (src/lib/elevation.ts).
- vantages.bearingDistanceTo uses geodeticToECEF + ecefToENU (cameraMath), h=0 both ends.
- bodyPosition.sampleBody(body, date, lat, lon) → { az, alt, distanceKm, radiusKm }.
- landmarks.ts: RevolutionLandmark { id, name, lat, lon, baseOrthometric, profile: [h, r][] ascending }.