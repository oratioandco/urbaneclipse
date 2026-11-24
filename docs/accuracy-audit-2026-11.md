# Accuracy audit, 23 November 2026

An adversarial check of every number Urban Eclipse gives a photographer, against a reference
that shares no code with the app. Branch `claude/accuracy-audit-929e89`, cut from `main` at 597b270.

## Verdict

**Would I trust the app's times for a real shoot today?**

- **Panel 05 on `/classic` (Lichtenberger Brücke to the Fernsehturm): yes**, for passes with the
  disc more than about 1° above the horizon. All 203 windows the app lists over twelve months
  exist in the reference, and none is missing. The best moment is within 6 s (median), 16 s
  (90 %) of the reference. You must stand on the listed point: one metre sideways moves the
  moment by 3 s.
- **The `/plan/` date list ("Behind the TV tower from here"): yes, to the minute**, with the fix
  on this branch. Before the fix it measured against the wrong north and was 20 s and 7 m out
  from the bridge. The list shows one whole minute for a pass that lasts two to four, so plan to
  be shooting a minute before it.
- **Not on 28 March and 31 October 2027 in `/plan/`**: picking a shot on a clock-change day sets
  the scene one hour off (defect 1, not fixed here).
- **Not for passes low on the horizon**: 60 of the 203 bridge windows have the disc's centre
  under 0.8°, where the app's own street data puts the skyline at 0.5°. The app lists them
  without saying that buildings probably hide them (defect 3).

**Before a release:** merge this branch's fix (defect 2), fix the clock on change days
(defect 1), mark or drop the low passes in panel 05 (defect 3), and correct the panel's note
that moon days are "±2 Tage genau", which is no longer true and undersells the app (defect 8).
The rest can follow.

**Update, 24 November 2026** (branch `claude/accuracy-fixes-7368f7`): defects 1, 3, 5, 7, 8 and 9
are fixed and 10 and 13 partly, each with a test against the reference; see the dated note under
each defect. Two things still stand between this and "yes" on the clock-change days: the `/plan/`
day view's own timeline and the moon header, both in files another session owns.

**A correction to the handoff:** it says suncalc's lunar theory is 0.3° off and misses the moon
on 14 January and 27 September 2027. The installed suncalc 2.0.1 uses the full Meeus chapter 47
series with parallax and delta-T. Measured here it is within 0.009° of JPL DE421 all year. It
finds 14 January 2027 (22:35:53 UTC, 9 s from the reference). On 27 September 2027 there is no
pass to find: the reference shows the moon's limb missing the antenna from every bridge point,
and the app lists one graze of 0.004 % from `sued-west`. "Moon accuracy" can come off the list
of next steps.

## Method

**The reference** (`scripts/audit/reflib.py`):

- Ephemeris: Skyfield 1.55 with JPL DE421, topocentric apparent places (light time, aberration,
  nutation, Skyfield's delta-T and leap seconds). The 17 MB kernel downloads on first run.
- Refraction: Bennett's formula at 10 °C and 1010 mbar. The app uses Sæmundsson's (Meeus 16.4).
- Geometry: WGS84. Bearings and distances by Vincenty's geodesic; the elevation of a point on a
  landmark through ECEF, so the earth's curvature is included. No terrestrial refraction (it
  lifts a point 6.1 km away by 0.004°).
- Passes: a 60 s sweep of the whole year, then 5 s samples wherever a body is within 1.5° of
  the landmark. The covered share of the disc is counted on 4,500 points, with the disc's true
  radius at that moment.

**The app's side** (`scripts/audit/app_dump.ts`) calls the app's own functions with the
arguments the pages pass, for 23 November 2026 to 23 November 2027.

