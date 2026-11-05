# Berlin miniature (experiment)

A white model of Berlin from the real LoD2 buildings, with real sun shadows, in Three.js
instead of Cesium. Top, isometric and free 3D views with pan and zoom.

- **Purpose:** find out whether this look can run smoothly in a browser, before deciding if it joins the app.
- **Base:** `redesign-daily-map` at eff7a47. Nothing here ships with the site.
- **Done when:** the look is approved and it has been tried on a real phone. Then either plan it into the app or retire this branch.

## Run

    npm install
    npm run city -- ../../../urbaneclipse/data/berlin-9km
    python scripts/build_terrain.py ../../../urbaneclipse/data/viewshed/ground.npz   # needs numpy, pyproj
    npm run dev

Open http://127.0.0.1:4330/?stats&date=2027-03-22&time=1020. URL options: `mode` (top, iso, free), `height` (metres in view), `shadow`, `budget`.

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
