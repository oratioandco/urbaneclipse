/**
 * The map drawn into the scene: the ground map, and lit-up street alignments. Ribbons blend as
 * (emission + background * alpha), so light covers like paint by day and adds up at night.
 */
import * as THREE from 'three';

const SUBDIVIDE_M = 40;
/** Sun rays stand no taller than this over a street, metres. */
const MAX_RAY_HEIGHT_M = 130;

const blend = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.SrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

export const ribbonUniforms = { uViewportH: { value: 1 }, uDay: { value: 1 } };

const rayVertex = /* glsl */ `
  attribute vec2 aAcross;
  attribute float aSide;
  attribute float aAlong;
  attribute float aHeight;
  attribute float aSeed;
  attribute vec3 aColour;
  uniform float uViewportH;
  varying float vSide;
  varying float vAlong;
  varying float vStanding;
  varying float vSeed;
  varying vec3 vColour;
  const float POOL_HALF_M = 46.0;
  const float POOL_MIN_PX = 30.0;
  void main() {
    vec3 world = position;
    if (aHeight > 0.0) {
      world.y += (aSide * 0.5 + 0.5) * aHeight;
    } else {
      vec4 view = viewMatrix * vec4(position, 1.0);
      float depth = projectionMatrix[3][3] == 1.0 ? 1.0 : -view.z;
      float metresPerPixel = 2.0 * depth / (projectionMatrix[1][1] * uViewportH);
      world += vec3(aAcross.x, 0.0, aAcross.y) * aSide * max(POOL_HALF_M, POOL_MIN_PX * metresPerPixel);
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vSide = aSide;
    vAlong = aAlong;
    vStanding = aHeight > 0.0 ? 1.0 : 0.0;
    vSeed = aSeed;
    vColour = aColour;
  }
`;

const rayFragment = (strength) => /* glsl */ `
  uniform float uDay;
  varying float vSide;
  varying float vAlong;
  varying float vStanding;
  varying float vSeed;
  varying vec3 vColour;
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    // Shafts run the length of the street, breaking up slowly along it.
    float shafts = noise(vec2(vSide * 5.0 + vSeed, vAlong * 2.5 + vSeed)) * 0.65 + noise(vec2(vSide * 13.0 + vSeed, vAlong * 5.0)) * 0.35;
    shafts = smoothstep(0.25, 0.72, shafts);
    // Strongest toward the sun's end, thinning out where the light has travelled furthest.
    float along = smoothstep(0.0, 0.2, vAlong) * (1.0 - smoothstep(0.97, 1.0, vAlong)) * (0.34 + 0.66 * pow(clamp(vAlong, 0.0, 1.0), 0.7));
    float d = abs(vSide);
    float pool = exp(-d * d * 3.6) * (1.0 - smoothstep(0.82, 1.0, d)) * (0.5 + 0.5 * shafts) * 0.78;
    float height = clamp(vSide * 0.5 + 0.5, 0.0, 1.0);
    float air = pow(1.0 - height, 1.35) * (0.32 + 0.68 * shafts) * 0.42;
    float light = mix(pool, air, vStanding) * along * ${strength};
    gl_FragColor = vec4(vColour * light * mix(1.5, 1.0, uDay), 1.0 - light * uDay);
  }
`;

const rayOptions = { ...blend, side: THREE.DoubleSide, uniforms: ribbonUniforms, vertexShader: rayVertex };
const rays = new THREE.ShaderMaterial({ ...rayOptions, fragmentShader: rayFragment('1.0') });
// Faintly through buildings, so a street stays traceable in the angled views.
const raysGhost = new THREE.ShaderMaterial({ ...rayOptions, depthTest: false, fragmentShader: rayFragment('0.2') });

/** A pool of light on the street, and a curtain of lit air rising along its middle. */
function rayGeometry(lines, groundAt) {
  const positions = [];
  const across = [];
  const sides = [];
  const alongs = [];
  const heights = [];
  const seeds = [];
  const colours = [];
  const indices = [];
  lines.forEach(({ a, b, colour, altitude }, lineIndex) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    const steps = Math.max(2, Math.ceil(length / SUBDIVIDE_M));
    const slope = Math.tan((Math.max(altitude, 0.5) * Math.PI) / 180);
    for (const standing of [false, true]) {
      const first = positions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a[0] + dx * t;
        const z = a[1] + dz * t;
        const height = standing ? Math.min(MAX_RAY_HEIGHT_M, 16 + length * t * slope) : 0;
        for (const side of [-1, 1]) {
          positions.push(x, groundAt(x, z) + 1.6, z);
          across.push(-dz / length, dx / length);
          sides.push(side);
          alongs.push(t);
          heights.push(height);
          seeds.push(lineIndex * 3.7);
          colours.push(colour[0], colour[1], colour[2]);
        }
        if (i > 0) {
          const v = first + i * 2;
          indices.push(v - 2, v - 1, v, v - 1, v + 1, v);
        }
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 2));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(alongs, 1));
  geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute('aColour', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  return geometry;
}

export function makeHighlights(scene, groundAt) {
  const group = new THREE.Group();
  scene.add(group);
  let meshes = [];
  return {
    group,
    /** @param lines [{ a: [x, z], b: [x, z] toward the body, colour, altitude }] */
    set(lines) {
      for (const mesh of meshes) group.remove(mesh);
      meshes[0]?.geometry.dispose();
      meshes = [];
      if (lines.length === 0) return;
      const geometry = rayGeometry(lines, groundAt);
      const solid = new THREE.Mesh(geometry, rays);
      const ghost = new THREE.Mesh(geometry, raysGhost);
      solid.renderOrder = 3;
      ghost.renderOrder = 2;
      solid.frustumCulled = ghost.frustumCulled = false;
      meshes = [solid, ghost];
      group.add(solid, ghost);
    },
  };
}

/** Paint water, parks and blurred street light into one texture covering the whole model. */
export function paintGroundMap(map, runs, packed, half, size, renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  const scale = size / (2 * half);
  const pixel = (v) => (v + half) * scale;

  const fillAreas = (elements, colour) => {
    ctx.fillStyle = colour;
    for (const rings of elements) {
      const path = new Path2D();
      for (const ring of rings) {
        path.moveTo(pixel(ring[0]), pixel(ring[1]));
        for (let i = 2; i < ring.length; i += 2) path.lineTo(pixel(ring[i]), pixel(ring[i + 1]));
        path.closePath();
      }
      ctx.fill(path, 'evenodd');
    }
  };
  fillAreas(map.green, '#0000ff');
  fillAreas(map.water, '#00ff00');

  const levels = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  let at = 0;
  for (const [count, level] of runs) {
    const path = levels[level];
    path.moveTo(pixel(packed[at] / 2), pixel(packed[at + 1] / 2));
    for (let i = 1; i < count; i++) path.lineTo(pixel(packed[at + i * 2] / 2), pixel(packed[at + i * 2 + 1] / 2));
    at += count * 2;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Widening strokes of falling strength stand in for a blur, which Safari's canvas lacks.
  const brightness = [1, 0.85, 0.7, 0.55];
  levels.forEach((path, level) => {
    for (const [metres, alpha] of [[110, 0.05], [62, 0.07], [36, 0.12], [20, 0.2], [10, 0.28]]) {
      ctx.lineWidth = Math.max(1, metres * scale * (level === 0 ? 1.25 : 1));
      ctx.strokeStyle = `rgba(255,0,0,${alpha * brightness[level]})`;
      ctx.stroke(path);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}
