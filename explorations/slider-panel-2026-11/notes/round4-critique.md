# Round 4 weather strip — critique

Reviewer stance: product design + amateur astrophotography, auditing the widget against the
user's actual decisions and what the repo's data sources can honestly support. Every code claim
cites file + line. Sketch claims cite `/tmp/claude-sketch/weather-strip-sketches.html` (S) and
`/tmp/claude-sketch/round4-designs.md` (D).

---

## 1. The user's decision ladder

The app is shot-centric everywhere else, so the strip's job is to serve the same decisions the
plan cards serve (`planmode.js:167-242`), in the order they're actually asked:

| # | Question | When asked | What answers it today |
|---|---|---|---|
| 1 | **"Is tomorrow dawn / Saturday dusk a go?"** — one event, go/no-go | Couch, T-12–36h | `readSky()` (`weather.js:119-132`) — the strip doesn't use it |
| 2 | **"Of the next three days, which one or two events are worth my alarm clock?"** — ranking across days | Couch | PER_DAY=3 card ranking (`planmode.js:185-189`); the strip should visualise the comparison, not re-derive it |
| 3 | **"It's still on — did the forecast move?"** | Door, T-0–1h | Re-grade every 5 min (`planmode.js:89-91`) |
| 4 | **"Which way do I stand, what minute, what lens?"** | On-site | Cards + `horizon.js` (bearings, alt, tower distance) — **not the strip's job** |
| 5 | Gear/comfort: rain on the lens, wind shake, fog soaking the tripod | Door | Nothing — and that's fine |

What they are optimizing, in evidence order: a **coloured sky at rise/set** (the whole
riseHorizon/setHorizon machinery, `weather.js:2-4, 119-132`), a **low moon behind the TV
tower** (moon tower rows exist only for moon alt 1–8°, `daylist.js:80`, gated lit ≥ 0.5,
`daylist.js:75`), and **alignment moments at exact minutes** (tower/street rows carry clock
times to the minute, `daylist.js:65,101,125`). Nobody in this ladder asks "is the rain a front
or a shower" (rung 5) or "how many mm fell by 4pm" (rung 5). Note also: `planmode.gradeAt`
(`planmode.js:94-103`) grades shots on **cloud + visibility only — rain probability plays no
part in what the plan shows**. The Round-4 rain work is solving a problem the plan itself
doesn't have.