**Landmark data.** Axis positions were checked against OpenStreetMap through Overpass
(`landmarks_osm.py`): Fernsehturm 0.55 m from the centre of way 556435241, Brandenburger Tor
0.24 m from way 518071791, Siegessäule 0.1 m from the node mean of way 718035022. Base heights
were compared with the repository's DGM1 grid (10 m): Brandenburger Tor 34.5 against 34.2 to
35.0 m, Siegessäule 35.2 against 34.0 to 36.1 m (terrace and roundabout), Fernsehturm 34.6
against 35.3 to 39.9 m. The tower's foot stands in a built-up plinth that bare-earth data
cannot resolve, so its base is uncertain by about 2 m, which is 0.02° from the bridge.
Structure heights (368.03 m, sphere centre 213.78 m, column 67 m) are the published figures the
code cites; I did not re-measure them.

**One slip of my own, found and fixed:** the first comparison showed a constant 0.085° azimuth
offset. It was the reference's time conversion counting 27 leap seconds, not the app.

**Tolerance for a two-minute transit.** From the bridge the sphere is 0.30° wide and the disc
0.53°; the sun moves 0.20° a minute sideways. I would defend: directions within 0.02° (2 m at
the tower, 6 s), the best moment within 30 s, the window's edges within 45 s.

## What the app claims, and what computes it

| Shown to the user | Where | Computed by | Assumes |
|---|---|---|---|
| Sun and moon azimuth, altitude | everywhere | `src/lib/bodyPosition.ts` `sampleBody` → suncalc 2.0.1 `getPosition`, `getMoonPosition` | Apparent altitude (refraction at 10 °C, 1010 mbar; a constant 0.48° below the horizon). Moon topocentric. No observer height |
| Disc size | `/classic`, `/map` | `occultation.ts` `angularRadiusDeg` from distance | Sun 695,700 km, moon 1,737.4 km; moon distance geocentric (up to 0.005° small when high) |
| Disc size | `/plan/` | `towerShots.js` `DISC_DEG` 0.52, `DISC_RADIUS_DEG` 0.27 | Fixed. True radius is 0.262 to 0.271° (sun), 0.245 to 0.279° (moon) |
| Panel 05 windows: day, time, covered %, band | `/classic` | `vantageWindows.ts` `enumerateVantageWindows` (5 min gate, 30 s grid, refined peak) | Eye 1.6 m above the surveyed deck (DOM1), tower base 34.6 m, geoid 39.5 m, minimum altitude −1°. No buildings |
| Siegessäule preview windows, "frei / verdeckt / unsicher" | `/classic?horizon=1` | `horizonWindows.ts` | Bare-earth DGM1 skyline, base 35.2 m. No trees or buildings |
| Standing points, bearing, distance | panel 05 | `vantages.ts` `bearingDistanceTo` (ECEF chord) | OSM node coordinates |
| "Behind the TV tower / gate / column from here", 12 months | `/plan/` | `towerShots.js` `findShots` in `dates.worker.js` (10 min gate, 1 min grid) | Flat scene, eye 1.6 m above scene ground, fixed disc, moon ≥ 25 % lit; buildings checked afterwards by `clearView` |
| "Down this street" dates | `/plan/`, `/map` | `streets.ts` `findStreetPasses` | Stored bearing, skyline and tolerance per street; disc 0.3 to 4° above the skyline; one pass per UTC day |
| Day list, tower lines on the map | `/plan/`, `/map` | `dailyPaths.ts` `computeDayPath` (3 min grid, 15 s for the building check) | Sphere centre 213 m, eye 1.5 m, body sampled at the tower |
| Golden, blue hour, twilight | `/plan/`, `/map` | `lightPhases.ts`: day ≥ 6°, golden to −4°, blue to −8°, twilight to −12° | Apparent altitude at the tower |
| Solar day bar | `/classic` | `timeline.ts` from suncalc `getTimes` | Different definitions from the above, and the UTC day |
| "Sunrise 07:42: …" weather line | `/plan/` | `weather.js` `horizonAzimuths`, 5 min samples | Apparent centre at 0°, not the upper limb |
| Moon phase, % lit, rise and set | `/plan/` header | suncalc `getMoonIllumination`, `getMoonTimes` | Geocentric; rise and set scanned over the UTC day |
| Cloud notes and good/fair/poor | `/plan/` | `planmode.js` `gradeAt`, `weather.js` `readSky`, `dates.js` `sunState` | Open-Meteo hourly cloud over Berlin |
| All clock times | `/plan/` | `time.js` (Berlin), `clock.js` `instant` | See defect 1 |
| All clock times | panel 05 | `VantageCalendar.tsx` `formatWhen` | The browser's own time zone, unlabelled |

