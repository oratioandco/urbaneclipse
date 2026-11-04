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

export function lightPhaseAt(sunAltitudeDeg: number): LightPhase {
  if (sunAltitudeDeg >= 6) return 'day';
  if (sunAltitudeDeg >= -4) return 'golden';
  if (sunAltitudeDeg >= -8) return 'blue';
  if (sunAltitudeDeg >= -12) return 'twilight';
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

/** Consecutive phases across a stretch of time, covering it exactly. */
export function lightBands(from: number, to: number, lat: number, lon: number, stepMs = 60_000): LightBand[] {
  if (!(stepMs > 0)) throw new RangeError(`stepMs must be positive, received ${stepMs}`);
  const bands: LightBand[] = [];
  for (let t = from; t < to; t += stepMs) {
    const phase = lightPhaseOf(t, lat, lon);
    const last = bands[bands.length - 1];
    if (last?.phase === phase) last.to = Math.min(t + stepMs, to);
    else bands.push({ phase, from: t, to: Math.min(t + stepMs, to) });
  }
  return bands;
}

/** The band containing an instant, if any. */
export function bandAt(bands: LightBand[], t: number): LightBand | undefined {
  return bands.find((b) => t >= b.from && t < b.to) ?? (t === bands[bands.length - 1]?.to ? bands[bands.length - 1] : undefined);
}