**Granularity.** Every event on the ladder lives in a 10–90 minute window (blue+golden at
Berlin's November latitudes; moon-tower alignment in a ≤7°-altitude band). Hour bins are the
wrong atom. The right atom — the *event instant* — is already computed: rise/set minutes at
5-min resolution (`weather.js:23-28`), moonrise/set via `getMoonTimes` (imported at
`planmode.js:11`, used at `planmode.js:48`).

**"Clear midday earns no frame" — wrong for this user, this season.** Berlin late-November
noon sun sits at ~17–18°, and the app's own definition of golden is "sun below 6°"
(`lightPhases.ts:22-23`). In November the sun spends barely ~5h above 6°; a clear 13:00 is
genuinely low, raking light on buildings, and street-henge moments (`streets.ts` moments
via `planmode.js:150-153`) fire all afternoon. The dawn/dusk-only frame rule imports summer
intuition into the one season where midday *is* golden hour. The bug isn't that Saturday gets a
frame at midday — it's that the sketch (S:973-975) and the design doc disagree about it: D:53
defines `sunRuns` with **no golden-hour restriction at all** and D:97 happily expects "one long
sun frame 08:00–16:00", while S:998 filters on a hardcoded `goldenHour` of
`[[428,475],[896,943]]` (S:975) — mock minute constants, not ephemeris. Both artefacts are
wrong in opposite directions; the correct window is computable from `lightBands()`
(`lightPhases.ts:41-51`), which `sparkstrip.js:44` **already calls**.

---

## 2. Verdict on the current widget

**Serves the ladder well:** nothing, yet — it's a sketch. What serves it in the *skeleton*:
deck strata (real data), the quiet status ink. What's genuinely right in Round 4: the
illumination gate value 0.25 matches the app's own `MIN_MOON_ILLUMINATION`
(`dailyPaths.ts:34`), and "rail without frame = up but unusable" is honest.

**Decoration:** the four rain encodings (S:1040-1135, D:102-286). Four variants of
type+intensity typography for the ladder's fifth rung. Variant D's cumulative wetness trace is
worse than decoration — it draws attention *toward the afternoon* (accumulation grows rightward
by construction, D:266-269) on the axis where the decision lives at 07:00. Variant C's
front/shower classification is meteorology storytelling the user never asks for, derived by a
"≥3 wet hours = front" heuristic (S:1092) that will mislabel as often as not.

**Misleading — the Round-4 mechanics specifically:**

1. **The ±2h moon window is wrong in both directions, and contradicts the app's own geometry.**
   S:990-991 gates moon frames on being within 2h of an up-span edge. But the app generates
   moon-tower rows only for moon alt 1–8° (`daylist.js:80`) and moon highlight paths only for
   alt 2–12° (`dailyPaths.ts:145-147`). At Berlin's latitude the moon climbs ~10–13°/h on a
   steep rise and far less on a shallow winter rise, so ±2h can mean alt up to ~25° (frames
   where the moon is hopelessly above the 213 m sphere — no card will ever exist) or a window
   3h+ long that the fixed 2h *under*-counts (high-declination shallow passes). The fixed
   constant is wrong precisely because the true quantity — altitude over time — is one
   `sampleBody('moon', …)` sweep away, and `daylist.js:78-85` already contains that exact
   5-minute sweep as precedent. The rail (S:1032-1036) is a flat line where a curve belongs.

2. **Three illumination gates disagree.** Widget: 0.25 (S:972). Tower moon rows: **0.5**
   (`daylist.js:75`). Path highlights: 0.25 (`dailyPaths.ts:34,146,369`). The widget will
   proudly frame a 30%-lit moonrise at 2h from rise — a shot `collectRows` refuses to issue.
   The strip and the plan must share one gate or the widget sells tickets the plan won't honour.

3. **Night-only moon frames hide day-time moon cards.** The plan's moon rows (`streetMoments`
   moon + tower rows, `planmode.js:150-154`) include *daylight* alignments — the repo even has
   a daytime-moon visibility rater (`moonPhase.ts:129-154`). Round 4 frames moon only at night
   (S:992 checks `moonLowAt`, and the mock up-spans are all night, S:488,494,500). A user who
   framed a 30% moon behind the sphere at 14:00 from the plan gets no corresponding mark from
   the strip.

4. **The grading is a third, diverging grade function.** Sketch `gradeAt` (S:505-506): rain
   probability 80/50 thresholds, no visibility. `planmode.gradeAt` (`planmode.js:100-101`):
   cover 0.75/0.5, visibility 3000/9000 m, no rain. And the app's *sky-quality* grade,
   `readSky()` (`weather.js:119-132`) — horizon-aware, the whole point of the 6-point fetch —
   is used by neither. Frames therefore fire on "locally clear" even when
   `readSky` would say "low cloud on the horizon may hide the sun" (`weather.js:128`): a
   clear zenith with a bricked horizon is the classic failed-sunrise, and the widget frames it.

5. **Hour bins vs 10-minute events.** `sunRuns`/`moonRuns` build frames from whole hours
   (S:998-999), so a 47-minute dawn is graded by whichever hourly cell it overlaps, and one
   bad cell amputates a frame mid-event. Frames also snap to `h·PX` boundaries (S:1003-1004)
   rather than to the event minute. The shipped strip already places shot ticks at exact
   minutes with collision nudging (`sparkstrip.js:73-81`) — the precedent is sitting in the
   widget the sketch is meant to replace.

6. **The shared sun-phase axis isn't earning its place.** It duplicates the phase gradient
   `sparkstrip.js:42-45` already draws from `lightBands`, per card, plus the hard-coded golden
   windows. Its one real per-day payload — exact rise/set minutes — is exactly what it can't
   show, because the axis is shared. Drop it; draw per-day event marks on the existing band.