## Results

### Sun and moon directions (52,560 instants, every 10 minutes for a year)

| | Azimuth on the sky | Altitude, above 5° | Altitude, 0 to 5° |
|---|---|---|---|
| Sun | 0.005° rms, 0.008° max | 0.004° rms, 0.009° max | 0.017° rms, 0.09° max |
| Moon | 0.005° rms, 0.009° max | 0.003° rms, 0.011° max | 0.017° rms, 0.09° max |

0.009° is 1 m at the tower from the bridge, or 2.6 s. The 0.09° at the very horizon is the two
refraction formulas parting below 0.5°; the weather moves the real figure by ±0.04° there
(−10 °C and 1035 mbar against 30 °C and 995 mbar), so neither is "right". The moon's lit
share agrees to 0.006 %. Sunrise and sunset from suncalc are within 3 s. Dates out to 2050 stay
within 0.007°.

**Passes.**

### Panel 05, Lichtenberger Brücke to the Fernsehturm (six points, 203 windows)

| | Sun (114) | Moon (89) |
|---|---|---|
| Best moment, app minus reference | 6 s median, 14 s at 90 %, 49 s worst | 7 s, 20 s, 48 s |
| Window start and end | 15 s median, 55 s worst | 15 s, 55 s |
| Covered share | 0.6 points median | 0.6 points |
| Length of a pass (reference) | 3 min 10 s median | 3 min 15 s |

The worst cases (48 to 49 s) are grazes where the disc's edge touches the antenna and 3 to 4 %
is covered for over a minute, so "the best moment" has no sharp answer. With the disc above 1°
and more than 5 % covered, every window is within 32 s. **All pass the tolerance.**

The reference has five passes the app does not list, all with the sun's centre 0.33° *below*
the horizon and 2 to 6 % of the disc behind the tower's foot: not photographs. The app has one
the reference does not: the 0.004 % graze on 27 September 2027.

Bearings and distances of all six points match the geodesic to 0.0001° and 0.1 m.

### `/plan/` date search, nine spots, about 500 shots (149 at the tower, 355 at the gate and column)

| | Before the fix | With the fix |
|---|---|---|
| Alignment instant against the true axis crossing, Fernsehturm, sun | 13 s median | 2 s |
| The same from the bridge (6.2 km east) | 20 s, 7.7 m at the tower | 1 to 3 s, under 1 m |
| The same from 5 km west of the tower | 0.059°, 5.2 m | under 1 m |
| "Edge" shots at the gate or column where the disc touches nothing | 23 | 7 |

The reference's own search for the tower (sphere touches and antenna crossings) finds no pass
the app misses and the app lists none that does not happen. Sphere states agree in 147 of 149
shots; the two others are within 0.005° of the boundary.

The time a row shows is the best-looking whole minute. For the sun at the sphere's edge it is
52 s (median) from the moment the sun's centre crosses the axis, 164 s at worst. That is by
design (closest to the sphere, on a one-minute grid) but the row does not say so.

### Streets

All 1,713 stored bearings are within 0.12° of the geodesic (0.03° rms): true north is right.
For 351 listed passes on eight streets, the body is where the app says to 0.008°, and inside the
street's tolerance every time.

