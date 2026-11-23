# Panel and slider spec for `/plan/`, 2026-11-23

This records what Tobias decided across rounds 10–14 of the sketches in this folder. It is the
source for building the new panel into `src/miniature/`. Where it says "open", nothing is decided.

## The goal

A releasable version of the planner that answers the feedback on the current one:

- the panel takes too much space on phones and large screens, most of all in preview
- it should behave like an app, and be collapsible
- grade dots and circles are not self-explanatory (Dan's feedback)
- the UI should be consistent, with better icons
- it must perform well on phones
- the Molecule Man landmark should be more accurate

## Dan's feedback (first impressions of the current planner)

Tobias supplied Dan's notes on 2026-11-23. Dan attached screenshots (`icons.png`, `arrow_1.PNG`,
`arrow_2.PNG`, `drone.jpg`) that are not in the repo. His three points:

1. **Dots.** The two orange dots are hard to tell apart, most of all where they overlap on the
   timeline. His suggestion: draw the one for the sun behind the TV tower as an orange outline
   with a white fill.
2. **Directionality.** It took him a moment to see that the arrow points toward the sun. The
   arrow is an equilateral triangle, so its tip is ambiguous. His suggestion: make it clearly
   isosceles, or better, mark the tip in a distinct, contrasting colour like a compass needle.
3. **Drone icon.** It was not clear what the icon showed (he guessed the drone point of view).
   He also asks for tooltips on the toolbar buttons.

What follows from this for the build:

- Marks that mean different things must differ in shape or fill, not only in position, and must
  stay distinguishable when they overlap. Every mark also gets a word (see the verdict rule).
- The sun and moon direction arrows need an unmistakable tip.
- Every toolbar button gets a tooltip and an accessible name, and the drone icon is redrawn so
  it reads as a drone view.

## Two surfaces, two jobs

**Home: a grid of shots for the next 3 days.** It answers "what is worth going out for".
Reference: `next-shots-grid.html` (Tobias: "the shot cards look good").

- One hero card for the next shot worth taking, with a countdown.
- A grid per day. Each card is a frame of the landmark in the light and weather of its minute.
- A day with nothing worth shooting collapses to one line that says why.
- The grid is independent of any slider.

**Day view: the time control for one day.** It drives the miniature and, at rest, tells the
photographer three things: today's light, whether the weather lets it through, and the few
moments that are shots. Reference: `day-light-glass.html`.

- One day, full 24 hours, straight time scale. Night moon shots must fit.
- Light shown as a sun curve and a moon curve over a horizon, with a dot for the selected minute.
- Cloud as one band built from the forecast's high, mid and low layers, blended. Where the sky
  is clear the band is empty.
- Rain as bars under the band. Thunder marked.
- The light bar is one continuous gradient in the app's phase colours, not sections.
- Shots as ticks on the timeline and as a row above it. Five fit on a phone without scrolling;
  more scroll sideways with a fading edge and a count, opened at the next shot.
- The thumb drags freely. No snapping. Tapping a shot glides to it.
- Phone aids: a time label on the thumb, buttons for one minute back and forward and for the
  earlier and later shot, vertical swipes scroll the page.

## Rules that apply everywhere

- **Verdicts are words with a reason**: "Go · clear light", "Maybe · mixed cloud",
  "Skip · overcast". Colour may back up the word. No bare dots or circles.
- **All landmarks, not only the Fernsehturm.** The sketches use mock minutes for eight
  landmarks. The app's shot maths only covers the Fernsehturm today (Siegessäule is behind a
  flag). Generalising it is part of this work; until then, show only what is computed.
- **One sun and one moon.** Follow the iconography rule: colour and look come from
  `src/lib/mapBodyLook.ts` and `src/lib/skyPalette.ts`. The sketches drew their own; do not
  copy those.
- **Not an Apple Weather copy.** Use the app's tokens from `src/miniature/miniature.css`
  (warm ink, navy surface, sun `#f26a12`, moon `#5b82ff`, accent `#d9772b`, 14px radius,
  system font). Planned identity moves: shot cards as small rendered frames in place of icon
  columns, and the Berlin skyline in clay as the timeline's horizon.

## Collapsible panel

- **Phone:** a bottom sheet with three heights. Peek is one line (next shot and countdown).
  Half is the shots. Full is planning (filters, year search, cloud detail). Moving the map
  drops the sheet to peek. Escape or back steps down one height. Height is remembered.
- **900px and wider:** a side panel that folds to an icon rail.
- **Preview (eye level):** the panel gives way to a small floating ticket: shot name, a
  scrubber, lens and format behind "more", the minimap as a corner button.

## Preview at one location

- Offer the same day slider there, scoped to that stand.
- Its shot cards reach further ahead, because alignments from one spot are rare, and cover
  sun, moon, and sun or moon down a street valley. Beyond the forecast window, cards show
  geometry only, labelled "no forecast yet".
- Time and camera stay separate. The slider changes time only. Tapping a shot card re-aims the
  camera once; after the user pans away, a "Re-aim" button brings them back.

## Weather on the map

- The slider should drive weather on the miniature: cloud, rain, lightning.
- Draw it as a screen overlay, not as 3D weather in the scene, and measure it on a phone.
- If it is too heavy, the map shows none and the timeline gets a sky strip
  (`day-light-glass-sky.html`). With weather on the map, that strip is redundant.

## Assets and techniques from the sketches

- Cloud imagery was generated with Bailian (`bl image generate`, then `bl video generate` from
  each still with the same first and last frame, so it loops).
- Embedded video did not play in the iPad app. The sketches pack 36 frames of each loop into
  one image and blend between frames in a shader. No video element.
- Cloud colour comes from the light of the minute; the image's brightness sets transparency
  only. Using brightness for both gave dark rims.
- Open: on Tobias's iPad the sketch showed no motion at all, while it animates on his Mac. The
  cause was not found. The sketches honour "reduce motion" and have a status line for this.

## How to work

- Verify before presenting: tests, build, and a headless render you have looked at.
- Commit verified work in small commits. Do not deploy without Tobias's OK.
- The repo is public: no server addresses, tokens, `.env` contents or personal data.
