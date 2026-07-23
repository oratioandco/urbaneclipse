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

/** Default plaster-void haze parameters (sensible; not asserted by contract).
 *
 *  Tuned so a landmark ~6 km out (the Fernsehturm from the Lichtenberger Brücke) is
 *  only lightly hazed (fog ~0.29) rather than washed to invisibility — it must read
 *  as a silhouette against the sky, not vanish into it. `hazeColor` is the warm, bright
 *  HORIZON tint; the sky darkens/cools toward the top via the `u_skyTop` uniform, and
 *  a warm sun/moon bloom is added around `u_sunUv`. */
const DEFAULTS = {
  fogStart: 8000,
  fogEnd: 24000,
  hazeColor: [0.96, 0.94, 0.9] as [number, number, number],
  grainAmount: 0.02,
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
    '// Plaster Void: gradient sky + sun/moon bloom + depth-haze + film-grain',
    '// post-process (GLSL ES 3.00). Cesium injects the version + precision, all czm_*',
    '// built-ins, and the layout(location=0) out vec4 out_FragColor we write to.',
    'uniform sampler2D colorTexture;',
    'uniform sampler2D depthTexture;',
    '',
    '// Custom PostProcessStage uniforms MUST be declared here (Cesium does not',
    '// auto-declare them), and their VALUES must be Cesium.Cartesian2/3 — plain JS',
    '// arrays are silently not bound and the uniform reads 0. See the factory below.',
    'uniform vec2 u_sunUv;        // sun/moon centre in texture coords [0,1]',
    'uniform float u_sunVisible;  // 1 when the body is up and on-screen, else 0',
    'uniform float u_aspect;      // viewport width/height, keeps the bloom circular',
    'uniform vec3 u_skyTop;       // cool sky colour at the top of frame',
    'uniform vec3 u_glowColor;    // warm sun / cool moon bloom colour',
    'uniform float u_glowStrength;',
    '',
    'in vec2 v_textureCoordinates;',
    '',
    `const vec3 c_haze = vec3(${hazeR}, ${hazeG}, ${hazeB});`,
    '',
    '// The plaster-void sky at a screen point: a vertical gradient from the warm haze',
    '// horizon up to the cooler u_skyTop, plus a soft radial bloom around the body.',
    'vec3 skyColor(vec2 uv, vec3 hazeColor) {',
    '  vec3 base = mix(hazeColor, u_skyTop, smoothstep(-0.15, 1.15, uv.y));',
    '  vec2 d = uv - u_sunUv;',
    '  d.x *= u_aspect;',
    '  float r2 = dot(d, d);',
    '  float glow = u_glowStrength * exp(-r2 / 0.03) * u_sunVisible;',
    '  return base + u_glowColor * glow;',
    '}',
    '',
    'void main() {',
    '  // Plaster-void haze + grain parameters, baked from build opts.',
    `  float fogStart = ${glslFloat(fogStart)};`,
    `  float fogEnd = ${glslFloat(fogEnd)};`,
    `  vec3 hazeColor = c_haze;`,
    `  float grainAmount = ${glslFloat(grainAmount)};`,
    '',
    '  vec4 color = texture(colorTexture, v_textureCoordinates);',
    '  float depth = czm_readDepth(depthTexture, v_textureCoordinates);',
    '  vec3 sky = skyColor(v_textureCoordinates, hazeColor);',
    '',
    '  // Fix #3: background via epsilon, never an exact one-point depth test.',
    '  // Logarithmic-depth distant geometry samples arbitrarily close to the',
    '  // far plane; the 0.9999 epsilon avoids flicker at the horizon.',
    '  if (depth > 0.9999) {',
    '    // Sky: the gradient + bloom, no fog ramp, no grain.',
    '    out_FragColor = vec4(sky, color.a);',
    '    return;',
    '  }',
    '',
    '  // Fix #4: fog from eye-space distance in METERS, not raw [0,1] depth.',
    '  // czm_windowToEyeCoordinates(...).xyz length is in meters, so fogStart',
    '  // / fogEnd are meters of eye-space distance. Geometry fades toward the SKY',
    '  // colour behind it (so a backlit tower gains an atmospheric rim and reads',
    '  // as a silhouette against the bloom rather than washing to flat white).',
    '  float dist = length(czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0)).xyz);',
    '  float fog = smoothstep(fogStart, fogEnd, dist);',
    '  vec3 result = mix(color.rgb, sky, fog);',
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
 * Live sky/bloom state, mutated by the app each frame and read through the uniform
 * callbacks below. Kept as a plain object so the app can update it in place without
 * re-creating the stage.
 */
export interface StudioEnvironmentState {
  /** Sun/moon centre in texture coords [0,1] (origin bottom-left). */
  sunUv: [number, number];
  /** 1 when the body is above the horizon and on-screen, else 0. */
  sunVisible: number;
  /** Viewport aspect (width/height) — keeps the bloom circular. */
  aspect: number;
  /** Cool sky colour at the top of frame. */
  skyTop: [number, number, number];
  /** Warm sun / cool moon bloom colour. */
  glowColor: [number, number, number];
  /** Bloom intensity. */
  glowStrength: number;
}

/** A neutral default so the stage renders sanely before the app sets real values. */
export function defaultStudioEnvironmentState(): StudioEnvironmentState {
  return {
    sunUv: [0.5, 0.5],
    sunVisible: 0,
    aspect: 1.6,
    skyTop: [0.8, 0.83, 0.89],
    glowColor: [1.0, 0.92, 0.75],
    glowStrength: 0.9,
  };
}

/**
 * Create the Cesium PostProcessStage for the Plaster Void look.
 *
 * NOT unit-tested: takes the Cesium namespace as a runtime argument so this module
 * has no load-time Cesium dependency. The sky-gradient / bloom uniforms read from the
 * shared `state` object through callbacks, so the app re-frames the bloom (e.g. as the
 * clock scrubs the sun across the sky) simply by mutating `state`.
 */
export function createStudioEnvironmentStage(
  Cesium: any,
  state: StudioEnvironmentState = defaultStudioEnvironmentState(),
): any {
  // vec2 / vec3 uniform VALUES must be Cesium.Cartesian2 / Cartesian3 — a plain JS
  // array is silently not bound (the uniform reads 0, rendering black). Scalars are
  // plain numbers. The app mutates stage.uniforms.* each frame via updateStudioUniforms.
  const stage = new Cesium.PostProcessStage({
    fragmentShader: buildStudioEnvironmentShaderSource(),
    uniforms: {
      u_sunUv: new Cesium.Cartesian2(state.sunUv[0], state.sunUv[1]),
      u_sunVisible: state.sunVisible,
      u_aspect: state.aspect,
      u_skyTop: new Cesium.Cartesian3(state.skyTop[0], state.skyTop[1], state.skyTop[2]),
      u_glowColor: new Cesium.Cartesian3(
        state.glowColor[0],
        state.glowColor[1],
        state.glowColor[2],
      ),
      u_glowStrength: state.glowStrength,
    },
  });
  return stage;
}

/** Push the live state object's values onto a stage's uniforms (Cartesian for vecs). */
export function updateStudioUniforms(
  Cesium: any,
  stage: any,
  state: StudioEnvironmentState,
): void {
  if (!stage || !stage.uniforms) return;
  stage.uniforms.u_sunUv = new Cesium.Cartesian2(state.sunUv[0], state.sunUv[1]);
  stage.uniforms.u_sunVisible = state.sunVisible;
  stage.uniforms.u_aspect = state.aspect;
  stage.uniforms.u_skyTop = new Cesium.Cartesian3(
    state.skyTop[0],
    state.skyTop[1],
    state.skyTop[2],
  );
  stage.uniforms.u_glowColor = new Cesium.Cartesian3(
    state.glowColor[0],
    state.glowColor[1],
    state.glowColor[2],
  );
  stage.uniforms.u_glowStrength = state.glowStrength;
}
