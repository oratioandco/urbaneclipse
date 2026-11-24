/**
 * The planner's icon set and its one sun and one moon (src/miniature/icons.js, bodies.js).
 * The colour checks compare against sunLook and moonLook directly, and against the keyframe
 * values written in the iconography rule (horizon sun rgb(255,163,61) and so on), which is an
 * independent statement of the same numbers.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS modules of the miniature
import { ICONS, ICON_NAMES, ICON_STROKE, icon, iconBody, iconSprite, iconUse, weatherIcon, phaseIcon, WEATHER_STATES, LIGHT_PHASES, PHASE_ALTITUDE } from '../../src/miniature/icons.js';
// @ts-expect-error plain JS modules of the miniature
import { sunSvg, moonSvg, bodySvg, drawSun, drawMoon, discRadius, GLOW_REACH, MOON_DARK } from '../../src/miniature/bodies.js';
// @ts-expect-error plain JS modules of the miniature
import { MARK_KINDS, MARK_NAMES, MARK_COLOUR, MARK_FILL, markSvg, markBody, drawMark, needleSvg, drawNeedle, NEEDLE_HALF_WIDTH } from '../../src/miniature/marks.js';
// @ts-expect-error plain JS modules of the miniature
import { CONTROL_NAMES, controlName } from '../../src/miniature/controlNames.js';
import { cssRgb, moonLook, sunLook } from '../../src/lib/mapBodyLook.js';
import { lightPhaseAt } from '../../src/lib/lightPhases.js';
import { skyPalette } from '../../src/lib/skyPalette.js';

const numbersIn = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

describe('icon set', () => {
  it('covers what the panel spec asks for', () => {
    for (const name of ['chevron-down', 'chevron-up', 'shot-earlier', 'shot-later', 'minus', 'plus', 'now', 'play', 'pause', 'layers', 'locate', 'share', 'lens', 'minimap', 'close', 'more']) {
      expect(ICON_NAMES, name).toContain(name);
    }
  });

  it('draws every icon on the one grid with the one stroke', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg, name).toContain('viewBox="0 0 24 24"');
      expect(svg, name).toContain(`stroke-width="${ICON_STROKE}"`);
      expect(svg, name).toContain('stroke="currentColor"');
      expect(svg, name).toContain('stroke-linecap="round"');
      // No colour of its own: both themes come from currentColor.
      expect(svg, name).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
      expect(ICONS[name].use, name).toBeTruthy();
    }
  });

  it('starts every path inside the grid', () => {
    for (const name of ICON_NAMES) {
      const def = ICONS[name];
      for (const part of [def.d, def.mass, def.soft, def.solid, def.dots]) {
        for (const move of (part ?? '').match(/M-?[\d.]+[ ,]-?[\d.]+/g) ?? []) {
          const [x, y] = numbersIn(move);
          expect(x, `${name} ${move}`).toBeGreaterThanOrEqual(1.5);
          expect(x, `${name} ${move}`).toBeLessThanOrEqual(22.5);
          expect(y, `${name} ${move}`).toBeGreaterThanOrEqual(1.5);
          expect(y, `${name} ${move}`).toBeLessThanOrEqual(22.5);
        }
      }
    }
  });

  it('is decorative by default and labelled on request', () => {
    expect(icon('layers')).toContain('aria-hidden="true"');
    expect(icon('layers')).not.toContain('role="img"');
    const labelled = icon('layers', { label: 'Map <layers>' });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Map &lt;layers&gt;"');
    expect(labelled).toContain('<title>Map &lt;layers&gt;</title>');
    expect(labelled).not.toContain('aria-hidden');
  });

  it('sizes in CSS pixels', () => {
    expect(icon('close', { size: 16 })).toContain('width="16" height="16"');
  });

  it('refuses names it does not have', () => {
    expect(() => icon('sun')).toThrow();
    expect(() => icon('moon')).toThrow();
    expect(() => iconUse('nope')).toThrow();
  });

  it('offers the same drawings as a sprite', () => {
    const sprite = iconSprite();
    for (const name of ICON_NAMES) expect(sprite).toContain(`<symbol id="ue-i-${name}" viewBox="0 0 24 24">${iconBody(name)}</symbol>`);
    expect(iconUse('pin', { size: 20 })).toContain('<use href="#ue-i-pin"/>');
  });
});

describe('the one sun', () => {
  it('takes core, limb and glow from sunLook at the given altitude', () => {
    for (const alt of [-6, 0, 6, 20, 45]) {
      const look = sunLook(alt);
      const svg = sunSvg({ altitudeDeg: alt });
      expect(svg, `${alt}`).toContain(`stop-color="${cssRgb(look.core)}"`);
      expect(svg, `${alt}`).toContain(`stop-color="${cssRgb(look.limb)}"`);
      expect(svg, `${alt}`).toContain(`stop-color="${cssRgb(look.glow)}"`);
    }
  });

  it('agrees with the disc tints of the iconography rule', () => {
    // -6° rgb(255,107,51), horizon rgb(255,163,61), 6° rgb(255,209,138), 20° rgb(255,235,199), 45° white.
    const rule: Array<[number, [number, number, number]]> = [[-6, [255, 107, 51]], [0, [255, 163, 61]], [6, [255, 209, 138]], [20, [255, 235, 199]], [45, [255, 255, 255]]];
    for (const [alt, tint] of rule) {
      expect(skyPalette('sun', alt).discTint.map((v) => Math.round(v * 255))).toEqual(tint);
      // The core is the tint mixed halfway to white.
      const core = tint.map((v) => Math.round((v + 255) / 2));
      const drawn = sunSvg({ altitudeDeg: alt }).match(/<stop offset="0" stop-color="rgb\((\d+) (\d+) (\d+)\)"/)!.slice(1).map(Number);
      for (let i = 0; i < 3; i++) expect(Math.abs(drawn[i]! - core[i]!), `${alt}° channel ${i}`).toBeLessThanOrEqual(1);
    }
  });

  it('is the same object at every size: only width and height change', () => {
    const strip = (svg: string) => svg.replace(/width="\d+" height="\d+"/, '').replace(/ue-sun-\d+/g, 'id');
    expect(strip(sunSvg({ altitudeDeg: 3, size: 12 }))).toBe(strip(sunSvg({ altitudeDeg: 3, size: 96 })));
  });

  it('keeps the glow inside the box', () => {
    expect(discRadius(24) * GLOW_REACH).toBeLessThanOrEqual(12);
    expect(discRadius(24, false)).toBeLessThan(12);
  });
});

describe('the one moon', () => {
  // Adversarial test 2026-11, finding 5: a low moon read as the sun. Its colour still comes
  // from moonLook; its marks are its own at every altitude.
  it('keeps the moon\u2019s own marks at the horizon, and gives the sun none of them', () => {
    const blueOf = (rgb: string) => Number(rgb.match(/rgb\((\d+) (\d+) (\d+)\)/)![3]) - Number(rgb.match(/rgb\((\d+) (\d+) (\d+)\)/)![1]);
    for (const altitudeDeg of [0, 1, 2, 3, 4, 5, 40]) {
      const moon = moonSvg({ fraction: 1, altitudeDeg, sunAltitudeDeg: -2, size: 16, glow: false });
      // The seas, clipped to the lit face, in the dark body's colour.
      expect(moon).toContain('clip-path');
      expect((moon.match(new RegExp(`fill="${MOON_DARK}" fill-opacity`, 'g')) ?? []).length).toBe(1);
      // The rim is the high moon's cool glow, not the horizon's warm one.
      const rim = moon.match(/stroke="(rgb\([^"]+\))" stroke-opacity/)![1];
      expect(rim).toBe(cssRgb(moonLook(90, -2, 1).glow));
      expect(blueOf(rim)).toBeGreaterThan(0);
      // The lit face is still moonLook's tint for that altitude.
      expect(moon).toContain(`fill="${cssRgb(moonLook(altitudeDeg, -2, 1).core)}"`);
      const sun = sunSvg({ altitudeDeg, size: 16, glow: false });
      expect(sun).not.toContain(MOON_DARK);
      expect(sun).not.toContain('clip-path');
    }
  });
  it('takes tint and glow from moonLook', () => {
    const cases = [
      { fraction: 0.85, waxing: true, altitudeDeg: 30, sunAltitudeDeg: -20 },
      { fraction: 0.85, waxing: true, altitudeDeg: 2, sunAltitudeDeg: -20 },
      { fraction: 0.4, waxing: false, altitudeDeg: 30, sunAltitudeDeg: 20 },
    ];
    for (const moon of cases) {
      const look = moonLook(moon.altitudeDeg, moon.sunAltitudeDeg, moon.fraction);
      const svg = moonSvg(moon);
      expect(svg).toContain(`fill="${MOON_DARK}"`);
      expect(svg).toContain(`fill="${cssRgb(look.core)}"`);
      expect(svg).toContain(`stop-color="${cssRgb(look.glow)}"`);
    }
  });

  it('warms toward the horizon', () => {
    const blue = (svg: string) => Number(svg.match(/<path[^>]*fill="rgb\(\d+ \d+ (\d+)\)"/)![1]);
    expect(blue(moonSvg({ fraction: 1, altitudeDeg: 1 }))).toBeLessThan(blue(moonSvg({ fraction: 1, altitudeDeg: 40 })));
  });

  it('lights the right side while waxing and the left while waning', () => {
    expect(moonSvg({ fraction: 0.3, waxing: true })).toContain('A1,1 0 0 1 0,1');
    expect(moonSvg({ fraction: 0.3, waxing: false })).toContain('A1,1 0 0 0 0,1');
  });

  it('draws a new moon as the dark disc alone', () => {
    expect(moonSvg({ fraction: 0 })).not.toContain('<path');
  });

  it('is decorative by default and labelled on request', () => {
    expect(moonSvg()).toContain('aria-hidden="true"');
    expect(bodySvg({ kind: 'moon', label: 'Waxing gibbous, 85% lit' })).toContain('aria-label="Waxing gibbous, 85% lit"');
    expect(bodySvg({ kind: 'sun', label: 'Sun' })).toContain('ue-sun');
  });
});

describe('canvas drawing', () => {
  /** A recording stand-in for a 2D context. */
  function fakeContext() {
    const calls: string[] = [];
    const stops: string[] = [];
    const gradient = { addColorStop: (_at: number, colour: string) => stops.push(colour) };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) => {
        if (key === 'createRadialGradient') return () => gradient;
        if (key in target) return target[key];
        return (...args: unknown[]) => calls.push(`${key}(${args.filter((a) => typeof a === 'number').join(',')})`);
      },
      set: (target, key: string, value) => {
        target[key] = value;
        if (typeof value === 'string') calls.push(`${key}=${value}`);
        return true;
      },
    });
    return { ctx, calls, stops };
  }

  it('paints the sun with the colours of the SVG sun', () => {
    const { ctx, stops } = fakeContext();
    drawSun(ctx, 50, 50, 20, 3);
    const look = sunLook(3);
    expect(stops).toContain(cssRgb(look.core));
    expect(stops).toContain(cssRgb(look.limb));
  });

  it('paints the moon on its dark disc', () => {
    (globalThis as { Path2D?: unknown }).Path2D ??= class { constructor(public d: string) {} };
    const { ctx, calls } = fakeContext();
    drawMoon(ctx, 50, 50, 20, { fraction: 0.6, waxing: true, altitudeDeg: 30, sunAltitudeDeg: -20 });
    expect(calls).toContain(`fillStyle=${MOON_DARK}`);
    expect(calls).toContain(`fillStyle=${cssRgb(moonLook(30, -20, 0.6).core)}`);
  });
});

