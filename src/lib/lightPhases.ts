/**
 * The photographer's day, from the sun's height. Pure, no Cesium.
 *
 * Boundaries follow common photography usage rather than the formal twilight definitions:
 * golden hour runs from the sun 6 degrees up to 4 degrees down, blue hour from there to 8
 * degrees down. Working from altitude also handles Berlin's short summer nights, when some
 * named twilight events do not happen at all.
 */
import { sampleBody } from './bodyPosition.js';

export type LightPhase = 'night' | 'twilight' | 'blue' | 'golden' | 'day';

export const LIGHT_PHASE_NAMES: Record<LightPhase, string> = {
  night: 'Night',
  twilight: 'Twilight',
  blue: 'Blue hour',
  golden: 'Golden hour',
  day: 'Day',
};

/**
 * What suncalc adds to a body under the horizon: its refraction formula (Meeus 16.4) held at
 * its value for 0 degrees. Real refraction means nothing for a sun you cannot see, and the
 * twilight boundaries are defined on the airless altitude.
 */
export const HORIZON_REFRACTION_DEG = (0.0002967 / Math.tan(0.00312536 / 0.08901179)) * (180 / Math.PI);

/**
 * The airless altitude of a body under the horizon, from the apparent altitude the app works
 * with (`sampleBody`). Above the horizon the altitude is returned as it is: there the
 * refraction is real and the golden hour's upper edge is about the light you see.
 */
export function airlessBelowHorizon(apparentAltitudeDeg: number): number {
  return apparentAltitudeDeg < HORIZON_REFRACTION_DEG ? apparentAltitudeDeg - HORIZON_REFRACTION_DEG : apparentAltitudeDeg;
}

/**
 * The phase for the sun's apparent altitude, as `sampleBody` gives it. The boundaries under
 * the horizon (4, 8 and 12 degrees down) are airless altitudes; before November 2026 they
 * were applied to the refracted figure, so "4 degrees down" was really 4.48 and blue hour,
 * twilight and night began 3.5 to 5 minutes late (audit defect 9).
 */
export function lightPhaseAt(sunAltitudeDeg: number): LightPhase {
  const alt = airlessBelowHorizon(sunAltitudeDeg);
  if (alt >= 6) return 'day';
  if (alt >= -4) return 'golden';
  if (alt >= -8) return 'blue';
  if (alt >= -12) return 'twilight';
  return 'night';
}

/** The light phase at an instant and position. */
export function lightPhaseOf(t: number, lat: number, lon: number): LightPhase {
  return lightPhaseAt(sampleBody('sun', new Date(t), lat, lon).alt);
}

export interface LightBand {
  phase: LightPhase;
  from: number;
  to: number;
}

/**
 * Consecutive phases across a stretch of time, covering it exactly. `stepMs` is only how
 * often the sun is sampled to notice a change; each edge is then narrowed to a second, so a
 * coarse step no longer draws every band up to a step late.
 */
export function lightBands(from: number, to: number, lat: number, lon: number, stepMs = 60_000): LightBand[] {
  if (!(stepMs > 0)) throw new RangeError(`stepMs must be positive, received ${stepMs}`);
  if (!(to > from)) return [];
  let at = from;
  let phase = lightPhaseOf(from, lat, lon);
  const bands: LightBand[] = [{ phase, from, to: from }];
  for (let t = Math.min(from + stepMs, to); ; t = Math.min(t + stepMs, to)) {
    const next = lightPhaseOf(t, lat, lon);
    // Usually one edge in a step; at midsummer two can fall close together, so look again.
    while (phase !== next) {
      let lo = at;
      let hi = t;
      while (hi - lo > 1000) {
        const mid = Math.round((lo + hi) / 2);
        if (lightPhaseOf(mid, lat, lon) === phase) lo = mid;
        else hi = mid;
      }
      bands[bands.length - 1]!.to = hi;
      phase = lightPhaseOf(hi, lat, lon);
      bands.push({ phase, from: hi, to: hi });
      at = hi;
    }
    bands[bands.length - 1]!.to = t;
    at = t;
    if (t >= to) break;
  }
  return bands;
}

/** The band containing an instant, if any. */
export function bandAt(bands: LightBand[], t: number): LightBand | undefined {
  return bands.find((b) => t >= b.from && t < b.to) ?? (t === bands[bands.length - 1]?.to ? bands[bands.length - 1] : undefined);
}

/**
 * Colour stops that blend each phase into the next. Every band holds its colour through
 * its middle, and a long one only starts to change near its edges, so a short golden hour
 * still reaches full colour and the long day does not wash out. Positions are 0 to 1.
 */
export function lightGradientStops(
  bands: readonly LightBand[],
  from: number,
  to: number,
  blendMs = 40 * 60_000,
): Array<{ phase: LightPhase; at: number }> {
  const span = to - from;
  const stops: Array<{ phase: LightPhase; at: number }> = [];
  const position = (t: number) => Math.min(1, Math.max(0, (t - from) / span));
  const visible = bands.filter((band) => band.to > from && band.from < to);
  visible.forEach((band, i) => {
    const start = Math.max(band.from, from);
    const end = Math.min(band.to, to);
    const inset = Math.min(blendMs, (end - start) / 2);
    // The first and last bands have nothing to blend from or into at the outer edge.
    stops.push({ phase: band.phase, at: i === 0 ? 0 : position(start + inset) });
    stops.push({ phase: band.phase, at: i === visible.length - 1 ? 1 : position(end - inset) });
  });
  return stops;
}
