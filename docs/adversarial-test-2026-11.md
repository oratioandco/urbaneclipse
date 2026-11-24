# Adversarial test of the release candidate, 24 November 2026

Branch `release/2026-11` at `10774b7`, built and served locally, driven in headless Chrome
(the installed Chrome through Playwright, Metal GPU) on 24 November 2026 between 07:00 and
08:00 Berlin time. Scripts: `scripts/adversarial/` (see its README). Renders and JSON: the
folder `adversarial-renders/` in the session notes; file names below are in that folder.
Nothing in the application was changed. The `views-*.png` renders alone were made with the software
rasteriser; everything else with the GPU.

## Verdict

**Would I release today? No, but it is close: three fixes first, about a day of work.**

What holds: the numbers. Twelve shots opened from the day list on five days, the two
clock-change days among them, put the sun or moon within 7 seconds and 3 metres of the tower's
axis against the audit's reference, with the right state (behind the sphere, ring, antenna)
every time. Sunrise, sunset, moonrise and moonset shown today match the reference to the
minute. The same list comes out with the device set to New York, Tokyo or Kiritimati. A failing
or slow forecast is said plainly and never shown as a grade. 716 tests pass and the build passes.

Fix before release:

1. **Lichtenberger Brücke cannot be stood on in `/plan/`** (finding 1). The planner moves you
   off the bridge and then says buildings hide the tower all year, while `/classic` lists 203
   windows from the same six points. A photographer on Berlin's best-known spot is told there
   is nothing to shoot.
2. **The day view is one hour off on 28 March and 31 October 2027** (finding 2). The audit said
   this was still open; it is, and it is plain to see: tap the "4:15 PM" card on 31 October and
   the clock reads 5:15 PM over a city at night.
3. **The low moon is drawn like the sun** (finding 5), on the map's pills, the peek line, the
   toolbar and the date list. It is the first thing on screen this morning and a quick fix.

Should follow in the same week: the minute in "Dates" (finding 3), the antenna rows' time
(finding 4), the shared link that forgets its shot (finding 7), the remembered filters that
make the app say "nothing lines up" (finding 8), the back button at eye level (finding 9).

## What was run, and what was not

| Check | Run | Script, output |
|---|---|---|
| Four views at 390 x 844 and 1280 x 800, light and dark | yes | `views.mjs`, `views-*.png`, `views.json` |
| Five use cases from a cold start, phone and desktop, real forecast | yes | `usecases.mjs`, `uc-*.png`, `usecases-phone-desktop.json` |
| Accuracy: 17 shots against the reference | yes | `accuracy.mjs`, `reference.py`, `accuracy-reference.json` |
| Clock-change days in the day view | yes | `dst.mjs`, `dst.json`, `dst-*.png` |
| Same shot, same time and verdict everywhere | yes, within `/plan/` and against `/map` | `usecases.mjs`, `crossview.mjs` |
| Edges (24 cases) | yes | `edges.mjs`, `edges.json`, `edge-*.png` |
| Dan's three points | yes | `dan.mjs`, `dan-*.png`, `dan.json` |
| One product: the four views compared | yes | `crossview.mjs`, `crossview.json` |
| Console, load size | yes | `views.json` |
| Scrubbing at 4x CPU throttle | yes, with the desktop GPU | `scrub.mjs`, `scrub-*.json` |

Not tested, and nothing below should be read as covering it:

- **Real phones and Safari.** Everything is Chrome on a Mac at phone sizes. Touch was simulated;
  drags on the sheet's handle, pinch, the iOS address bar, safe areas, the share sheet and the
  glass blur on a real GPU were not exercised. `navigator.share` returned nothing in headless.
- **Frame rate on a phone.** The 4x throttle slows JavaScript, not the GPU.
- **The city's buildings against the world.** No standing point was checked on site.
- **The dark scheme of `/plan/`**, because it has none (see "One product").
- **`/map` and `/classic` beyond their first screen.** Their previews, the area solver and the
  panel 05 calendar were not walked; the audit covered their numbers.
- **The "Dates" list on a clock-change day.** No row fell on 28 March or 31 October from the
  spot used; that path sets the clock through `setMinute`, which the day-list rows also use
  and which was right.
- **Geolocation on a real device**, calendar import into a real calendar app, the directions
  link in Maps.
- A first run with the software rasteriser drew the eye-level sky white with no tower. With the
  GPU it draws correctly (`eye-desktop-software-rasteriser.png`, `eye-desktop-gpu.png`), so that is the
  rasteriser, not the app, and is not a finding.

## Findings, by harm to a photographer

"Verified" means I ran it and opened the render or log named. "Suspected" means read from code
or inferred.

### 1. Lichtenberger Brücke: the planner takes you off the bridge and says the tower is hidden. High. Verified.

- Steps: `/plan/` with the device's location on the bridge deck (panel 05's own point
  "nord-mitte", 52.5115358, 13.4982790), press "My location". Or open
  `/plan/?at=52.511300,13.498800&look=280,2&lens=200&cam=ff` (the default observer of `/classic`).
  Then More, Dates.
- Seen: the toast says "Standing in the open street nearest you, 44 m away"; the view is a
  street below the bridge facing a wall (`bridge-gps-view.png`). Dates says "Buildings hide it
  from here. Try a few steps along, or take off." for the tower, the gate and the column. By
  address the eye is inside the bridge (ground 4.8, roof 10.3 in scene metres) and the frame is
  empty (`bridge-classic-coords-noon.png`, `accuracy-dates-list.png`).
- Why it matters: `/classic` panel 05 lists 203 windows from these six points and the audit
  trusts them. Two views of one product disagree about the app's flagship spot, and the newer
  one is wrong.
- Likely file: `src/miniature/sightlines.js` (`standable`, `underRoof`: a bridge deck in the
  LoD2 model counts as a roof), `src/miniature/eyeLevel.js` (`enterEye` always stands on
  `groundAt`), `src/miniature/link.js` (`openLinkedView` does not check the spot at all).
- Fix: let a spot on a bridge stand on the deck (use the roof height as ground where the
  "building" is a bridge, or a short list of decks starting with the vantages in
  `src/lib/vantages.ts`). Until then, do not say "Buildings hide it": say the spot is on a
  structure the model cannot stand on, and offer take-off at deck height.
