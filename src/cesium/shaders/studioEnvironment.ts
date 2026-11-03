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
 * follows the spec's plaster intent, applying the correctness fixes from that
 * critique plus the 2026 depth-encode fix (below). Verified against Cesium 1.143
 * runtime conventions (node_modules/cesium/Build/CesiumUnminified/index.cjs:230817
 * BlackAndWhite) which compiles post-process stages as `#version 300 es`
 * (GLSL ES 3.00):
 *   1. NO `#version` / `precision` — Cesium injects them (and all `czm_*`,
 *      plus `layout(location = 0) out vec4 out_FragColor;` which we write to).
 *   2. GLSL ES 3.00 sampling: `texture(sampler, uv)` (NOT `texture2D(...)`),
 *      and `in vec2 v_textureCoordinates;` (NOT `varying`), and write to
 *      `out_FragColor` (NOT `gl_FragColor`).
 *   3. Background via EXACT cleared-depth test `depth >= 1.0` — see
 *      BACKGROUND_DEPTH_EPSILON below for why the old 0.9999 epsilon ate the city.
 *   4. Fog from eye-space distance in METERS via
 *      `length(czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0)).xyz)`
 *      then `smoothstep(fogStart, fogEnd, dist)`; film grain via `czm_frameNumber`.
 *
 * THE DISC LIVES IN THE SHADER
 * ----------------------------
 * The sun/moon disc is drawn here, in the background branch, as a tinted circle at
 * `u_sunUv` with angular radius `u_sunRadius` — NOT as a billboard entity. Two
 * reasons:
 *   - A billboard at the required 50 km sits beyond fogEnd and would be fully
 *     fogged to sky colour (invisible); closer distances break occultation for
 *     far targets. In the shader there is no such trade-off.
 *   - Occultation falls out for free: the disc is only painted on background
 *     pixels (depth >= 1.0), so any building or the tower — whose depth is
 *     always < 1.0 — covers it exactly where it should, per pixel.
 */

/**
 * Background test: the depth buffer is CLEARED to exactly 1.0, and no geometry in
 * this scene can write exactly 1.0 — with plain hyperbolic depth the farthest
 * content (the ~50 km sky direction) tops out at ~0.999998, and with logarithmic
 * depth only geometry beyond ~9,999 km quantises to 1.0. The previous
 * `depth > 0.9999` epsilon assumed log-depth encoding, but the post-process depth
 * texture arrives hyperbolic (near=0.1, far=1e10): EVERYTHING beyond ~1 km read
 * above 0.9999 and was painted over with sky — the Fernsehturm, the disc, and most
 * of the city vanished from the preview. Exact `>= 1.0` is correct under BOTH
 * encodings at this scene's scales.
 */
export const BACKGROUND_DEPTH = 1.0;

/** Exact cleared-depth background test (fix #3, revised — see above). */
export function isBackgroundDepth(depth: number): boolean {
  return depth >= BACKGROUND_DEPTH;
}

export interface StudioEnvironmentOptions {
  /** Eye-space distance (meters) at which haze begins to ramp in. */
  fogStart?: number;
  /** Eye-space distance (meters) at which haze reaches full strength. */
  fogEnd?: number;
  /** Film-grain strength (fraction of a channel). */
  grainAmount?: number;
}

/** Default plaster-void haze parameters (sensible; not asserted by contract).
 *
 *  Tuned so a landmark ~6 km out (the Fernsehturm from the Lichtenberger Brücke) is
 *  still crisp; the atmospheric separation begins beyond the canonical composition
 *  rather than flattening the street canyon. The haze COLOUR is a live
 *  uniform (`u_haze`, driven per-frame from src/lib/skyPalette.ts); this default is
 *  only the value before the app pushes the time-of-day palette. */
const DEFAULTS = {
  fogStart: 12000,
  fogEnd: 30000,
  grainAmount: 0.02,
};