describe('weather and light phases', () => {
  it('draws every weather state', () => {
    for (const state of WEATHER_STATES) expect(weatherIcon(state), state).toContain('<svg');
    expect(() => weatherIcon('fog')).toThrow();
  });

  it('puts the canonical body, not a drawn sun, into clear and part-cloud skies', () => {
    const look = sunLook(2);
    for (const state of ['clear', 'some-cloud']) {
      expect(weatherIcon(state, { body: { kind: 'sun', altitudeDeg: 2 } }), state).toContain(`stop-color="${cssRgb(look.core)}"`);
      expect(weatherIcon(state, { body: { kind: 'moon', fraction: 0.5 } }), state).toContain(MOON_DARK);
    }
    for (const state of ['overcast', 'rain', 'thunder']) expect(weatherIcon(state), state).not.toMatch(/rgb\(|#[0-9a-f]{6}/i);
  });

  it('draws each light phase at an altitude inside that phase', () => {
    for (const phase of LIGHT_PHASES) {
      expect(lightPhaseAt(PHASE_ALTITUDE[phase]), phase).toBe(phase);
      expect(phaseIcon(phase, { label: phase }), phase).toContain(`aria-label="${phase}"`);
    }
    expect(phaseIcon('golden')).toContain(`stop-color="${cssRgb(sunLook(PHASE_ALTITUDE.golden).core)}"`);
    expect(phaseIcon('night')).not.toContain('radialGradient');
    expect(() => phaseIcon('dawn')).toThrow();
  });
});

describe('event marks', () => {
  it('gives every event its own drawing, with a name', () => {
    const drawings = MARK_KINDS.map((kind: string) => markBody(kind, ''));
    expect(new Set(drawings).size).toBe(MARK_KINDS.length);
    for (const kind of MARK_KINDS) expect(MARK_NAMES[kind], kind).toBeTruthy();
    expect(() => markSvg('tower-venus')).toThrow();
  });

  it('separates the two orange marks by shape, not colour: a ring and a bar', () => {
    const tower = markBody('tower-sun', '');
    const henge = markBody('henge-sun', '');
    expect(tower).toContain('<circle');
    expect(tower).not.toContain('<rect');
    expect(henge).toContain('<rect');
    expect(henge).not.toContain('<circle');
    // Dan's suggestion for the sun behind the tower: an orange outline with a white fill.
    expect(tower).toContain(`fill="#fff" stroke="${MARK_COLOUR.sun}"`);
  });

  it('separates sun from moon by fill as well as colour', () => {
    for (const event of ['tower', 'henge']) {
      expect(markBody(`${event}-moon`, ''), event).toContain(`fill="${MARK_FILL.moon}"`);
      expect(markBody(`${event}-sun`, ''), event).not.toContain(MARK_FILL.moon);
    }
  });

  it('carries a halo so an overlapped pair stays two marks', () => {
    for (const kind of MARK_KINDS) {
      expect(markSvg(kind), kind).toContain('fill="var(--surface, #fff)"');
      expect(markSvg(kind, { halo: '' }), kind).not.toContain('--surface');
    }
  });

  it('is decorative by default and labelled on request', () => {
    expect(markSvg('tower-sun', { size: 10 })).toContain('width="10" height="10" aria-hidden="true"');
    expect(markSvg('henge-moon', { label: MARK_NAMES['henge-moon'] })).toContain('aria-label="Street henge, moon"');
  });

  it('draws on a canvas without throwing', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : () => calls.push(key)),
      set: (target, key: string, value) => ((target[key] = value), true),
    });
    for (const kind of MARK_KINDS) drawMark(ctx, kind, 10, 10, 12, '#fff');
    drawNeedle(ctx, 10, 10, 1, 16, { kind: 'moon', halo: '#fff' });
    expect(calls).toContain('arc');
    expect(calls).toContain('roundRect');
    expect(calls).toContain('rotate');
  });
});

