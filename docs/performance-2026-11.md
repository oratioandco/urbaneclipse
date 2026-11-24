# Planner performance, 2026-11-23

What `/plan/` costs to load and to draw, what was fixed on branch
`claude/planner-performance-0f3e92`, what was left alone, and what the planned weather overlay
may cost. Baseline is `main` at 597b270.

## How it was measured, and how far to trust it

`scripts/miniature/perf.mjs` drives a production build (`npm run build`, `astro preview`) in the
installed Chrome, headless, through Playwright and the DevTools protocol. Two profiles:

- **phone**: 390x844, device scale 3, touch (the app caps the scale at 2, so a 780x1688 buffer)
- **desktop**: 1440x900, device scale 2

The city geometry is not in git, so the script answers `/city/` from the live site (read-only)
through a disk cache. Transfer sizes of city files are the gzip sizes the live server sent.
The weather forecast is answered with a fixed partly cloudy day, so the cloud shaders run and
every run sees the same sky. Each drag is 91 steps of the time slider from 10:00 to 19:00, one
step per animation frame.

| Kind of number | Trust |
|---|---|
| Requests, bytes, draw calls, triangles, textures, programs, frames drawn | Exact and repeatable |
| Main-thread time (script per step, long tasks, handler time) | Good for before/after. Absolute values are an Apple M1; `--cpu=4` slows the main thread four times, which is the usual stand-in for a mid-range phone's CPU, not a measurement of one |
| Frame intervals | Headless Chrome used the real GPU here (ANGLE Metal on an Apple M1), not the software rasteriser, so they are real for this Mac. They say nothing about a phone's GPU, and they snap to the 60 Hz refresh (16.7, 33.3 ms) |
| Wall-clock times (first frame, city built) | Noisy: other sessions were building and testing on the same machine (load average 5 to 54). Compared only as interleaved base/new runs, 3 or 4 rounds |
| Memory | JS heap from DevTools (excludes typed arrays). Geometry and texture memory is counted from the buffers, not measured on the GPU |

## Baseline

### What is sent

| | Requests | Transfer |
|---|---:|---:|
| HTML, CSS | 2 | 11 KB |
| JavaScript | 3 | 279 KB (main script 957 KB, 271 KB gzipped) |
| Images, icons, moon texture | 7 | about 150 KB |
| Tower viewshed (`/viewshed/fernsehturm.bin`) | 2 | 1.0 MB |
| City start-up files (manifest, map, roads, streets, terrain) | 6 | 1.9 MB |
| Trees | 2 | 2.4 MB |
| City tiles, phone view | **665** | **11.2 MB** |
| City tiles, desktop view | 522 | 16.4 MB |

- The main script is one file. About 750 KB of its 957 KB is libraries: three.js with its
  post-processing add-ons, and the whole `meshoptimizer` package (encoder, simplifier,
  clusterizer and tangent tool besides the decoder the page uses).
- **Of the 355 coarse tiles, 245 to 280 were fetched twice.** The start-up pass and the per-frame
  level picker both asked for them. A real browser may answer the second from its cache; the
  request, the decode and the upload still happened twice.
- The six start-up files were fetched one after another, so each waited a round trip.
- Tiles and the other `/city/` files are cached for 30 days under `?v=`. The viewshed is served
  `no-cache` (it has no version in its address), which costs one conditional request a visit.

### Start-up

| | Phone profile, M1 | Phone profile, 4x CPU |
|---|---:|---:|
| First contentful paint | 0.15 to 0.7 s | 0.4 to 1.0 s |
| First rendered frame (ground and tower) | 0.5 to 0.7 s | 1.4 to 1.6 s |
| "City built" (all 355 coarse tiles shown) | 2.1 to 2.9 s | 7.8 to 9.7 s |
| Frames drawn until then | 60 to 75 | 155 to 200 |
| Long tasks until then | 7, 1.0 to 1.2 s in all, longest 0.7 s | 7 to 9, 3.3 to 4.0 s in all, longest 2 s |

