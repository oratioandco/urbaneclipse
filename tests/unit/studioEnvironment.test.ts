import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildStudioEnvironmentShaderSource,
  isBackgroundDepth,
  // createStudioEnvironmentStage is intentionally NOT unit-tested: it takes
  // Cesium as a runtime param and is only the two pure builders that are tested.
} from '../../src/cesium/shaders/studioEnvironment';

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleSource = readFileSync(
  resolve(__dirname, '../../src/cesium/shaders/studioEnvironment.ts'),
  'utf8',
);

describe('isBackgroundDepth (epsilon background test, fix #3)', () => {
  // Implements `depth > 0.9999` (strict). With logarithmicDepthBuffer=true,
  // distant ~5.5km geometry samples arbitrarily close to 1.0, so we never
  // compare `== 1.0` — we branch on this epsilon instead.
  it('returns false for foreground / clearly-below-epsilon depths', () => {
    expect(isBackgroundDepth(0.5)).toBe(false);
    expect(isBackgroundDepth(0.9998)).toBe(false);
  });

  it('returns true above the 0.9999 epsilon and at exactly 1.0', () => {
    expect(isBackgroundDepth(0.99995)).toBe(true);
    expect(isBackgroundDepth(1.0)).toBe(true);
  });

  it('treats the threshold value itself as foreground (strict >)', () => {
    // 0.9999 is the boundary; strict `>` means the exact cutoff is NOT background.
    expect(isBackgroundDepth(0.9999)).toBe(false);
    // One representable step above crosses into background.
    expect(isBackgroundDepth(0.99991)).toBe(true);
  });
});

describe('buildStudioEnvironmentShaderSource — GLSL ES fragment for PostProcessStage', () => {
  const src = buildStudioEnvironmentShaderSource();

  it('returns a non-empty string', () => {
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(0);
  });

  // ---- Rule 1: Cesium injects #version / precision; we must NOT. ----
  describe('rule 1: no #version or precision (Cesium injects them)', () => {
    it('omits any #version directive', () => {
      expect(src).not.toMatch(/#version/);
    });
    it('omits any precision statement', () => {
      expect(src).not.toMatch(/precision\s+(lowp|mediump|highp)/);
    });
  });

  // ---- Rule 2: GLSL ES 3.00 — texture(...), not texture2D(...). ----
  // Cesium 1.143 compiles PostProcessStage shaders as `#version 300 es`
  // (confirmed via the BlackAndWhite stock stage at
  // node_modules/cesium/Build/CesiumUnminified/index.cjs:230817). The legacy
  // GLSL ES 1.00 `texture2D` sampler is removed; use `texture(sampler, uv)`.
  describe('rule 2: GLSL ES 3.00 sampling (texture, not texture2D())', () => {
    it('samples colorTexture with texture(...)', () => {
      expect(src).toContain('texture(colorTexture');
    });
    it('does not use the removed GLSL ES 1.00 texture2D() sampler', () => {
      // GLSL ES 3.00 dropped texture2D / texture3D / textureCube; Cesium does
      // NOT auto-convert them, so their presence fails shader compilation.
      expect(src).not.toMatch(/texture2D\s*\(/);
    });
    it('declares the varying as `in vec2` (GLSL ES 3.00), not `varying`', () => {
      // `varying` is a reserved word in GLSL ES 3.00 — using it is a hard
      // compile error ("Illegal use of reserved word").
      expect(src).toContain('in vec2 v_textureCoordinates');
      expect(src).not.toMatch(/\bvarying\b/);
    });
    it('writes to out_FragColor (Cesium-injected output), not gl_FragColor', () => {
      // Cesium injects `layout(location = 0) out vec4 out_FragColor;` and
      // rewrites it back to gl_FragColor for the GLSL ES 1.00 fallback path.
      expect(src).toContain('out_FragColor');
      expect(src).not.toMatch(/gl_FragColor/);
    });
  });

  // ---- Rule 3: background via epsilon, NEVER depth == 1.0. ----
  describe('rule 3: background via epsilon (depth > 0.9999), never == 1.0', () => {
    it('branches on the epsilon comparison depth > 0.9999', () => {
      expect(src).toContain('depth > 0.9999');
    });
    it('never compares depth == 1.0', () => {
      expect(src).not.toMatch(/depth\s*==\s*1\.0/);
    });
  });

  // ---- Rule 4: fog from eye-space distance in METERS + film grain. ----
  describe('rule 4: fog from eye-space distance (meters) + film grain', () => {
    it('computes eye-space distance via length(czm_windowToEyeCoordinates(...).xyz)', () => {
      expect(src).toContain('czm_windowToEyeCoordinates');
      expect(src).toContain(
        'length(czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0)).xyz)',
      );
    });
    it('applies smoothstep(fogStart, fogEnd, dist) over that distance', () => {
      expect(src).toContain('smoothstep(fogStart, fogEnd, dist)');
    });
    it('mixes toward hazeColor (depth-haze ramp)', () => {
      expect(src).toMatch(/mix\s*\(/);
      expect(src).toContain('hazeColor');
    });
    it('references czm_frameNumber for temporal film grain', () => {
      expect(src).toContain('czm_frameNumber');
    });
  });

  // ---- Required Cesium PostProcessStage hooks / references. ----
  describe('required PostProcessStage hooks and references', () => {
    it('declares sampler2D colorTexture + depthTexture uniforms', () => {
      expect(src).toContain('uniform sampler2D colorTexture');
      expect(src).toContain('uniform sampler2D depthTexture');
    });
    it('declares the v_textureCoordinates stage input (in vec2)', () => {
      expect(src).toContain('in vec2 v_textureCoordinates');
    });
    it('reads depth via czm_readDepth(depthTexture, v_textureCoordinates)', () => {
      expect(src).toContain('czm_readDepth(depthTexture, v_textureCoordinates)');
    });
    it('uses smoothstep (the depth-haze ramp)', () => {
      expect(src).toContain('smoothstep');
    });
  });

  // ---- opts are baked into the source as GLSL float/vec3 literals. ----
  describe('options', () => {
    it('honors opts by baking the passed values into the source as literals', () => {
      const custom = buildStudioEnvironmentShaderSource({
        fogStart: 1234,
        fogEnd: 5678,
        hazeColor: [0.1, 0.2, 0.3],
        grainAmount: 0.07,
      });
      expect(custom).toContain('1234.0');
      expect(custom).toContain('5678.0');
      expect(custom).toContain('vec3(0.1, 0.2, 0.3)');
      expect(custom).toContain('0.07');
      // The 4 invariant rules still hold on a customized source.
      expect(custom).toContain('depth > 0.9999');
      expect(custom).toContain('smoothstep(fogStart, fogEnd, dist)');
    });

    it('works with no opts (sensible plaster-void defaults)', () => {
      const def = buildStudioEnvironmentShaderSource();
      expect(def).toContain('fogStart');
      expect(def).toContain('fogEnd');
      expect(def).toContain('grainAmount');
    });
  });
});

describe('module boundary: no Cesium import at load time', () => {
  it('does not import the cesium package (Cesium is passed as a runtime param)', () => {
    // createStudioEnvironmentStage takes Cesium as an argument; the two tested
    // builders are pure. No top-level cesium import may exist.
    expect(moduleSource).not.toMatch(/from\s+['"]cesium['"]/);
    expect(moduleSource).not.toMatch(/require\(['"]cesium['"]\)/);
  });
});
