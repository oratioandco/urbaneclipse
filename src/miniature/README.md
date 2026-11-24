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
    rsync -az --delete -e "ssh -i ~/.ssh/id_ed25519_hetzner" public/city/ "$PLASTERVOID_HOST":/data/plastervoid/city/

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

### The day's shots, for the planner and the home page

`dayShots.js` works out a day's shots and is the only place that does: `computeDayPaths` (the
tower's paths), `computeLandmarkPasses` (the Siegessäule's and the Brandenburger Tor's),
`collectRows` (every shot, in time order) and `dayShots` (all of it, from the city data
alone). It has no three.js and no DOM, so the home page (`src/home/`) loads it without
the planner. In the planner, `plan.js` puts the paths into scene coordinates and keeps each
day's landmark passes, and `daylist.js` adds `go` to each row (fly to where to stand). A list
of several days drops the 00:00 repeat of a pass that runs across midnight
(`withoutContinued`): home's grid and the planner's "3 days" list do; the planner's "1 day"
view keeps that row, since it is all that day has of the pass.

A link can name its shot: `?date=…&time=…&shot=sphere-sun` (or `sphere-moon`, `antenna-moon`,
`viktoria-sun`, `quadriga-moon`, `street-sun:Sonnenallee`; `shotKey`). `link.js` then opens it as a tap on its card would:
it finds the day's row (`findShot`), searches for a confirmed clear spot and puts the shot's
card on the ticket. A link without `shot`, or one whose row the day does not have, opens at
its own `at` and `look` as before. Home's cards link this way (`planLink` in `src/home/grid.js`).

### The Siegessäule and the Brandenburger Tor

The sun or moon behind the Viktoria on the column and the quadriga on the gate are rows of a
day like the tower's (`landmarkShots.js`, hooked into `collectRows`): `kind: 'tower'`, their
own `landmark` (the sprite) and `target` (the landmark's id), `where: 'viktoria' | 'quadriga'`,
and `at`, `look`, `lens`, `openAt`, `stand`, `score` as a tower row has them. The list's
Landmarks switch (`layers.landmarks`) is theirs; Tower is the TV tower's alone.

The geometry is `src/lib/landmarkStands.ts`, and it is narrow by nature:

- **Height.** The figures are 23 m and 63 m up (gate 20.3 m, quadriga's tip about 26 m; Viktoria
  8.32 m on a monument of about 67 m: de.wikipedia). A 0.52° disc is as wide as half the figure
  is tall from 314 m (gate) and 457 m (column); closer than that no shot is offered. So the body
  stands 1° to 4° up for the gate and 2° to 8° for the column, and each minute has exactly one
  stand point, which runs along the street at up to 40 m a minute.
- **Where one may stand.** Only on strips of open ground whose axis runs through the landmark,
  because the Tiergarten's woods are in no data here: Straße des 17. Juni east (to Platz des
  18. März) and west (to the Stadtbahn viaduct) of the column, the same street west of the gate,
  and the middle promenade of Unter den Linden east of it. Bearings and tree lines are from
  OSM, ground heights from DGM1, measured 2026-11-24; each strip's numbers and limits are in
  the file. So every row says a side: east of the landmark looking west (evening sun, setting
  moon) or west of it looking east.
- **Line of sight.** Each landmark has a viewshed like the tower's
  (`public/viewshed/siegessaeule.*`, `brandenburger-tor.*`; `scripts/build_viewshed.py
  --landmark <id>`), aimed at the middle of the figure. It also asks what stands behind: a cell
  counts as visible only when the sight line, carried on past the figure, clears every LoD2
  roof by the disc's radius (value 3, `VIEW_NO_SKY`, marks the rest). Without its viewshed a
  landmark has no rows. Trees are not checked, and every row says so: "trees unchecked" on the
  card (`caution`), "buildings checked, trees not" in its small print and its accessible name. The planner's fly-to
  (`goViewHere`, kind `landmark`) confirms the sight line against the full-detail buildings and
  stays within 45 m of the row's spot, since the alignment holds at that spot only.
- **Rank.** `landmarkScore`: the larger the disc against the figure, the higher, and always
  under the tower's best of the same kind (sun 1.1 or 1.5, moon up to 2.0).

In the 365 days from 2026-11-24 the pipeline gives 48 sun and 27 moon rows for the column
(sun: 27 from the east, 21 from the west) and 31 sun and 20 moon rows for the gate (sun: 12
from Unter den Linden, 19 from Straße des 17. Juni); `tests/unit/landmarkShots.test.ts` pins
March 2027. The sun's are two runs of days either side of each equinox.
Not offered: the long shots of the column from Bismarckstraße and Kaiserdamm (the viaduct's
height and the terrain west of the DGM1 sheets are not in the data), Pariser Platz itself (too
close for the disc to count), and any stand point off the four strips.

### The shot card

`shotCard.js` is the one way a shot is shown in `/plan/`: the day view's strip, the rows of
"This day" and "Next 3 days", the line on the eye-level ticket, and the cards and rows of
"From here" (below). Its styles are its own file,
`shotcard.css`, which also holds the sizes it is built from as tokens; `miniature.css` imports
it, and so does the home page, which loads nothing else of the planner's styles.

```js
import { shotCard, drawShotFrame } from './shotCard.js';
const card = shotCard(shot, verdict, { size: 'card' });   // 'card' | 'row' | 'ticket'; tag: 'button' | 'a' | 'div'; pixels: [w, h]; day: 'Tomorrow'
// `day` is said in the card's name; a container with the class `shotcards-dated` also shows it over the time
card.addEventListener('click', () => openShot(shot, verdict));   // openShot is in daylist.js
```

