/**
 * Known-answer tests for the in-scene moon's terminator (src/miniature/sky.js).
 *
 * The sky dome draws the moon disc as a sphere lit from uSunDir, so the terminator is
 * computed per pixel from the sun/moon/observer geometry rather than read from an image.
 * These tests pin what that geometry must produce, at a near-full-moon date and a
 * first-quarter date that are FOUND by scanning the ephemeris from a fixed reference
 * (nothing about a picture is hardcoded), and they guard the shader against being
 * replaced by canned phase art.
 *
 * The replica below mirrors the shader's own lines, in the same world frame the app
 * feeds it (state.js `toDirection`: x east, y up, z south).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getMoonIllumination } from 'suncalc';
import { sampleBody } from '../../src/lib/bodyPosition';
import { moonLighting } from '../../src/lib/moonPhase';

const BERLIN = [52.52, 13.41] as const;
/** sky.js's disc angular radius, radians. */
const MOON_RADIUS = 0.0045;

type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalise = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A sky direction in the frame the app feeds the shader (state.js `toDirection`). */
const world = (azDeg: number, altDeg: number): V3 => {
  const a = (azDeg * Math.PI) / 180;
  const h = (altDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
};

/** GLSL smoothstep. */
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The sky.js moon block, line for line: at a disc point reached by view ray d, the
 * surface normal of the sphere, lit where it faces the sun.
 */
function shaderLit(m: V3, s: V3, across: V3): number {
  const an = Math.hypot(across[0], across[1], across[2]);
  const k = Math.sqrt(Math.max(0, 1 - an * an));
  const normal: V3 = [across[0] - m[0] * k, across[1] - m[1] * k, across[2] - m[2] * k];
  return smoothstep(-0.03, 0.05, dot(normal, s));
}

interface Terminator {
  /** Lit fraction of the disc, integrated over the shader's own mask. */
  fraction: number;
  /** Unit direction from the disc centre to the bright limb, world frame. */
  limb: V3;
  /** The sun's direction with the moon component removed, world frame. */
  sunAcross: V3;
  moonAz: number;
  moonAlt: number;
  sunAz: number;
  sunAlt: number;
}

/** Integrate the shader's lit mask over the disc for a real instant and place. */
function terminatorAt(date: Date, lat: number, lon: number, N = 240): Terminator {
  const moon = sampleBody('moon', date, lat, lon);
  const sun = sampleBody('sun', date, lat, lon);
  const m = world(moon.az, moon.alt);
  const s = world(sun.az, sun.alt);
  const e1 = normalise(cross([0, 1, 0], m));
  const e2 = cross(m, e1);
  let sum = 0;
  let weight = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < N; i++) {
    const r = (i + 0.5) / N;
    for (let j = 0; j < N; j++) {
      const phi = (2 * Math.PI * (j + 0.5)) / N;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const across: V3 = [
        r * (c * e1[0] + sn * e2[0]),
        r * (c * e1[1] + sn * e2[1]),
        r * (c * e1[2] + sn * e2[2]),
      ];
      const w = r * shaderLit(m, s, across);
      sum += w;
      weight += r;
      cx += w * c;
      cy += w * sn;
    }
  }
  const cosE = Math.max(-1, Math.min(1, dot(m, s)));
  const sunAcross = normalise([s[0] - m[0] * cosE, s[1] - m[1] * cosE, s[2] - m[2] * cosE]);
  const len = Math.hypot(cx, cy);
  const limb: V3 = len > 1e-12
    ? [
        (cx * e1[0] + cy * e2[0]) / len,
        (cx * e1[1] + cy * e2[1]) / len,
        (cx * e1[2] + cy * e2[2]) / len,
      ]
    : [0, 0, 0];
  return {
    fraction: sum / weight,
    limb,
    sunAcross,
    moonAz: moon.az,
    moonAlt: moon.alt,
    sunAz: sun.az,
    sunAlt: sun.alt,
  };
}

// ---- the two known dates, found by scanning the ephemeris from a fixed reference ----

const REFERENCE = Date.UTC(2027, 0, 1);
const SCAN_DAYS = 45;

function findQuarterAndFull(): { quarter: Date; full: Date } {
  let full = { f: -1, t: 0 };
  let quarter: number | null = null;
  let prev = { f: -1, t: 0 };
  for (let i = 0; i < SCAN_DAYS * 24; i++) {
    const t = REFERENCE + i * 3_600_000;
    const { fraction, waxing } = getMoonIllumination(new Date(t));
    if (fraction > full.f) full = { f: fraction, t };
    if (quarter === null && waxing && prev.f < 0.5 && fraction >= 0.5) {
      let lo = prev.t;
      let hi = t;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        if (getMoonIllumination(new Date(mid)).fraction < 0.5) lo = mid;
        else hi = mid;
      }
      quarter = (lo + hi) / 2;
    }
    prev = { f: fraction, t };
  }
  if (quarter === null) throw new Error('no waxing quarter found near the reference');
  return { quarter: new Date(quarter), full: new Date(full.t) };
}

const { quarter, full } = findQuarterAndFull();
const quarterTerm = terminatorAt(quarter, ...BERLIN);
const fullTerm = terminatorAt(full, ...BERLIN);