### Clock-change days, solstices, equinoxes, named moon dates

Twelve days were checked (`results/streets_times.json`). Directions, panel 05 and the date list
work in instants and are right on all of them. What is wrong on those days is the `/plan/`
clock (defect 1), the weather-line sunrise (defect 5) and the light bands (defect 9).

## Defects, ranked

Each has a case you can reproduce. "Fixed" means fixed on this branch with a test. Notes dated
2026-11-24 are from the follow-up branch `claude/accuracy-fixes-7368f7`; its numbers are from a full
re-run of `scripts/audit/run.sh` before and after.

**1. `/plan/`: picking a shot on a clock-change day sets the scene one hour off.** High, two
days a year. `clock.js` `setMinute` stores minutes *elapsed* since Berlin midnight; `instant()`
reads them back as *wall-clock* minutes. Case: 28 March 2027, a shot at 19:35 CEST → the slider
reads 18:35 and the scene shows 18:35, one hour early; 31 October 2027, 16:40 → 17:40. Replayed
from the file's own lines in Node, in Berlin and New York time. The row's printed time is right;
the sun in the scene is 15° away from where the shot is. Also wrong on those days: slider times
between 01:00 and 03:00, and `plan.js`, `daylist.js`, `sparkstrip.js`, `planmode.js`, which
build a day as 24 hours. Fix: let `setMinute` convert through Berlin wall time
(`src/lib/berlinTime.ts` already does this correctly with two passes), and take day ends from
the next Berlin midnight. Not fixed: `clock.js` is not solver code.
**Fixed on 2026-11-24** in `clock.js`, with the arithmetic in the new `berlinClock.js`: the slider
is wall-clock minutes in both directions. A 19:35 shot on 28 March set the slider to 18:35 (60
minutes off); it now sets 19:35 and the same instant, likewise 16:40 on 31 October. A time in the
missing hour moves to what the clock reads (02:30 becomes 03:30); a shot in the doubled hour keeps
its own instant. Tests: `clockChange.test.ts`, `clockModule.test.ts` (the real module with a
stand-in page), and the built page checked in Chrome. **Still open, in the panel's files:**
`dayview.js`, `daylist.js`, `sparkstrip.js`, `plan.js`, `planmode.js`, `verdict.js` and `dates.js`
still build a day as 24 hours and turn an instant into minutes by subtracting midnight, so a shot
picked from the day view's own timeline is still an hour off on those two days. `clock.js` now
exports `instantOfMinute`, `minuteOf` and `dayEnd` for them.

**2. `/plan/` date search measured a true azimuth against grid north. Fixed.** Medium. The scene
is a transverse Mercator centred on the tower, so its north is the tower's; the search sampled
the sun where you stand and compared it with a bearing in the scene. Error: 0.071° at the
bridge (7.7 m at the tower, 20 s), 0.059° 5 km west. The flat scene also showed a landmark
6 km away 0.03° too high. Fix: `gridConvergenceDeg` and `curvatureDropDeg` in `towerShots.js`,
passed by `dates.js`. The eye-level view and the day list sample the sun at the tower and were
already right in azimuth.

**3. Panel 05 lists passes that the skyline very likely hides.** Medium. The Fernsehturm
calendar has no building or horizon test. 60 of 203 windows have the disc's centre below 0.8°,
45 below 0.5°. Case: `sued-mitte`, 4 April 2027, 19:42 CEST, "39 %": the sun's centre is 0.14°
up, behind the tower's lowest 30 m. The app's own street data gives a 0.5° skyline for
Frankfurter Allee from the same bridge. I could not confirm against the building model (it is
not in this checkout), so this is likely, not proven. Fix: gate the calendar on the skyline
toward the tower (the Siegessäule preview's machinery, with the surface model rather than bare
earth), or label these rows "am Horizont, Sicht prüfen".
**Fixed on 2026-11-24 by labelling.** A window with the disc's centre under 0.8° is listed paler
with "tief, Scheibenmitte 0,1° hoch · wahrscheinlich von Häusern verdeckt", counted in the summary
and never offered as "Nächster Termin". 0.8° is the street data's 0.5° skyline plus the 0.27° disc:
below it part of the disc is behind the roofs. The reference puts 61 of the 203 windows under that
line on this run (60 when audited; one sits on it) and the panel marks the same ones, bar those
within 0.1° of the line (`panel05.test.ts`, `lib/lowPass.ts`). Still a likelihood: the building
model has not been run for the bridge.