- **Fixed on 2026-11-24** (`src/miniature/decks.js`, `sightlines.js` `deckAt`, `eyeLevel.js`,
  `walk.js`, `locate.js`; tests in `tests/unit/decks.test.ts`). Cause, measured in the page: the
  deck is a surface of the building model 2 to 5 m above the bare-earth terrain (terrain 4.6 to
  7.5, deck 8.2 to 10.1 in scene metres at the six points), so `roofAt` took it for a roof,
  `standable` moved the photographer to the nearest street and `enterEye` stood them on the
  terrain inside the bridge. A deck is now told from a roof for any bridge: a built surface
  with a street on it whose points run on, without a step, to plain ground. A viaduct or a
  house over the street steps down by its clearance and is not a deck. Re-run: all six points
  of `src/lib/vantages.ts` and the default spot of `/classic` stand where they are (moved 0 m);
  "My location" at nord-mitte says "Standing where you are, on the bridge, facing the TV
  tower"; the view shows the tower 6.2 km off (`bridge-classic-link.png`); Dates lists passes
  behind the tower from there. Walking onto and along a deck works by the same rule.
  Not checked: that the list equals panel 05's 203 windows, and the model's deck height against
  the surveyed 47.7 to 48.2 m (the scene's vertical datum was not tied down here; the deck may
  sit a few metres low in the model, which moves a pass by seconds, not minutes).