describe('the known dates (found by scanning the ephemeris)', () => {
  it('finds a waxing quarter and a full moon near the fixed reference', () => {
    expect(getMoonIllumination(quarter).waxing).toBe(true);
    expect(getMoonIllumination(quarter).fraction).toBeGreaterThan(0.49);
    expect(getMoonIllumination(quarter).fraction).toBeLessThan(0.51);
    expect(getMoonIllumination(full).fraction).toBeGreaterThan(0.999);
    // A quarter leads its full moon by a bit over half a lunation's quarter.
    const days = (full.getTime() - quarter.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(9);
  });
});

describe('the in-scene terminator (sky.js maths, replicated exactly)', () => {
  it('is gibbous at the full-moon date', () => {
    expect(fullTerm.fraction).toBeGreaterThan(0.85); // the brief's bar for "gibbous"
    expect(fullTerm.fraction).toBeGreaterThan(0.97); // this date is much fuller than that
    // The area the shader lights agrees with the elongation it is fed.
    const analytic = (1 - Math.cos(Math.acos(Math.max(-1, Math.min(1,
      dot(world(fullTerm.moonAz, fullTerm.moonAlt), world(fullTerm.sunAz, fullTerm.sunAlt))))))) / 2;
    expect(Math.abs(fullTerm.fraction - analytic)).toBeLessThan(0.01);
  });

  it('is half-lit at the quarter date', () => {
    expect(quarterTerm.fraction).toBeGreaterThan(0.45);
    expect(quarterTerm.fraction).toBeLessThan(0.55);
  });

  it('agrees with the canonical moonLighting helper at both dates', () => {
    for (const [date, term] of [[full, fullTerm], [quarter, quarterTerm]] as const) {
      const { fraction } = moonLighting(date, ...BERLIN);
      expect(Math.abs(fraction - term.fraction), date.toISOString()).toBeLessThan(0.02);
    }
  });

  it('agrees with the canonical helper across a whole lunation', () => {
    const from = quarter.getTime() - 2 * 86_400_000;
    const to = full.getTime() + 2 * 86_400_000;
    for (let t = from; t <= to; t += 6 * 3_600_000) {
      const date = new Date(t);
      const { fraction } = moonLighting(date, ...BERLIN);
      const replica = terminatorAt(date, ...BERLIN, 96).fraction;
      expect(Math.abs(fraction - replica), date.toISOString()).toBeLessThan(0.02);
    }
  });

  it('points the bright limb along the direction of the sun across the disc', () => {
    // The lit region is symmetric about the plane holding moon and sun, so the limb's
    // centroid must lie along the sun's component across the disc.
    const align = dot(quarterTerm.limb, quarterTerm.sunAcross);
    expect(align).toBeGreaterThan(0.99);
    // ...and the mask is brighter on the sun's side than on the far side.
    const m = world(quarterTerm.moonAz, quarterTerm.moonAlt);
    const s = world(quarterTerm.sunAz, quarterTerm.sunAlt);
    const toward = shaderLit(m, s, quarterTerm.sunAcross.map((v, i) => 0.9 * v + m[i] * Math.sqrt(1 - 0.81)) as V3);
    const away = shaderLit(m, s, quarterTerm.sunAcross.map((v, i) => -0.9 * v + m[i] * Math.sqrt(1 - 0.81)) as V3);
    expect(toward).toBeGreaterThan(0.9);
    expect(away).toBeLessThan(0.1);
  });

  it('points the bright limb toward the bearing of the sun, as a photographer sees it', () => {
    // At eye level the screen's up is the zenith, projected on the disc. Express both
    // the limb and the horizontal direction of the sun's bearing in that basis.
    const m = world(quarterTerm.moonAz, quarterTerm.moonAlt);
    const up = normalise([m[0] * -m[1], 1 - m[1] * m[1], m[2] * -m[1]] as V3);
    const right = cross(m, up);
    const screen = (v: V3) => [dot(v, right), dot(v, up)] as const;
    const limb = screen(quarterTerm.limb);
    const sunBearing = screen(world(quarterTerm.sunAz, 0));
    const cosA = (limb[0] * sunBearing[0] + limb[1] * sunBearing[1])
      / (Math.hypot(...limb) * Math.hypot(...sunBearing));
    const angle = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
    // The horizon bearing is only a rough proxy for where the sun is (it sits below
    // it), so this pins the limb to the sun's side of the sky rather than to a point.
    expect(angle).toBeLessThan(45);
  });
});

describe('sky.js keeps drawing the terminator from geometry', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'miniature', 'sky.js'), 'utf8');

  it('still lights the disc sphere from the sun direction', () => {
    expect(source).toMatch(/smoothstep\(-0\.03,\s*0\.05,\s*dot\(normal,\s*uSunDir\)\)/);
    expect(source).toMatch(/uMoonDir/);
  });

  it('uses no texture but the near-side albedo map', () => {
    // The one texture2D call samples the NASA map for surface brightness; the lit mask
    // must not come from any image.
    expect(source.match(/texture2D\(/g)).toHaveLength(1);
    expect(source).toContain('moon-nearside.jpg');
    expect(source).not.toMatch(/lit\s*=.*uMoonMap/);
  });
});