**4. `/plan/` lists one whole minute for a pass of two to four.** Medium to low. Up to 30 s of
rounding, and the chosen minute is the closest to the sphere, not the axis crossing. Case:
bridge, 4 September 2027: listed 19:33 (before the fix), axis crossing 19:34:19. Fix: show the
pass as "19:32 to 19:35" and refine the best moment to seconds, as panel 05 does.
**Left on 2026-11-24:** the row is drawn in `dates.js`, one of the panel session's files.

**5. The weather line's sunrise is 3 to 7 minutes late; sunset is 2 minutes either way.** Low
to medium. `weather.js` takes the first 5-minute sample after the sun's centre passes 0°.
Case: 21 June 2027, sunrise shown 7 min after the reference; 27 March 2027, 6 min 40 s. Fix:
use suncalc `getTimes` (within 3 s).
**Fixed on 2026-11-24:** `horizonAzimuths` uses suncalc's sunrise and sunset. Sunrise was 178 to
418 s late and is now within 2 s; sunset was 126 s early to 114 s late and is now within 3 s, on
all twelve days (`results/streets_times.json`, test in `accuracyAudit.test.ts`).

**6. The weather grades disagree with each other and with the sky a photographer cares about.**
Medium to low, see the next section.
**Left on 2026-11-24** to the session that owns the `/plan/` panel, which is unifying the grades.

**7. Panel 05 prints times in the browser's time zone with no label.** Low for Berliners, an
hour or more wrong for anyone planning from abroad. `VantageCalendar.tsx` `formatWhen`. Fix:
`timeZone: 'Europe/Berlin'`, as `/plan/` and `/map` do.
**Fixed on 2026-11-24:** `formatWhenDe` in `lib/berlinTime.ts` prints Europe/Berlin, the panel says
"Alle Uhrzeiten in Berliner Zeit (MEZ/MESZ)" and the next date carries MEZ or MESZ. Checked with
the device set to New York, Tokyo and UTC (`panel05.test.ts`) and in Chrome with a New York clock:
the list is identical. Before, 19:35 printed as 13:35 there.

**8. Panel 05 says "Mond-Tage sind auf ±2 Tage genau (Mondtheorie von suncalc)".** Low, but it
is a false statement about accuracy. Moon windows are within 20 s (90 %). Remove the sentence.
**Fixed on 2026-11-24:** the sentence is gone from both targets; the panel now says sun and moon
times are equally exact.

**9. Blue hour and twilight start 3.5 to 5 minutes late (11 minutes for night at midsummer).**
Low. Below the horizon the app still adds 0.48° of refraction, so "4° down" is really 4.48°.
Case: 20 March 2027, blue hour starts 4 min 6 s after the sun's centre reaches −4°. Fix: use
the unrefracted altitude below the horizon. Expected-fail test.
**Fixed on 2026-11-24:** `lightPhaseAt` takes suncalc's constant 0.484° off under the horizon, and
`lightBands` narrows each edge to a second instead of leaving it on the sampling step. Evening
edges against the reference, twelve days: golden to blue 207 to 312 s late before, 2 to 4 s now;
blue to twilight 207 to 396 s, now 2 to 4 s; twilight to night 204 to 666 s, now 2 to 6 s. The
expected-fail test is a plain test.

