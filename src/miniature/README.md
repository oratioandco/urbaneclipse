# The planner (Berlin miniature)

A white model of Berlin from the real LoD2 buildings, with real sun shadows, in Three.js.
Since 2026-11-06 it is the home page (`src/pages/index.astro`). The earlier daily map is at
`/map`, the first planner at `/classic`; both stay in the repo.

## Data

The city geometry (`public/city`, about 80 MB in 1,070 files) is not in git. Build it, then
upload it to the server volume that nginx serves at `/city/`:

    node scripts/miniature/build_city.mjs data/berlin-9km
    python scripts/miniature/build_terrain.py data/viewshed/ground.npz   # needs numpy, pyproj
    python scripts/miniature/build_map.py <checkout with data/streets/osm>
    rsync -az --delete -e "ssh -i ~/.ssh/id_ed25519_hetzner" public/city/ root@100.82.42.52:/data/plastervoid/city/

After a rebuild, bump `CITY_VERSION` in `main.js`, since the files are cached for 30 days.

## Run

    npm run dev        # then http://localhost:4321/?stats&date=2027-03-22&time=1020

URL options: `date`, `time` (minutes after midnight), `at=lat,lon`, `look=heading,pitch`,
`lens`, `cam` (these four open eye level; the address keeps them up to date, so it can be
shared), `nointro`, `mode` (top, iso, free), `height`, `shadow`, `budget`, `stats`.
The rules for moon and sun shots with the tower are in `towerShots.js`, tested in
`tests/unit/miniature.test.ts`.

## Measured, 2026-11-05, Mac at 1440x900, device scale 2, Chromium with Metal

| | Triangles | Size | Gzipped |
|---|---|---:|---:|
| Source tiles | 16.6 M | 385 MB | |
| Full detail | 16.4 M | 50 MB | 40 MB |
| 1.5 m error | 6.5 M | 21 MB | 18 MB |
| 6 m error | 1.5 M | 5.6 MB | 5.0 MB |

Median frame while the sun moves, re-rendering the shadow map each frame: 17 ms at most
views, 18 ms in 3D, 27 ms for the whole 18 km area (slow spikes while tiles arrive).
Ambient occlusion took frames to about 170 ms and barely changed the picture, so it was dropped.

## Not known yet

Real phones, Safari, and memory use. Trees and water are not in the data. Ground heights
partly come from building bases, so they are estimates away from the DGM1 strip.

## Map, light and night (second pass)

`scripts/build_map.py` builds roads, names, water and parks from OpenStreetMap, using the
checkout's `data/streets/osm` download plus a fetched `areas.json`. Credit OSM (ODbL) if shown.

- **Ground:** one paved surface; parks and water come from a painted 4096 px map of the model.
  So does street light, as widening strokes, which is why roads have no geometry of their own.
- **Water:** a half-resolution mirror render of buildings near water. Skipped in Top view.
- **Windows:** procedural; merge into larger patches with distance instead of a flat tone.
- **Light shafts:** a pool on the street plus a curtain of lit air, brightest at the body's end.
- **Tower:** one window row and red lights. Light heights are read off photos, and the flash
  rhythm is the German "Feuer W, rot" (1 s on, 0.5 off, 1 on, 1.5 off), not confirmed for this tower.

Median frame during a sun scrub, Mac, 1440x900 at scale 2, Chromium Metal, without multisampling
(with it, Isometric took about 33 ms): Isometric 17 ms, 3D 33 ms, whole city 33 ms; p95 50 to 67 ms.
URL options added: `blur=0`, `mirror=0` (or a scale), `samples=N`. Phones and Safari are untested.

## Standing in the street (third pass)

- **Overview camera:** one perspective camera with a 28° field of view and free tilt from 0 to 80°.
  Drag pans, right-drag or two fingers rotate and tilt, and the compass turns north up. The
  2D/3D button flips between straight down and 55°. Tapping a pill turns the map to face that body.
- **Photographer:** drag the button onto the map to stand there, or tap it to stand mid-map.
  The spot moves to the nearest open street point when it lands under a roof or against a wall.
  Arrival faces a lined-up street, else the sun or moon, else the tower, turning to the nearest
  open view if a wall is within 60 m. Double-tap the ground to walk up to 600 m. "Map" flies back up.
- **Eye level:** sky dome with the sun at true size and a moon lit from the sun's direction,
  lens 16 to 600 mm (35 mm equivalent), drag to look. Shadows are fitted to 1.4 km around the
  view. Pills only point to bodies out of frame.
- **Check:** Gitschiner Straße, 22 Mar 2027 18:04, 95 mm, facing 268.6°: the sun sits in the
  street's gap, as in the Cesium preview. Median frame while the sun moves: 17 ms (Mac).
- **Limits:** the ground map is about 4.6 m a pixel, so park edges and water banks blur up close.
  The ground follows a 40 m terrain grid, there are no trees, and phones and Safari are untested.