7. **`bright/soft` by illumination ≥0.4 (S:996)** is a second arbitrary number on a quantity
   that moves ~3–4%/day. Across the 3-day window it's near-constant per day; the things that
   actually change a moon photo — altitude and cloud — already have their own encoding. Drop.

---

## 3. Data audit

| Signal | Status | Would change in the widget |
|---|---|---|
| 3-deck cloud, Berlin + 6 horizon pts, one request | **Have** (`weather.js:62-88`) | Already the frame gate — needs to be the *event-hour* gate, not 24-cell gate |
| riseHorizon/setHorizon low-cloud profile | **Have, unused by widget** (`weather.js:88`) | Gate sunrise/sunset frame brightness on horizon low cloud — this is *the* sunrise killer |
| readSky() event grade | **Have, unused by widget** (`weather.js:119-132`) | Become the frame's tint/verdict; delete the parallel gradeAt |
| Exact rise/set minutes + azimuths, 5-min sweep | **Have** (`weather.js:19-30`) | First-class event marks on the axis |
| Moon az/alt at any instant | **Have** (`bodyPosition.ts:52-69`) | Replace the rail with a real altitude curve; derive moon windows from the 1–8° band |
| Moon illumination/limb/phase | **Have** (`moonPhase.ts:69-88`, suncalc `planmode.js:11`) | One gate, shared with `daylist.js:75`/`dailyPaths.ts:34` |
| Moonrise/moonset clock times | **Have** (`getMoonTimes`, used `planmode.js:48`) | Mark the minute; ±2h heuristic deleted |
| Daylight-moon visibility rating | **Have, unused** (`moonPhase.ts:129-154`) | Frame/annotate daytime moon alignments the plan already emits |
| Visibility (fog proxy), Berlin only | **Have, unused by widget** (`weather.js:86`; used `planmode.js:100`) | Fog dawn = a *different* kind of go; show as frame state, not just "poor" |
| cloudDrift (wind advection) | **Have** (`weather.js:139-152`) | Décor only; fine to ignore here |
| `weather_code` hourly | **Could fetch** (Open-Meteo documented var) | Rain *type* honestly: fog (45/48), snow (71–77), thunder (95–99) — mm/h cannot distinguish these, and S/D claim "type" they don't have data for |
| `dew_point_2m` (+ spread) | **Could fetch** | Predict radiation-fog dawns — Berlin's best winter sunrises are fog sunrises; turns a "poor" verdict into a flagged special case |
| `cloud_base`/`cloud_height` | **Could fetch** | Geometry upgrade to `readSky`: the sun at 1° altitude sits ~100–200 m up at 120 km; whether horizon "low cloud" blocks it depends on cloud base, not cover fraction alone |
| 15-min timestep (`temporal_resolution=15`) | **Could fetch** | Kills the hour-bin problem at the source: grade the 47-min golden window on 3–4 sub-hour samples |
| `wind_gusts_10m` | **Could fetch** | Long-exposure/tripod note on the frame — rung 5, low priority |
| `cape` | **Could fetch** | "Dramatic clouds" hint; marginal, skip in v1 |
| `snowfall` | **Could fetch** | Novelty-shot flag; `weather_code` covers it |
| Per-deck movement direction | **Impossible** | One 10 m wind vector (`weather.js:85`) advects everything equally |
| Cumulus vs stratus | **Impossible** | Decks are cover fractions, not types; `weather_code` is sky-total WMO code only |
| Twilight colour quality / aerosols | **Impossible** | `visibility` is the only proxy; volcanic-smoke sunrises unforecastable |
| Urban light pollution | **Impossible** | But *daylight-moon visibility* (`moonPhase.ts:129`) partially covers the visible-moon question |
| Sub-hour cloud timing at 60–220 km | **Impossible** | Model grid + hourly output; event-window grading must tolerate ±1h slop — another reason to mark the *event*, not the cell |

---

## 4. Prescription (ranked)

**MUST show:**

