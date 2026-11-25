# Adversarial test scripts, November 2026

The scripts behind `docs/adversarial-test-2026-11.md`. They drive a build of the site in headless
Chrome (Playwright, the installed Chrome, the machine's GPU) and write renders and JSON to `OUT`.
They test; they change nothing in the application.

```sh
npm ci && npm run build
npx astro preview --port 4471 &          # any free port; pass it as BASE
export BASE=http://localhost:4471 OUT=/path/for/renders CACHE=/path/for/the/city/cache
node scripts/adversarial/views.mjs
```

`CITY` is where `/city/` files are read from when the build has none (default: the live site,
read only); they are kept in `CACHE` so later runs need no network. `GPU=0` falls back to the
software rasteriser, which is about five times slower and draws the eye-level sky washed out.

| Script | What it does |
|---|---|
| `lib.mjs` | Browser, sizes, the city cache, the forecast (`live`, `fixed`, `fail`, `500`, `slow`), time zone, locale, location |
| `views.mjs` | The four views at 390 x 844 and 1280 x 800, light and dark: render, console, bytes on a cold load |
| `crossview.mjs` | Words, type, colours and corner radii of the four views, read off the pages |
| `usecases.mjs` | The five core use cases from a cold start, with tap counts; one shot held against itself in every place it appears; the calendar file |
| `accuracy.mjs` | Reads shots off `/plan/` (day lists of five days, the year's dates from one spot), opens them, writes down what the page shows |
| `reference.py` | Checks those against the audit's reference (`scripts/audit/reflib.py`: Skyfield, DE421). Needs Python with skyfield and `data/audit/de421.bsp` |
| `riseset.py` | Sunrise, sunset, moonrise, moonset from the same reference, for the weather line and the moon header |
| `dst.mjs` | The day view on the two clock-change days and a plain one: the first and the last card as the page lists them, the clock, the slider and the card held against each other (exit 1 when they disagree), the Shot buttons |
| `edges.mjs` | Forecast failing and slow, far dates, bad addresses, empty and full days, midnight, other time zones, 320 and 2560 px, keyboard, reduced motion, glass off, reload and back, deep links |
| `dan.mjs` | Dan's three points as close-ups: marks, the direction arrow, the drone button and the tooltips |
| `scrub.mjs` | Dragging the day view's thumb at normal speed and with the CPU slowed four times |
| `rows.mjs` | Every row of the day list for a stretch of days, opened through its own `go`: does it arrive at eye level, is the body where the row says (`__mini.rowSeen`), did it open at its own spot, and do its words about trees match the measure there (`__mini.treeLevelHere`)? With `--mask` it adds the places that fail to `public/viewshed/fernsehturm-scene.json`; with `--trees` the places whose words differ to `public/viewshed/trees-in-the-way.json`. Prints how much of each shot's disc and target buildings and that day's trees hide where it opens; `--before` measures with the earlier one-ray check, `--step=3` samples. Exit 1: a row fails; 2: tree words differ |
| `crawl.test.ts` | The scene mask and the tree list (in leaf and bare) for a stretch of days, by asking the page about every tower row's own spots and every street's stand, round after round until the list is stable; writes the covered days into both files (`FROM`, `DAYS`, `FRESH=1`, `ONLY=streets`; `npx vitest run -c scripts/adversarial/vitest.config.ts`; about an hour and a half for fourteen months). `rows.mjs` afterwards is the proof. How and when to re-crawl: "The days the shots are checked for" in `src/miniature/README.md` |
| `sameshots.mjs` | `/plan/`'s day list and `/map`'s lists for the same days: the same shots at the same times, written the same way |
| `probe.mjs`, `dump.mjs` | One state looked at by hand: a query, a few steps, a render and the panel's words |
