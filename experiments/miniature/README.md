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
