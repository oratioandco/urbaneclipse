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

export const ribbonUniforms = { uViewportH: { value: 1 }, uDay: { value: 1 }, uBeams: { value: 1 } };

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
  lines.forEach(({ a, b, colour, altitude, strength = 1 }, lineIndex) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    const steps = Math.max(2, Math.ceil(length / SUBDIVIDE_M));
    const slope = Math.tan((Math.max(altitude, 0.5) * Math.PI) / 180);
    for (const standing of [false]) {
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
          colours.push(colour[0] * strength, colour[1] * strength, colour[2] * strength);
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

// ---- Rays from the sun or moon -----------------------------------------------------------
// Real light down a lined-up street runs nearly level, since the body is only a few degrees
// up. On the map, one beam per street instead comes down from a single bright point far out
// in the body's direction, so all of them meet where the sun or moon lies, as sunbeams through
// clouds appear to. Like the direction pills, they say where the light comes from.
const SOURCE_DISTANCE_M = 12000;
const SOURCE_ELEVATION_DEG = 14;

const beamVertex = /* glsl */ `
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute float aU;
  attribute float aSide;
  attribute vec2 aWidth;
  attribute float aSeed;
  attribute vec3 aColour;
  varying float vU;
  varying float vSide;
  varying float vSeed;
  varying vec3 vColour;
  void main() {
    vec3 at = mix(aFrom, aTo, aU);
    vec3 axis = normalize(aTo - aFrom);
    // A flat strip turned about its own axis to face the camera, so it reads as a beam of light.
    vec3 across = normalize(cross(axis, cameraPosition - at) + vec3(1e-4, 0.0, 0.0));
    vec3 world = at + across * aSide * mix(aWidth.x, aWidth.y, aU);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vU = aU;
    vSide = aSide;
    vSeed = aSeed;
    vColour = aColour;
  }
`;

const beamFragment = (strength) => /* glsl */ `
  uniform float uDay;
  uniform float uBeams;
  varying float vU;
  varying float vSide;
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
    float core = exp(-vSide * vSide * 2.6);
    // Faint streaks along the beam, the way light catches in haze.
    float streaks = 0.7 + 0.3 * noise(vec2(vSide * 4.0 + vSeed, vU * 18.0 + vSeed));
    // Thin near the source, gathering strength as it comes down over the city.
    float along = smoothstep(0.0, 0.6, vU) * (1.0 - smoothstep(0.96, 1.0, vU) * 0.4);
    float light = core * streaks * along * ${strength} * uBeams;
    gl_FragColor = vec4(vColour * light * mix(1.6, 1.0, uDay), 1.0 - light * uDay * 0.9);
  }
`;

const beamOptions = { ...blend, side: THREE.DoubleSide, uniforms: ribbonUniforms, vertexShader: beamVertex };
const beams = new THREE.ShaderMaterial({ ...beamOptions, fragmentShader: beamFragment('0.6') });
const beamsGhost = new THREE.ShaderMaterial({ ...beamOptions, depthTest: false, fragmentShader: beamFragment('0.12') });

const gapVertex = /* glsl */ `
  attribute vec3 aColour;
  attribute vec2 aCorner;
  attribute float aSize;
  varying vec2 vCorner;
  varying vec3 vColour;
  void main() {
    vec4 view = viewMatrix * vec4(position, 1.0);
    view.xy += aCorner * aSize;
    gl_Position = projectionMatrix * view;
    vCorner = aCorner;
    vColour = aColour;
  }
`;
const gapFragment = /* glsl */ `
  uniform float uDay;
  uniform float uBeams;
  varying vec2 vCorner;
  varying vec3 vColour;
  void main() {
    float r = length(vCorner);
    float light = (exp(-r * r * 14.0) * 0.9 + exp(-r * r * 3.0) * 0.3) * uBeams;
    gl_FragColor = vec4(vColour * light * mix(1.8, 1.1, uDay), 1.0 - light * uDay * 0.8);
  }
`;
const gaps = new THREE.ShaderMaterial({ ...blend, depthTest: false, uniforms: ribbonUniforms, vertexShader: gapVertex, fragmentShader: gapFragment });

/** One source per body: far out from the lit streets' middle, in the body's direction. */
function sourcesFor(lines, groundAt) {
  const sources = new Map();
  for (const line of lines) {
    const key = line.body ?? 'sun';
    const entry = sources.get(key) ?? { x: 0, z: 0, n: 0, az: line.az, colour: line.colour, strength: line.strength ?? 1 };
    entry.x += (line.a[0] + line.b[0]) / 2;
    entry.z += (line.a[1] + line.b[1]) / 2;
    entry.n++;
    sources.set(key, entry);
  }
  for (const entry of sources.values()) {
    const az = (entry.az * Math.PI) / 180;
    const cx = entry.x / entry.n;
    const cz = entry.z / entry.n;
    entry.x = cx + Math.sin(az) * SOURCE_DISTANCE_M;
    entry.z = cz - Math.cos(az) * SOURCE_DISTANCE_M;
    entry.y = groundAt(cx, cz) + SOURCE_DISTANCE_M * Math.tan((SOURCE_ELEVATION_DEG * Math.PI) / 180);
  }
  return sources;
}

function beamGeometry(lines, sources, groundAt) {
  const from = [];
  const to = [];
  const us = [];
  const sides = [];
  const widths = [];
  const seeds = [];
  const colours = [];
  const positions = [];
  const indices = [];
  lines.forEach(({ a, b, colour, strength = 1, body = 'sun' }, lineIndex) => {
    const source = sources.get(body);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // The beam lands on the middle of the street and is as wide as a good part of it.
    const x = (a[0] + b[0]) / 2;
    const z = (a[1] + b[1]) / 2;
    const end = [x, groundAt(x, z) + 1.5, z];
    const first = positions.length / 3;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      for (const side of [-1, 1]) {
        from.push(source.x, source.y, source.z);
        to.push(...end);
        us.push(u);
        sides.push(side);
        widths.push(14, 20 + length * 0.025);
        seeds.push(lineIndex * 3.7);
        colours.push(...colour.map((v) => v * strength));
        positions.push(...end);
      }
      if (i > 0) {
        const v = first + i * 2;
        indices.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFrom', new THREE.Float32BufferAttribute(from, 3));
  geometry.setAttribute('aTo', new THREE.Float32BufferAttribute(to, 3));
  geometry.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.setAttribute('aWidth', new THREE.Float32BufferAttribute(widths, 2));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute('aColour', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  return geometry;
}

function gapGeometry(sources) {
  const positions = [];
  const corners = [];
  const sizes = [];
  const colours = [];
  const indices = [];
  for (const source of sources.values()) {
    const first = positions.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(source.x, source.y, source.z);
      corners.push(cx, cy);
      sizes.push(900);
      colours.push(...source.colour.map((v) => v * source.strength));
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aColour', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function makeHighlights(scene, groundAt) {
  const group = new THREE.Group();
  scene.add(group);
  let meshes = [];
  return {
    group,
    /** @param lines [{ a: [x, z], b: [x, z] toward the body, body, az, colour, altitude, strength }] */
    set(lines) {
      for (const mesh of meshes) {
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      meshes = [];
      if (lines.length === 0) return;
      const geometry = rayGeometry(lines, groundAt);
      const solid = new THREE.Mesh(geometry, rays);
      const ghost = new THREE.Mesh(geometry, raysGhost);
      solid.renderOrder = 3;
      ghost.renderOrder = 2;
      const sources = sourcesFor(lines, groundAt);
      const fan = beamGeometry(lines, sources, groundAt);
      const beam = new THREE.Mesh(fan, beams);
      const beamGhost = new THREE.Mesh(fan, beamsGhost);
      beam.renderOrder = 4;
      beamGhost.renderOrder = 2;
      const glow = new THREE.Mesh(gapGeometry(sources), gaps);
      glow.renderOrder = 5;
      meshes = [solid, ghost, beam, beamGhost, glow];
      for (const mesh of meshes) mesh.frustumCulled = false;
      group.add(...meshes);
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
