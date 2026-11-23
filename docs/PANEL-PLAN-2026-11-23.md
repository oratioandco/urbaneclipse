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
