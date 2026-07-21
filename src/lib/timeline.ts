/**
 * Pure sun-event timeline classifier — NO suncalc dependency at module load
 * (Constitution Principle I: TDD-first, pure math, Vitest-covered; Principle II: defensive).
 *
 * The module consumes a getTimes-SHAPED object (`Record<string, Date>`) rather than
 * calling suncalc itself, so the timeline math is fully mockable and testable without
 * a network, a clock, or suncalc's floating-point output. A caller wires real data via
 * `SunCalc.getTimes(...)` at the edges; all branching lives here.
 *
 * ── suncalc 2.0.1 field names (verified by a live call, see tests/unit/timeline.test.ts) ──
 *   solarNoon, nadir, sunrise, sunset, sunriseEnd, sunsetStart, dawn, dusk,
 *   nauticalDawn, nauticalDusk, night, nightEnd, goldenHour, goldenHourEnd
 *
 *   • There is NO `solarMidnight` field — suncalc 2.0.1 names the solar-midnight
 *     instant `nadir` (its JSDoc reads "Local solar midnight (Sun's lowest point)").
 *   • There is NO `blueHour` field — blue windows are derived from nautical/civil twilights.
 *   • Event fields (`night`, `nightEnd`, …) can be `null` at high latitudes (e.g. Berlin
 *     in summer); everything is guarded defensively.
 *
 * ── Counterintuitive golden-hour naming (the swap this module encodes) ──
 *   `goldenHourEnd` is the END of the MORNING golden hour  → morning band [sunrise, goldenHourEnd]
 *   `goldenHour`    is the START of the EVENING golden hour → evening band [goldenHour, sunset]
 */

/** Timeline band kind. Golden and blue are atmospheric; day and night are the remainder. */
export type BandKind = 'golden' | 'blue' | 'day' | 'night';

/** A half-open-ish time band on a single solar day. Night bands may wrap midnight (start > end). */
export interface Band {
  kind: BandKind;
  start: Date;
  end: Date;
}

/** A getTimes-shaped input: arbitrary string keys → Date (per suncalc's `SunTimes`). */
export type TimesInput = Record<string, Date>;

/** True only for a real, finite Date — rejects undefined, null, and Invalid Dates (NaN). */
function isValidDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

/** Read a named field as a valid Date, or undefined if missing/null/NaN. */
function getField(times: TimesInput, key: string): Date | undefined {
  const v = times[key];
  return isValidDate(v) ? v : undefined;
}

/**
 * Build the golden / blue / day / night bands for one solar day from a
 * getTimes-shaped object. Bands whose endpoints are missing, null, NaN, or
 * (for non-night kinds) inverted are silently omitted — never thrown on.
 *
 * Window definitions (per spec; suncalc field names in parens):
 *   golden morning = [sunrise,    goldenHourEnd]   (goldenHourEnd = MORNING end)
 *   golden evening = [goldenHour, sunset]          (goldenHour    = EVENING start)
 *   blue   morning = [nauticalDawn, dawn]
 *   blue   evening = [dusk,         nauticalDusk]
 *   day            = [sunriseEnd,   sunsetStart]
 *   night          = [night, nightEnd]             (wraps midnight; contains nadir)
 *
 * The night band intentionally permits start > end: within one getTimes result the
 * evening `night` is later in wall-clock than the morning `nightEnd`, so the deep-night
 * interval containing `nadir` (the solar-midnight instant) straddles midnight.
 */
export function buildTimelineBands(times: TimesInput): Band[] {
  const bands: Band[] = [];

  const push = (kind: BandKind, startKey: string, endKey: string, allowWrap: boolean) => {
    const start = getField(times, startKey);
    const end = getField(times, endKey);
    if (!start || !end) return; // missing / null / NaN — defensive (Principle II)
    const s = start.getTime();
    const e = end.getTime();
    if (s === e) return; // degenerate zero-width window — nothing to represent
    // Non-night windows must be chronologically ordered; an inversion signals bad input.
    if (!allowWrap && s > e) return;
    bands.push({ kind, start, end });
  };

  // Golden hour — note the morning/evening naming swap.
  push('golden', 'sunrise', 'goldenHourEnd', false); // morning
  push('golden', 'goldenHour', 'sunset', false); // evening
  // Blue hour (suncalc has no blueHour field — derived from twilight boundaries).
  push('blue', 'nauticalDawn', 'dawn', false); // morning
  push('blue', 'dusk', 'nauticalDusk', false); // evening
  // Day.
  push('day', 'sunriseEnd', 'sunsetStart', false);
  // Night — wraps midnight (evening `night` → morning `nightEnd`), so allowWrap.
  push('night', 'night', 'nightEnd', true);

  return bands;
}

/** True iff instant `t` falls inside `band`, handling midnight wrap for night bands. */
function bandContains(band: Band, tMs: number): boolean {
  const s = band.start.getTime();
  const e = band.end.getTime();
  if (s <= e) return s <= tMs && tMs <= e; // normal closed interval
  // Wrap (start > end): the band spans [start, ∞) ∪ (-∞, end] across midnight.
  return tMs >= s || tMs <= e;
}

/**
 * Classify an instant `t` into the kind of the band that contains it.
 *
 * Overlap resolution: golden hour is a special atmospheric period that sits inside
 * the broader day window (morning golden overlaps [sunriseEnd, goldenHourEnd];
 * evening golden overlaps [goldenHour, sunsetStart]). When `t` lies in both a
 * golden and a day band, the more specific atmospheric kind wins (golden > day).
 * Blue and night windows do not overlap golden or day, so the order below is
 * only load-bearing for the golden/day tie.
 *
 * Returns `null` when `t` falls in an uncovered gap (e.g. civil/nautical twilight
 * between bands) or when `bands` is empty.
 */
export function classifyHourBand(bands: Band[], t: Date): BandKind | null {
  if (!isValidDate(t)) return null;
  const tMs = t.getTime();
  // Priority order: golden (atmospheric, specific) → blue → night → day (broad).
  const priority: BandKind[] = ['golden', 'blue', 'night', 'day'];
  for (const k of priority) {
    for (const b of bands) {
      if (b.kind === k && bandContains(b, tMs)) return k;
    }
  }
  return null;
}