**10. Siegessäule preview: the listed time wanders when the whole disc is hidden.** Low,
preview only. From 718 m the hall covers the disc completely for minutes and the "peak" is any
moment of that plateau: up to 115 s and 0.46° (5.7 m) from the centred moment. Four windows are
only the sun grazing the 1.1 m terrace, up to 2° beside the column. Fix: among equal cover,
take the moment nearest the axis; leave the terrace out of the outline. Expected-fail test.
**Partly fixed on 2026-11-24:** among fully covered instants the window now takes the one nearest
the axis (`centreOnPlateau` in `vantageWindows.ts`). Against the reference's axis crossing, the six
passes from "west" whose crossing lies inside the hidden stretch were up to 140 s out and are now
within 21 s (median 2 s). The reference's own "peak" on such a pass is the middle of the stretch in
time, not the axis crossing, so the test now compares with the crossing, which the reference
reports since this run. Not done: the terrace is still part of the outline, so the four grazes
remain. The expected-fail test is a plain test.

**11. Solid landmarks: "edge" was a bounding-box test. Fixed.** Low. 23 of 365 gate and column
shots had the disc passing clear. Now the disc's own curve is tested at each height; 7 remain,
all within 0.05° of touching.

**12. Brandenburger Tor: "Sun behind the gate" on 45 days from Pariser Platz.** Low, a question
of meaning. The gate is modelled as a 25.8 m round solid; from 190 m the sun simply sets behind
a building. The disc's centre is up to 4° from the axis at the listed minute. Consider listing
only the quadriga band.
**Left on 2026-11-24:** a decision about what the product should list, not an error to correct.

