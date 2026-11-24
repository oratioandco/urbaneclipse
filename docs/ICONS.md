# The planner's icons

One icon set for `/plan/`, and the one sun and one moon. Written 2026-11-23.

- `src/miniature/icons.js`: the icons, the weather and light-phase marks, the DOM helpers.
- `src/miniature/bodies.js`: the canonical sun and moon, as SVG and on a canvas.
- `src/miniature/marks.js`: the event marks for timeline and map, and the direction needle.
- `src/miniature/controlNames.js`: tooltip and accessible name of every icon-only control.
- `explorations/icons-2026-11/specimen.html`: every icon at 16, 20, 24 and 32 px on the light
  and the dark surface, the sun from -6° to 45°, the moon by phase, altitude and sky. Open the
  file in a browser. Rebuild it after any change: `node scripts/build-icon-specimen.mjs`.
- `tests/unit/miniatureIcons.test.ts`: the rules below, as tests.

Adopted in `/plan/` on 2026-11-24 (branch `claude/panel-finish-3c13ce`): the panel, the toolbar,
the layers menu, the map's pills, spots and minimap draw from these modules, and the interim
discs, marks and glyphs are deleted. Two small modules sit on top: `bodyAt.js` (the body of an
instant, for rows and buttons) and `shotPicture.js` (the body behind the set's tower or down
its street, for shot cards and list rows). Not swapped: the `#eclipse` status dot at eye level
(a status light in the body's line colour, beside words) and the legend's line samples.
The mapping table at the end of this note is kept as the record of what was replaced.

## The rules

1. **A verdict is a word.** "Go", "Maybe", "Skip", each with its reason ("Go · clear light").
   `verdict-go`, `verdict-maybe` and `verdict-skip` may sit beside the word. They never stand
   alone, and colour never carries the verdict by itself: the three differ in shape (tick,
   wave, bar), so they still read in greyscale. The same goes for weather and light: the name
   is shown, the icon supports it.
2. **One sun, one moon.** There is no `sun` or `moon` in the icon list, on purpose. A sun or
   moon anywhere in the interface is `sunSvg`, `moonSvg`, `drawSun` or `drawMoon` from
   `bodies.js`, at the altitude and phase of the minute it stands for. No widget draws its own.
3. **Icons take the text colour.** Every icon is `currentColor`. Do not give an icon a colour
   of its own to carry meaning; colour the control or the word.
4. **Decorative unless told otherwise.** `icon()` output is `aria-hidden`. A control that is
   only an icon gets its name on the control (`setIcon(button, 'layers', { label: 'Layers' })`
   sets `aria-label` on the button). Pass `label` to `icon()` only when the drawing stands
   alone with no control and no word, which should be rare.

## The drawing

- 24-unit grid, drawn inside a 20-unit live area.
- One stroke: 1.75 units, round caps, round joins. It scales with the icon, so 16 px gets
  about 1.2 px and 32 px about 2.3 px.
- The one solid thing in an icon may carry a 14 % wash of the same colour (the cloud, the
  tower's sphere, the top map layer): clay masses with drawn edges, as in the miniature.
  Secondary lines are at half strength. `play` and `pause` are solid.
- Tested sizes: 16, 20, 24, 32. In a 40 px round control use 22; in a chip or beside 12–13 px
  text use 16.

The sun is a disc with a flat core to 65 % of its radius, falling to the limb colour, a rim
and a halo in the glow colour. No rays. The moon is the dark disc `#20263a` with the lit part
in `moonLook`'s tint, stopped short of the edge so a dark ring always shows: that ring is what
separates a low, warm, nearly full moon from a low sun. All colours come from `sunLook` and
`moonLook` in `src/lib/mapBodyLook.ts`. The geometry is in units of the radius, so 12 px and
96 px are the same drawing.

## Using it

```js
import { icon, iconEl, setIcon, weatherIcon, phaseIcon } from './icons.js';
import { sunSvg, moonSvg, drawSun, drawMoon, discRadius } from './bodies.js';

row.innerHTML = `${sunSvg({ altitudeDeg: row.alt, size: 20 })}<span>…</span>`;
row.innerHTML = moonSvg({ fraction: moon.fraction, waxing: moon.waxing, altitudeDeg: alt, sunAltitudeDeg: sunAlt, size: 20 });
setIcon(document.getElementById('layers'), 'layers', { size: 22, label: 'What the map shows' });
chip.innerHTML = `${weatherIcon('some-cloud', { size: 16, body: { kind: 'sun', altitudeDeg: alt } })}Some cloud`;
chip.innerHTML = `${phaseIcon('golden', { size: 16 })}Golden hour`;
drawSun(ctx, x, y, 7.5, body.alt);              // canvas: centre and disc radius
drawMoon(ctx, x, y, 7.5, { fraction, waxing, altitudeDeg, sunAltitudeDeg });
```

`glow: false` drops the halo and lets the disc fill the box (for very tight rows). With the
glow, the disc's radius is a third of the box; `discRadius(size)` gives it.

`iconSprite()` and `iconUse(name)` give the same drawings as a `<symbol>` sprite, if a page
would rather not repeat paths.

## Which icon for which meaning

| Meaning | Icon |
| --- | --- |
| Collapse / expand the panel or sheet one step | `chevron-down` / `chevron-up` |
| Previous / next day, open a row | `chevron-left` / `chevron-right` |
| Earlier / later shot | `shot-earlier` / `shot-later` |
| One minute back / forward | `minus` / `plus` |
| Return to the present minute | `now` |
| Run / hold time | `play` / `pause` |
| Pick a date, more dates, add to calendar | `calendar` |
| Rises at / sets at | `rise` / `set` |
| Map layers | `layers` |
| Stand where I am | `locate` |
| Face north | `compass` (the filled half of the needle is north) |
| The minimap corner button | `minimap` |
| Back to the map | `map` |
| View from here (eye level) | `eye` |
| Re-aim at the shot | `aim` |
| The photographer, stand here | `camera` |
| Lens and focal length | `lens` |
| Lines at thirds | `thirds` |
| Drone view, on foot, lift off | `drone`, `walk`, `takeoff` |
| Go there, directions | `pin` |
| Share, copy link | `share`, `link` |
| Back, go, opens another site | `arrow-left`, `arrow-right`, `external` |
| Close, more, filters, help | `close`, `more`, `tune`, `help` |
| TV tower, layer: tower alignments | `tower`, `tower-line` |
| Layer: street henges, trees, street names | `henge`, `tree`, `names` |
| Layer: weather, clouds on the map | `cloud`, `cloud-map` |
| Clear | `weatherIcon('clear', { body })`: the body of that minute, nothing else |
| Some cloud | `weatherIcon('some-cloud', { body })` |
| Overcast, rain, thunderstorm | `weatherIcon('overcast' \| 'rain' \| 'thunder')` |
| Night, twilight, blue hour, golden hour, day | `phaseIcon('night' \| 'twilight' \| 'blue' \| 'golden' \| 'day')` |
| Beside "Go" / "Maybe" / "Skip" | `verdict-go` / `verdict-maybe` / `verdict-skip` |
| The sun, the moon | `sunSvg`, `moonSvg` (never an icon) |
| An event on a timeline or the map | `markSvg` / `drawMark`: `tower-sun`, `henge-sun`, `tower-moon`, `henge-moon` |
| Which way the sun or moon lies | `needleSvg` / `drawNeedle` |

Clear, some cloud, overcast and rain can be told from what `weather.js` fetches today (cloud
cover by layer, precipitation). It does not fetch a weather code, so nothing can say
"thunderstorm" yet: the icon is ready, the data is not. The light phases are the five of
`src/lib/lightPhases.ts`.

## Dan's feedback: marks, needle, drone, tooltips

Dan's three points (recorded in the panel spec) and what this set offers for each.

### 1. The two orange dots

**Which two.** A sun event behind the TV tower and a sun event down a street (a street henge)
are drawn with the same orange mark wherever they meet:

| Place | File and lines | Tower alignment, sun | Street henge, sun |
| --- | --- | --- | --- |
| Three-day strip, a tick per shot | `sparkstrip.js:73–91`, `miniature.css:328–332` | orange diamond on a stem (`spark-sun`) | the same orange diamond; ticks are nudged apart (`MIN_GAP`) but still touch |
| Bars above the time slider | `plan.js:189–216` (rows), `plan.js:222–238` (bars), `miniature.css:225–229` | `--sun` bar, 3 px at its shortest, so a dot | `#d9a441` bar on the row below: a second orange |
| List rows | `daylist.js:188–192` `bodyIcon()`, used at `daylist.js:172`, `planmode.js:233`, `dates.js:110` | two-tone orange disc | the same disc |
| Street chips | `miniature.css:238–240` `#moments button::before` | | 8 px `--sun` dot |
| Map and minimap | `overlay.js:208–218`, `minimap.js:110–118` | white disc with an orange ring (the sphere spot) | a glowing street, no dot |

Dan's screenshots are not in the repo, so which of the first three he was looking at is a
reading of the code, not a certainty. The strip is the one where two marks overlap.

**The family** (`markSvg`, `drawMark`, `MARK_NAMES` in `marks.js`). What happens sets the
shape, which body sets the fill:

| | Sun | Moon |
| --- | --- | --- |
| Tower alignment | `tower-sun`: orange ring, white inside | `tower-moon`: blue ring, dark inside |
| Street henge | `henge-sun`: solid orange upright bar | `henge-moon`: blue upright bar, dark inside |

Every mark has a halo in the surface colour, so two that overlap remain two.

**Judged against the alternatives** at 8, 10, 12 and 14 px, light and dark, alone and as six
overlapped pairs (specimen, "Event marks: three candidates"):

- *Today* (every event a dot): the orange and ochre dots are one blob when they overlap, in
  either order, and differ by hue alone when apart.
- *Dan's suggestion, literally* (only the sun behind the tower becomes a white-filled ring):
  it does fix the pair he named, and it matches the ring the map already draws for the sphere
  spot. It leaves the moon's two events as identical blue dots, and sun against moon as
  colour alone.
- *Chosen*: Dan's ring kept for the tower, a bar for the street, and the moon's marks dark
  inside. Any two of the four differ in shape or in fill, at 8 px too, and a ring over a bar
  or a bar over a ring both show two marks. Street henges take the body's colour; the third
  orange (`#d9a441`) is no longer needed.

A mark still never stands without its words: `MARK_NAMES[kind]` in the row, the tooltip or
the `label`.

### 2. The direction arrow

Today: `overlay.js:106–118` in `drawPill()`, a solid triangle 11 long and 12 wide in the text
colour, used for both pills on the map (`overlay.js:300`) and at eye level (`overlay.js:655`).
It is wider than it is long, which is why its tip is ambiguous.

`needleSvg({ kind, angleDeg, size })` and `drawNeedle(ctx, x, y, angleRad, length, { kind, ink, halo })`
draw a kite about twice as long as it is wide with a notched tail. The front half is the
body's colour (sun `#f26a12`, moon `#5b82ff`, the colours of that body's lines on the map), the
back half is ink: as on a compass, the coloured end is the one that points. On the map use a
length of 18 and pass the pill's fill as `halo`. The specimen shows it at eight rotations and
on canvas pills.

The swap in `drawPill()`: replace the triangle's `save … restore` block with
`drawNeedle(ctx, x + ux * (reach + 12), y + uy * (reach + 12), Math.atan2(uy, ux), 18, { kind: moon ? 'moon' : 'sun', ink: night ? '#ece8df' : '#24221f', halo: <the pill fill> })`.

### 3. The drone icon

Today: `walk.js:94` `DRONE_ICON`, four rings and a square seen from above, set at
`walk.js:128`. From above a quadcopter is an abstract X; nothing says "camera in the air".

`drone` is now a drone seen from the front: two rotors, the body, and the camera hanging under
it. `walk` (a walking figure) is its counterpart for being on foot. On the specimen the two
sit beside `eye` and `camera` at 20 and 24 px and in 40 px buttons; no two share a silhouette.
This is my reading of a render. Nobody outside has been asked whether it now says "drone".

### 4. Tooltips and accessible names

`CONTROL_NAMES` in `controlNames.js` holds the wording, and
`nameControl(button, 'layers')` sets icon, `title`, `data-tip` and `aria-label` in one call.
The tooltip names the thing in two or three words; the accessible name says what it does.

| Control | `id` today (`plan.astro` line) | Icon | Tooltip | Accessible name |
| --- | --- | --- | --- | --- |
| compass | `#compass` (26) | `compass` | Face north | Compass: turn the map to face north |
| face-tower | `#face-tower` (27) | `tower` | Face the TV tower | Turn to face the TV tower |
| face-sun | `#face-sun` (28) | `sunSvg` | Face the sun | Turn to face the sun |
| face-moon | `#face-moon` (29) | `moonSvg` | Face the moon | Turn to face the moon |
| locate | `#locate` (30) | `locate` | My location | Stand where you are now |
| help | `#help` (31) | `help` | How this works | How this works |
| layers | `#layers` (32) | `layers` | Map layers | Map layers: choose what the map shows |
| tilt-flat | `#tilt` (33) | text | Flat view | Switch to the flat view from above |
| tilt-angled | `#tilt` (33) | text | Angled view | Switch to the angled view |
| photographer | `#photographer` (34) | `camera` | Stand here | Stand here: drag onto the map, or tap to stand in the middle |
| back | `#back` (121) | `arrow-left` | Back to the map | Back to the map |
| takeoff | `#takeoff` (122) | `drone` | Drone view | Take off: see this spot from a drone, up to 120 metres |
| land | `#takeoff` (122) | `walk` | Back on foot | Land: return to eye level on foot |
| go-there | `#share` (123) | `pin` | Go there | Go there: directions, calendar and a link to this view |
| directions | `#directions` (126) | `pin` | Directions | Directions to this spot |
| calendar | `#calendar` (127) | `calendar` | Add to calendar | Add this shot to your calendar |
| copy-link | `#copylink` (128) | `link` | Copy link | Copy a link to this exact view |
| share-link | `#copylink` (128) | `share` | Share | Share a link to this exact view |
| expand | `#sheet-toggle` (145) | `chevron-up` | Show more | Show more of the panel |
| collapse | `#sheet-toggle` (145) | `chevron-down` | Show less | Show less of the panel |
| close | (new) | `close` | Close | Close |
| more | (new) | `more` | Lens and format | More: lens and camera format |
| filters | (new) | `tune` | Filters | Filters: which shots to show |
| minimap | `#minimap` (142) | `minimap` | Minimap | Minimap: where you stand. Tap to go back to the map |
| lens | (new) | `lens` | Lens | Lens: choose the focal length |
| thirds | `#thirds` (178) | `thirds` | Thirds | Show lines at thirds |
| reaim | (new) | `aim` | Re-aim | Re-aim the camera at the shot |
| view-here | `#viewhere` (139) | `eye` | View from here | View from here at eye level |
| shot-earlier | (new) | `shot-earlier` | Earlier shot | Go to the earlier shot |
| shot-later | (new) | `shot-later` | Later shot | Go to the later shot |
| minute-back | (new) | `minus` | 1 minute earlier | One minute earlier |
| minute-forward | (new) | `plus` | 1 minute later | One minute later |
| now | (new) | `now` | Now | Go to the present minute |
| play | (new) | `play` | Play | Run time forward |
| pause | (new) | `pause` | Pause | Pause time |
| prev-day | `#prev-day` (183) | `chevron-left` | Previous day | Previous day |
| next-day | `#next-day` (190) | `chevron-right` | Next day | Next day |
| pick-date | `#date` (187) | `calendar` | Choose a date | Choose a date |
| more-dates | `#dates-toggle` (175) | `calendar` | More dates | More dates from where you stand |

`2D`/`3D`, `±30 min`, `Today` and `Advanced` stay words and need no tooltip. The existing
`title` attributes ("TV tower", "Sun", "Moon", "Where am I?", "Layers", "How this works",
"Lines at thirds") are replaced by the tooltips above; `#compass`, `#tilt`, `#photographer`,
`#back`, `#takeoff` and `#share` have none today.

## Audit: what the planner draws today

Found in `src/pages/plan.astro`, `src/miniature/*.js` and `src/miniature/miniature.css` on
`main` at 597b270. `public/` holds photos, landmark sprites and the favicon, no interface icons.

### Inconsistencies

- **Five suns.** A rayed orange sun (`#face-sun`, flat `#f26a12`, 2-unit stroke); a two-tone
  disc `#f8a03a`/`#ffd27a` in the layers pill and in every list row (`bodyIcon`), the same at
  noon and at sunset; a plain `--sun` dot in filters, intro cards and "View from here"; a
  filled dot with a white ring on the horizon strip; and the photographic disc from `sunLook`
  in the map's direction pill. Only the last follows the rule.
- **Five moons.** A solid blue crescent (`#face-moon`); a phase disc `#2a3150`/`#e8ecff` in
  the layers pill and panel head; the same with a blue ring in list rows; a plain `--moon`
  dot in filters and on the minimap rim; and the `moonLook` disc on `#20263a` in the map pill.
- **Stroke weights from 1.2 to 2.5** across the line icons: 1.3 (thirds), 1.6 (drone, date
  picker, henge tile), 1.7 (layers, share menu), 1.8 (pin, dates), 1.9 (locate), 2 (sun rays).
  Some are filled silhouettes instead (TV tower, photographer, weather cloud).
- **Sizes drift**: 13, 15, 16, 18, 20, 21, 22, 24 and 26 px with no relation to the control.
- **Type as icons** next to drawn ones: `?`, `2D`, `←`, `↑`, `↗`, `›`, `‹`, `⌃`, `±`, and an
  "Aa" set in the system font inside an SVG.
- **Meaning by colour alone**: the grade dots (green, amber, red) on plan cards and the
  weather line, with the word only in a `title`; the red half of the compass needle; the
  sun/moon filter dots; the `#eclipse` status dot; the intro cards' dots; the white dot on
  the layers button for heavy cloud.
- **Per-widget CSS sets stroke widths** (`.shareitem svg`, `#dates-toggle svg`, `.daypick svg`,
  `#thirds svg`), which is how the weights drifted. No emoji are used.

### Mapping: each thing found, and its replacement

| Where today | What it is today | Means | Replace with |
| --- | --- | --- | --- |
| `plan.astro` `#compass` | red and grey needle, filled | face north | `icon('compass', { size: 22 })`. `chrome.js` rotates `compass.querySelector('svg')`; that keeps working |
| `#face-tower` | filled tower silhouette | turn to the TV tower | `tower` |
| `#face-sun` | rayed sun, flat orange | turn to the sun | `sunSvg({ altitudeDeg: sunAt.alt, size: 26 })`, refreshed in `lighting.js` where it already toggles `hidden` |
| `#face-moon` | blue crescent | turn to the moon | `moonSvg({ …illumination, altitudeDeg, sunAltitudeDeg, size: 26 })`, same place |
| `#locate` | outline arrow, 1.9 stroke | stand where you are | `locate` |
| `#help` | the letter `?` | how this works | `help` |
| `#layers` | 3 layers, 1.7 stroke | map layers | `layers` |
| `#layers.clouds-heavy::after` | white dot | heavy cloud today | keep the dot only with a text equivalent in the button's label ("Layers, heavy cloud today") |
| `#tilt` | text `2D` / `3D` | flat or angled view | keep as text: it is a word, not a picture |
| `#photographer` | filled figure with camera | drag to stand there | `camera` (the map marker is already a camera badge) |
| layer row: tower | tower and orange line | layer: tower alignments | `tower-line` |
| layer row: streets | two lines and a yellow bar | layer: street henges | `henge` |
| layer row: weather | filled cloud | layer: weather | `cloud` |
| layer row: clouds | cloud outline and line | layer: clouds on the map | `cloud-map` |
| layer row: trees | green ball on a stick | layer: trees | `tree` |
| layer row: names | "Aa" as SVG text | layer: street names | `names` |
| `.body-pill` Sun | two-tone disc | show the sun | `sunSvg({ altitudeDeg, size: 16 })` of the current minute |
| `.body-pill` Moon `#layers-moon` (`chrome.js:77`) | phase disc | show the moon | `moonSvg({ …, size: 16 })` |
| `.legend` line samples | 40×12 line swatches | what the map's lines mean | keep: they are samples of the map's own marks, not icons |
| `.legend summary::after`, `#flatmap` `›` | `›` glyph | opens | `chevron-right` at 16 |
| `.intro-shot b i` | sun, moon, ink dots | which body the shot is of | `sunSvg` / `moonSvg` at 12–14 for the two bodies, `drone` for the drone card |
| `#back` `← Map` | arrow glyph | back to the map | `arrow-left` (or `map`) + "Map" |
| `#takeoff` `↑ Take off`, `walk.js:94` `DRONE_ICON` | arrow glyph; drone with 4 rings from above | take off, land | `drone` with "Take off", `walk` with "Land" (`takeoff` remains for a bare lift-off arrow) |
| `#share` "Go there", `#directions` | pin, 1.8 stroke | go there, directions | `pin` |
| `#calendar`, `#dates-toggle`, `.daypick` | calendar at three weights | add to calendar, more dates, pick a date | `calendar` |
| `#copylink` | chain links | copy or share link | `link`; `share` where the system share sheet opens |
| `#sheet-toggle b` `⌃` | caret glyph | expand or collapse the sheet | `chevron-up` / `chevron-down` |
| `#mode-toggle` `Advanced ›` / `‹ Shots` | angle glyphs | switch panel mode | `chevron-right` / `chevron-left` after or before the word |
| `#moon-head-disc` (`planmode.js:46`) | phase disc | today's moon | `moonSvg({ …, size: 18 })` |
| `planmode.js:49–50` `↑ 17:41 · ↓ 06:12` | arrow glyphs | moonrise, moonset | `rise`, `set` at 14–16 with "rises"/"sets" in the accessible text |
| `.plan-filter` and `#dayfilter` dots | `--sun` / `--moon` dots | filter by body | `sunSvg` / `moonSvg` at 12–14 beside the words (the words stay) |
| `daylist.js` `bodyIcon()` (rows in `daylist.js`, `planmode.js`, `dates.js`) | two-tone sun; phase moon with blue ring | the body of that row | `sunSvg({ altitudeDeg: row altitude, size: 20 })` / `moonSvg({ … })`. `bodyIcon(body, t)` needs the altitude at `t`: the rows compute `bodyAlt` for their text but do not keep it, so store it on the row or sample it |
| `.planrow .grade` (`planmode.js:233`) | green / amber / red dot, word in `title` | verdict for the shot | the word "Go" / "Maybe" / "Skip" with its reason, and `verdict-go` / `verdict-maybe` / `verdict-skip` at 16 before it. `good` → Go, `fair` → Maybe, `poor` → Skip |
| `.weather-line span::before` (`forecast.js`) | grade dot | light forecast for sunrise and sunset | the same verdict word and icon; `weatherIcon(state, { body })` for the sky |
| `dates.js:99` `.sun-state` dot | coloured dot | sun state at a future date | verdict word and icon as above |
| rows `<em>Go ›</em>` | text and `›` | open this shot | `arrow-right` at 16 after "Go". Note the clash: once "Go" is a verdict, this action wants another word ("Open", "View") |
| `#eclipse::before` | 8 px dot in `--dot` | status: body near the sphere | `sunSvg` / `moonSvg` at 12 with `glow: false` |
| `#airspace` `↗` | arrow glyph | opens another site | `external` at 14 |
| `#thirds` | grid, 1.3 stroke, 16×12 box | lines at thirds | `thirds` |
| `#format` select arrow (CSS data URI) | chevron | opens a list | `chevron-down` path, same weight; it lives in CSS, so copy the path `M6 9.5l6 6 6-6` |
| `#fine` `±30 min` | text | fine timing | keep as text |
| `#prev-day` `‹`, `#next-day` `›` | angle glyphs | previous, next day | `chevron-left`, `chevron-right` |
| `#viewhere` dot (`pointer.js:123,150`) | `--sun` / `--moon` dot | view from here, for that body | `sunSvg` / `moonSvg` at 14, or `eye` when no body applies |
| `.spark-tick::after` (`miniature.css:328–332`, `sparkstrip.js:73–91`) | diamond (sun) or dot (moon), same for tower and street | a shot on the day strip | `markSvg(kind, { size: 10 })`, kind from the row: `tower-sun`, `henge-sun`, `tower-moon`, `henge-moon` |
| `.track--sun`, `.track--moon`, `.track--streets` bars (`plan.js:189–238`, `miniature.css:225–229`) | orange, blue and ochre bars, dots when short | when things line up today | a `markSvg` at the peak of each run, the bar kept for its length in the body's colour |
| `#moments button::before` (`miniature.css:238–240`) | `--sun` / `--moon` dot | a street henge chip | `markSvg('henge-sun' \| 'henge-moon', { size: 10 })` |
| `kbd` `←` `→` `⇧` | key legends | keyboard keys | keep: they name keys |
| `#loading i` | CSS spinner | building the city | keep |
| `overlay.js` `drawDisc()` in the direction pill | `sunLook` gradient disc; `moonLook` on `#20263a` | where the sun or moon lies | `drawSun(ctx, x, y, 7.5, body.alt, { glow: false })` / `drawMoon(…)`. Same colours; adds the rim, and the moon's dark ring |
| `overlay.js:106–118` pill arrow | solid triangle, 11 long, 12 wide | which way the body lies | `drawNeedle(…)`, see "The direction arrow" above |
| `overlay.js:208–218`, `minimap.js:110–118` sphere spots | white disc, ring in the body's colour | where to stand for the sphere | `drawMark(ctx, 'tower-sun' \| 'tower-moon', x, y, 16)`: the same ring for the sun, dark inside for the moon |
| `overlay.js` eclipse ring, photographer badge | canvas shapes | closeness, where you stand | keep: map marks, not interface icons. The badge's camera could follow `camera` later |
| `horizon.js:100–112` | 4 px dots in `sunCol` / `moonCol` | bodies on the horizon strip | `drawSun` / `drawMoon` with radius 4.5, `glow: false` |
| `minimap.js:176` | 4.5 px `--sun` / `--moon` dots on the rim | which way the bodies lie | `drawSun` / `drawMoon` with radius 4.5, `glow: false` |
| `minimap.js:184` | red "N" in a disc | north | keep |
| `sky.js` shader sun and moon | the bodies in the 3D sky | the real thing | keep: it is the scene. It reads the same palette |

### What the adopting change has to touch

This work added files only. To use the set, the panel work needs these edits in files it owns:

- `miniature.css`: remove the per-widget `stroke-width` rules on `svg` (`.shareitem svg`,
  `#dates-toggle svg`, `.daypick svg`, `#thirds svg`). CSS beats the SVG's own attributes, so
  while they stay, those icons keep the old weights. Add
  `.ue-icon, .ue-body { flex: none; display: block; }` once.
- `daylist.js` `bodyIcon(body, t)`: give it the body's altitude (and the sun's, for the moon),
  then return `sunSvg` / `moonSvg`. It is the one function behind every list row.
- `planmode.js`, `forecast.js`, `dates.js`: turn the grade into the word with its icon.
- `plan.astro`: swap the inline SVGs for `setIcon` calls at start-up, or paste `icon()` output.

## Not done, and open

- The icons were judged on a headless Chrome render of the specimen at 2× in both themes, not
  on a phone and not inside the running planner.
- At 16 px the night, twilight and blue-hour marks are quiet; they depend on the word beside
  them, as rule 1 says.
- A white midday sun on the light surface is held by its gold rim and halo. It is legible but
  it is the weakest pairing in the set; on the dark surface every altitude is strong.
- No raster or generated assets were made for this set. Everything is drawn.