| Input | What | Needed |
|---|---|---|
| `shot.t` | the instant, ms | yes |
| `shot.body` | `'sun'` or `'moon'` | yes |
| `shot.kind` | `'tower'` or `'street'` | yes |
| `shot.where` | `'sphere'` or `'antenna'` (TV tower), `'viktoria'`, `'quadriga'`: what the disc is behind | tower shots |
| `shot.landmark` | `fernsehturm` (default), `siegessaeule` or `brandenburger_tor`: a sprite in `public/landmark-sprites/` with an entry in `SPRITE` | no |
| `shot.distanceM` | distance to the landmark: sizes the disc against the tower's sphere. For a street, its length: the longer, the narrower the gap at its far end | no |
| `shot.title`, `shot.short` | the shot in a sentence; the place alone | one of them |
| `shot.stand` | where to stand, short ("5.3 km SE"; "1.1 km east" at a landmark) | no |
| `shot.caution` | what is not checked, in two words ("trees unchecked"): added to the card's line, where no small print shows | no |
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

### From here: the year from where you stand

At eye level, "Dates" (behind "More" on the ticket) searches the next twelve months from the
spot you stand on: the street you are in, and the sun and moon behind each landmark of
`targets.js`. Three files, so the search and what is shown of it stay apart:

- `dates.js` and `dates.worker.js` search (a street's henges; passes by the `towerShots.js`
  rules), check every date against the buildings and word it. The worker posts how far the year
  is (`{ id, progress }`), read off the instants the search asks `bodyAt` for.
- `fromHere.js` (pure, tested in `tests/unit/fromHere.test.ts`) decides what to show: `asShot`
  makes a found date a shot for the card, `spectacle` scores it on `collectRows`' scale (the moon
  by day counts for less), `highlights` picks up to three, `byMonth` groups the year,
  `shownShots` applies the five switches, `gatherNotes` says each of the search's remarks once.
- `fromHereView.js` and `fromhere.css` show it in `#dates`, with the shot card throughout.

What a photographer sees:

| State | Shown |
|---|---|
| Searching | "Searching the next 12 months from this spot…", a bar that follows the search, and each thing looked for with its count once it is done |
| Found | "Best from here": up to three cards in the day view's row of cards (4:5, the day over the time; they scroll sideways on a phone). Under it every date by month as shot rows: the body's disc, date and time, the verdict, then place, pass, height and light |
| Nothing | "Nothing lines up from here in the next twelve months. Try a few steps along." and what the search knows of why (hidden by buildings, or no pass at all) |
| Failed | "The search did not finish." with "Search again" and the error: no answer is not the same as nothing |
| Switched off | The day list's own sentence and its "Show all shots" |
| Moved | "You have moved: search from here" stays at the top of the list |

The highlights: the next shot in time comes first when it is decent (a score of 1 or more, and
no forecast saying Skip), on the best of its days when it comes back on the days after (the
edge of the sphere today, a ring round it tomorrow); the others are the best by score, a shot a year off losing a third
against the same shot today; one of each kind (a body at a place) before a second of any, since
the moon comes round every month; a run of the same henge on neighbouring days gives one card.
Cards are in time order.

A verdict is shown only for a date the forecast reaches (16 days), in the words of `verdict.js`;
beyond that a card has no pill at all, and neither has the ticket's card of such a shot
(`ticketVerdict` in `daylist.js`). The switches are the day list's five (`wireSwitches` in
`chrome.js`: any `button[data-layer]` shows and sets the one state, and `layerchange` on
`document` tells other lists): "Tower" is the TV tower, "Landmarks" the Siegessäule and the
Brandenburger Tor. A date behind one of those two carries what its day rows carry
(`landmarkShots.js`): the part it is named after (`viktoria`, `quadriga`), where you stand
("400 m east": the side from the bearing dates.js gives), "trees unchecked" on the card and
"buildings checked, trees not" in the row.

Picking a card or a row calls the date's `go` (day, time, fine timing, turn to face it) and
puts the shot on the ticket (`showTicket`), so the address carries `shot=…&here=year` and the
calendar entry is named after it. `here=year` tells `link.js` that the day's own rows do not
hold this shot (they are for other spots): it makes the ticket's card again from the link
alone (`shotFromKey`, with the spot's distance and bearing from the landmark the name is of).

While the list is open, the ticket's idle line ("Nothing lines up with the tower from here",
which is about the chosen minute) names the next date instead: "Next from here: Tue, 1 Dec,
11:38", or "Nothing lines up right now". `fromHereView.js` does that from outside, only for
the idle line; what `eclipse.js` says of the minute is untouched, and comes back when the list
closes.

The list opens a third of the screen high (250 to 300 px); the chevron beside the count gives
it the ticket's whole height (hidden on a screen under 600 px high, where there is none to
give). The horizon strip and the lens row fold away meanwhile, and on a phone for as long as
the list is open: the ticket is then 51 % of a 390 x 844 screen, 77 % with the whole list.
Under 360 px wide a row drops the weekday, the chevron, and the light and lit share from its
small print (place, pass, height: `brief`), so it is three lines at most, a verdict's line apart.

Code: `main.js` loads the city and runs the frame loop; its header lists the other modules.
Shared state that several modules change lives on `app` in `state.js`.
A browser walk-through of the main features: `node scripts/miniature/walkthrough.mjs <url> <shots dir>`
(headless, the city answered from the live site through a cache, as `scripts/adversarial/lib.mjs` does).
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