/** Initial haze colour — the neutral daytime value the palette module replaces. */
export const DEFAULT_HAZE: [number, number, number] = [0.96, 0.94, 0.9];

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
 * source as float literals (so the stage can be created with `uniforms: {}`).
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
  const grainAmount = opts?.grainAmount ?? DEFAULTS.grainAmount;

  return [
    '// Plaster Void: gradient sky + sun/moon disc & bloom + depth-haze + film-grain',
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
    'uniform float u_sunRadius;   // disc angular radius as a fraction of frame height',
    'uniform vec3 u_discColor;    // disc tint (time-of-day palette)',
    'uniform float u_aspect;      // viewport width/height, keeps the bloom circular',
    'uniform vec3 u_skyTop;       // cool sky colour at the top of frame',
    'uniform vec3 u_haze;         // haze/horizon colour (time-of-day palette)',
    'uniform vec3 u_glowColor;    // warm sun / cool moon bloom colour',
    'uniform float u_glowStrength;',
    'uniform vec3 u_sceneTint;    // geometry dim/tint (day/night, golden hour)',
    'uniform vec2 u_towerBaseUv;  // landmark base in texture coords',
    'uniform vec2 u_towerTopUv;   // landmark tip in texture coords',
    'uniform float u_towerVisible;',
    'uniform vec2 u_gateSouthBaseUv; // Frankfurter Tor south crown',
    'uniform vec2 u_gateSouthTopUv;',
    'uniform vec2 u_gateNorthBaseUv; // Frankfurter Tor north crown',
    'uniform vec2 u_gateNorthTopUv;',
    'uniform float u_gateVisible;',
    '',
    'in vec2 v_textureCoordinates;',
    '',
    '// The plaster-void sky at a screen point: a vertical gradient from the warm haze',
    '// horizon up to the cooler u_skyTop, a soft radial bloom around the body, and the',
    '// disc itself — drawn ONLY on background pixels, so geometry occludes it per-pixel.',
    'vec3 skyColor(vec2 uv, vec3 hazeColor) {',
    '  vec3 base = mix(hazeColor, u_skyTop, smoothstep(-0.15, 1.15, uv.y));',
    '  vec2 d = uv - u_sunUv;',
    '  d.x *= u_aspect;',
    '  float r = length(d);',
    '  // Keep the halo proportional to the real disc. The tighter floor preserves',
    '  // atmosphere without making a physically accurate low sun read oversized.',
    '  float glowSpread = max(u_sunRadius * u_sunRadius * 0.85, 0.00018);',
    '  float glow = u_glowStrength * exp(-(r * r) / glowSpread) * u_sunVisible;',
    '  vec3 sky = base + u_glowColor * glow;',
    '  float soft = max(u_sunRadius * 0.045, 0.0007);',
    '  float disc = u_sunVisible * (1.0 - smoothstep(u_sunRadius - soft, u_sunRadius + soft, r));',
    '  return mix(sky, u_discColor, disc);',
    '}',
    '',
    '// Exact Fernsehturm profile in screen space. Coordinates are converted to',
    '// screen-height units so x/y distances stay isotropic in a landscape viewport.',
    'float towerMask(vec2 uv) {',
    '  if (u_towerVisible < 0.5) return 0.0;',
    '  vec2 p = vec2((uv.x - u_towerBaseUv.x) * u_aspect, uv.y - u_towerBaseUv.y);',
    '  vec2 axis = vec2((u_towerTopUv.x - u_towerBaseUv.x) * u_aspect, u_towerTopUv.y - u_towerBaseUv.y);',
    '  float axis2 = dot(axis, axis);',
    '  if (axis2 < 0.000001) return 0.0;',
    '  float t = dot(p, axis) / axis2;',
    '  if (t < 0.0 || t > 1.0) return 0.0;',
    '  float h = t * 368.03;',
    '  float radiusM;',
    '  if (h < 20.0) radiusM = mix(16.0, 8.0, h / 20.0);',
    '  else if (h < 197.0) radiusM = mix(8.0, 5.3, (h - 20.0) / 177.0);',
    '  else if (h <= 229.0) {',
    '    float dz = h - 213.0;',
    '    float sphereR = sqrt(max(0.0, 256.0 - dz * dz));',
    '    float shaftR = mix(5.3, 4.8, (h - 197.0) / 32.0);',
    '    radiusM = max(sphereR, shaftR);',
    '  } else if (h < 248.78) radiusM = mix(4.8, 4.5, (h - 229.0) / 19.78);',
    '  else radiusM = mix(3.0, 0.9, (h - 248.78) / 119.25);',
    '  float distanceToAxis = length(p - axis * t);',
    '  float radiusUv = radiusM * sqrt(axis2) / 368.03;',
    '  float edge = max(0.00035, radiusUv * 0.08);',
    '  // The real lower tower is hidden by the Alexanderplatz skyline from this',
    '  // viewpoint. Fade the analytical model into that foreground instead of',
    '  // painting its flared base over the city mesh.',
    '  float skylineReveal = smoothstep(45.0, 65.0, h);',
    '  return skylineReveal * (1.0 - smoothstep(radiusUv - edge, radiusUv + edge, distanceToAxis));',
    '}',
    '',
    '// Frankfurter Tor crown: lower lantern, cornice, domed copper roof and finial.',
    '// The LoD2 blocks remain real geometry; this restores only the curved crown that',
    '// the city mesh necessarily generalises into a flat roof.',
    'float gateCrownMask(vec2 uv, vec2 baseUv, vec2 topUv) {',
    '  vec2 p = vec2((uv.x - baseUv.x) * u_aspect, uv.y - baseUv.y);',
    '  vec2 axis = vec2((topUv.x - baseUv.x) * u_aspect, topUv.y - baseUv.y);',
    '  float axis2 = dot(axis, axis);',
    '  if (axis2 < 0.000001) return 0.0;',
    '  float t = dot(p, axis) / axis2;',
    '  if (t < 0.0 || t > 1.0) return 0.0;',
    '  float radiusRatio;',
    '  if (t < 0.34) radiusRatio = 0.19;',
    '  else if (t < 0.43) radiusRatio = 0.31;',
    '  else if (t < 0.84) {',
    '    float q = (t - 0.43) / 0.41;',
    '    radiusRatio = 0.31 * sqrt(max(0.0, 1.0 - q * q));',
    '  } else radiusRatio = mix(0.045, 0.008, (t - 0.84) / 0.16);',
    '  float distanceToAxis = length(p - axis * t);',
    '  float radiusUv = radiusRatio * sqrt(axis2);',
    '  float edge = max(0.00028, radiusUv * 0.10);',
    '  return 1.0 - smoothstep(radiusUv - edge, radiusUv + edge, distanceToAxis);',
    '}',
    '',
    'float gateMask(vec2 uv) {',
    '  if (u_gateVisible < 0.5) return 0.0;',
    '  return max(',
    '    gateCrownMask(uv, u_gateSouthBaseUv, u_gateSouthTopUv),',
    '    gateCrownMask(uv, u_gateNorthBaseUv, u_gateNorthTopUv)',
    '  );',
    '}',
    '',
    '// Analytical landmarks share the distant city plaster rather than becoming',
    '// darker cut-outs. Their contrast now comes from the real backlit composition.',
    'vec3 landmarkColor(vec3 hazeColor) {',
    '  vec3 distantPlaster = vec3(0.42, 0.39, 0.37);',
    '  return mix(distantPlaster, hazeColor, 0.18);',
    '}',
    '',
    'void main() {',
    '  // Plaster-void haze + grain parameters, baked from build opts.',
    `  float fogStart = ${glslFloat(fogStart)};`,
    `  float fogEnd = ${glslFloat(fogEnd)};`,
    '  vec3 hazeColor = u_haze;',
    `  float grainAmount = ${glslFloat(grainAmount)};`,
    // Horizon-fade band, in units of sin(view elevation): terrain fades to sky over
    // HORIZON_FADE_BELOW..0 (the last few degrees of ground up to the silhouette) and
    // the fade tapers to zero by HORIZON_FADE_ABOVE (tower/building tops stay sharp).
    // Keep the band narrow and partial: it hides the terrain seam without turning
    // the entire boulevard into fog. Tunable — see the horizon-seam note.
    '  float HORIZON_FADE_BELOW = -0.035;',
    '  float HORIZON_FADE_ABOVE = 0.025;',
    '',
    '  vec4 color = texture(colorTexture, v_textureCoordinates);',
    '  float depth = czm_readDepth(depthTexture, v_textureCoordinates);',
    '  vec3 sky = skyColor(v_textureCoordinates, hazeColor);',
    '',
    '  // Fix #3 (revised): background is EXACTLY the cleared depth 1.0. Geometry in',
    '  // this scene always writes < 1.0 under either depth encoding (see the module',
    '  // header), so an exact test — never a 0.9999 epsilon — separates void from city.',
    '  if (depth >= 1.0) {',
    '    // Sky plus the surveyed landmark silhouette. Foreground city geometry has',
    '    // depth < 1 and therefore naturally occludes the screen-space tower.',
    '    vec3 landmark = landmarkColor(hazeColor);',
    '    vec3 result = mix(sky, landmark, towerMask(v_textureCoordinates));',
    '    result = mix(result, landmark, gateMask(v_textureCoordinates));',
    '    out_FragColor = vec4(result, color.a);',
    '    return;',
    '  }',
    '',
    '  // Fix #4: fog from eye-space distance in METERS, not raw [0,1] depth.',
    '  // czm_windowToEyeCoordinates(...).xyz length is in meters, so fogStart',
    '  // / fogEnd are meters of eye-space distance. Geometry fades toward the SKY',
    '  // colour behind it (so a backlit tower gains an atmospheric rim and reads',
    '  // as a silhouette against the bloom rather than washing to flat white).',
    '  vec4 eye = czm_windowToEyeCoordinates(vec4(gl_FragCoord.xy, depth, 1.0));',
    '  float dist = length(eye.xyz);',
    '  float fog = smoothstep(fogStart, fogEnd, dist);',
    '  // Horizon fade (the "horizon seam" fix). The DGM1 globe terrain carries no',
    '  // vertex normals, so it renders at full plaster intensity right up to the globe',
    '  // silhouette and then hard-cuts to sky; at a low eye height the geometric',
    '  // horizon is closer than fogStart, so the distance fog above never softens it.',
    '  // Fade the terrain to sky as the view goes grazing (eye.y/dist -> 0 from below)',
    '  // so the ground dissolves into the haze instead of ending in a hard line. The',
    '  // fade is scoped to a narrow band around the horizon, so steep near-ground and',
    '  // tower/building tops (viewPitch > HORIZON_FADE_ABOVE, above the horizon) keep',
    '  // full intensity and their silhouettes stay sharp.',
    '  float viewPitch = eye.y / dist;',
    '  float horizonFog = smoothstep(HORIZON_FADE_BELOW, 0.0, viewPitch);',
    '  horizonFog *= (1.0 - smoothstep(0.0, HORIZON_FADE_ABOVE, viewPitch));',
    '  fog = max(fog, horizonFog * 0.38);',
    '  // u_sceneTint adds a mild warmth (golden hour) / coolness (night) to the',
    '  // clay geometry — brightness comes from the directional light + image-based',
    '  // ambient against the tiles real per-face normals, so the tint stays near 1.',
    '  // Darken near geometry and let the distant city open toward the haze. This',
    '  // restores the street-canyon depth a telephoto frame needs without textures.',
    '  float depthTone = mix(0.66, 1.0, smoothstep(300.0, 6200.0, dist));',
    '  vec3 plaster = color.rgb * u_sceneTint * depthTone;',
    '  vec3 result = mix(plaster, sky, fog);',
    '  // The landmark is an analytical planning surface, rendered after the coarse',
    '  // LoD2 city mesh so its surveyed silhouette is not lost inside generalized',
    '  // building blocks. The separate line-of-sight verdict still reports occlusion.',
    '  vec3 landmark = landmarkColor(hazeColor);',
    '  result = mix(result, landmark, towerMask(v_textureCoordinates));',
    '  result = mix(result, landmark, gateMask(v_textureCoordinates));',
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
  /** Disc angular radius as a fraction of frame height (UV units, y-axis). */
  sunRadius: number;
  /** Disc tint (palette discTint). */
  discColor: [number, number, number];
  /** Viewport aspect (width/height) — keeps the bloom circular. */
  aspect: number;
  /** Cool sky colour at the top of frame. */
  skyTop: [number, number, number];
  /** Haze/horizon colour. */
  haze: [number, number, number];
  /** Warm sun / cool moon bloom colour. */
  glowColor: [number, number, number];
  /** Bloom intensity. */
  glowStrength: number;
  /** Geometry dim/tint multiplier (1,1,1 = full daylight). */
  sceneTint: [number, number, number];
  /** Landmark base/tip in texture coordinates; used for the exact tower silhouette. */
  towerBaseUv: [number, number];
  towerTopUv: [number, number];
  towerVisible: number;
  gateSouthBaseUv: [number, number];
  gateSouthTopUv: [number, number];
  gateNorthBaseUv: [number, number];
  gateNorthTopUv: [number, number];
  gateVisible: number;
}

