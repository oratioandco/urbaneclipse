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

describe('isBackgroundDepth (exact cleared-depth test, fix #3 revised)', () => {
  // The depth buffer is cleared to exactly 1.0 and no geometry in this scene can
  // write exactly 1.0 (hyperbolic: ~50 km content tops out at ~0.999998; log-depth:
  // only geometry beyond ~9,999 km quantises to 1.0). The old 0.9999 epsilon ate all
  // geometry beyond ~1 km because the post-process depth texture arrives hyperbolic
  // (near=0.1, far=1e10) — the tower and the disc vanished into the sky.
  it('returns false for real geometry at any distance', () => {
    expect(isBackgroundDepth(0.5)).toBe(false);
    expect(isBackgroundDepth(0.9999)).toBe(false);
    expect(isBackgroundDepth(0.99999)).toBe(false);
    expect(isBackgroundDepth(0.999998)).toBe(false); // the ~50 km sky-direction content
  });

  it('returns true only at exactly the cleared depth 1.0', () => {
    expect(isBackgroundDepth(1.0)).toBe(true);
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
    it('renders the authored sky and scene as opaque surfaces', () => {
      expect(src.match(/out_FragColor = vec4\(result, 1\.0\);/g)).toHaveLength(2);
    });
  });

  // ---- Rule 3: background via EXACT cleared depth (depth >= 1.0). ----
  describe('rule 3: background via exact cleared depth (depth >= 1.0)', () => {
    it('branches on the exact cleared-depth comparison depth >= 1.0', () => {
      expect(src).toContain('depth >= 1.0');
    });
    it('never uses the city-eating 0.9999 epsilon comparison', () => {
      // With the hyperbolic depth texture this scene produces (near=0.1, far=1e10),
      // everything beyond ~1 km reads above 0.9999 and would be painted as sky.
      // (Comments may cite the value; the COMPARISON must be gone.)
      expect(src).not.toMatch(/depth\s*>\s*0\.9999/);
    });
  });

  // ---- Rule 4: fog from eye-space distance in METERS + film grain. ----
  describe('rule 4: fog from eye-space distance (meters) + film grain', () => {
    it('computes eye-space position + distance via czm_windowToEyeCoordinates', () => {
      expect(src).toContain('czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0))');
      expect(src).toContain('vec4 eye = czm_windowToEyeCoordinates');
      expect(src).toContain('float dist = length(eye.xyz)');
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

  // ---- Horizon fade (the "horizon seam" fix): terrain dissolves to sky at the globe
  //      silhouette instead of hard-cutting, scoped so tower/building tops stay sharp. ----
  describe('horizon fade (view-pitch band around the horizon)', () => {
    it('derives view pitch from the eye-space up component and blends toward sky', () => {
      expect(src).toContain('float viewPitch = dot(eye.xyz / dist, upEC);');
      expect(src).toContain('float horizonFog = smoothstep(HORIZON_FADE_BELOW, 0.0, viewPitch)');
      expect(src).toContain(
        'horizonFog *= (1.0 - smoothstep(0.0, HORIZON_FADE_ABOVE, viewPitch))',
      );
      expect(src).toContain('fog = max(fog, horizonFog * 0.38)');
    });
    it('keeps the distance-fog ramp and the haze mix intact (no regression)', () => {
      expect(src).toContain('smoothstep(fogStart, fogEnd, dist)');
      expect(src).toContain('vec3 plaster = color.rgb * u_sceneTint * depthTone');
      expect(src).toContain('mix(plaster, airColor(v_textureCoordinates, hazeColor), fog)');
    });
    it('never touches the background depth test or the disc (additive only)', () => {
      // The fade lives entirely in the geometry branch (depth < 1.0); the background
      // branch and the disc are unchanged, so the city-eating regression cannot recur.
      expect(src).toContain('depth >= 1.0');
      expect(src).toContain('smoothstep(u_sunRadius - soft, u_sunRadius + soft, r)');
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
        grainAmount: 0.07,
      });
      expect(custom).toContain('1234.0');
      expect(custom).toContain('5678.0');
      expect(custom).toContain('0.07');
      // The 4 invariant rules still hold on a customized source.
      expect(custom).toContain('depth >= 1.0');
      expect(custom).toContain('smoothstep(fogStart, fogEnd, dist)');
    });

    it('reads the haze colour from the u_haze uniform (time-of-day palette), not a baked literal', () => {
      const srcNow = buildStudioEnvironmentShaderSource();
      expect(srcNow).toContain('uniform vec3 u_haze');
      expect(srcNow).toContain('vec3 hazeColor = u_haze');
      expect(srcNow).not.toMatch(/const vec3 c_haze/);
    });

    it('draws the disc on background pixels from u_sunUv/u_sunRadius/u_discColor', () => {
      // The disc lives in the shader so city geometry occults it per-pixel and the
      // fog ramp can never haze it out (a 50 km billboard had both problems).
      expect(src).toContain('uniform float u_sunRadius');
      expect(src).toContain('uniform vec3 u_discColor');
      expect(src).toContain('smoothstep(u_sunRadius - soft, u_sunRadius + soft, r)');
    });

    it('dims geometry via the u_sceneTint uniform (night/golden-hour without usable normals)', () => {
      expect(src).toContain('uniform vec3 u_sceneTint');
      expect(src).toContain('color.rgb * u_sceneTint');
    });

    it('uses the distant-city plaster for analytical landmarks instead of a black silhouette', () => {
      expect(src).toContain('vec3 landmarkColor');
      expect(src).toContain('mix(silhouette, hazeColor,');
      expect(src).not.toContain('mix(result, vec3(0.12, 0.115, 0.12)');
    });

    it('paints no screen-space building crowns over the city', () => {
      expect(src).not.toContain('gateMask');
      expect(src).not.toContain('u_gate');
    });

    it('paints ground, not sky, below the horizon where there is no terrain', () => {
      expect(src).toContain('uniform float u_horizonY');
      expect(src).toContain('uniform vec3 u_groundColor');
      expect(src).toContain('float belowHorizon = u_horizonY - v_textureCoordinates.y');
      expect(src).toContain('mix(u_groundColor, airColor(v_textureCoordinates, hazeColor), groundHaze)');
    });

    it('lights the moon as a sphere, so it shows its phase', () => {
      expect(src).toContain('uniform vec2 u_moonLimb');
      expect(src).toContain('texture(u_moonMap, mapUv)');
      expect(src).toContain('dot(p, u_moonLimb) * u_moonPhase.y + facing * u_moonPhase.x');
    });

    it('treats undrawn pixels as sky, even when the engine wrote depth there', () => {
      expect(src).toContain('if (depth >= 1.0 || nothingDrawn)');
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
