/**
 * How the moon is lit at an instant, as seen from a position. Pure, no Cesium.
 *
 * The lit side always faces the sun, so both the fraction and the tilt of the bright limb
 * come from the angle between the two bodies, using the same ephemeris as the disc itself.
 */
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from './bodyPosition.js';

export interface MoonLighting {
  /** Lit fraction of the disc, 0 (new) to 1 (full). */
  fraction: number;
  waxing: boolean;
  /** Screen direction from the disc centre to the middle of the bright limb, unit length. */
  limb: [number, number];
  /** Screen direction of lunar north, unit length, so the surface sits the right way up. */
  north: [number, number];
  /** Sun-moon-observer angle: the terminator's shape on the disc. */
  phaseCos: number;
  phaseSin: number;
}

type Vec = [number, number, number];

function enu(azDeg: number, altDeg: number): Vec {
  const az = (azDeg * Math.PI) / 180;
  const alt = (altDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Where a sky direction lies on the moon's disc, as a unit vector on screen axes. */
function directionOnDisc(m: Vec, target: Vec): [number, number] {
  // Project onto the plane of the disc, then read it on screen axes: up is the local
  // vertical, right is the viewing direction crossed with up.
  const along = dot(target, m);
  const toward: Vec = [target[0] - along * m[0], target[1] - along * m[1], target[2] - along * m[2]];
  const z: Vec = [0, 0, 1];
  const zAlong = dot(z, m);
  const up: Vec = [z[0] - zAlong * m[0], z[1] - zAlong * m[1], z[2] - zAlong * m[2]];
  const right: Vec = [m[1] * z[2] - m[2] * z[1], m[2] * z[0] - m[0] * z[2], m[0] * z[1] - m[1] * z[0]];
  const x = dot(toward, right) / (Math.hypot(...right) || 1);
  const y = dot(toward, up) / (Math.hypot(...up) || 1);
  const length = Math.hypot(x, y);
  return length > 1e-9 ? [x / length, y / length] : [0, 1];
}

/** Sky direction of a point given in equatorial coordinates, degrees. */
function equatorialToEnu(date: Date, lat: number, lon: number, raDeg: number, decDeg: number): Vec {
  const daysSinceJ2000 = date.getTime() / 86_400_000 - 10957.5;
  const siderealDeg = 280.46061837 + 360.98564736629 * daysSinceJ2000 + lon;
  const h = ((siderealDeg - raDeg) * Math.PI) / 180;
  const d = (decDeg * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  return [
    -Math.cos(d) * Math.sin(h),
    Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(h) * Math.sin(p),
    Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(h) * Math.cos(p),
  ];
}

/** The celestial pole's direction on the moon's disc. Exposed for checking against the ephemeris. */
export function celestialNorthOnDisc(date: Date, lat: number, lon: number): [number, number] {
  const at = sampleBody('moon', date, lat, lon);
  return directionOnDisc(enu(at.az, at.alt), equatorialToEnu(date, lat, lon, 0, 90));
}

export function moonLighting(date: Date, lat: number, lon: number): MoonLighting {
  const moonAt = sampleBody('moon', date, lat, lon);
  const sunAt = sampleBody('sun', date, lat, lon);
  const m = enu(moonAt.az, moonAt.alt);
  const s = enu(moonAt.az === sunAt.az ? sunAt.az + 1e-6 : sunAt.az, sunAt.alt);
  const cosElongation = Math.max(-1, Math.min(1, dot(m, s)));

  // The moon's axis stays within about 1.5 degrees of the ecliptic pole's direction.
  const eclipticPole = equatorialToEnu(date, lat, lon, 270, 66.56);

  return {
    fraction: (1 - cosElongation) / 2,
    waxing: getMoonIllumination(date).waxing,
    limb: directionOnDisc(m, s),
    north: directionOnDisc(m, eclipticPole),
    // The phase angle is the supplement of the elongation.
    phaseCos: -cosElongation,
    phaseSin: Math.sqrt(1 - cosElongation * cosElongation),
  };
}

/** The everyday name for a phase. */
export function phaseName(fraction: number, waxing: boolean): string {
  if (fraction < 0.03) return 'New moon';
  if (fraction > 0.97) return 'Full moon';
  if (fraction >= 0.45 && fraction <= 0.55) return waxing ? 'First quarter' : 'Last quarter';
  return `${waxing ? 'Waxing' : 'Waning'} ${fraction < 0.5 ? 'crescent' : 'gibbous'}`;
}

/** "Waning crescent, 27% lit" */
export function phaseLabel(fraction: number, waxing: boolean): string {
  return `${phaseName(fraction, waxing)}, ${Math.round(fraction * 100)}% lit`;
}

/**
 * SVG path of the lit part of a unit disc centred on the origin, with up as -y. Seen from
 * the northern hemisphere: the right side is lit while waxing and the left while waning.
 */
export function litDiscPath(fraction: number, waxing: boolean): string {
  const rx = Math.abs(1 - 2 * fraction).toFixed(3);
  const outer = waxing ? 1 : 0;
  // A crescent's terminator bulges toward the lit limb, a gibbous one away from it.
  const inner = fraction < 0.5 === waxing ? 0 : 1;
  return `M0,-1 A1,1 0 0 ${outer} 0,1 A${rx},1 0 0 ${inner} 0,-1 Z`;
}

export type MoonVisibility = 'easy' | 'faint' | 'hard';

export const MOON_VISIBILITY_LABELS: Record<MoonVisibility, string> = {
  easy: 'easy to see in daylight',
  faint: 'faint in daylight',
  hard: 'hard to spot in daylight',
};

/**
 * A rough rating of how readily a daytime moon stands out, assuming a clear sky. A rule of
 * thumb rather than a sky-brightness model: it reflects that a fuller moon, further from
 * the sun and higher above the haze, is easier to find. Null once the sky is dark enough
 * that the question does not arise.
 */
export function moonDaylightVisibility(
  litFraction: number,
  moonAltDeg: number,
  sunAltDeg: number,
  elongationDeg: number,
): MoonVisibility | null {
  if (sunAltDeg <= -4) return null;
  if (moonAltDeg < 3 || elongationDeg < 25 || litFraction < 0.1) return 'hard';
  // A low sun leaves a darker sky, which forgives a thinner or lower moon.
  const sunIsLow = sunAltDeg < 6;
  if (litFraction >= 0.4 && (moonAltDeg >= 12 || sunIsLow)) return 'easy';
  if (litFraction >= 0.2 && moonAltDeg >= 5) return 'faint';
  return 'hard';
}

/** The rating for a moment, with its inputs read from the ephemeris. */
export function moonVisibilityAt(date: Date, lat: number, lon: number): MoonVisibility | null {
  const lighting = moonLighting(date, lat, lon);
  const elongation = (Math.acos(-lighting.phaseCos) * 180) / Math.PI;
  return moonDaylightVisibility(
    lighting.fraction,
    sampleBody('moon', date, lat, lon).alt,
    sampleBody('sun', date, lat, lon).alt,
    elongation,
  );
}
