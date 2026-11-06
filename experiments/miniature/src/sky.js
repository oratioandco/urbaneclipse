/**
 * The sky seen from street level: a dome that meets the haze at the horizon, the sun at its
 * true size with a glow, and the moon lit from the sun's actual direction, so its phase is right.
 */
import * as THREE from 'three';
import { CLOUD_GLSL } from './shading.js';

const SUN_RADIUS = 0.00465;
const MOON_RADIUS = 0.0045;

export const skyUniforms = {
  uHorizon: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColour: { value: new THREE.Color() },
  uGlowColour: { value: new THREE.Color() },
  uGlow: { value: 0 },
  uMoonLight: { value: 1 },
  uFade: { value: 0 },
  /** 0 to 1: how much of a corona shows round whatever covers the sun. */
  uCorona: { value: 0 },
  /** The angular radius of what covers it, radians. */
  uCoronaR: { value: 0.01 },
  /** Forecast cloud cover in three layers, 0 to 1. */
  uCloudLow: { value: 0 },
  uCloudMid: { value: 0 },
  uCloudHigh: { value: 0 },
  uCloudShift: { value: new THREE.Vector2() },
};

export function makeSky() {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(20_000, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon, uZenith, uSunDir, uMoonDir, uSunColour, uGlowColour;
        uniform float uGlow, uMoonLight, uFade, uCorona, uCoronaR;
        ${CLOUD_GLSL}
        // A deck seen from the camera: where this direction meets the deck's height, in world metres.
        float deck(vec3 d, float height, vec2 scale, float cover) {
          if (cover <= 0.01 || d.y <= 0.0) return 0.0;
          vec2 world = cameraPosition.xz + d.xz / max(d.y, 0.03) * max(height - cameraPosition.y, 50.0);
          return cloudMask(world, scale, cover) * smoothstep(0.0, 0.08, d.y);
        }
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 colour = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, d.y));
          float sunAngle = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
          colour += uGlowColour * uGlow * (1.0 - uCorona) * (exp(-sunAngle * 9.0) * 0.45 + exp(-sunAngle * 70.0) * 0.9);
          if (uCorona > 0.0) {
            // A corona, as in a total eclipse: a pearly ring hugging the cover's edge, and
            // softer streamers reaching out unevenly round it. Whatever stands in front hides
            // the middle, since this sky is drawn behind the city.
            vec3 side = normalize(cross(abs(uSunDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), uSunDir));
            vec3 lift = cross(uSunDir, side);
            vec3 off = d - uSunDir * dot(d, uSunDir);
            float around = atan(dot(off, lift), dot(off, side));
            float streamers = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(around * 5.0 + 1.3), 2.0) * (0.6 + 0.4 * sin(around * 11.0 + 0.4));
            float beyond = max(sunAngle - uCoronaR * 0.96, 0.0) / max(uCoronaR, 0.002);
            float ring = exp(-beyond * 6.0);
            float rays = exp(-beyond * 1.1) * streamers;
            colour += vec3(1.0, 0.97, 0.92) * uCorona * (ring * 2.2 + rays * 0.9) * step(uCoronaR * 0.85, sunAngle);
          }
          float sunDisc = 1.0 - smoothstep(${SUN_RADIUS * 0.8}, ${SUN_RADIUS}, sunAngle);
          colour = mix(colour, uSunColour * 24.0, sunDisc * step(-0.004, uSunDir.y));
          // Treat the moon's disc as a sphere and light it from the sun's direction.
          float moonCos = dot(d, uMoonDir);
          float moonAngle = acos(clamp(moonCos, -1.0, 1.0));
          if (moonAngle < ${MOON_RADIUS}) {
            vec3 across = (d - uMoonDir * moonCos) / sin(${MOON_RADIUS});
            vec3 normal = across - uMoonDir * sqrt(max(0.0, 1.0 - dot(across, across)));
            float lit = smoothstep(-0.03, 0.05, dot(normal, uSunDir));
            float edge = 1.0 - smoothstep(${MOON_RADIUS * 0.85}, ${MOON_RADIUS}, moonAngle);
            colour += vec3(0.95, 0.96, 1.0) * uMoonLight * lit * edge;
          }
          // Forecast clouds, high to low. Toward a low sun their undersides catch its colour.
          float toSun = max(dot(d, uSunDir), 0.0);
          float sunLow = smoothstep(14.0, -2.0, degrees(asin(clamp(uSunDir.y, -1.0, 1.0)))) * step(-0.12, uSunDir.y);
          // Clouds are grey, as bright as the sky around them; a low sun tints them from its side.
          float skyLight = dot(mix(uZenith, uHorizon, 0.5), vec3(0.3333));
          vec3 grey = vec3(skyLight);
          vec3 warm = uGlowColour * (0.9 + skyLight);
          float high = deck(d, HIGH_DECK_M, HIGH_SCALE, uCloudHigh) * 0.45;
          vec3 highColour = mix(grey * 1.25 + 0.05, warm * 1.3, sunLow * (0.5 + 0.5 * pow(toSun, 2.0)));
          colour = mix(colour, highColour, high);
          float mid = deck(d, MID_DECK_M, MID_SCALE, uCloudMid) * 0.85;
          vec3 midColour = mix(grey * 1.05, warm, sunLow * (0.2 + 0.6 * pow(toSun, 3.0)));
          colour = mix(colour, midColour, mid);
          float low = deck(d, LOW_DECK_M, LOW_SCALE, uCloudLow);
          vec3 belly = mix(grey * 0.78, warm * 0.85, sunLow * 0.6 * pow(toSun, 4.0));
          colour = mix(colour, belly, low * 0.94);
          // Below the horizon the city's ground hides the sky; keep it the haze's colour.
          colour = mix(uHorizon, colour, smoothstep(-0.01, 0.0, d.y));
          // Drawn first and opaque, so the city covers it; from above it fades into the plain haze.
          gl_FragColor = vec4(mix(uHorizon, colour, uFade), 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.visible = false;
  return dome;
}
