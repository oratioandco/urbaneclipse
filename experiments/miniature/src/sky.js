/**
 * The sky seen from street level: a dome that meets the haze at the horizon, the sun at its
 * true size with a glow, and the moon lit from the sun's actual direction, so its phase is right.
 */
import * as THREE from 'three';

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
        uniform float uGlow, uMoonLight, uFade;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 colour = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, d.y));
          float sunAngle = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
          colour += uGlowColour * uGlow * (exp(-sunAngle * 9.0) * 0.45 + exp(-sunAngle * 70.0) * 0.9);
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