**13. The moon header misses a moonrise or moonset in the first hour or two after midnight.**
Low. suncalc scans the UTC day. Case: 27 March 2027, the moon rises at 00:18 Berlin time; the
header shows only the set. Expected-fail test.
**Partly fixed on 2026-11-24:** `moonTimesBetween` in the new `lib/moonTimes.ts` finds every rise
and set inside a Berlin day: on the twelve days all 23 of the reference's are found within 5 s,
the 00:18 rise included, and the set that suncalc reported for 14 January (really 00:01 on the
15th) is no longer shown. The expected-fail test is a plain test. **Still open:** the header in
`planmode.js` (the panel's file) has to call it:
`moonTimesBetween(from, dateDayStart(tomorrow), FERNSEHTURM.lat, FERNSEHTURM.lon)`.

**14. Small inconsistencies.** Low. `/plan/` uses a fixed disc (0.27° radius) where the true
one is 0.245 to 0.279°; the sphere centre is 213 m in `dailyPaths.ts` and 213.78 m in
`landmarks.ts`; its top 229 m against 229.78 m; eye height 1.5 m against 1.6 m. Each is under
0.01° from the bridge and up to 0.03° from 1.3 km. `findStreetPasses` keeps one pass per UTC
day, which could split a moon pass at 01:00 or 02:00 Berlin time (none in the sampled year).
**Left on 2026-11-24:** each is under 0.01° from the bridge, no reference case fails on them, and
the constants feed the day list that the panel session is working on.

## Attacking the edges

| Attack | Result |
|---|---|
| Observer off the listed point | 1 m sideways at the bridge = 0.009° = 2.8 s; 10 m = 28 s. The six bridge points span 0.38°, about 2 minutes. Phone GPS (±5 m) is ±14 s. The app's six separate calendars are the right answer; the copy could say "auf den Meter" |
| Eye height | 1 m = 0.009° from the bridge: irrelevant. From 718 m it is 0.08° |
| Low altitude, refraction | ±0.04° with the weather below 2°, up and down only (4 m at the tower from the bridge). Times do not move; the height on the tower does |
| Moon parallax | The app is topocentric (0.009° from DE421). Geocentric would be up to 0.95° out |
| Leap seconds, delta-T | JavaScript time is UTC; UT1 differs by under 0.9 s (0.004°). suncalc's delta-T is 22 s from Skyfield's by 2050, worth 0.003° on the moon |
| Far future | 2030 to 2050: within 0.007° |
| Antenna against sphere | States agree with the reference in 147 of 149 shots |
| Midnight, clock change | Instants are right. `/plan/` clock is wrong on change days (defect 1); moon header (13); street passes keyed by UTC day (14) |
| Blocked by buildings or terrain | Panel 05, Fernsehturm: not tested by the app at all (defect 3). `/plan/` tests buildings (`clearView`) but I could not run it: the city geometry is only on the server. Trees are in neither. The Siegessäule preview uses bare earth and says so |

## The weather verdict

Read only: `weather.js`, `forecast.js`, `planmode.js` (`gradeAt`), `dates.js` (`sunState`).

- **Three rules for the same sky.** `gradeAt` takes the largest of low, middle and high cloud:
  over 75 % is "poor", over 50 % "fair". `sunState` weights them (low 1, middle 0.85, high 0.4).
  `readSky` calls middle or high cloud between 20 and 80 % "good: clouds above to catch the
  colour". So 80 % thin cirrus with no low cloud is "poor" on a card, "sun maybe" in the date
  list, and the textbook case for a red sunset. **A clear lower sky is graded badly.**
- **The wrong place.** A disc 2° up is seen through air 50 to 200 km away. `gradeAt` and
  `sunState` use the cloud over Berlin only. `readSky` does look 60, 120 and 220 km toward the
  sun, but only at low cloud, only for sunrise and sunset, and it is not used for the shot
  grades. **A horizon blocked by a cloud bank is graded "good"** when Berlin itself is clear.
- **"Good" on a card means "not cloudy and not hazy overhead".** For a silhouette of the tower
  against the disc that is close to what a photographer wants, apart from the horizon. For
  colour it is the opposite of `readSky`'s "good".
- **Visibility under 3 km is "poor"** whatever the distance. From 1.3 km a 4 km haze is fine;
  from 6.1 km a 9 km visibility ("fair") already washes the tower out. Compare with the
  distance of the shot.
- **Clock-change days:** the hourly arrays are read by minutes elapsed since midnight, an hour
  off after the change.
- Fix, in order: one function for all three places; grade a low shot on cloud along the
  bearing to the body (the horizon points `cloudsFor` already fetches), not overhead; let
  high cloud dim rather than block.

## What I could not check

- **Buildings and trees.** `clearView` needs the city geometry, which is only on the server.
  No on-site check of any standing point.
- **The pages in a browser.** I ran the functions the pages call, not the pages. Defect 1 was
  replayed from `clock.js`'s lines, not clicked.
- **`/map`'s spot events and the `/classic` area solver** (`findSpotEvents`, `findCompositions`).
  They use the same ephemeris and silhouette code that passed, but their results were not
  compared one by one.
- **Structure dimensions** (shaft taper, antenna width, column profile) against a survey.
- **The Fernsehturm's base height** to better than about 2 m.
- **Berliner Dom** (OSM lookup timed out; the model is not shown in `/plan/` or panel 05).
- **The forecast itself** (Open-Meteo's skill), only the logic that reads it.

## Reproduce

```sh
python3 -m venv .venv && .venv/bin/pip install skyfield
sh scripts/audit/run.sh        # 10 to 20 minutes; downloads DE421 (17 MB) on first run
npx vitest run tests/unit/accuracyAudit.test.ts
```

The numbers above are in `scripts/audit/results/`. The tests hold the app to the reference in
`tests/fixtures/accuracy-reference.json`: 12 passed and 3 were expected failures (defects 9, 10, 13)
when audited; since 2026-11-24 all pass, with one more for the weather line, and
`clockChange.test.ts`, `clockModule.test.ts` and `panel05.test.ts` cover defects 1, 3 and 7.
