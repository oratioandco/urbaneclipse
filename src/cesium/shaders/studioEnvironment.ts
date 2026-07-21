/**
 * "Plaster Void" depth-haze + film-grain PostProcessStage — pure builders.
 *
 * Two pure, unit-tested builders (`buildStudioEnvironmentShaderSource`,
 * `isBackgroundDepth`) plus a thin `createStudioEnvironmentStage` factory that
 * takes Cesium as a runtime argument. NO Cesium import at module load — this
 * module is importable from node/SSR and from the unit tests with no Cesium
 * present.
 *
 * Background / spec: research.md §6 "Art Direction — Plaster Void". The GLSL
 * follows the spec's plaster intent but applies the 4 correctness fixes from
 * that critique. Verified against Cesium 1.143 runtime conventions
 * (node_modules/cesium/Build/CesiumUnminified/index.cjs:230817 BlackAndWhite)
 * which compiles post-process stages as `#version 300 es` (GLSL ES 3.00):
 *   1. NO `#version` / `precision` — Cesium injects them (and all `czm_*`,
 *      plus `layout(location = 0) out vec4 out_FragColor;` which we write to).
 *   2. GLSL ES 3.00 sampling: `texture(sampler, uv)` (NOT `texture2D(...)`),
 *      and `in vec2 v_textureCoordinates;` (NOT `varying`), and write to
 *      `out_FragColor` (NOT `gl_FragColor`).
 *   3. Background via epsilon `depth > 0.9999`, NEVER `depth == 1.0`
 *      (logarithmic-depth distant geometry samples arbitrarily close to 1.0).
 *   4. Fog from eye-space distance in METERS via
 *      `length(czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0)).xyz)`
 *      then `smoothstep(fogStart, fogEnd, dist)`; film grain via `czm_frameNumber`.
 */

/** Background-epsilon threshold. Strictly-greater comparison (see fix #3). */
export const BACKGROUND_DEPTH_EPSILON = 0.9999;

/**
 * Epsilon background test (fix #3). With logarithmicDepthBuffer=true, distant
 * geometry samples arbitrarily close to 1.0, so we branch on this epsilon
 * instead of comparing `== 1.0` (which would flicker).
 */
export function isBackgroundDepth(depth: number): boolean {
  return depth > BACKGROUND_DEPTH_EPSILON;
}

export interface StudioEnvironmentOptions {
  /** Eye-space distance (meters) at which haze begins to ramp in. */
  fogStart?: number;
  /** Eye-space distance (meters) at which haze reaches full strength. */
  fogEnd?: number;
  /** RGB (0..1) haze color mixed toward with distance. */
  hazeColor?: [number, number, number];
  /** Film-grain strength (fraction of a channel). */
  grainAmount?: number;
}

/** Default plaster-void haze parameters (sensible; not asserted by contract). */
const DEFAULTS = {
  fogStart: 3000,
  fogEnd: 8000,
  hazeColor: [0.92, 0.92, 0.9] as [number, number, number],
  grainAmount: 0.025,
};

/**
 * Format a JS number as a valid GLSL float literal (must contain a decimal
 * point; an integer like 3000 becomes 3000.0).
 */
function glslFloat(n: number): string {
  if (!Number.isFinite(n)) {
    return '0.0';
  }
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/**
 * Build the "Plaster Void" depth-haze + film-grain GLSL ES 3.00 fragment source
 * for a Cesium PostProcessStage. The configurable values are BAKED INTO the
 * source as float/vec3 literals (so the stage can be created with `uniforms: {}`).
 *
 * Cesium auto-injects `#version 300 es`, `precision`, every `czm_*` built-in
 * (`czm_readDepth`, `czm_windowToEyeCoordinates`, `czm_frameNumber`), and the
 * `layout(location = 0) out vec4 out_FragColor;` declaration — do NOT redeclare
 * those here.
 */
export function buildStudioEnvironmentShaderSource(
  opts?: StudioEnvironmentOptions,
): string {
  const fogStart = opts?.fogStart ?? DEFAULTS.fogStart;
  const fogEnd = opts?.fogEnd ?? DEFAULTS.fogEnd;
  const hazeColor = opts?.hazeColor ?? DEFAULTS.hazeColor;
  const grainAmount = opts?.grainAmount ?? DEFAULTS.grainAmount;

  const hazeR = glslFloat(hazeColor[0]);
  const hazeG = glslFloat(hazeColor[1]);
  const hazeB = glslFloat(hazeColor[2]);

  return [
    '// Plaster Void: depth-haze + film-grain post-process (GLSL ES 3.00).',
    '// Cesium injects the version + precision, all czm_* built-ins, and the',
    '// layout(location=0) out vec4 out_FragColor declaration we write to below.',
    'uniform sampler2D colorTexture;',
    'uniform sampler2D depthTexture;',
    '',
    'in vec2 v_textureCoordinates;',
    '',
    'void main() {',
    '  // Plaster-void haze + grain parameters, baked from build opts.',
    `  float fogStart = ${glslFloat(fogStart)};`,
    `  float fogEnd = ${glslFloat(fogEnd)};`,
    `  vec3 hazeColor = vec3(${hazeR}, ${hazeG}, ${hazeB});`,
    `  float grainAmount = ${glslFloat(grainAmount)};`,
    '',
    '  vec4 color = texture(colorTexture, v_textureCoordinates);',
    '  float depth = czm_readDepth(depthTexture, v_textureCoordinates);',
    '',
    '  // Fix #3: background via epsilon, never an exact one-point depth test.',
    '  // Logarithmic-depth distant geometry samples arbitrarily close to the',
    '  // far plane; the 0.9999 epsilon avoids flicker at the horizon.',
    '  if (depth > 0.9999) {',
    '    // Pure background (the sky void): flat haze, no fog ramp, no grain.',
    '    out_FragColor = vec4(hazeColor, color.a);',
    '    return;',
    '  }',
    '',
    '  // Fix #4: fog from eye-space distance in METERS, not raw [0,1] depth.',
    '  // czm_windowToEyeCoordinates(...).xyz length is in meters, so fogStart',
    '  // / fogEnd are meters of eye-space distance.',
    '  float dist = length(czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0)).xyz);',
    '  float fog = smoothstep(fogStart, fogEnd, dist);',
    '  vec3 result = mix(color.rgb, hazeColor, fog);',
    '',
    '  // Film grain: temporal dither driven by czm_frameNumber (fix #4).',
    '  float grain = fract(sin(dot(v_textureCoordinates * (czm_frameNumber + 1.0), vec2(12.9898, 78.233))) * 43758.5453);',
    '  result += (grain - 0.5) * grainAmount;',
    '',
    '  out_FragColor = vec4(result, color.a);',
    '}',
    '',
  ].join('\n');
}

/**
 * Create the Cesium PostProcessStage for the Plaster Void look.
 *
 * NOT unit-tested: takes the Cesium namespace as a runtime argument so this
 * module has no load-time Cesium dependency. `uniforms` is empty because the
 * haze/grain parameters are baked into the fragment source as literals.
 */
export function createStudioEnvironmentStage(Cesium: any): any {
  return new Cesium.PostProcessStage({
    fragmentShader: buildStudioEnvironmentShaderSource(),
    uniforms: {},
  });
}
