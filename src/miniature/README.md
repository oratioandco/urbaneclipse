# The planner (Berlin miniature)

A white model of Berlin from the real LoD2 buildings, with real sun shadows, in Three.js.
It lives at `/plan/` (`src/pages/plan.astro`); `/` is the landing page (`src/pages/index.astro`),
which forwards old planner links (`/?date=…`) to `/plan/`. The earlier daily map is at `/map`,
the first planner at `/classic`; both stay in the repo.

The landing page's clips and stills (`public/media`) come from the planner itself:
`node scripts/miniature/record_clips.mjs <url>` records them frame by frame against a build.

## Data

The city geometry (`public/city`, about 80 MB in 1,070 files) is not in git. Build it, then
upload it to the server volume that nginx serves at `/city/`:

    node scripts/miniature/build_city.mjs data/berlin-9km
    python scripts/miniature/build_terrain.py data/viewshed/ground.npz   # needs numpy, pyproj
    python scripts/miniature/build_map.py <checkout with data/streets/osm>
    node scripts/miniature/build_trees.mjs          # the tree register, cached in data/trees
    rsync -az --delete -e "ssh -i ~/.ssh/id_ed25519_hetzner" public/city/ root@100.82.42.52:/data/plastervoid/city/

After a rebuild, bump `CITY_VERSION` in `main.js`, since the files are cached for 30 days.

## Run

    npm run dev        # then http://localhost:4321/plan/?stats&date=2027-03-22&time=1020

URL options: `date`, `time` (minutes after midnight), `at=lat,lon`, `look=heading,pitch`,
`lens`, `cam` (these four open eye level; the address keeps them up to date, so it can be
shared), `nointro`, `mode` (top, iso, free), `height`, `shadow`, `budget`, `stats`.
The panel's state can be opened from the address too, without storing it: `sheet=peek|half|full`
(phone), `panel=rail` (900 px and wider), `more=open` and `minimap=open` (eye level).

Every surface that floats on the map is the one `.surface` in `miniature.css`: frosted glass
(`--glass`, `--glass-deep` for panes with small text, `--glass-blur`). A blur is redrawn whenever
the map moves behind it, so `glass.js` watches the frames during drags and swaps it for
near-opaque paper after three rough drags in a row (`glassBudget.js`, tested); `glass=off` starts
without it. The landing page uses the same glass for its header.

## The panel

One block of markup in `plan.astro` (`.bottom` > `.panel`), three shapes, all in `miniature.css`:

- **Phone:** a bottom sheet at one of three heights. Peek is one line, the next shot in full
  (`peek.js`, wordings in `shotWords.js`). Under it one bar (`.viewbar`: which view, and for the
  day view which day) and two views, one timeline at a time: "Next 3 days" (the overview strips of `sparkstrip.js` and each day's best shots,
  `planmode.js`) and "This day" (the day view, `dayview.js`, which is also the time control,
  and the day's list, `daylist.js`). Half shows the top of the view that is up, full the list
  under it. `sheet.js` does the dragging, snapping, Escape, back button, the drop to peek when
  the map moves, and remembers the height; its rules are pure and live in `sheetHeights.js`.
- **900 px and wider:** the same content as a side panel that folds to a rail (`sheet.js`).
- **Eye level:** a floating ticket: what lines up, the time scrubber, and the camera's rows
  behind "More"; the minimap waits behind a corner button (`chrome.js`).

The time lives in the `#time` input, as it always has. The day view's thumb writes to it and
fires its `input` event, so `clock.js`, `lighting.js` and `link.js` follow; the input stays over
the timeline, unseen, as the slider for keyboards and screen readers. Days are Berlin's own:
23 or 25 hours when the clocks change, so the panel takes a day's end, its wall-clock minutes
and its three-day steps from `dayMath.js` (over `berlinClock.js`), never from `+ 86_400_000`. Verdicts are words with a
reason, never a bare dot, and every one comes from the one grade, `assess` in `verdict.js`.
Sun, moon, marks, icons and tooltips come from `bodies.js`, `marks.js`, `icons.js` and
`controlNames.js` (see `docs/ICONS.md`); `bodyAt.js` gives the body of an instant. The day view's arithmetic is in `dayTimeline.js`.
All three pure files are tested in `tests/unit/panel.test.ts`. `main.js` reads `.bottom`'s
height as what covers the map from below, so `.bottom` is only ever as tall as what really
sits at the bottom of the screen (zero for the side panel).

### The shot card

`shotCard.js` is the one way a shot is shown in `/plan/`: the day view's strip, the rows of
"This day" and "Next 3 days", and the line on the eye-level ticket. Its styles are the
`.shotcard` block in `miniature.css`. The home grid of the coming days is to be built from it.

```js
import { shotCard, drawShotFrame } from './shotCard.js';
const card = shotCard(shot, verdict, { size: 'card' });   // 'card' | 'row' | 'ticket'; tag: 'button' | 'div'; pixels: [w, h]
card.addEventListener('click', () => openShot(shot, verdict));   // openShot is in daylist.js
```

| Input | What | Needed |
|---|---|---|
| `shot.t` | the instant, ms | yes |
| `shot.body` | `'sun'` or `'moon'` | yes |
| `shot.kind` | `'tower'` or `'street'` | yes |
| `shot.where` | `'sphere'` or `'antenna'`: what the disc is behind | tower shots |
| `shot.landmark` | `fernsehturm` (default), `siegessaeule` or `brandenburger_tor`: a sprite in `public/landmark-sprites/` with an entry in `SPRITE` | no |
| `shot.distanceM` | distance to the landmark: sizes the disc against the tower's sphere. For a street, its length: the longer, the narrower the gap at its far end | no |
| `shot.title`, `shot.short` | the shot in a sentence; the place alone | one of them |
| `shot.stand` | where to stand, short ("5.3 km SE") | no |
| `shot.detail` | the row's small print | rows |
| `verdict` | what `shotVerdict` returns; its `sky` draws the frame's cloud and rain. `null`: no pill, clear sky | no |

The rows of `collectRows` (`daylist.js`) already are shots. `size: 'card'` takes the width of
its container (set `--card` or a grid column) and puts the words on the frame; it is 4:5 unless
the container sets `--shot-aspect` (the day view's strip sets 6:5 and passes `pixels: [336, 280]`
so the frame is drawn to that shape). `'row'` puts a 76 px frame beside the words; `'ticket'` is
one line. `drawShotFrame(canvas, shot, verdict, { words })` draws the frame alone on any canvas,
for a larger hero; `words: true` keeps the disc in the band a card's words leave free.

The frame: the sky of `skyPalette` for the sun's height, the sun or moon of `bodies.js`, the
forecast's three cloud layers and rain, and the landmark's sprite as a silhouette, placed so
the part the body is behind sits on the disc. `SPRITE` in `shotCard.js` holds that framing for
the Fernsehturm (sphere and antenna; the disc has its true size against the sphere), the
Siegessäule (the figure on top) and the Brandenburger Tor (the quadriga); a new landmark needs
its sprite and an entry there. A street has no sprite: it is drawn as the street, two rows of
houses running to the point where the body stands, with its light on the road. The houses are
that street's own (seeded by its name), the gap narrows with its length, and the roofs drop
away under a higher body, so two street cards are not the same picture.

The card's words: the verdict's pill and reason, the time, the place (`short`), and one line of
what tells this shot from its neighbours (`shotWhat`): "Sun · 5.3 km SE" at the tower,
"Sun · 2° up" down a street.

Code: `main.js` loads the city and runs the frame loop; its header lists the other modules.
Shared state that several modules change lives on `app` in `state.js`.
More dates from where you stand (the Dates button at eye level) search a year in
`dates.worker.js`: a street's henges, and passes behind the tower by the `towerShots.js` rules.
A browser walk-through of the main features: `node scripts/miniature/walkthrough.mjs <url> <shots dir>`.
`#time` holds minutes on the Berlin wall clock. A Berlin day is 23 or 25 hours long when the
clocks change, so never add those minutes to midnight: use `instantOfMinute`, `minuteOf` and `dayEnd`
from `clock.js` (arithmetic in `berlinClock.js`, tests in `tests/unit/clockChange.test.ts`).
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

A fuller measurement from 2026-11-23 (network, start-up, what a frame and a slider drag cost,
and the script that produces the numbers) is in `docs/performance-2026-11.md`.

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

## Trees and landmarks (fourth pass, 2026-11-08)

- **Trees:** 541,524 street and park trees from Berlin's tree register (WFS `baumbestand`,
  Datenlizenz Deutschland Zero 2.0), each at its place with its listed height and crown; gaps
  are filled from girth or kind. 3.8 MB in `trees.bin`, sorted into 500 m cells. `trees.js` draws
  the cells whose crowns would cover 3 px or more, nearest first, up to 90,000 trees (30,000 on
  a phone, `trees=N` to change), as three instanced meshes. Broadleaf trees go twig-grey and thin
  from December to March. Dense woods inside parks are not in the register, and trees do not
  block sightlines yet. Layer switch: Trees.
- **Landmarks:** `landmarks.js` models the Oberbaumbrücke (not in LoD2 at all: arches, arcade,
  towers, ramps) and the Frankfurter Tor's drums and domes (LoD2 has a pyramid there, cut away in
  the building shader above the cornice). Sizes from OSM building parts and the LoD2 cornice;
  arch rise, arcade and dome heights from photographs. Standing on the bridge puts you on its deck.
