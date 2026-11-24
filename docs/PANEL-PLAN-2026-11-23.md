# Planner panel, phase 1: plan (2026-11-23)

Source: `explorations/slider-panel-2026-11/SPEC.md` on `wip/slider-explorations`, reference sketch
`day-light-glass.html`. This phase rebuilds the bottom panel of `/plan/` as a collapsible, app-like
panel with the one-day view. The three-day home grid and the per-location slider come later.

## What is built, and where

| Spec item | Change | Files |
|---|---|---|
| Phone sheet with three heights (peek, half, full); drag handle with snapping; tap toggles peek and half; moving the map drops to peek; Escape or back steps down; height remembered | New shell replaces the two-state `data-sheet`. Pure height logic is separate from the DOM wiring | new `sheetHeights.js` (pure), new `sheet.js`, `plan.astro`, `miniature.css`, `daylist.js` (`setSheet` kept as a thin wrapper) |
| Peek is one line: next shot and countdown, or a plain sentence | Peek line rendered from the plan's three days | `planmode.js`, new `peek.js` |
| 900 px and wider: side panel that folds to an icon rail | Same markup, other layout; `.bottom` keeps zero height there so the map overlay's bottom inset (read in `main.js`) stays right | `miniature.css`, `sheet.js`, `plan.astro` |
| Eye level: floating ticket (shot name, scrubber, lens and format behind "more", minimap as a corner button) | Camera rows fold behind "More"; minimap behind a round button | `plan.astro`, `miniature.css`, `chrome.js` |
| Verdicts as a word and a reason, no bare dots | One pure function over the existing thresholds; used by plan cards, day list, shot row, weather line | new `verdict.js` (pure), `planmode.js`, `daylist.js`, `miniature.css` |
| Day view: 24 h straight scale, sun and moon curves over a horizon with a dot at the minute, one blended cloud band, rain bars, continuous light bar, shot ticks and shot row (five fit at 390 px, more scroll with a fading edge and a count), free thumb with a time label, glide on tap, minute and shot buttons, vertical swipes scroll | New day view drives the existing `#time` input (kept as the state holder and the keyboard and screen-reader slider), so `clock.js`, `lighting.js` and `link.js` keep working, URL parameters included | new `dayTimeline.js` (pure), new `dayview.js`, `plan.js` (`updateTracks` now redraws the day view; the `#tracks` bars and `#moments` chips go), `plan.astro`, `miniature.css` |
| One sun, one moon | Disc colours from `src/lib/mapBodyLook.ts` in `bodyIcon` and on the curves | `daylist.js`, `dayview.js` |
| Consistency: spacing, radius, control height, type sizes, focus, labels | Tokens added to `:root` in `miniature.css`; applied to everything touched | `miniature.css`, `plan.astro` |

Tests for the pure parts go to `tests/unit/panel.test.ts`.

## Structure for what comes later

- The panel body has two sections: the day view (half height) and planning (full height). The home
  grid replaces the planning section's three-day list; the day view does not change.
- `dayview.js` takes its shots as a list of rows and its time through `#time`, so a slider scoped to
  one stand can reuse it with another list.
- Shot rows carry `kind` and a short name; nothing in the day view assumes the Fernsehturm.

## Left for later

- Three-day home grid with rendered frames; hero card.
- Day slider at one preview location, "Re-aim", shots beyond the forecast window.
- Weather on the 3D map, the animated sky, generated cloud imagery.
- Shot maths for more landmarks: only tower alignments and street henges are shown.
- Thunder marks: the forecast request (`weather.js`, not this session's file) does not ask for it.
- The icon set and the shared sun and moon module (icons session); this phase uses small inline
  marks and `mapBodyLook.ts` directly, to be swapped.

## State at the end of phase 1 (2026-11-23)

Built as planned, on branch `claude/planner-panel-2b8335`, not pushed. Differences from the plan:

- A first tap on a shot card glides the time there; a second tap on the card the thumb stands
  on opens the view from where to stand ("View"). Time and camera stay separate, as the spec
  asks for the preview.
- The credit line (OpenStreetMap, Open-Meteo) moved out of the panel to a small line riding on
  its top edge, so it shows at every height.
- Files touched outside this session's list, each a small change: `overlay.js` (the sun and moon
  pills keep clear of the side panel), `forecast.js` (sunrise and sunset readings worded as
  verdicts; notes whether the forecast failed), `dates.js` ("Go" on a row is now a chevron, since
  "Go" is a verdict), `scripts/miniature/walkthrough.mjs` and `record_clips.mjs` (new selectors).

How much of the screen the panel takes (measured in headless Chrome, 26 Nov 2026 data):

| State | 390 x 844 | 1280 x 800 |
|---|---:|---:|
| Peek / rail | 6% (50 px) | 1% (56 x 212 px) |
| Half (day view) | 46-47% (384-397 px) | |
| Full / side panel open | 93% (leaves 56 px of map) | 28% (372 px wide) |
| Eye-level ticket | 10% (88 px; the walk stick row above it on touch) | 4% (480 x 88 px) |
| Eye-level ticket with More | 23% | 11% |

