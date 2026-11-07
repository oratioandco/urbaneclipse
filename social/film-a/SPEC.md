# Film A: One day, one night

GOAL:    A photographer in Berlin wants to open the planner and find their own shot.
OUTPUT:  HyperFrames, 1080×1920 (story), 30 fps. Then the same film recomposed at 1080×1350 (feed).
TIME:    28 s × 30 = 840 frames. The track is assets/urbaneclipse-A.mp3 (ElevenLabs).
         Measured beat period 0.4195 s, first beat at 0.315 s. Drums drop at 17.815 s; the music ends at 26.6 s.

LOOK:
- **Ground:** the planner's own render, full-bleed. No designed backgrounds except on the end card, which uses night blue #0d1424 sampled from the night city.
- **Ink:** #ffffff, with a soft shadow of 0 2px 18px rgba(0,0,0,.45) for legibility over bright sky.
- **Accent:** sun orange #f26a12, used only on the sun's word in each title and on the end card mark. Moon blue #5b82ff appears only on the word "moon".
- **Display type:** Inter 800, 92 px, tracking −2%, one or two lines, left-aligned at x = 84.
- **Sub-line:** Inter 600, 38 px, 80% opacity. It names the date and place: real data from the planner.
- **Text band:** text sits between y = 200 and y = 560. Nothing readable below y = 1330 except the planner's own UI.

OBJECTS:
- The TV tower, the sun, the moon, a street and the city: all from the real planner render, never drawn.
- The viewfinder is the planner's own overlay, from the -ui footage.

MOTION:
- **Eases:** titles arrive per word with blur 8→0 px and opacity 0→1 over 4 frames, 3 frames apart, no translate. Exits are a blur-out over 5 frames.
- **Footage:** slow push 1.00→1.06 inside each shot.
- **Cuts:** every cut sits on a beat. The cut into the night is the drop: a hard cut on 17.815 s, preceded by a 3-frame dip.

SHOTS:
- **0.00–2.40, hook.** eclipse-clean, pushed in to 1.25 on the sphere. Title "The sun behind the TV tower", with "sun" in orange. Sub-line "3 June 2027 · 20:37:15".
- **2.40–3.64, the reveal.** A blur swap to eclipse-ui at scale 1.0: the viewfinder, the "Behind the sphere" pill, the planner panel. Sub-line "Planned in urbaneclipse".
- **3.64–7.40, noon.** city-noon, orbiting. Title "Every street in Berlin". Sub-line "in 3D, every minute of the year".
- **7.40–14.07, time-lapse.** city-daynight at 2× from 15:00. A large clock reads the real time and ticks with the footage.
- **14.07–17.82, henge.** henge-clean. Title "Sunset down the street", with "Sunset" in orange. Sub-line "Grunewaldstraße · 8 March 2027".
- **17.82–20.30, the drop.** city-night, hard cut. No title for one bar, then "And at night" at 18.6.
- **20.30–22.82, moon.** moon-clean. Title "The moon on the antenna", with "moon" in blue. Sub-line "22 March 2027 · 05:10".
- **22.82–24.90, drone.** drone-ui rising. Title "Rise to 120 m".
- **24.90–28.00, end card.** Night blue. An orange disc slides behind a dark sphere on the beat: the mark. Then "Find your shot." and "urbaneclipse.oratio.co".

BANNED: the BANNED-by-default list in spec.md, plus: drawn mock UI, invented dates, glow added on top of the render, and a logo docked in a corner.

QA:
- **Frame 0:** sphere and sun with the title readable.
- **2.5 s:** the UI is visible.
- **10 s:** the clock matches the light.
- **17.8 s:** the night cut lands on the drop.
- **26 s:** the end card URL is readable at phone width.
