/**
 * Time-of-day sky palette for the preview — pure, NO Cesium (Constitution I).
 *
 * One function answers "what should the preview look like at this instant?" given the
 * celestial body's altitude: sky gradient colours, haze/horizon colour, bloom colour
 * and strength, scene light intensity, and the tint of the drawn disc. Everything is
 * derived from the SAME suncalc altitude the solver and the disc use, so the sky, the
 * shadows (via the directional light this palette drives) and the disc cannot disagree.
 *
 * SUN ramps through keyframes by altitude (degrees, refraction-corrected as suncalc
 * reports it):
 *   < -6   night          — near-black blue sky, no bloom, disc hidden anyway
 *   -6..0  twilight       — deep blue/magenta, residual warm glow at the horizon
 *   0..6   sunset/golden  — big red-orange orb, warm haze, long-shadow light
 *   6..20  low day        — warming sky, pale yellow disc
 *   > 20   day            — cool blue sky, white disc, full light
 * Values interpolate piecewise-linearly between keyframes.
 *
 * MOON is a fixed dim cool palette (its brightness barely varies with altitude);
 * the glow strengthens slightly near the horizon like the real moon's halo.
 */

export type Rgb = [number, number, number];

export interface SkyPalette {
  /** Cool sky colour at the top of frame (drives u_skyTop). */
  skyTop: Rgb;
  /** Haze/horizon colour (drives u_haze). */
  haze: Rgb;
  /** Bloom colour around the body (drives u_glowColor). */
  glowColor: Rgb;
  /** Bloom intensity (drives u_glowStrength). */
  glowStrength: number;
  /** Directional-light intensity for the scene (Cesium's default sun is ~2). */
  lightIntensity: number;
  /** Sky-ambient fill level — sets `tileset.imageBasedLighting.luminanceAtZenith`,
   *  the soft hemisphere fill that keeps shaded facades reading as clay instead of
   *  black. Now that the tiles carry real per-face normals, dimming for night /
   *  twilight comes from HERE + the directional light, not from `sceneTint`. */
  ambientLevel: number;
  /** Multiplicative tint for the drawn disc billboard (white = untinted). */
  discTint: Rgb;
  /** Mild multiplicative tint on city geometry (warm at golden hour, cool at
   *  night) — kept close to 1.0 so the clay form stays readable; brightness is
   *  driven by `ambientLevel` + `lightIntensity` against the real normals. */
  sceneTint: Rgb;
}

export type PaletteBody = 'sun' | 'moon';

interface Keyframe {
  alt: number;
  palette: SkyPalette;
}

const NIGHT: SkyPalette = {
  skyTop: [0.045, 0.055, 0.09],
  haze: [0.07, 0.08, 0.12],
  glowColor: [0, 0, 0],
  glowStrength: 0,
  lightIntensity: 0.12,
  ambientLevel: 0.04,
  discTint: [1, 1, 1],
  sceneTint: [0.62, 0.66, 0.8],
};

const SUN_KEYFRAMES: Keyframe[] = [
  { alt: -18, palette: NIGHT },
  {
    alt: -6,
    palette: {
      skyTop: [0.1, 0.12, 0.22],
      haze: [0.16, 0.15, 0.24],
      glowColor: [0.55, 0.3, 0.28],
      glowStrength: 0.25,
      lightIntensity: 0.25,
      ambientLevel: 0.12,
      discTint: [1, 0.42, 0.2],
      sceneTint: [0.82, 0.8, 0.92],
    },
  },
  {
    alt: 0,
    palette: {
      skyTop: [0.25, 0.28, 0.4],
      haze: [0.98, 0.5, 0.24],
      glowColor: [1.0, 0.58, 0.24],
      glowStrength: 0.9,
      // Low sun grazes every facade, which picks out mesh facets as streaks. Keep the
      // key light soft here and let the sky fill carry the form.
      lightIntensity: 0.3,
      ambientLevel: 0.22,
      discTint: [1, 0.64, 0.24],
      sceneTint: [1.0, 0.86, 0.72],
    },
  },
  {
    alt: 6,
    palette: {
      skyTop: [0.42, 0.48, 0.62],
      haze: [0.98, 0.74, 0.48],
      glowColor: [1.0, 0.72, 0.38],
      glowStrength: 0.72,
      lightIntensity: 0.75,
      ambientLevel: 0.36,
      discTint: [1, 0.82, 0.54],
      sceneTint: [1.0, 0.94, 0.84],
    },
  },
  {
    alt: 20,
    palette: {
      skyTop: [0.58, 0.68, 0.84],
      haze: [0.9, 0.9, 0.92],
      glowColor: [1.0, 0.88, 0.66],
      glowStrength: 0.45,
      lightIntensity: 1.8,
      ambientLevel: 0.55,
      discTint: [1, 0.92, 0.78],
      sceneTint: [1, 1, 1],
    },
  },
  {
    alt: 45,
    palette: {
      skyTop: [0.55, 0.7, 0.9],
      haze: [0.86, 0.89, 0.94],
      glowColor: [1.0, 0.95, 0.85],
      glowStrength: 0.3,
      lightIntensity: 2.0,
      ambientLevel: 0.6,
      discTint: [1, 1, 1],
      sceneTint: [1, 1, 1],
    },
  },
];