1. **Event marks at exact minutes** — sunrise, sunset, moonrise, moonset as ticks/edges on the
   existing band (data: `weather.js:25`, `getMoonTimes` via `planmode.js:11`). Windows drawn
   *around* them from `lightBands()` for the sun and from sampled moon altitude for the moon.
2. **A real moon altitude curve** replacing the flat rail: sample `sampleBody('moon', …)`
   hourly-to-5-min (precedent: `daylist.js:78-85`), draw alt 0–30° as a curve under night
   hours; highlight where it passes the app's own 1–8° window (`daylist.js:80`). The curve
   *is* the window — honest on shallow and steep rises alike.
3. **`readSky()` as the frame's verdict** — good/fair/poor tint on the sun frames, including
   the horizon-cloud fail (`riseHorizon`/`setHorizon`, `weather.js:88`). One grading authority,
   horizon-aware, already written.
4. **One shared illumination gate** (pick 0.25 for generic moon, but tower-frame only where the
   plan agrees — or lower `daylist.js:75` to `MIN_MOON_ILLUMINATION`).
5. **Fog/visibility state** — visibility is fetched (`weather.js:86`) and used by the plan
   (`planmode.js:100`) but invisible in the widget; add `weather_code`+`dew_point_2m` in the
   next fetch (`weather.js:67`) to name the fog dawn as a special go.

**DROP:**

- Three of the four rain encodings. Keep A's quiet ground band (D:110-137) at most; D's
  cumulative trace is actively misdirecting; C's front/shower typology and B's bead census
  answer rung-5 questions with made-up classifications.
- The separate shared sun-phase axis (duplicates `sparkstrip.js:42-45`).
- `bright/soft` illumination sub-classes (S:996).
- The hardcoded `litH`/`goldenHour` minute constants (S:712, 828, 975) — replace with
  `lightBands`, which the shipped strip already uses.
- Hour-cell verdict strips (`r4verdict`, S:1017-1027): the frames *are* the verdict; the
  3px strip is a third redundant grade render.

**Best information-per-pixel, 3 changes:** (1) exact-minute event marks + ephemeris-true
windows; (2) moon altitude curve instead of rail; (3) `readSky` tint with horizon-cloud gating
— all three use data the repo already computes and currently throws away at the widget layer.

---

## 5. v1, concretely

A `weatherstrip` pass inside `renderSparkstrip`'s row builder (`sparkstrip.js:25-120`), fed by
the `blocks` that `renderPlanCards` already assembles (`planmode.js:191`): per day, compute
`events = { rise, set }` from `cloudsFor`'s existing sweep (`weather.js:19-30`), and moon
rise/set from `getMoonTimes`; draw each as a 1px tick at `((t - from) / 86_400_000) * 100%`
on the band that already carries the `lightBands` gradient (`sparkstrip.js:44`), reusing the
tick-collision nudge (`sparkstrip.js:73-81`) as pattern. Sun frames = the `golden`+`blue` bands
from `lightBands` clipped to "sun up or within blue hour", tinted by `readSky(day, 'rise'|'set')`
grade, dimmed to a ghost outline when the horizon gate (`riseHorizon`/`setHorizon` low > 0.6)
fails. Moon frames = the 5-minute `sampleBody('moon')` alt sweep, marked where alt ∈ [1,8]°,
gated by one shared illumination constant and `cloudsAt`/`visibilityAt` at the window's mid
instant; the rest of the night shows the altitude curve at 2px so "up but useless" stays
visible. Keep variant-A's ground band as the only rain element. Hover keeps `sparkstrip.js`'s
crosshair pattern and reads the event text verbatim from `readSky` plus exact clock times.
Second session, not v1: switch the fetch (`weather.js:67`) to `weather_code,dew_point_2m` +
15-min timestep, and add the cloud-base geometry upgrade to `readSky`. Nothing here needs new
data plumbing beyond one `hourly=` string edit — every window, gate and tint is derived from
exports that already exist in `weather.js`, `bodyPosition.ts`, `moonPhase.ts` and
`lightPhases.ts`.
