/**
 * How the sun and moon look on the map at an instant. Pure, no Cesium.
 *
 * Colours come from the palette behind the 3D preview, so a body has the same colour on
 * the map as in the view it opens.
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

export function sunLook(altitudeDeg: number): BodyLook {
  const { discTint, glowColor, glowStrength } = skyPalette('sun', altitudeDeg);
  return {
    core: mix(discTint, [1, 1, 1], 0.35),
    limb: [discTint[0], discTint[1] * 0.82, discTint[2] * 0.62],
    glow: glowColor,
    glowOpacity: 0.4 + 0.6 * glowStrength,
  };
}

export function moonLook(moonAltitudeDeg: number, sunAltitudeDeg: number, litFraction: number): BodyLook {
  const { discTint } = moonPalette(moonAltitudeDeg, sunAltitudeDeg, litFraction);
  const lit = Math.min(1, Math.max(0, litFraction));
  return {
    core: discTint,
    limb: discTint,
    glow: mix([0.72, 0.78, 1], discTint, 0.5),
    glowOpacity: 0.2 + 0.6 * lit,
  };
}

export const cssRgb = ([r, g, b]: Rgb): string =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