const MOON_PALETTE: SkyPalette = {
  skyTop: [0.08, 0.1, 0.17],
  haze: [0.13, 0.15, 0.21],
  glowColor: [0.75, 0.82, 0.95],
  glowStrength: 0.5,
  lightIntensity: 0.3,
  ambientLevel: 0.08,
  discTint: [0.92, 0.94, 1.0],
  sceneTint: [0.8, 0.84, 0.94],
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerpPalette(a: SkyPalette, b: SkyPalette, t: number): SkyPalette {
  return {
    skyTop: lerpRgb(a.skyTop, b.skyTop, t),
    haze: lerpRgb(a.haze, b.haze, t),
    glowColor: lerpRgb(a.glowColor, b.glowColor, t),
    glowStrength: lerp(a.glowStrength, b.glowStrength, t),
    lightIntensity: lerp(a.lightIntensity, b.lightIntensity, t),
    ambientLevel: lerp(a.ambientLevel, b.ambientLevel, t),
    discTint: lerpRgb(a.discTint, b.discTint, t),
    sceneTint: lerpRgb(a.sceneTint, b.sceneTint, t),
  };
}

/**
 * The palette for a body at `altitudeDeg` above the horizon.
 *
 * Altitudes outside the keyframe range clamp to the nearest keyframe, so a polar-night
 * sun at -40° reads as full night rather than extrapolating to negative light.
 */
export function skyPalette(body: PaletteBody, altitudeDeg: number): SkyPalette {
  if (body === 'moon') {
    // A touch more halo near the horizon, like the real rising moon.
    const t = Math.min(1, Math.max(0, altitudeDeg / 30));
    return { ...MOON_PALETTE, glowStrength: lerp(0.7, 0.4, t) };
  }

  const alt = Number.isFinite(altitudeDeg) ? altitudeDeg : -18;
  const keys = SUN_KEYFRAMES;
  if (alt <= keys[0].alt) return keys[0].palette;
  if (alt >= keys[keys.length - 1].alt) return keys[keys.length - 1].palette;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (alt >= a.alt && alt <= b.alt) {
      return lerpPalette(a.palette, b.palette, (alt - a.alt) / (b.alt - a.alt));
    }
  }
  return keys[keys.length - 1].palette;
}

/**
 * The palette for a moon pass, which depends on three things. The sky comes from where the
 * sun is, since the moon is often up in daylight. The light and glow it adds follow how
 * much of it is lit. Its colour reddens near the horizon, as the sun's does.
 */
export function moonPalette(moonAltDeg: number, sunAltDeg: number, litFraction: number): SkyPalette {
  const lit = Math.min(1, Math.max(0, litFraction));
  const night: SkyPalette = {
    ...skyPalette('moon', moonAltDeg),
    lightIntensity: MOON_PALETTE.lightIntensity * (0.2 + 0.8 * lit),
    ambientLevel: MOON_PALETTE.ambientLevel * (0.5 + 0.5 * lit),
  };
  night.glowStrength *= 0.2 + 0.8 * lit;

  // Twilight runs from the sun 12 degrees down to just below the horizon.
  const t = Math.min(1, Math.max(0, (sunAltDeg + 12) / 10));
  const day: SkyPalette = { ...skyPalette('sun', sunAltDeg), glowColor: night.glowColor, glowStrength: 0.12 * lit };
  const blended = lerpPalette(night, day, t * t * (3 - 2 * t));

  const horizonWarmth = 1 - Math.min(1, Math.max(0, moonAltDeg / 12));
  const paleInDaylight = lerpRgb(MOON_PALETTE.discTint, [0.97, 0.97, 0.98], t);
  blended.discTint = lerpRgb(paleInDaylight, [1, 0.72, 0.48], horizonWarmth);
  return blended;
}
