/**
 * The city's lights, added to the Lambert materials. Street light comes from a painted map of
 * the roads, blurred, so ground and nearby walls pick it up without any real light sources.
 * Windows are procedural, and fade to their average brightness once too small to resolve.
 */
import * as THREE from 'three';

export const CUTS = 7;

export const cityUniforms = {
  uMap: { value: null },
  uTerrain: { value: null },
  uHalf: { value: 9400 },
  uLights: { value: 0 },
  uWindows: { value: 0 },
  uMirror: { value: null },
  uMirrorVP: { value: new THREE.Matrix4() },
  uMirrorOn: { value: 0 },
  uWaterLevel: { value: -3 },
  uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
  uKeyLight: { value: new THREE.Color() },
  uSkyLight: { value: new THREE.Color() },
  uHazeColour: { value: new THREE.Color() },
  uHazeFocus: { value: new THREE.Vector2() },
  uHazeNear: { value: 1000 },
  uHazeFar: { value: 4000 },
  /** Brightness of the paved ground: lowered in low sun so the buildings stand off it. */
  uGroundTone: { value: 1 },
  uCloudLow: { value: 0 },
  uCloudMid: { value: 0 },
  uCloudHigh: { value: 0 },
  uCloudShift: { value: new THREE.Vector2() },
  /** Toward the sun, for where a cloud's shadow falls. */
  uCloudSun: { value: new THREE.Vector3(0, 1, 0) },
  /**
   * Where a modelled landmark replaces the LoD2 roof: x, z, half size and the height above which
   * the buildings are cut, then the square's rotation as cos and sin. See landmarks.js.
   */
  uCuts: { value: Array.from({ length: CUTS }, () => new THREE.Vector4(0, 0, 0, 1e9)) },
  uCutTurns: { value: Array.from({ length: CUTS }, () => new THREE.Vector2(1, 0)) },
};

export const CLOUD_GLSL = /* glsl */ `
// The forecast's clouds as one field over the city, shared by the sky and the light on the
// ground, so a cloud overhead and its shadow agree. Decks at fixed heights; noise in world
// metres, drifting with the wind.
uniform float uCloudLow, uCloudMid, uCloudHigh;
uniform vec2 uCloudShift;
float cHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float cNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * cNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
/** Cloud at a point of a deck, 0 to 1. The noise sits near 0.5, so this covers about the forecast share. */
float cloudMask(vec2 world, vec2 scale, float cover) {
  if (cover <= 0.01) return 0.0;
  float n = cFbm((world + uCloudShift) / scale);
  float threshold = 0.5 + (0.5 - cover) * 0.55;
  return smoothstep(threshold - 0.05, threshold + 0.07, n);
}
const float LOW_DECK_M = 1500.0;
const float MID_DECK_M = 3500.0;
const float HIGH_DECK_M = 8000.0;
const vec2 LOW_SCALE = vec2(1800.0);
const vec2 MID_SCALE = vec2(3200.0);
const vec2 HIGH_SCALE = vec2(6000.0, 1700.0);
`;

const WARM = 'vec3(1.0, 0.62, 0.3)';

const sharedFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uTerrain;
  uniform float uHalf, uLights, uWindows;
  varying vec3 vWorldP;
  varying vec3 vRel;
  uniform sampler2D uMirror;
  uniform mat4 uMirrorVP;
  uniform float uMirrorOn, uWaterLevel;
  uniform vec3 uKeyDir, uKeyLight, uSkyLight, uHazeColour;
  uniform float uGroundTone;
  uniform vec3 uCloudSun;
  uniform vec4 uCuts[${CUTS}];
  uniform vec2 uCutTurns[${CUTS}];
  ${CLOUD_GLSL}
  /** How much sunlight reaches a point through the clouds above it, toward the sun. */
  float cloudPass(vec3 p) {
    if (uCloudLow + uCloudMid + uCloudHigh <= 0.01) return 1.0;
    vec2 toward = uCloudSun.xz / max(uCloudSun.y, 0.05);
    float low = cloudMask(p.xz + toward * (LOW_DECK_M - p.y), LOW_SCALE, uCloudLow);
    float mid = cloudMask(p.xz + toward * (MID_DECK_M - p.y), MID_SCALE, uCloudMid);
    return (1.0 - 0.85 * low) * (1.0 - 0.55 * mid) * (1.0 - 0.2 * uCloudHigh);
  }
  uniform vec2 uHazeFocus;
  uniform float uHazeNear, uHazeFar;
  // Air thickening away from the middle of the view, and the model's edge dissolving into it.
  vec3 hazed(vec3 colour, vec3 world) {
    float view = smoothstep(uHazeNear, uHazeFar, length(world.xz - uHazeFocus)) * 0.88;
    float edge = smoothstep(uHalf - 1500.0, uHalf - 60.0, max(abs(world.x), abs(world.z)));
    return mix(colour, uHazeColour, max(view, edge));
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

function inject(material, name, edit) {
  // Three.js caches programs by this function's source, which is the same for all of them.
  material.customProgramCacheKey = () => name;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nvarying vec3 vRel;')
      // Relative to the camera as well: small numbers, so their screen derivatives stay precise.
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 placed = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        placed = instanceMatrix * placed;
        #endif
        vWorldP = (modelMatrix * placed).xyz;
        vRel = vWorldP - cameraPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${sharedFragment}`);
    edit(shader);
  };
  return material;
}

export function shadeGround(material) {
  return inject(material, 'city-ground', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directDiffuse *= cloudPass(vWorldP);')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 groundMap = texture2D(uMap, vWorldP.xz / (2.0 * uHalf) + 0.5).rgb;
        float isWater = smoothstep(0.42, 0.58, groundMap.g);
        float isGreen = smoothstep(0.42, 0.58, groundMap.b);
        // Mottled at two scales, like grass under trees, fading out before it can shimmer.
        float mottle = noise(vWorldP.xz * 0.07) * 0.6 + noise(vWorldP.xz * 0.019) * 0.4;
        vec3 green = mix(vec3(0.15, 0.31, 0.09), vec3(0.3, 0.46, 0.15), mottle);
        diffuseColor.rgb = mix(diffuseColor.rgb, green, isGreen * (1.0 - isWater));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.13, 0.19), isWater);`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `outgoingLight += uLights * ${WARM} * pow(groundMap.r, 2.6) * 0.8 * (1.0 - isWater);
        if (isWater > 0.0) {
          vec3 toEye = normalize(cameraPosition - vWorldP);
          vec2 ripple = vec2(noise(vWorldP.xz * 0.11) + 0.5 * noise(vWorldP.xz * 0.37), noise(vWorldP.xz * 0.11 + 37.0) + 0.5 * noise(vWorldP.xz * 0.37 + 11.0)) - 0.75;
          vec3 up = normalize(vec3(ripple.x * 0.09, 1.0, ripple.y * 0.09));
          float facing = max(dot(up, toEye), 0.0);
          // More mirror-like than real water seen from above, so the river reads in steep views.
          float fresnel = 0.3 + 0.7 * pow(1.0 - facing, 3.0);
          vec3 sky = uSkyLight;
          if (uMirrorOn > 0.5) {
            vec4 clip = uMirrorVP * vec4(vWorldP.x, uWaterLevel, vWorldP.z, 1.0);
            sky = texture2D(uMirror, clip.xy / clip.w * 0.5 + 0.5 + ripple * vec2(0.006, 0.012)).rgb;
          }
          vec3 glint = uKeyLight * pow(max(dot(up, normalize(uKeyDir + toEye)), 0.0), 260.0) * 2.5;
          outgoingLight = mix(outgoingLight, mix(outgoingLight, sky, fresnel) + glint, isWater);
        }
        outgoingLight = hazed(outgoingLight, vWorldP);
        #include <opaque_fragment>`,
      );
  });
}

/**
 * The buildings' light at night. With windows false, for modelled landmarks: no window grid,
 * and no cuts, since those only remove the LoD2 roofs a landmark replaces. A landmark may pass
 * its own program name, so a second material (the gilded figures) can share the same lighting.
 */
export function shadeBuildings(material, { windows = true, cuts = true, name } = {}) {
  return inject(material, name ?? (windows ? 'city-buildings' : 'city-landmarks'), (shader) => {
    if (windows && cuts) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
        for (int i = 0; i < ${CUTS}; i++) {
          vec2 d = vWorldP.xz - uCuts[i].xy;
          d = vec2(d.x * uCutTurns[i].x + d.y * uCutTurns[i].y, d.y * uCutTurns[i].x - d.x * uCutTurns[i].y);
          if (vWorldP.y > uCuts[i].w && max(abs(d.x), abs(d.y)) < uCuts[i].z) discard;
        }`,
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directDiffuse *= cloudPass(vWorldP);').replace(
      '#include <opaque_fragment>',
      /* glsl */ `{
        vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
        vec2 uv = vWorldP.xz / (2.0 * uHalf) + 0.5;
        float street = texture2D(uMap, uv).r;
        float height = max(vWorldP.y - texture2D(uTerrain, uv).r, 0.0);
        float wall = 1.0 - smoothstep(0.3, 0.55, abs(worldNormal.y));
        // Light from the street reaches up the facades, and a little of it onto the roofs.
        vec3 cityLight = ${WARM} * uLights * mix(0.012 + 0.08 * street, street * (0.02 + 0.5 * exp(-height / 11.0)), wall);
        if (${windows ? 'true' : 'false'} && wall > 0.0 && uWindows > 0.001) {
          // The wall's direction, steady across the whole wall: from camera-relative positions,
          // whose derivatives are precise, and snapped to whole degrees. Taken from the large
          // world coordinates, it jittered per pixel and the window grid with it.
          vec3 face = normalize(cross(dFdx(vRel), dFdy(vRel)));
          float angle = atan(face.z, face.x);
          angle = floor(angle / 0.017453 + 0.5) * 0.017453;
          vec2 facing = vec2(cos(angle), sin(angle));
          vec2 along = vec2(-facing.y, facing.x);
          vec2 fine = vec2(dot(vWorldP.xz, along) / 3.7, height / 3.3);
          // Further away, windows merge into larger lit patches rather than dissolving into a
          // flat tone, so the city keeps its sparkle at every zoom.
          float scale = pow(2.0, ceil(log2(max(max(fwidth(fine).x, fwidth(fine).y) * 3.2, 1.0))));
          vec2 cell = fine / scale;
          vec2 id = floor(cell);
          vec2 f = fract(cell) - 0.5;
          vec2 blur = max(fwidth(cell), vec2(1e-4));
          float seed = hash21(id + floor(dot(vWorldP.xz, facing) / 3.0 + 0.5) * 0.137);
          float pane = smoothstep(0.27 + blur.x, 0.27 - blur.x, abs(f.x)) * smoothstep(0.3 + blur.y, 0.3 - blur.y, abs(f.y));
          float shade = hash21(id.yx + 7.3);
          vec3 tint = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.8, 0.55), shade);
          cityLight += wall * tint * pane * step(seed, uWindows) * step(0.5, id.y + 0.5) * (0.75 + 1.1 * shade);
        }
        outgoingLight = hazed(outgoingLight + cityLight, vWorldP);
      }
      #include <opaque_fragment>`,
    );
  });
}

