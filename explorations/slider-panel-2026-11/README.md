# Plan panel and slider explorations (11–12 Nov 2026)

Design sketches for the miniature planner's plan panel: the three-day weather strip and the lens/time slider. They were made with Claude on 11 and 12 Nov 2026 in `/tmp/claude-sketch/`, which was wiped when the old MacBook Air was retired, so they never reached git.

Open `weather-strip-sketches.html` in a browser. It is one self-contained page with nine rounds:

- Sketches 1–8: first pass at the strip
- Round 2: the combination, eight ways
- Round 3: the restructure (A–D)
- Round 4: built from D (A–D); see `notes/round4-*.md`
- Round 5: the critique, built
- Round 6: the brand pass, condensed
- Round 7: Crazy 8, the lens pass (lens on the band, three lanes, the whole panel as one eclipse pill, …)
- Round 8: the assembly round
- Round 9: the mechanism the slider actually teaches
- Round 10 (added 23 Nov, after the critique): the panel as an app. A phone sheet with peek / half / full, a 3-day shot grid, planning one height up, a desktop side panel that folds to a rail, and a floating preview ticket in place of the panel

## How this was recovered

The page was rebuilt from the Claude Code session logs: the original `Write` plus all 183 later edits, replayed in order. The result matches, line for line, the last read-back of the file (12 Nov, 21:42), so this is the final state.

- `icons/lm/*.png`: the landmark sprites, the same files as `public/landmark-sprites/` on `experiment-miniature-city`.
- `icons/moon_disc_*.png`: regenerated from `public/textures/moon-nearside.jpg` with the original script.
- **Missing:** `icons/sun_32.png` and `icons/sun_64.png`. They were AI-generated clay sun icons and can't be rebuilt exactly, so the sun shows as a broken image wherever a sketch uses it.
- `notes/`: the Round 4 brief, the Round 4 designs, the critique brief and the critique.