From a served-from-disk cache, so without network time. Where the main thread goes during
load (dev build, M1): the frames drawn while tiles arrive 1.2 s (half of it the 2D overlay),
`start()` 0.65 s (of it: recolouring the mini map's ground 0.26 s, `updateDay()` 0.24 s), the
day's paths and the three-day plan cards 0.4 s, tile decoding 0.13 s.

### A frame

The page draws **on demand**: 0 frames in 5 s of idle. (At night the tower's red lights wake
one frame per blink while the tower is on screen.) A hidden tab draws nothing, since everything
hangs off `requestAnimationFrame`.

| | Phone view | Desktop view |
|---|---:|---:|
| Drawing buffer | 780x1688 (ratio 2) | 2448x1530 at most; the scaler settles at 0.6 to 1.7 |
| Frame without the shadow pass | 81 calls, 3.01 M triangles | 152 calls, 7.52 M triangles |
| Frame with the shadow pass | 183 calls, 4.49 M triangles | 273 calls, 11.52 M triangles |
| Shadow map | 2048², one, PCF | 4096² |
| Building triangles held | 2.39 M | 4.71 M |
| Textures / shader programs after load | 7 / 13 | 7 / 19 |
| ... after a drag through dusk | 18 / 27 | 18 / 33 |
| Passes | shadow, water mirror (half size), scene, bloom (when lights are on), edge blur, output; all colour targets half-float |
| JS heap after load | 13 to 45 MB used (garbage-collector noise), about 85 MB reserved |
| Geometry buffers (counted) | 39.8 MB indices, 13.5 MB vertices | 63.2 MB, 20.1 MB |

The triangle budget (1.2 M on a phone, 5 M otherwise) is not what is drawn: the coarse city
alone is 1.5 M, the tilted start view sees nearly all of it, and the water mirror and the
shadow map each draw their share again.

### A drag of the time slider

Every step: `updateSun()` (sun and moon position, the light rig, uniforms, the clock and phase
label, the horizon strip, live street henges, the tower spots), then one frame that picks tile
levels, updates trees, **refits and redraws the shadow map**, redraws the water mirror, draws
the scene and the post passes, and redraws the whole 2D overlay canvas. Not recomputed: the
day's eclipse paths, the viewshed, sightlines (per day or per stand).

| Phone profile | M1 | 4x CPU |
|---|---:|---:|
| Input handler (`updateSun`), median | 0.5 ms | 1.9 to 2.4 ms |
| Script per step | 6.6 to 8.0 ms | 20 to 23 ms |
| Frame interval, median / p95 | 17 to 20 / 24 to 47 ms | 23 to 30 / 33 to 57 ms |
| Layouts / style recalcs per step | 1 / 2 (0.3 ms) | 1 / 2 (1.1 ms) |
| Long tasks during the drag | 2 to 3, 0.1 to 0.3 s (shaders compiling as dusk arrives) | 0.2 to 2.4 s |
| Pixel ratio after two drags | 2.0 | **0.6 to 1.1** |

Three things stood out:

1. **The 2D overlay was about 40% of the main thread's work in a drag.** Every frame it
   projected all 9,351 name anchors and every point of the day's paths again, though only the
   time had moved.
2. **The shadow pass is a third of the frame's triangles** (1.5 M of 4.5 M on a phone view) and
   is redrawn on every step and every pan frame.
3. **The resolution scaler made things worse on a slow CPU.** It steps down on any slow frame.
   Under the 4x throttle the buffer fell to 0.6 to 1.1 (a blurry picture) while the frame time
   stayed the same, because pixels were not what was slow.

Desktop view on the M1: a drag frame is 11.6 M triangles, median 33 to 40 ms, and the scaler
ends at 0.6 to 0.86. That is the graphics card running out of triangles, not pixels.

## Ranked: benefit on a mid-range phone against risk and effort

| # | Finding | Benefit | Risk / effort | Done |
|---|---|---|---|---|
| 1 | Overlay recomputes names and paths every frame | High: 40% of drag main-thread time | Low | Yes |
| 2 | Coarse tiles fetched twice | High on first load: 280 requests, 3.4 MB | Low | Yes |
| 3 | Resolution drops when the CPU is the limit | High: full sharpness kept | Low, unit-tested | Yes |
| 4 | Shadow map redrawn every step and pan frame | Medium to high on weak devices | Low to medium: shadows trail a frame in motion | Yes, only when frames run slow |
| 5 | Start-up files fetched in series | Medium on a mobile network (5 round trips) | Low | Yes |
| 6 | Whole meshoptimizer package shipped | Medium: 44 KB gzipped, four WebAssembly modules not set up | Low | Yes |
| 7 | 32-bit tile indices | Medium: 24 MB less on a phone view, twice (page and GPU) | Low | Yes |
| 8 | Mini map ground recoloured during start-up | Low to medium: 0.26 s (M1) off the path to "city built" | Low | Yes |
| 9 | Plan cards and day paths computed on the main thread at start-up; forecast retry loop | Medium | In files the panel session owns | No, reported |
| 10 | Shaders compile the first time dusk arrives (0.1 s on the M1, likely 0.5 s or more on a phone) | Medium, once per visit | Medium: needs every material state warmed up | No |
| 11 | 355 coarse tiles as 355 requests | Medium on a slow line | Needs a data rebuild and upload | No |
| 12 | Mirror pass draws near-water buildings at full detail | Medium (0.6 M triangles on a phone view, 2.6 M on desktop) | Changes the reflections | No |
| 13 | three.js is most of the script | Low: it is needed before the first frame | High | No |

## What was changed

Each change was measured before and after. Nothing changes how the page looks on a device
that keeps pace: screenshots of the phone view before and after are 99.9% identical pixels
(the rest is the stats line). The one visible trade is #4, and only on devices that measure slow.

1. **Each tile fetched once; start-up files together** (`tiles.js`, `main.js`, `trees.js`).
   The level picker now waits for a tile's coarse level instead of asking for it as well.
2. **Overlay keeps names and paths while the view stands still** (`overlay.js`). Redone when
   the camera, the window, the panel's height or the live stands change.
3. **Shadow cadence and a scaler that knows its limit** (`quality.js`, `main.js`). When frames
   that redraw the shadow map run slow (over 24 ms), it is redrawn every second frame, at
   worst every third; the owed frame follows at once, so the picture at rest is unchanged.
   The resolution only steps down when less than 60% of a frame goes by on the main thread.
   `quality.shadowEvery` holds the cadence and `?stats` shows it. Three new unit tests.
4. **Mini map ground after the city is up** (`minimap.js`): at an idle moment, or at the first
   look from the street.
5. **16-bit tile indices** (`tiles.js`): no level of any tile has more than 65,535 vertices.
6. **Decoder-only import of meshoptimizer** (`main.js`, `tiles.js`).
7. The measuring script (`scripts/miniature/perf.mjs`).

### Before and after

Phone profile, interleaved base/new runs. Ranges are the runs, not error bars.

| | Before | After |
|---|---:|---:|
| Main script, raw / gzipped | 957 KB / 271 KB | 838 KB / 227 KB |
| Tile requests on first load, phone view | 570 to 665 | 387 |
| Tile transfer on first load, phone view | 11.2 MB | 7.8 MB |
| Tile requests, desktop view | 460 to 522 | 405 |
| Building index memory, phone / desktop view | 39.8 / 63.2 MB | 15.9 / 30.6 MB |
| "City built", 4x CPU, load only (4 rounds) | 7.8, 8.1, 9.5, 9.7 s | 5.7, 6.1, 6.2, 7.1 s |
| "City built", M1 (3 rounds) | 2.2, 2.5, 2.9 s | 2.1, 2.6, 2.9 s (no change) |
| Frames drawn during load, 4x CPU | 154 to 198 | 107 to 114 |
| Long tasks during load, 4x CPU | 3.3 to 4.0 s | 3.6 to 4.2 s (no change) |
| Drag: script per step, M1 | 6.6, 6.6, 8.0 ms | 3.0, 3.5, 4.6 ms |
| Drag: script per step, 4x CPU | 19.9, 21.3, 23.1 ms | 10.5, 11.1, 11.9 ms |
| Drag: frame interval median, 4x CPU | 22.5, 23.2, 26.1 ms | 16.7, 16.9, 17.0 ms |
| Pixel ratio after two drags, 4x CPU | 0.60, 0.99, 2.0 | 2.0, 2.0, 2.0 |
| Pan: frame interval median, 4x CPU | 38 ms | 38 to 40 ms (no change: a pan moves every name) |
| Triangles and calls per frame | 4.49 M / 183 | the same; half as often when the cadence is 2 |

The fetch changes show no gain in "city built" on the M1 because the files come from a local
disk here; the saved round trips and megabytes only count on a real network. The shadow cadence
engaged in the runs where the machine was busiest (cadence 2, 45 of 91 frames with a shadow
pass) and on the desktop view, where the buffer then stayed at 0.75 to 0.88 instead of 0.6.

## Measured and left alone

- **Triangles per frame.** 3 M without and 4.5 M with shadows on a phone view is the real load,
  and no setting here lowers it at rest. Lowering it means a coarser far city, a smaller
  mirror pass or coarser shadow casters, and each changes the picture. Worth doing only after
  a real phone shows it is needed; the cadence covers motion in the meantime.
- **Shader compiles at dusk** (#10). Warming them up after load is possible
  (`renderer.compileAsync` over each material state) but touches every material; not done.
- **One request per coarse tile** (#11). Packing the 355 coarse tiles (5.0 MB) into one file
  needs `scripts/miniature/build_city.mjs`, a rebuild, an upload and a `CITY_VERSION` bump.
- **The viewshed's cache header.** It could be cached like `/city/` if its address carried a
  version; today it revalidates, which is one small request.
- **The main-thread work at start-up in `plan.js` and `planmode.js`** (#9) belongs to the panel
  session. Notes are in the shared notes folder.
- **The panel 05 sweep on `/classic`** (4 to 11 s on the main thread, from the handoff) is not
  part of `/plan/` and was not touched. It still wants a Web Worker.
- **The NaN bounding sphere** three logs at load: one mesh of 97,236 vertices with NaN
  positions. It is never culled, so it is drawn in every pass. Not traced to its builder.
- **Code splitting.** The script is needed before the first frame, and what could load later
  (the dates search, sharing, the intro logo) is small next to three.js.

## The planned weather overlay

The spec (`explorations/slider-panel-2026-11/SPEC.md` on `wip/slider-explorations`) wants cloud,
rain and lightning on the map as a screen overlay driven by the time slider. Where it could get
expensive, given the numbers above:

1. **It animates, and the map does not.** Today the planner draws nothing while idle. If
   drifting cloud or falling rain redraws the scene, every animated frame costs 3 M triangles
   and five passes, for as long as the page is open. The overlay must never invalidate the
   scene. Draw it on its own canvas above the map, or as a last pass over the scene's kept
   texture.
2. **Per-pixel noise.** The existing cloud decks (`clouds.js`) and the cloud shadows in the
   city shaders evaluate a five-octave noise up to three times a pixel per deck. A full-screen
   overlay doing the same at 1.3 megapixels would cost more than the scene. Use the baked
   36-frame atlas from the sketches: two taps to blend frames, one more for rain.
3. **Half-float full-size targets.** Each extra full-screen pass in the composer reads and
   writes 1.3 MP at 8 bytes a pixel. Add no pass and no full-size target to the composer.
4. **Two cloud systems at once.** With the overlay on, switch the in-scene decks off, or the
   device pays for both and the clouds disagree.
5. **Lightning as light.** Relighting the city for a flash means a shadow pass and a scene
   frame per flash. A flash is a brightness uniform in the overlay for two or three frames.

**Frame budget.** At 60 Hz a frame has 16.7 ms and a drag frame on a phone view already fills
it on an M1. The overlay gets:

- at most **2 ms of GPU time** on the target phone, measured there, or **10% of the frame
  interval** with the overlay on against off in `perf.mjs`
- at most **3 texture taps a pixel**, no loops, no noise functions
- its own target at **half size** (a quarter of the pixels) or smaller, 8-bit
- one atlas of at most **2048²** single-channel (4 MB); 1024² on phones
- **30 frames a second at most** when nothing else moves; it rides along with the scene's
  frames when they are being drawn anyway
- nothing in the slider's input handler beyond setting uniforms

**Quality tiers.** Decided once the first 60 frames have been drawn, from what `quality.js`
already knows, and only ever stepped down during a visit:

| Tier | Rule | Overlay |
|---|---|---|
| Full | pixel ratio at the screen's maximum and `quality.shadowEvery === 1` | Half-size, animated at 30 fps |
| Still | `isPhone`, or `navigator.deviceMemory <= 4`, or the pixel ratio below the screen's maximum | Quarter-size, one still frame per slider position, no idle animation |
| None | `quality.shadowEvery > 1`, or pixel ratio below 1, or `deviceMemory <= 2`, or `navigator.connection.saveData`, or a software renderer | No map overlay; the timeline's sky strip, as the spec allows |

In every tier: paused while `document.hidden` or while the sheet covers the map, a still frame
under `prefers-reduced-motion`, and demoted one tier if the frame interval with the overlay
rises by more than 4 ms over a 30-frame window.

## What needs a real phone

- Every absolute frame time. Nothing here says whether a mid-range phone holds 60, 30 or 15
  frames a second in a drag, or whether it is limited by triangles, pixels or the CPU.
- Whether the shadow cadence engages there, and whether shadows trailing by one frame are
  visible to the eye during a drag or a pan.
- Start-up on a mobile network: the parallel start-up fetch and the 280 fewer requests should
  show there and cannot be seen from a local disk.
- Memory on iOS Safari, which closes pages well below what a desktop allows. Counted, not
  measured: about 16 MB shadow map, 21 MB ground map with mip levels, 30 MB of half-float
  targets, 27 MB of building geometry on a phone view.
- Half-float render targets and the 2048² shadow map on Safari and on older Android GPUs.
- The shader compile stall when dusk first arrives.
- Heat: a long drag session on a phone throttles, and the scaler and cadence will then move.

## Running it again

    npm run build && npx astro preview --port 4403 &
    node scripts/miniature/perf.mjs http://localhost:4403 phone --gpu \
      --city=https://urbaneclipse.oratio.co --cache=/tmp/city-cache --shot=/tmp/plan.png

Add `--cpu=4` for a slow main thread, `desktop` for the large view, `--load-only` for start-up
alone, `--profile=<file>` for a CPU profile of the drag, `--requests` for the request list.
Without `--gpu` Chrome falls back to its software rasteriser, which did not finish a run with
the city in it inside ten minutes. Run base and new builds in turn and several times: single runs on a busy
machine differ by a factor of two.