describe('direction needle', () => {
  it('is at least as long as twice its width, unlike the old triangle', () => {
    // Today's arrow in overlay.js is 11 long and 12 wide.
    expect(1 / (2 * NEEDLE_HALF_WIDTH)).toBeGreaterThanOrEqual(1.9);
  });

  it('colours the end that points, and leaves the tail to the text colour', () => {
    const sun = needleSvg({ kind: 'sun', angleDeg: 30 });
    expect(sun).toContain('rotate(30)');
    expect(sun).toContain('fill="currentColor"');
    // The coloured part is the one that holds the tip at x = 8 (half of the 16-unit box).
    expect(sun).toMatch(new RegExp(`<path d="M8 0L[^"]*" fill="${MARK_COLOUR.sun}"`));
    expect(needleSvg({ kind: 'moon' })).toContain(`fill="${MARK_COLOUR.moon}"`);
    expect(() => needleSvg({ kind: 'venus' })).toThrow();
  });
});

describe('control names', () => {
  it('names every control with a short tooltip and a full accessible name', () => {
    const keys = new Set<string>();
    for (const control of CONTROL_NAMES) {
      expect(keys.has(control.key), control.key).toBe(false);
      keys.add(control.key);
      expect(control.tip.length, control.key).toBeGreaterThan(1);
      expect(control.tip.length, control.key).toBeLessThanOrEqual(20);
      expect(control.tip.endsWith('.'), control.key).toBe(false);
      expect(control.name.length, control.key).toBeGreaterThanOrEqual(control.tip.length);
      if (control.icon && control.icon !== 'sun' && control.icon !== 'moon') expect(ICON_NAMES, control.key).toContain(control.icon);
    }
  });

  it('covers the toolbar of plan.astro', () => {
    for (const id of ['compass', 'face-tower', 'face-sun', 'face-moon', 'locate', 'help', 'layers', 'tilt', 'photographer', 'back', 'takeoff', 'share']) {
      expect(CONTROL_NAMES.some((c: { id: string | null }) => c.id === id), id).toBe(true);
    }
    expect(controlName('takeoff').icon).toBe('drone');
    expect(() => controlName('nope')).toThrow();
  });
});