Open points for the next phase:

- Shots low on the horizon are graded on the cloud overhead only; the sunrise and sunset reading
  (`readSky`) also knows the cloud on the horizon and can disagree with a card's "Maybe".
- A busy day has 19-24 shots (every clear stretch of the tower path, and twelve streets); the
  home grid should rank them, as the three-day list already does.
- The half height is content-sized. Shot cards as rendered frames will need the same budget.

## Dan's feedback (added 2026-11-23, same branch)

1. **Dots.** Event marks differ by shape and fill: behind the tower is a ring (white inside for the
   sun, dark for the moon), a street henge a solid bar (the moon's dark with a rim), each with a
   halo so overlapping marks stay apart. Used on the day view's ticks, the three-day strip and
   the shot cards (`markShape` in `daylist.js`); interim until the icons session's `marks.js`.
2. **Directionality.** The pill's arrow is a compass needle: long and narrow, haloed, with a red
   tip (`drawPill` in `overlay.js`).
3. **Tooltips.** Every toolbar button has a tip (`data-tip`, shown on hover and keyboard focus)
   and an accessible name. The drone icon itself is the icons session's to redraw.

Also: the sun's curve takes the sun's colour for its height from `skyPalette`, as the dot and the
card discs already did from `sunLook`. The event ticks stay in the app's sun and moon colours:
they mark events, and a near-white ring would not show on the light surface.

## Phase 2: finishing for release (2026-11-24, branch `claude/panel-finish-3c13ce`)

1. **Icon set adopted.** One sun and moon (`bodies.js` through `bodyAt.js`), one set of marks
   (`marks.js`), one icon set and one table of tooltips and names (`icons.js`,
   `controlNames.js`; the markup says `data-icon` or `data-control`, `chrome.js` fills them).
   `markShape`, `markIcon`, the old `bodyIcon` and every inline SVG in `plan.astro` except the
   legend's line samples are gone. `tests/unit/panelWords.test.ts` fails if one comes back.
2. **Peek line.** `peek.js` words the next shot in up to six ways (`peekVariants` in
   `shotWords.js`) and takes the fullest that fits: the countdown gives way first, then
   "Straße" becomes "Str." and "Tomorrow" the weekday. Time and verdict are in every wording;
   the type stays 13 px.
3. **Shot cards.** Time, a picture (`shotPicture.js`: the body behind the tower's sphere, on
   its antenna or at the end of a street), SUN or MOON, the place on up to three lines (for a
   tower shot, where to stand: "5.3 km SE"), the verdict with its sign, the reason. More than
   five scroll sideways with a fade at each edge that has more, snap to cards, open at the next
   shot, and the heading counts them ("6 possible from now · 21 in all").
4. **Needle.** `drawPill` draws `drawNeedle` at 28 px, as long as the pill is high.
5. **One timeline at a time.** The tabs moved to the top of the panel and switch two views:
   "Next 3 days" (use case 1: the three overview strips, the filter, the best shots per day)
   and "This day" (use case 2: the day view, which is also the time control, and every shot of
   the day). A day's name on a strip opens that day. Half height is the top of whichever view
   is up: 30 % of a 390 x 844 screen for the overview, 51 % for the day view, whose four step
   buttons now lie just under the fold (full shows them; a keyboard reaching them opens the
   sheet).
6. **One weather grade.** `assess` in `verdict.js`; see its header. Used by the cards, the day
   list, the three days, the date list (`dates.js`) and the sunrise and sunset line
   (`forecast.js`). `readSky` in `weather.js` is no longer called by the planner.

Open after this phase:

- The horizon forecast only looks toward sunrise and sunset. A low moon elsewhere is graded on
  Berlin's sky and says "clear here"; asking Open-Meteo for the moon's own direction needs a
  change in `weather.js`.
- The thresholds (cloud weights 1 / 0.85 / 0.4, 4 degrees, 2.5 times the distance) are reasoned,
  not validated against photographs.
- The sunrise time in the weather line is still 3 to 7 minutes late (audit defect 5, `weather.js`).
- Day view at half is 51 % of a phone screen, up from 46 %: the tabs row is the cost of showing
  one timeline at a time.

### Change to point 3, same day: the approved shot card

The ring-and-name cards of point 3 are replaced by the owner-approved card of
`next-shots-grid.html`, as one component (`shotCard.js`, documented in `src/miniature/README.md`)
used for the day view's strip, both lists' rows and the eye-level ticket. Three cards fit the
strip at 390 px (the spec's "five fit" was for icon cards; a frame needs the width). Half height
with the day view is 53 % of a 390 x 844 screen; the ticket is one line taller (17 %) when it was
opened from a shot. The date list at eye level ("Dates") still uses plain rows with the body's
disc: its entries are dates, mostly beyond the forecast, and were not asked for.