/** A neutral default so the stage renders sanely before the app sets real values. */
export function defaultStudioEnvironmentState(): StudioEnvironmentState {
  return {
    sunUv: [0.5, 0.5],
    sunVisible: 0,
    sunRadius: 0.01,
    discColor: [1, 1, 1],
    aspect: 1.6,
    skyTop: [0.8, 0.83, 0.89],
    haze: DEFAULT_HAZE,
    glowColor: [1.0, 0.92, 0.75],
    glowStrength: 0.9,
    sceneTint: [1, 1, 1],
    towerBaseUv: [0.5, 0.25],
    towerTopUv: [0.5, 0.75],
    towerVisible: 0,
    gateSouthBaseUv: [0.45, 0.25],
    gateSouthTopUv: [0.45, 0.3],
    gateNorthBaseUv: [0.55, 0.25],
    gateNorthTopUv: [0.55, 0.3],
    gateVisible: 0,
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
      u_sunRadius: state.sunRadius,
      u_discColor: new Cesium.Cartesian3(state.discColor[0], state.discColor[1], state.discColor[2]),
      u_aspect: state.aspect,
      u_skyTop: new Cesium.Cartesian3(state.skyTop[0], state.skyTop[1], state.skyTop[2]),
      u_haze: new Cesium.Cartesian3(state.haze[0], state.haze[1], state.haze[2]),
      u_glowColor: new Cesium.Cartesian3(
        state.glowColor[0],
        state.glowColor[1],
        state.glowColor[2],
      ),
      u_glowStrength: state.glowStrength,
      u_sceneTint: new Cesium.Cartesian3(state.sceneTint[0], state.sceneTint[1], state.sceneTint[2]),
      u_towerBaseUv: new Cesium.Cartesian2(state.towerBaseUv[0], state.towerBaseUv[1]),
      u_towerTopUv: new Cesium.Cartesian2(state.towerTopUv[0], state.towerTopUv[1]),
      u_towerVisible: state.towerVisible,
      u_gateSouthBaseUv: new Cesium.Cartesian2(
        state.gateSouthBaseUv[0],
        state.gateSouthBaseUv[1],
      ),
      u_gateSouthTopUv: new Cesium.Cartesian2(
        state.gateSouthTopUv[0],
        state.gateSouthTopUv[1],
      ),
      u_gateNorthBaseUv: new Cesium.Cartesian2(
        state.gateNorthBaseUv[0],
        state.gateNorthBaseUv[1],
      ),
      u_gateNorthTopUv: new Cesium.Cartesian2(
        state.gateNorthTopUv[0],
        state.gateNorthTopUv[1],
      ),
      u_gateVisible: state.gateVisible,
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
  stage.uniforms.u_sunRadius = state.sunRadius;
  stage.uniforms.u_discColor = new Cesium.Cartesian3(
    state.discColor[0],
    state.discColor[1],
    state.discColor[2],
  );
  stage.uniforms.u_aspect = state.aspect;
  stage.uniforms.u_skyTop = new Cesium.Cartesian3(
    state.skyTop[0],
    state.skyTop[1],
    state.skyTop[2],
  );
  stage.uniforms.u_haze = new Cesium.Cartesian3(state.haze[0], state.haze[1], state.haze[2]);
  stage.uniforms.u_glowColor = new Cesium.Cartesian3(
    state.glowColor[0],
    state.glowColor[1],
    state.glowColor[2],
  );
  stage.uniforms.u_glowStrength = state.glowStrength;
  stage.uniforms.u_sceneTint = new Cesium.Cartesian3(
    state.sceneTint[0],
    state.sceneTint[1],
    state.sceneTint[2],
  );
  stage.uniforms.u_towerBaseUv = new Cesium.Cartesian2(
    state.towerBaseUv[0],
    state.towerBaseUv[1],
  );
  stage.uniforms.u_towerTopUv = new Cesium.Cartesian2(
    state.towerTopUv[0],
    state.towerTopUv[1],
  );
  stage.uniforms.u_towerVisible = state.towerVisible;
  stage.uniforms.u_gateSouthBaseUv = new Cesium.Cartesian2(
    state.gateSouthBaseUv[0],
    state.gateSouthBaseUv[1],
  );
  stage.uniforms.u_gateSouthTopUv = new Cesium.Cartesian2(
    state.gateSouthTopUv[0],
    state.gateSouthTopUv[1],
  );
  stage.uniforms.u_gateNorthBaseUv = new Cesium.Cartesian2(
    state.gateNorthBaseUv[0],
    state.gateNorthBaseUv[1],
  );
  stage.uniforms.u_gateNorthTopUv = new Cesium.Cartesian2(
    state.gateNorthTopUv[0],
    state.gateNorthTopUv[1],
  );
  stage.uniforms.u_gateVisible = state.gateVisible;
}