- **That fix was not enough; corrected on 2026-11-24 after an independent re-test** (retest
  of d3732ef). Re-run with `scripts/adversarial/bridge.mjs` (checks A, B, C, and `census`):
  - **A, the eye was inside the deck.** The deck's height was remembered per 3 m cell, from
    whichever point asked first and from the coarse tiles, so the eye stood 0.55 m under to
    1.45 m over the deck (reproduced: sued-mitte -0.47, sued-ost -0.55). The height is now
    read at the very point from the buildings as drawn, and read again when a tile refines
    (`sightlines.js` `deckAt`, `walk.js` `settleFooting`). Result: 1.6 m over the deck at all
    six points, desktop and phone; render `bridge-A-desktop-sued-mitte.png` opened.
  - **B, Dates against `/classic`.** With the eye out of the deck, sued-mitte lists 11 passes,
    7 of them at the sphere (28 Dec, 21 Feb, 7 to 9 Apr, 3 and 4 Sept), as panel 05 has them.
    Panel 05 counts 34 "Fenster" because it also lists the shaft, the foot and moons that are
    not lit; `/plan/` lists the sphere and the antenna only. At nord-mitte 4 antenna rows show
    and 8 are "hidden by buildings": a look at 2 degrees along 279.7 degrees meets a building
    17.8 m high 307 m on, at 52.5120, 13.4938, which OpenStreetMap (Nominatim) has as
    Frankfurter Allee 221; at 2.5 degrees and above the view is clear. `/classic` does not
    check buildings there. Whether that building really hides the sphere from the north
    footway needs a look on site.
  - **C, not any bridge.** A straight bridge has no corner point of a street on it, so its
    deck had no street. Street points are now taken every 12 m along each street line
    (`roadsNear`), and "stand here" looks among those. Of 16 road bridges, at the coordinates
    OpenStreetMap gives them (the tester's were 50 to 350 m off for six), 14 stand where you
    put them, Moltkebrücke and Warschauer Brücke among them. **Not fixed: Bösebrücke and
    Swinemünder Brücke** (moved 21 and 14 m). The model has their spans without the
    approaches: the deck ends 6 m in the air, exactly as a viaduct over a street does. A rule
    for such decks (long and narrow along its street) was tried and taken out again, because
    the census showed it also took the Stadtbahn viaduct and the halls of Hauptbahnhof,
    Ostbahnhof and Friedrichstraße for decks. It needs OpenStreetMap's `bridge` tag in the
    street data (`scripts/miniature/build_map.py`), which means rebuilding and deploying the
    city data. **Also not fixed:** Langenscheidtbrücke, Elsenbrücke and Oberbaumbrücke have
    no deck in the building model at all, so one stands on the terrain under them. The two
    deck cells near Hardenbergstraße (52.50465, 13.32633, 4 m, and 52.50509, 13.32914,
    1.8 m) are decks by the first rule (their street comes down without a step); what they
    are was not looked up.

### 2. Clock-change days: the day view sets and reads the time one hour off. High on two days a year. Verified.

- Steps: `/plan/?date=2027-10-31`, "This day", tap the card "4:15 PM TV tower" (or press "Shot ›").
- Seen: the clock reads 5:15 PM, the city is lit for night, the readout still says "Ring of sun
  round the TV tower's sphere" (`dst-2027-10-31-card-415PM.png`). 7:17 AM becomes 8:17 AM. On
  28 March the 7:22 AM card gives 6:22 AM and 7:07 PM gives 6:08 PM. With the thumb set by hand
  to the right minute the scene is right (light 1.9° up at 7:17 on 31 October, reference 1.8°),
  but the readout says "Blue hour · sun and moon down", no card lights up, and every tick on
  the timeline sits an hour from its label (`dst.json`). On 21 June all of this agrees.
- Not affected: a shot opened from the list under the day view. Those were right to the second
  on both days (`accuracy-reference.json`).
- File: `src/miniature/dayview.js` lines 96 to 103, 243 and 303 (`from + minute * 60_000`,
  `(row.t - drawn.from) / 60_000`); the same arithmetic in `sparkstrip.js`, `planmode.js`,
  `verdict.js` (`shotSky`) and `dates.js` (`addClouds`), where it will read the forecast's
  wrong hour on those days.
- Fix: `instantOfMinute`, `minuteOf` and `dayEnd` from `clock.js`, as the audit wrote. Add the
  two cases of `dst.mjs` as a test.
- **Fixed on 2026-11-24** (commit 8e76276, `src/miniature/dayMath.js`; tests in
  `tests/unit/panelDays.test.ts` for both days). `dst.mjs` re-run on b46eb58: the 7:22 AM and
  7:07 PM cards of 28 March and the 7:17 AM and 4:15 PM cards of 31 October set the clock they
  show, the card under the thumb lights up, and the readout names the shot
  (`dst-2027-10-31-card-415PM.png` opened: 4:15 PM over a city in daylight). The forecast
  lookups in `verdict.js`, `planmode.js` and `dates.js` read the wall-clock hour.

- **One more on 2026-11-24, found by the re-test and not a clock-change fault:** a card read
  7:07 PM and the clock it set 7:08 PM on 28 March 2027. The alignment falls at 19:07:59.5;
  the card cut it to the minute and the clock rounded it to the second. A tower row's minute
  is now a whole second, and scrubbing snaps to the alignment itself, not to the whole minute
  beside it. `dst.mjs` re-run: all five cards and clocks agree.

### 3. "Dates": the minute shown depends on the second you pressed the button, and is cut, not rounded. Medium. Verified.

- Steps: open any shot, More, Dates. Compare a row with the same shot in the day list, and run
  it twice a minute apart.
- Seen: "Moon down Sonnenallee" is 7:33 AM in the day list and 7:32 AM in Dates. Tomorrow's is
  "8:30 AM · 4° up" in one run and "8:29 AM · 5° up" a minute later
  (`usecases-phone-desktop.json`, `uc-phone-08-uc4-dates.png`). Opening a row sets the clock
  55 seconds past the minute it printed (7:22 becomes 7:22:55, all five rows the same). Against
  the reference the opened instant is 11 to 43 seconds from the axis crossing and up to 12 m
  off the axis at the tower, where the day list's rows are within 7 seconds.
- File: `src/miniature/dates.js` (`start: now`, so the one-minute search grid starts on the
  second of the click; the title prints `formatClock(s.peak)`, which drops the seconds),
  `src/miniature/towerShots.js` (`findShots`), `src/lib/streets.ts`.
- Fix: start the search on a whole minute; set the scene to the shot's `align` instant, which
  `findShots` already returns; print the pass as a range, as the audit's defect 4 asks.
- **Fixed on 2026-11-24** (`src/miniature/dates.js`): the search starts on the whole minute, a
  tower row opens at the axis crossing (`align`), and the row prints the pass as a range with
  the crossing to the second. Not re-measured against the reference (`reference.py` needs the
  ephemeris file, which is not on this machine); street rows still open at their one-minute peak. Left so on 2026-11-24, read in the code and not re-measured: a street's search runs from a whole minute in one-minute steps, so the row's label and the clock it opens at are the same whole minute, and a street's gap is 0.5 to 1 degree wide, several minutes of sun, so seconds would be false precision.

### 4. Antenna rows show the start of an hour-long window as the shot's time. Medium. Verified.

- Steps: 24 December 2026, "Moonset behind the TV tower's antenna", shown as 7:50 AM. Open it.
- Seen: the clock goes to 8:20 AM while the ticket above it still says 7:50 AM. 6:00 becomes
  6:25 on 20 February; 1:45 AM becomes 3:40 AM on 28 March (`accuracy-reference.json`). The row
  says "1.6 km–9.0 km SE"; you are put at 3.8 km. Today at 07:04 the row "6:40 AM–7:35 AM" was
  already "Passed" with half an hour of it left, and so it never showed as the next shot. At
  midnight one moonrise is split into two rows on two days, the second starting "12:00 AM".
- File: `src/miniature/daylist.js`, the antenna block of `collectRows` (`t: w.start`, `go` uses
  `mid.t`).
- Fix: give the row the instant it opens at, show the window as a range, and call it passed at
  its end.
- **Fixed on 2026-11-24** (`src/miniature/dayShots.js`, `verdict.js`): the row's time is the
  minute it opens at (8:20 for 24 December), the stretch stays in its small print as a range,
  it is "Passed" only after the stretch ends and stays the next shot until then, and a stretch
  across midnight is one row in lists of days. Test: `tests/unit/homeGrid.test.ts`, "antenna
  rows". Not changed: where on the 1.6 to 9 km stretch you are put (its middle).
- **Corrected on 2026-11-24 after the re-test of d3732ef**, which found the 24 December
  moonrise row opening 6.9 km out, facing a wall, the moon 1.3 degrees over the tip. An
  antenna row now opens at the minute of its pass, nearest the middle, that has a place on
  the stretch of the line from which the moon is behind the antenna at that minute and the
  tower is seen (the viewshed); a pass with no such place is not listed (that moonrise is
  gone from 24 December). The search for the standing point keeps to that stretch. A pass
  across midnight is looked for whole and listed once, on the day of its opening minute (it
  read "11:45 PM–12:00 AM" on 10 September 2027 and came again on the 11th). Re-run:
  `scripts/adversarial/antenna.mjs` opens every antenna row of six days, 10 rows: each
  stands 2.9 to 5.1 km out with the moon between the sphere's top and the tip, the view
  clear, and the line reading "Moon behind the antenna now"; render
  `antenna-2027-02-20-1.png` opened. Tests in `tests/unit/homeGrid.test.ts`. Not checked:
  trees, which the sightline check does not count.

### 5. A low moon looks like the sun. Medium, and on the first screen. Verified.

- Steps: open `/plan/` any morning or evening with the moon under about 10°.
- Seen: "Moon 4° up" and "Sun 0° up" carry the same peach disc; only a thin rim differs
  (`finding-sun-moon-look-alike.png`). The peek line's moon shot has an orange disc
  (`finding-moon-peek-orange.png`), the eye-level toolbar's "Face the moon" button is an orange
  disc (`uc-phone-06-uc3-eye-level.png`), every moon row in Dates has one
  (`uc-phone-08-uc4-dates.png`), and the introduction's "The moon by the tower" too
  (`uc-phone-02-plan-first-sight.png`).
- File: `src/miniature/bodies.js`, `src/miniature/bodyAt.js`, `src/lib/mapBodyLook.ts` (the
  moon takes the horizon's colour as the sun does).
- Fix: keep the moon's own mark in small sizes whatever its altitude: the dark limb or the
  phase, a cool rim. Colour it warm only in the rendered frame.
- **Fixed on 2026-11-24** in `src/miniature/bodies.js` (`moonFragment`, `drawMoon`), so every
  place that shows a moon has it: a wider dark limb, seas on the lit face, and a rim in the
  high moon's cool glow. The face's colour is still `moonLook`'s for its altitude. Sun and
  moon side by side at 0 to 5 degrees, 16 and 32 px, light and dark, before and after:
  `docs/images/sun-moon-low-2026-11-24.png`. Test: `tests/unit/miniatureIcons.test.ts`.

### 6. `/map` and `/plan/` name different tower shots for the same day. Medium. Verified from the pages' text.

- Seen today: `/map` "Best shots" has 08:27 "2.7 km NW of the tower" and 15:06 "2.1 km NE";
  `/plan/` has 8:34 AM "8:27 AM–8:42 AM · 2.3 km NW" and 2:31 PM "1.3 km NE"; `/plan/` lists
  six sun shots at the tower, `/map` two. Street times agree to the minute (07:33, 08:08, 08:26,
  15:30, 15:41, 15:49). `/map` shows no weather verdict at all (`crossview.json`).
- File: `src/components/react/daily/` against `src/miniature/daylist.js`; both read
  `dailyPaths.ts` but pick the moment and the stand differently.
- Fix: one function for "the shots of a day", used by both, or take the list off `/map` and
  link to `/plan/`.
- **Fixed on 2026-11-24.** `/map`'s "Best shots" and "Streets today" are now the rows of
  `src/miniature/dayShots.js`, the list `/plan/` and the home page use; its own picker
  (`dayHighlights`) is no longer called by the page. A sphere row opens `/map`'s preview at
  the shared standing point and minute; an antenna row links to `/plan/`. Found on the way:
  the twelve streets kept depended on the order the moments came in, so `/plan/` (by time)
  and `/map` and the home page (sun first) could keep a different one of a street's two
  equally long directions (Weserstraße, 07:34 against 08:09); the cut now breaks ties by
  time. Re-run: `scripts/adversarial/sameshots.mjs` reads both pages for 24 November: nine
  tower rows and twelve street rows, identical in time, title and stand. Test:
  `tests/unit/homeGrid.test.ts`. Not done: `/map` still shows no weather verdict, and its
  clock stays 24-hour (13g).

### 7. A shared link, a reload or the calendar entry forgets which shot it was. Medium. Verified.

- Steps: open "Moon down Weserstraße", copy the link or reload.
- Seen: the ticket's shot card is gone; the only headline left is "Nothing lines up with the
  tower from here" (`edge-reload-at-eye-level.png`, `edges-width-narrow-reload-back.json`). The
  calendar file for a street shot is titled "Photo facing NW" and never names the street or the
  moon; the entry runs from 20 minutes before to 10 minutes after, so the calendar shows 7:13
  for a 7:33 shot (`usecases-phone-desktop.json`, step uc5-calendar). The status line under a
  street shot always talks about the tower ("Sphere spot for now: 7.6 km W → go").
- File: `src/miniature/link.js` (no shot in the address), `src/miniature/share.js` (`title()`
  reads the tower status only), `src/miniature/eclipse.js`.
- Fix: put the shot's kind and name in the address, rebuild the ticket from it, and title the
  calendar entry "Moon down Weserstraße, 7:33".
- **Fixed on 2026-11-24** (`link.js`, `share.js`, `daylist.js`): the address carries
  `shot=street-moon:Weserstraße&here=1` while a shot's card is on the ticket; a reload or a
  shared link shows the card again at the same spot; the link and the calendar entry are titled
  with the shot and its time. Not changed: the status line under a street shot still speaks of
  the tower, and the calendar entry still starts 20 minutes early (on purpose: be there first).
  **Status line fixed on 2026-11-24** (`streetStatus` in `dayShots.js`, used by `eclipse.js`):
  under a street's card it says "Sun down Sonnenallee now", "… in 26 min (08:08)" or
  "Sun was down Sonnenallee 30 min ago", and a tap goes to the peak; a tower alignment at that
  very minute still comes first. Checked in the page at 08:07 and 07:40; test in
  `tests/unit/homeGrid.test.ts`.
  **Stale ticket, fixed on 2026-11-24 after the re-test:** one could open the 8:33 shot, walk
  130 m, set the clock to 9:03, and the ticket, the address and the calendar's title still
  said 8:33. The card now goes, and with it `shot=…&here=1` and the shot's name in the
  calendar entry, once one is more than 40 m from where it went up or the clock is more than
  ten minutes outside the shot's stretch (`shotStillHeld` in `dayShots.js`, `checkTicket` in
  `daylist.js`). A link that names a shot hours from its own time shows no card. `here=0` is
  read as "not here". Re-run: `scripts/adversarial/stale.mjs`, four steps, all pass.

### 8. Switches you forgot make the app say nothing lines up. Medium. Verified.

- Steps: under "This day" switch Sun and Streets off on a new-moon day; or switch all four
  off, then come back later.
- Seen: "Nothing lines up on this day. Try another." although the day has shots the switches
  hide. On the next visit the peek line says "Nothing lines up in the next three days" and the
  list "No shots line up in the next three days. Try another day." (`edge-no-shots-filtered.png`,
  `edge-no-shots-next-visit.png`, `edges.json`).
- File: `src/miniature/daylist.js` (`emptyDay` only names the switches when both of a pair are
  off), `src/miniature/planmode.js`, `src/miniature/chrome.js` (layers kept in `localStorage`).
- Fix: when any switch is off and the list is empty, say which, with a button to show all.
- **Fixed on 2026-11-24** (`daylist.js` `emptyNote`, `chrome.js` `switchedOff`): an empty list
  with any switch off says "No shots to show with Sun and Streets switched off" with a "Show
  all shots" button, in the day view, the day list and the three-day list; the peek line says
  "No shots to show: … switched off".
  **Added on 2026-11-24 after the re-test:** a list that has rows, but not all, ends with
  "Streets switched off: not every shot is listed" and the same button (`filterHint`; the day
  list and the three-day list; render opened).

### 9. At eye level the browser's back button leaves the planner, and Escape does nothing. Medium. Verified.

- Seen: back from an opened shot lands on `/` (`edge-back-from-eye-level.png`). On the sheet the
  back button does step full, half, peek as the spec says. With the keyboard, Enter on a row
  opens the shot, then focus falls to the page body and Escape does not go back to the map; the
  map itself cannot be moved with keys (`edges.json`, keyboard).
- File: `src/miniature/eyeLevel.js` (`enterEye` pushes no history entry), `src/miniature/sheet.js`.
- Fix: push a history entry on entering eye level; Escape and back both return to the map; move
  focus to the ticket.
- **Fixed on 2026-11-24** (`sheet.js`): eye level is its own history entry. Re-run with the
  keyboard: Enter on a row opens the shot with the focus on "Map"; Escape returns to the map;
  the browser's back returns to the map; the "Map" button returns and a further back leaves the
  planner. Moving the map itself with keys is not added.

### 10. On a phone the map shows a time nobody states. Medium. Verified.

- Seen at 07:30: the map and its pills show 4:00 PM ("Sun 0° up") while the panel's open tab,
  "Next 3 days", has no clock; the clock is in the other tab (`uc-phone-03-uc1-next-shots.png`).
  The planner opens at 16:00, not now. On an overcast day the "Clouds on the map" layer greys
  the whole map out on first sight (same render).
- File: `src/miniature/clock.js` (`timeInput.value = params.get('time') ?? '960'`),
  `src/miniature/overlay.js`, `src/miniature/chrome.js`.
- Fix: open at the present minute (or at the next shot), and put the time on the pill:
  "Sun 0° up · 4:00 PM".
- **Fixed on 2026-11-24** (`clock.js`, `overlay.js`): without a time in the address, today
  opens at the present minute (checked: 09:11 gave minute 551), another day at 16:00, and the
  map's first pill carries the time. The grey of "Clouds on the map" on an overcast day is
  unchanged.

### 11. A bad date in the address leaves an empty page for good. Low to medium. Verified.

- Steps: `/plan/?date=garbage` or `?date=2027-02-30`.
- Seen: "Building Berlin" for five minutes and no map; `RangeError: Invalid time value`
  (`edge-bad-date-FAILED.png`). `time=9999` is clamped to 11:59 PM, `at=` outside the model or
  unreadable is dropped without a word.
- File: `src/miniature/clock.js` (`dateInput.value = startAt`), `src/miniature/link.js`.
- Fix: fall back to today when the date does not parse; say "This link's spot is outside the
  model" for a dropped `at`.
- **Fixed on 2026-11-24** for the date (`berlinClock.js` `startDate`, tested): `?date=garbage`
  opens today and the page builds. A dropped `at` is still dropped without a word.
  **Fixed on 2026-11-24** for `at` too (`link.js` `linkSpotProblem`): the map opens with
  "This link's standing point is outside the model, which reaches 9 km from the TV tower"
  or "… could not be read", for six seconds. Checked in the page with `at=48.137,11.575`
  and `at=abc`; a link without `at` says nothing.
  **Far dates, fixed on 2026-11-24 after the re-test:** a date before 1950 or after 2100 opens
  today (`0000-01-01` and `9999-12-31` hung on "Building Berlin", `0001-01-01` came up as
  1901). Checked in the page; test in `tests/unit/panelDays.test.ts`.

### 12. Small phones: the picture at eye level shrinks to a stamp. Medium on 320 px, low on 390. Verified.

- Seen: at 320 x 568 with More open the frame is about 87 x 130 px between the buttons, and the
  layers button is under the credit line (`edge-width-narrow-eye-more.png`). At 390 x 844 with
  Dates open the panel covers the frame and the walk pad sits on it
  (`uc-phone-08-uc4-dates.png`). The ticket cuts its own line: "7:33 AM Sonnen… Moon down the s".
  At 320 px a card's reason overlaps its time (`edge-width-narrow-thisday.png`). No horizontal
  overflow at any width; 2560 px is fine (`edge-width-wide-thisday.png`).
- File: `src/miniature/miniature.css` (eye-level ticket, `.walkpad`, `.tools`), `shotCard.js`.
- **Partly fixed on 2026-11-24.** At 320 x 568 with More open the frame is 124 x 186 px
  (was 87 x 131): where it fits between the walk stick and the minimap it now takes the room
  beside them, down to the credit line (`main.js` `updateViewArea`; 390 x 844 is unchanged at
  271 x 407). The six eye-level buttons are 40 px on screens under 600 px high and end above
  the credit line. The horizon strip behind More was blank until the view moved; it is drawn
  when it opens. The half sheet is at most half the screen: 49.7 % at 320 x 568 in "1 day"
  (was 69 %), the rest shows at full (`sheetHeights.js`, test in `tests/unit/panel.test.ts`).
  Renders opened: 320 x 568 map and eye level. Not fixed: the ticket's line and the frame's
  caption are still cut at 320 px ("08:08 Sonne…", "Tower 4.3 km · s"), and at 390 px the
  Dates list still covers the frame.
- Fix: Dates as a full sheet of its own; hide the walk pad while More is open; let the ticket's
  line wrap.

### 13. Smaller things

| | Finding | State | File |
|---|---|---|---|
| a | `THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN` on every load of `/plan/`, all sizes | verified, `views.json` | `landmarks.js` `fieldGroundAt`. **Fixed on 2026-11-24**: it was the Holocaust memorial; eight slabs at the field's south edge read a ground probe past the end of the 7x7 grid and got NaN heights (and were not drawn). Re-run: no NaN position in the scene, no console error |
| b | After midnight the day label still says "Today, Tue 24 Nov" (device clock faked across midnight). **Fixed on 2026-11-24**: the label is refreshed every minute. Re-run with the faked clock (`edges.mjs day-change`): at 23:58 "Today, Tue 24 Nov", six minutes on "Tue 24 Nov", and the three-day cards call the 25th "Today" | verified, `edges.json` day-change | `clock.js` `showDay` runs only on a day change by hand. **Also fixed on 2026-11-24:** the peek line and the three days are worked out anew within 30 s of midnight, not at the next five-minute round ("Wed 8:35 AM" became "8:35 AM" 50 s after midnight in a faked-clock run) |
| c | A failed forecast is not asked for again within 65 s and has no "try again" | verified, 3 requests then none | `weather.js`, `forecast.js` |
| d | "+ 1 min" at 11:59 PM does nothing and is not disabled; typing "24:00" gives 11:59 PM; "noon" is ignored | verified | `dayview.js`, `time.js` |
| e | `glass=off` is dropped from the address on the first frame, so a reload brings the glass back. **Fixed on 2026-11-24** (`link.js` keeps it). Re-run (`edges.mjs glass-off`): the address reads `…&nointro&glass=off` after the first frames and the panel has no backdrop filter | verified, `edges.json` | `link.js` list of kept options |
| f | "Next 3 days" lists a day's shots out of time order (tomorrow: 4:20 PM, 8:54 AM, 8:00 AM) with no word on why | verified | `planmode.js` |
| g | Times are 12-hour in `/plan/` and on the landing page with an English device, 24-hour in `/map`, UTC in `/classic` | verified | `time.js`, `daily/`, `ControlPanel.tsx` |
| h | The landing page says "Trees are not in the model"; `/plan/` has a Trees layer and draws them | verified, `crossview.json` | `src/pages/index.astro`. **Fixed on 2026-11-24**: "Trees are drawn, not checked", which is what the code does (the tree register is drawn; `sightlines.js` checks buildings only) |
| i | The landing page's hero clip still shows the old small triangle arrow and old pills | verified, `views-home-desktop-dark.png` | `public/media`, re-record with `record_clips.mjs`. **Fixed on 2026-11-24**: `berlin-day.mp4` and its poster re-recorded from the present planner (the pill with the time, the kite needle); frames at 2, 6 and 10 s and the poster opened. The recorder can now run against a local preview (`CITY`, `HEADLESS`). The three eye-level clips were not re-recorded: they show no controls |
| j | `/classic` at 390 px: panels overlap and are cut off | verified, `views-classic-phone-light.png` | `src/styles/global.css` |
| k | Server addresses in a public repository (already on `main`). **Fixed on 2026-11-24** in the four files: a placeholder in the notes, and `sync_tiles_hetzner.sh` now requires `PLASTERVOID_HOST` from the environment. Git history still holds the address; it was not rewritten | verified by grep | `src/miniature/README.md:20`, `docs/HANDOFF-2026-11-08.md:20`, `scripts/README.md:321`, `scripts/sync_tiles_hetzner.sh:23` |

## The five use cases

Cold start on `/`, real forecast (overcast today), `usecases-phone-desktop.json`.

| Use case | Answered? | Taps from the landing page | Where it confuses |
|---|---|---|---|
| 1. Anything worth shooting soon? | Yes. Peek line: "11:39 AM Sun behind TV tower · Maybe" | 2 (Open the planner, Start planning); 3 to see the list on a phone | Only the tower and streets, which the spec allows. The map behind shows 4 PM (finding 10). The grey line over each day strip is not named (it is cloud). List order (13f) |
| 2. What will this day's light do? | Yes | +1 ("This day") | The clock shows 4:00 PM on arrival. Marks bunch up at sunrise and sunset (Dan 1). "1 possible from now · 21 in all" is good |
| 3. Where do I stand, what will I see? | Yes for tower shots; for a street the stand is the street's end and the status talks about the tower | +1 (a row) | Finding 5, 7, 12. Lens and format are behind "More" as specified |
| 4. When does this happen from my spot? | Yes, and it checks buildings | +2 (More, Dates) | Finding 1 and 3. The list stops at 40 rows ("The next 40 of 47 dates") with no way to the rest |
| 5. Take me there and remind me | Yes: directions, a calendar file, a link | +2 each | Finding 7. On a phone "Go there" is a bare pin |

The words, read as a newcomer:

- **Go / Maybe / Skip** work, because the reason always follows and the three have their own
  signs. "clear here" does not explain itself (it means the horizon toward the low sun is not
  in the forecast); "Go · clear here" for a moon 2° up promises more than is known.
- **Street henge** is explained in the introduction and in each row's small print ("street
  henge: the sun down the street"). Good enough.
- **"Moon down Sonnenallee"** reads as "moonset", most of all beside "Moonset behind the TV
  tower's antenna". "Moon along Sonnenallee" or "Moon at the end of Sonnenallee" would not.
- **"TV antenna · 1.7 km+ SE"**, **"3 line up"**, **"±30 min"** (a button that turns on fine
  timing) and **"Passed"** on a window still open need a second look each.
- **Tabs** "Next 3 days" and "This day" are clear. That the peek line always speaks of today
  while the day view may show another date is not.
- **Marks:** the legend sits under Layers, "What the marks mean", and describes the map's lines,
  not the ring and the bar on the timeline. Each mark has a tooltip and a spoken name.

## Accuracy from the outside

Method: `accuracy.mjs` read rows off the page, opened them, and wrote down the clock, the date
and the spot in the address. `reference.py` asked the audit's reference where the body was at
that instant from that spot. Full table: `accuracy-reference.json`.

| Shot as listed | Clock after opening | Off the axis | Axis crossed | Reference says | Page says |
|---|---|---|---|---|---|
| 28 Mar 2027 7:22 AM, sun, tower, 3.0 km W | 7:22:00 | 0.02°, 1.1 m | 6 s before | wholly behind the sphere | Sun behind the sphere |
| 28 Mar 2027 7:06 AM, sun, Kastanienallee | 7:06:00 | 0.0° from the street | | alt 1.75° | 2° up |
| 28 Mar 2027 1:45 AM, moon, antenna | 3:40:00 | 0.003° | 1 s before | on the antenna | Moon behind the antenna (finding 4) |
| 28 Mar 2027 1:40 AM, moon, Bernadottestraße | 1:40:00 | 1.15° from the street | | alt 0.84° | 1° up |
| 31 Oct 2027 7:17 AM, sun ring, 6.4 km WNW | 7:17:30 | 0.023°, 2.6 m | 7 s before | sphere inside the disc | Ring of sun |
| 31 Oct 2027 7:17 AM, sun, Charlottenburger Straße | 7:17:00 | 0.08° | | alt 1.81° | 2° up |
| 24 Dec 2026 8:38 AM, sun ring, 6.1 km NW | 8:38:15 | 0.023°, 2.4 m | 7 s before | ring | Ring of sun |
| 24 Dec 2026 7:50 AM, moon, antenna | 8:20:00 | 0.004° | 1 s before | on the antenna | Moon behind the antenna |
| 21 Jun 2027 6:38 AM, sun, 840 m WSW | 6:38:15 | 0.008°, 0.1 m | 3 s before | behind the sphere | Sun behind the sphere |
| 21 Jun 2027 4:53 AM, sun, Seestraße | 4:53:00 | 0.15° | | alt 0.73° | 1° up |
| 20 Feb 2027 6:00 AM, moon, antenna | 6:25:00 | 0.008° | 3 s before | on the antenna | Moon behind the antenna |
| 20 Feb 2027 6:20 AM, moon, Rigaer Straße | 6:20:00 | 0.02° | | alt 4.64° | 5° up |
| Dates, 24 Nov 7:22 AM, moon at the sphere's edge | 7:22:55 | 0.133°, 12.3 m | 43 s before | overlaps the sphere | Moon at the edge |
| Dates, 18 Jan 2027 3:42 AM, moon, antenna | 3:42:55 | 0.087°, 8.0 m | 28 s after | on the antenna | Moon behind the antenna |
| Dates, 6 Jun 2027 9:03 PM, sun at the edge | 9:03:55 | 0.128°, 11.9 m | 39 s after | overlaps the sphere | Sun at the edge |
| Dates, 7 Jun 2027 9:03 PM, sun at the edge | 9:03:55 | 0.114°, 10.5 m | 35 s after | overlaps the sphere | Sun at the edge |
| Dates, 28 Jul 2027 4:17 PM, moon, antenna | 4:17:55 | 0.034°, 3.2 m | 11 s before | on the antenna | Moon behind the antenna |

"Facing" was within 0.1° of the body in every tower case; the stand's distance and compass
point matched the geodesic. Today's "Sunrise 7:43 AM", "Sunset 4:02 PM" and the moon's 3:15 PM
and 7:52 AM match `riseset.py` (07:43:26, 16:02:07, 15:15:33, 07:52:17).

Same shot, same time and verdict: inside `/plan/`, the peek line, the three-day strip, the
coming-days list, the day view's cards and the day list agreed on every shot that appears in
more than one of them (real forecast, 21 shots today, 7 on the coming days). They part in
"Dates" (finding 3), on antenna rows once opened (finding 4), in the day view on clock-change
days (finding 2) and between `/plan/` and `/map` (finding 6).

## Edges

| Case | Result |
|---|---|
| Forecast request fails, or answers 500 | Honest: "No forecast" on the peek line and every card, "No cloud forecast available". No retry seen (13c). `edge-forecast-fail-next3.png` |
| Slow forecast (12 s) | "Forecast loading" everywhere, then grades appear without a jump. Pass |
| Date beyond the forecast, far future (2040), long past (2025) | "No forecast yet: it reaches 16 days ahead"; "No weather kept for days this long ago"; shots still listed. Pass |
| Bad date, bad time, bad spot in the address | Finding 11 |
| A day with no shots | Only reachable through the switches; the message blames the day (finding 8) |
| Midsummer, 23 shots | Cards scroll sideways, 3 on screen, opened at the first. Pass. One moonrise split at midnight (finding 4) |
| Midnight | 13d. The day does not roll over under an open page (13b) |
| Device in New York, Tokyo, Kiritimati | Identical lists, times, "Today" and sunrise line. Pass |
| 320 px, 2560 px | Finding 12; no overflow |
| Keyboard only | Every control reachable, focus ring on all 36 stops, slider steps a minute per arrow key. Fails at eye level (finding 9) |
| Reduced motion | Tapping a card sets the time at once; no CSS animation runs. The flight to eye level still takes 1.9 s: suspected not shortened, not measured against a run without the setting |
| `?glass=off` | Opaque panels, no blur. Not kept on reload (13e) |
| Reload and back | Sheet: back steps full, half, peek, then leaves. Eye level: reload keeps spot and time, loses the shot (finding 7); back leaves the planner (finding 9) |
| Deep links (the introduction's four) | All open at eye level with the status they promise. Pass |

## Dan's three points

1. **Marks can be told apart: yes. Also when overlapping: only in pairs.** Ring against bar,
   orange against blue, the moon's dark inside: clear on the three-day strips
   (`dan-1-marks-strips-phone3.png`). On the day timeline two marks in the same minute show as a
   ring with a bar's edge behind it. Seven marks in fifteen minutes around sunrise on 31 October
   collapse into one ring and a sliver (`dan-1-marks-timeline-closeup.png`,
   `dan-1-marks-timeline-phone3.png`); today's morning on a phone is a knot of blue bars and
   orange rings (`uc-phone-05-uc2-this-day.png`). Suggested: stack a cluster's marks upward, or
   show one mark with a count.
   **Fixed on 2026-11-24**: on the day timeline three or more marks within a mark's width
   (11 px) of each other keep their ticks and share one sign with their number, in the body's
   colour, or in ink when sun and moon are mixed (`clusterMarks`, `clusterBody` in `marks.js`).
   Pairs stay two marks. Renders opened for 31 October ("6", "7", "3") and 24 November
   ("6", "4", "6") at 390 px. Test: `tests/unit/miniatureIcons.test.ts`. The three-day strips
   are unchanged.
2. **The arrow's tip is unmistakable: yes.** A long kite with a notched tail, the front half in
   the body's colour (`dan-2-arrow-closeup-phone-day.png`). At night the tail is white and
   brighter than the blue tip (`dan-2-arrow-closeup-night.png`); the shape still carries it. The
   moon's arrow can land on an hour pill (`finding-sun-moon-look-alike.png`).
3. **The drone icon is clear: yes**, a quadcopter with a camera beside the words "Take off",
   tooltip "Drone view" (`dan-3-drone-button-hover.png`). **Every toolbar button has a tooltip:
   yes with a mouse or the keyboard** (16 of 16, `dan.json`, `dan-3-tip-*.png`), **no on a touch
   screen**, where six of the map's buttons are bare icons (`dan-3-touch-toolbar.png`). The
   camera icon means "Stand here" and reads as "take a picture". On a phone "Go there" loses its
   words too. Suggested: a long press shows the tip, or the help sheet names the six buttons.
   **Fixed on 2026-11-24** (`src/miniature/tips.js`): on a touch screen a long press on a
   toolbar button shows its tip and does nothing else, and a tap does what the button does and
   shows the tip beside it for two seconds (a button that opens a menu leaves the naming to the
   menu's heading). Re-run with real touch events on a 390 px phone,
   `scripts/adversarial/touchtips.mjs`: six of six map buttons show their tip on a long press
   and none acts; a tap on Layers opens the menu. Not checked on a real phone: whether iOS or
   Android puts its own long-press menu over the tip. The camera icon still means "Stand here".

## One product?

Not yet. Most visible first (`views-*.png`, `crossview.json`):

1. **Colour scheme.** `/` follows the device (light or dark). `/plan/` ignores the device and
   turns dark when the scene's sun goes down. `/map` is always dark. `/classic` is always light.
2. **Sun and moon.** `/plan/`: drawn discs coloured by altitude (finding 5). `/map`: a photo of
   the moon and flat orange and lilac dots. `/classic`: a glowing disc in the scene, no icon.
   Landing page: plain dots in the cards and the old arrow in the clip.
3. **Type.** `/` and `/plan/`: system sans, bold headings. `/map`: a serif "Today" at 34 px.
   `/classic`: 9 to 10 px uppercase with wide letter-spacing, numbered panels.
4. **Shape.** `/` pills at 23 px radius; `/plan/` 14 px surfaces and round buttons; `/map` 10
   and 18 px; `/classic` square corners throughout.
5. **Words.** `/plan/`: "Sun behind the TV tower's sphere", "street henge", Go, Maybe, Skip.
   `/map`: "No sun shot at this time", "fully hidden", "Best shots", "Streets today · 157", no
   verdicts. `/classic`: "Placement", "Line of sight", "Full eclipse impossible from here", and
   panel 05 in German ("Dein Standort", "Stehpunkt", "12 Monate rechnen") inside an English page.
6. **Time.** 12-hour, 24-hour and UTC (13g).
7. **Behaviour.** A shot is opened by a row in `/plan/`, by "Preview" in `/map`, by a search in
   `/classic`. Back is a "Map" chip in `/plan/` and the browser elsewhere. Only `/plan/` has the
   sheet.
8. **Icons.** One set in `/plan/`; `/map` uses text arrows and Leaflet's plus and minus;
   `/classic` has none.

The landing page and `/plan/` are close, as the spec asked first: same font, same accent, same
headline. What still separates them is the scheme (1), the clip (13i) and the tree sentence (13h).

## Console, load, scrubbing

- **Console.** `/`, `/map`, `/classic`: nothing. `/plan/`: the NaN error (13a) and a
  `toNonIndexed` warning on every load.
- **Cold load, bytes on the wire** (`views.json`; the city came from a local cache, so its
  figure is the files' size, not the wire's):

| View | Phone | Desktop |
|---|---|---|
| `/` | 4.6 MB, of which the hero clip 4.2 MB | 4.9 MB |
| `/plan/` | 0.26 MB script, 1.5 MB data, 0.16 MB images, plus about 16.8 MB of city in 395 files | the same, city 21 to 24 MB in about 400 files |
| `/map` | 2.3 MB, map tiles included | 2.6 MB |
| `/classic` | 9.9 MB (Cesium 1.8 MB, tiles 7.1 MB) | 10.6 MB |

  The landing page sends a phone a 4.2 MB clip before anything is tapped.
- **Scrubbing the day view** for a there-and-back drag, `scrub-*.json`: phone layout at normal
  speed, frame gap 17 ms median, 33 ms at 99 %, 100 ms worst, one long task. At 4x CPU: 17 ms
  median, 50 ms at 99 %, 83 ms worst, nine long tasks of at most 93 ms, 569 ms in all over 16 s.
  Desktop layout at 4x: 17, 50, 100 ms. It stays responsive under the throttle; this is a Mac's
  GPU, so it says the JavaScript is not the bottleneck and no more.

- **Scrubbing at eye level, measured on 2026-11-24** (`scripts/adversarial/eyescrub.mjs`, the
  ticket's slider moved one step per frame for six seconds at an 8:33 sphere shot, 200 mm,
  headless Chrome on this machine's GPU; numbers compare builds, not phones). Desktop
  1280 x 800: median frame 33 to 50 ms, 95th percentile 50 to 83 ms over three runs. Phone
  390 x 844: median 16.7 ms, 95th percentile 33 ms.
  - **The main thread is not the cost.** A CPU profile on the dev server: 87 % idle; the page's
    own script and three.js together 7.5 ms of a 59 ms frame (2.2 ms "program", 1.7 ms
    `bufferSubData`, 1.2 ms three.js, 0.5 ms the frame loop, under 0.2 ms each for the
    overlay, the horizon strip, the trees' update, the minimap).
  - **The cost is triangles.** Desktop draws 10.4 to 12.5 million triangles in a frame at eye
    level (137 to 161 calls), into a canvas the quality governor has already cut to
    768 x 480; the phone layout draws 3.9 to 4.8 million. Shadows are redrawn every second
    frame while the clock moves.
  - **Switched off one at a time** (same scrub, desktop): glass, edge blur, the water mirror, a
    1024 px shadow map, half the pixels, More and the minimap open or closed: no change
    outside the run-to-run noise (33 ms median each). **Trees cut to one instance: 16.7 ms
    median, 33 ms at the 95th percentile, 7.7 million triangles.** So the trees are the
    largest single cost on desktop: 3 to 5 million triangles a frame, with their shadow pass.
    Desktop allows 90,000 tree instances, the phone 30,000 (`trees.js` `BUDGET`).
  - Nothing was changed. What would help, in order of risk: a lower tree budget or coarser
    crowns for far trees at eye level (a telephoto frame shows a few hundred); shadows only
    every third or fourth frame while scrubbing, since the sun moves 0.02 degrees in a 5 s
    step; trees left out of the shadow pass beyond some distance. Each changes the picture and
    wants a look before it ships.
  - **A cheaper scene while the clock is dragged, added on 2026-11-24** (`scrub.js`, `main.js`,
    `trees.js` `setTreeDetail`): during a drag and for 200 ms after its last step the shadow
    map is redrawn on every third frame at most, the trees stay out of it, and the trees are
    drawn in a quarter of their triangles (750,000 to 231,000 in the test view). At rest one
    whole frame is drawn again. **The resting picture is unchanged: 0 % of pixels differ**
    between a still before a drag and one after it (`scripts/adversarial/scrubstill.mjs`; the
    control, two stills with nothing done, also 0 %); the in-drag still was looked at beside
    them (crowns a little more angular, no tree shadows). **Measured once the machine was quiet again (load
    average 5 to 13), same build, three rounds each, 1280 x 800:** a drag drawn whole
    (`?scrub=full`) median 50 ms, 95th percentile 83 to 100 ms; the cheaper drag median
    33.4 ms, 95th percentile 50 to 67 ms. **The target (16.7 and 33 ms) is not met.** What is
    left is not the drag: a forced redraw with the clock standing still also takes 33 ms. An
    A/B inside one page, each part hidden in turn for 1.5 s, four rounds: as built 35.7 ms
    mean, trees hidden 30.0, no shadow light 34.1, bloom off 35.2, sky hidden 32.4,
    **buildings hidden 25.7 (median 16.8)**. So the rest is the city itself: 355 building
    tiles and 4 to 8 million triangles in view at eye level on a desktop screen, whose camera
    sees far more than the viewfinder's crop. Getting under 16.7 ms means drawing fewer or
    coarser buildings outside the frame, which changes the picture around the viewfinder and
    was not attempted. (An hour earlier, at a load average of 288 from other test browsers,
    every variant read 50 ms and nothing could be told apart; those numbers were thrown away.)
