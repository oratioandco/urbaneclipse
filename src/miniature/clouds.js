/**
 * The forecast's clouds, seen from above in the map: three soft decks floating over the model.
 * They are the same noise field the shadows on the ground and the street-level sky use
 * (CLOUD_GLSL), so a cloud and its shadow agree. The real decks are kilometres up, above the map
 * camera, so each is drawn lower, at a map height, and sampled where the sun's ray through the
 * drawn point meets the real deck: the shadow then falls straight under the drawn cloud's ray.
 *
 * They fade as the camera comes down toward them, and are gone at street level, where the sky
 * dome shows the clouds instead.
 */
import * as THREE from 'three';
import { scene } from './render.js';
import { CLOUD_GLSL, cityUniforms } from './shading.js';

/** Drawn height, the real deck it shows, its strength, and its sharpest opacity. */
const DECKS = [
  { height: 420, deck: 'LOW_DECK_M', scale: 'LOW_SCALE', cover: 'uCloudLow', opacity: 1 },
  { height: 600, deck: 'MID_DECK_M', scale: 'MID_SCALE', cover: 'uCloudMid', opacity: 0.8 },
  { height: 820, deck: 'HIGH_DECK_M', scale: 'HIGH_SCALE', cover: 'uCloudHigh', opacity: 0.45 },
];

const meshes = DECKS.map((d, i) => {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...cityUniforms, uFade: { value: 0 }, uHeight: { value: d.height } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldP;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldP = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      ${CLOUD_GLSL}
      uniform vec3 uCloudSun, uHazeColour;
      uniform float uHalf, uLights, uFade, uHeight;
      varying vec3 vWorldP;
      void main() {
        vec2 toward = uCloudSun.xz / max(uCloudSun.y, 0.05);
        toward *= min(1.0, 3.0 / max(length(toward), 1e-4));
        vec2 at = vWorldP.xz + toward * (${d.deck} - uHeight);
        // The same field and threshold as cloudMask, with a crisper edge for the eye, and a
        // thickness that makes the cores dense and bright.
        float cover = ${d.cover};
        if (cover <= 0.01) discard;
        vec2 scale = ${d.scale};
        float n = cFbm((at + uCloudShift) / scale);
        float threshold = 0.5 + (0.5 - cover) * 0.55;
        float body = smoothstep(threshold - 0.015, threshold + 0.05, n);
        if (body < 0.01) discard;
        float thick = smoothstep(threshold, threshold + 0.16, n);
        // Puffed up by the field's slope toward the sun: lit on that side, shaded on the other.
        vec2 sunward = normalize(uCloudSun.xz + 1e-4) * scale.x * 0.03;
        float slope = cFbm((at + sunward + uCloudShift) / scale) - cFbm((at - sunward + uCloudShift) / scale);
        // Seen from above, cloud tops are bright: white by day, warm in low sun, slate at night.
        float day = smoothstep(-0.12, 0.2, uCloudSun.y);
        float warmth = (1.0 - smoothstep(0.05, 0.4, uCloudSun.y)) * day;
        vec3 top = mix(vec3(0.17, 0.19, 0.26), vec3(1.0), day);
        top = mix(top, top * vec3(1.0, 0.86, 0.72), warmth * 0.6);
        float shade = clamp(0.8 + 4.0 * slope + 0.2 * thick, 0.6, 1.1);
        vec3 colour = top * shade + vec3(1.0, 0.62, 0.3) * uLights * ${i === 0 ? '0.08' : '0.03'};
        float cloud = body * mix(0.5, 0.94, thick);
        float edge = 1.0 - smoothstep(uHalf - 2500.0, uHalf - 200.0, max(abs(vWorldP.x), abs(vWorldP.z)));
        colour = mix(colour, uHazeColour, 0.08);
        gl_FragColor = vec4(colour, cloud * ${d.opacity.toFixed(2)} * uFade * edge);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material);
  mesh.position.y = d.height;
  mesh.renderOrder = 10 + i;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
});

/**
 * Each drawn frame: shows the decks with cloud in them, faded by how far the camera is above
 * each and by how far into the street it has come.
 */
export function updateClouds({ on, camera, street }) {
  const half = cityUniforms.uHalf.value;
  DECKS.forEach((d, i) => {
    const mesh = meshes[i];
    const fade = on ? THREE.MathUtils.smoothstep(camera.position.y, d.height + 150, d.height + 900) * (1 - street) : 0;
    mesh.visible = fade > 0.01 && cityUniforms[d.cover].value > 0.01;
    mesh.material.uniforms.uFade.value = fade;
    mesh.scale.set(half, 1, half);
  });
}
