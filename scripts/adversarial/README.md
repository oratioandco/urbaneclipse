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
| `dst.mjs` | The day view on the two clock-change days: cards, Shot buttons, the thumb |
| `edges.mjs` | Forecast failing and slow, far dates, bad addresses, empty and full days, midnight, other time zones, 320 and 2560 px, keyboard, reduced motion, glass off, reload and back, deep links |
| `dan.mjs` | Dan's three points as close-ups: marks, the direction arrow, the drone button and the tooltips |
| `scrub.mjs` | Dragging the day view's thumb at normal speed and with the CPU slowed four times |
| `rows.mjs` | Every row of the day list for a year, opened through its own `go`: does it arrive at eye level, and is the body where the row says (`__mini.rowSeen`)? With `--mask` it adds the places that fail to `public/viewshed/fernsehturm-scene.json`, which takes them out of the pipeline; with `--trees` the spots with the tree register's trees in the frame to `public/viewshed/trees-in-the-way.json`. Prints how much of each shot's disc and target buildings and trees hide where it opens; `--before` measures with the earlier one-ray check, `--step=3` samples the year |
| `crawl.test.ts` | The scene mask and the tree list by asking the page about every tower row's own spots, round after round until the year's list is stable (`npx vitest run -c scripts/adversarial/vitest.config.ts`; `MASK_FROM_EMPTY=1` starts the mask over). Quicker than `rows.mjs --mask` round by round with a build between; `rows.mjs` afterwards is the proof |
| `sameshots.mjs` | `/plan/`'s day list and `/map`'s lists for the same days: the same shots at the same times, written the same way |
| `probe.mjs`, `dump.mjs` | One state looked at by hand: a query, a few steps, a render and the panel's words |