/** Trees: clouds and haze like the buildings, and no windows. */
export function shadeFoliage(material) {
  return inject(material, 'city-foliage', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directDiffuse *= cloudPass(vWorldP);')
      .replace('#include <opaque_fragment>', 'outgoingLight = hazed(outgoingLight, vWorldP);\n#include <opaque_fragment>');
  });
}

/**
 * The tower's light. At night only the row of windows in the sphere is lit; the red lights are
 * separate points. Up close the sphere reads as what it is — steel panels with bands of glass:
 * panel seams fade in with zoom, and before they could shimmer they are gone; the glass darkens
 * towards the sky it faces and catches the sun as a glint.
 */
export function shadeTower(material) {
  return inject(material, 'city-tower', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `{
        float y = vWorldP.y;
        float row = smoothstep(202.6, 203.2, y) * (1.0 - smoothstep(208.0, 208.6, y));
        float pane = smoothstep(0.1, 0.2, abs(fract(atan(vWorldP.x, vWorldP.z) * 15.28) - 0.5));
        vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
        vec3 toEye = normalize(cameraPosition - vWorldP);
        // Panel seams on the sphere only: meridians and rings, dropping out as they get thin.
        float onSphere = 1.0 - smoothstep(16.5, 17.6, length(vWorldP - vec3(0.0, 213.0, 0.0)));
        vec2 fine = vec2(atan(vWorldP.x, vWorldP.z) * 5.73, y / 4.5);
        vec2 fw = fwidth(fine);
        float fade = 1.0 - smoothstep(0.3, 0.7, max(fw.x, fw.y));
        vec2 f = abs(fract(fine) - 0.5);
        float seam = max(smoothstep(0.5 - fw.x * 1.4, 0.5, f.x), smoothstep(0.5 - fw.y * 1.4, 0.5, f.y)) * fade * onSphere;
        // The sphere's glass bands, in metres: the lower gallery and the observation deck.
        float glass = smoothstep(197.2, 198.0, y) * (1.0 - smoothstep(201.2, 202.0, y));
        glass = max(glass, smoothstep(212.4, 213.2, y) * (1.0 - smoothstep(217.6, 218.4, y)));
        glass = max(glass, row);
        // What the glass faces: the sky, and the sun as a glint on the surface.
        vec3 dir = reflect(-toEye, normalize(worldNormal));
        vec3 reflection = uSkyLight * (0.55 + 0.45 * dir.y) + uKeyLight * pow(max(dot(dir, normalize(uKeyDir)), 0.0), 90.0) * 2.5;
        float shine = clamp(glass * 0.6 + onSphere * 0.1, 0.0, 0.85);
        outgoingLight = mix(outgoingLight, reflection, shine);
        outgoingLight -= outgoingLight * seam * 0.14;
        outgoingLight += uLights * vec3(1.0, 0.8, 0.5) * row * (0.5 + 1.5 * pane);
        outgoingLight = hazed(outgoingLight, vWorldP);
      }
      #include <opaque_fragment>`,
    );
  });
}

/**
 * Stands in for the ground in the water's mirror view: solid banks that hide what could not be
 * seen in the reflection, with holes where the water is for the view to look out through.
 */
export const mirrorGround = new THREE.ShaderMaterial({
  uniforms: cityUniforms,
  side: THREE.DoubleSide,
  vertexShader: 'varying vec2 vPlace; void main() { vPlace = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D uMap;
    uniform float uHalf;
    uniform vec3 uSkyLight;
    varying vec2 vPlace;
    void main() {
      if (texture2D(uMap, vPlace / (2.0 * uHalf) + 0.5).g > 0.5) discard;
      gl_FragColor = vec4(uSkyLight * 0.35, 1.0);
    }`,
});

export function makeTerrainTexture(heights, size) {
  const data = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) data[i] = THREE.DataUtils.toHalfFloat(heights[i] / 10);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
