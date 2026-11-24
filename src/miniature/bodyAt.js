/**
 * The canonical sun or moon (bodies.js) as it stands over Berlin at an instant: the sun at its
 * altitude, the moon in its phase, at its altitude and under that minute's sky. Every list
 * row, card, button and thumb in the panel asks here, so none draws a body of its own.
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../lib/bodyPosition.ts';
import { FERNSEHTURM } from '../lib/landmarks.ts';
import { bodySvg } from './bodies.js';

/** What bodies.js needs to draw `body` ('sun' or 'moon') at instant `t`. */
export function bodyState(body, t) {
  const when = new Date(t);
  const sun = sampleBody('sun', when, FERNSEHTURM.lat, FERNSEHTURM.lon);
  if (body !== 'moon') return { kind: 'sun', altitudeDeg: sun.alt };
  const lit = getMoonIllumination(when);
  const moon = sampleBody('moon', when, FERNSEHTURM.lat, FERNSEHTURM.lon);
  return { kind: 'moon', fraction: lit.fraction, waxing: lit.waxing ?? lit.phase < 0.5, altitudeDeg: moon.alt, sunAltitudeDeg: sun.alt };
}

/**
 * The body as an inline SVG. In a row beside text the bare disc fills its box (`glow: false`);
 * pass `glow: true` where it has room to shine.
 */
export const bodyIcon = (body, t, { size = 20, glow = false, label = '' } = {}) => bodySvg({ ...bodyState(body, t), size, glow, label });
