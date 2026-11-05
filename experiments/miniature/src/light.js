/**
 * The light on the model through the day, keyed to the sun's height. The stops sit on the
 * phase boundaries in src/lib/lightPhases.ts, so each named phase has its own look.
 */
const stops = [
  // alt, sky colour, sky strength, sun colour, sunlit ground brightness, street lights
  { alt: -18, haze: [0.016, 0.021, 0.04], sky: [0.46, 0.58, 1], skyI: 0.075, sun: [1, 0.5, 0.2], ground: 0, lights: 1 },
  { alt: -12, haze: [0.026, 0.036, 0.08], sky: [0.4, 0.52, 1], skyI: 0.12, sun: [1, 0.5, 0.2], ground: 0, lights: 1 },
  { alt: -8, haze: [0.05, 0.085, 0.24], sky: [0.24, 0.38, 1], skyI: 0.22, sun: [1, 0.5, 0.2], ground: 0, lights: 1 },
  { alt: -4, haze: [0.14, 0.2, 0.44], sky: [0.3, 0.44, 1], skyI: 0.44, sun: [1, 0.5, 0.2], ground: 0, lights: 0.85 },
  { alt: -1, haze: [0.5, 0.34, 0.42], sky: [0.72, 0.6, 0.82], skyI: 0.85, sun: [1, 0.45, 0.2], ground: 0, lights: 0.35 },
  { alt: 2, haze: [0.92, 0.56, 0.34], sky: [0.93, 0.8, 0.82], skyI: 1.32, sun: [1, 0.55, 0.2], ground: 0.8, lights: 0 },
  { alt: 6, haze: [0.94, 0.74, 0.54], sky: [0.92, 0.85, 0.86], skyI: 1.22, sun: [1, 0.7, 0.36], ground: 1.15, lights: 0 },
  { alt: 14, haze: [0.86, 0.84, 0.8], sky: [0.86, 0.89, 1], skyI: 1.12, sun: [1, 0.83, 0.62], ground: 1.3, lights: 0 },
  { alt: 35, haze: [0.8, 0.85, 0.92], sky: [0.9, 0.94, 1.02], skyI: 1.2, sun: [1, 0.98, 0.94], ground: 1.45, lights: 0 },
];

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const MAX_KEY = 4;
const MOON_COLOUR = [0.62, 0.74, 1];
/** How bright a full moon makes the flat ground. Far above reality, so the night stays legible. */
const FULL_MOON_GROUND = 0.06;

/** Share of windows lit by the clock, minutes after local midnight. */
function windowsAt(minutes) {
  const hour = minutes / 60;
  if (hour < 5) return mix(0.3, 0.09, smooth(hour, 0, 3));
  if (hour < 9) return mix(0.09, 0.4, smooth(hour, 5, 7));
  return mix(0.6, 0.3, smooth(hour, 21.5, 24));
}

/**
 * @returns the sky, the key light (the sun, or the moon once the sky is dark enough for its
 * shadows to read), and how much of the city is switched on.
 */
export function lightAt(sunAlt, moonAlt, moonFraction, minutes) {
  let i = stops.length - 2;
  while (i > 0 && sunAlt < stops[i].alt) i--;
  const a = stops[i];
  const b = stops[i + 1];
  const t = Math.min(1, Math.max(0, (sunAlt - a.alt) / (b.alt - a.alt)));
  const sky = mix3(a.sky, b.sky, t);
  const skyI = mix(a.skyI, b.skyI, t);
  const haze = mix3(a.haze, b.haze, t);
  const lights = mix(a.lights, b.lights, t);
  const sunUp = smooth(sunAlt, -0.8, 1.5);
  if (sunUp > 0) {
    const ground = mix(a.ground, b.ground, t);
    const height = Math.sin((sunAlt * Math.PI) / 180);
    return {
      sky,
      skyI,
      haze,
      lights,
      windows: windowsAt(minutes),
      key: { body: 'sun', colour: mix3(a.sun, b.sun, t), intensity: sunUp * Math.min(MAX_KEY, ground / Math.max(0.02, height)) },
    };
  }
  const moonUp = smooth(moonAlt, 0, 6) * smooth(-sunAlt, 2.5, 9);
  const height = Math.sin((Math.max(moonAlt, 0) * Math.PI) / 180);
  const ground = FULL_MOON_GROUND * Math.sqrt(moonFraction);
  return {
    sky,
    skyI,
    haze,
    lights,
    windows: windowsAt(minutes),
    key: { body: 'moon', colour: MOON_COLOUR, intensity: moonUp * Math.min(0.25, ground / Math.max(0.3, height)) },
  };
}
