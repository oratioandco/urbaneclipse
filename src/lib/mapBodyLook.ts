/**
 * How the sun and moon look on the map at an instant. Pure, no Cesium.
 *
 * Disc colours come from the palette behind the 3D preview, so a body has the same colour
 * on the map as in the view it opens.
 */
import { moonPalette, skyPalette, type Rgb } from './skyPalette.js';

export interface BodyLook {
  /** Colour of the middle of the disc. For the moon, a tint over its surface. */
  core: Rgb;
  /** Colour at the edge of the disc. The sun's limb is darker and redder than its centre. */
  limb: Rgb;
  glow: Rgb;
  /** Strength of the glow around the disc, 0 to 1. */
  glowOpacity: number;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Glow colours are more saturated than the disc itself, as a neon tube's are: the palette's
 * midday glow is nearly white, which would read as grey haze on the dark map.
 */
const SUN_GLOW: ReadonlyArray<{ alt: number; color: Rgb }> = [
  { alt: 0, color: [1, 0.3, 0.05] },
  { alt: 6, color: [1, 0.5, 0.1] },
  { alt: 20, color: [1, 0.7, 0.25] },
  { alt: 45, color: [1, 0.82, 0.42] },
];
const MOON_GLOW: Rgb = [0.5, 0.62, 1];
const MOON_GLOW_LOW: Rgb = [1, 0.55, 0.25];

function sunGlowColor(altitudeDeg: number): Rgb {
  const last = SUN_GLOW[SUN_GLOW.length - 1]!;
  if (altitudeDeg >= last.alt) return last.color;
  for (let i = SUN_GLOW.length - 2; i >= 0; i--) {
    const from = SUN_GLOW[i]!;
    const to = SUN_GLOW[i + 1]!;
    if (altitudeDeg >= from.alt) return mix(from.color, to.color, (altitudeDeg - from.alt) / (to.alt - from.alt));
  }
  return SUN_GLOW[0]!.color;
}

export function sunLook(altitudeDeg: number): BodyLook {
  const { discTint, glowStrength } = skyPalette('sun', altitudeDeg);
  return {
    core: mix(discTint, [1, 1, 1], 0.5),
    limb: [discTint[0], discTint[1] * 0.82, discTint[2] * 0.62],
    glow: sunGlowColor(altitudeDeg),
    glowOpacity: 0.7 + 0.3 * glowStrength,
  };
}

export function moonLook(moonAltitudeDeg: number, sunAltitudeDeg: number, litFraction: number): BodyLook {
  const { discTint } = moonPalette(moonAltitudeDeg, sunAltitudeDeg, litFraction);
  const lit = Math.min(1, Math.max(0, litFraction));
  const nearHorizon = 1 - Math.min(1, Math.max(0, moonAltitudeDeg / 12));
  return {
    core: discTint,
    limb: discTint,
    glow: mix(MOON_GLOW, MOON_GLOW_LOW, nearHorizon),
    glowOpacity: 0.35 + 0.65 * lit,
  };
}

export const cssRgb = ([r, g, b]: Rgb): string =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
