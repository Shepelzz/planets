import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Swarm } from './data';

// A giant planet's many small moons, shown as one body: a band of lumpy rocks circling the planet,
// each on its own tilted (sometimes backwards) orbit, as most of the small outer moons really are.
// The rocks are made here from a noisy icosahedron: no textures to download.

const VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform vec3 uColor;
varying vec3 vWorldPos;
void main() {
  // flat facets, like a real chipped rock
  vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 col = uColor * (max(dot(N, L), 0.0) * 2.0 + 0.06 + 0.05 * max(dot(N, V), 0.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Deterministic 0..1 random numbers, so the swarm looks the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A lumpy rock of radius ≈ 1. */
export function rockGeometry(seed: number) {
  const rand = rng(seed * 7919 + 13);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  // a few random bumps and dents, plus an overall squash
  const bumps = Array.from({ length: 7 }, () => ({
    dir: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    amount: (rand() - 0.45) * 0.5,
    width: 0.5 + rand() * 0.9,
  }));
  const squash = new THREE.Vector3(1, 0.65 + rand() * 0.3, 0.75 + rand() * 0.25);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const b of bumps) r += b.amount * Math.exp(-(1 - v.dot(b.dir)) / (b.width * 0.25));
    v.multiplyScalar(r).multiply(squash);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingSphere();
  return g;
}

export function rockMaterial(colour: string, sunPos: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uSunPos: { value: sunPos }, uColor: { value: new THREE.Color(colour) } },
    extensions: { derivatives: true }, // dFdx/dFdy on WebGL 1
  });
}

interface Rock {
  mesh: THREE.Mesh;
  distance: number;
  angle: number;
  /** radians per second; negative = backwards */
  speed: number;
  plane: THREE.Quaternion;
  spin: THREE.Vector3;
}

export interface SwarmView {
  /** add to the body's tilt group (the planet's equatorial plane) */
  group: THREE.Group;
  rocks: Rock[];
  material: THREE.ShaderMaterial;
}

const GEOMETRIES = 4;

export function makeSwarm(s: Swarm, seed: number, sunPos: THREE.Vector3): SwarmView {
  const rand = rng(seed * 104729 + 7);
  const material = rockMaterial(s.colour, sunPos);
  const geos = Array.from({ length: GEOMETRIES }, (_, i) => rockGeometry(seed * 31 + i));
  const group = new THREE.Group();
  const rocks: Rock[] = [];
  for (let i = 0; i < s.count; i++) {
    const mesh = new THREE.Mesh(geos[i % GEOMETRIES], material);
    // show sizes: far bigger than real (a few km), or they would be invisible next to the planet
    mesh.scale.setScalar(0.9 + rand() * rand() * 2.2);
    mesh.rotation.set(rand() * 6.3, rand() * 6.3, rand() * 6.3);
    const distance = s.inner + rand() * (s.outer - s.inner);
    const backwards = rand() < 0.35; // many small outer moons go round the wrong way
    // farther out = slower, roughly as Kepler would have it
    const speed = ((backwards ? -1 : 1) * 1.1) / Math.pow(distance / 10, 1.5);
    const plane = new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.9, rand() * 6.3, (rand() - 0.5) * 0.5));
    const spin = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.2);
    group.add(mesh);
    rocks.push({ mesh, distance, angle: rand() * Math.PI * 2, speed, plane, spin });
  }
  updateSwarm({ group, rocks, material }, 0);
  return { group, rocks, material };
}

export function updateSwarm(v: SwarmView, dt: number) {
  for (const r of v.rocks) {
    r.angle += r.speed * dt;
    r.mesh.position.set(Math.cos(r.angle) * r.distance, 0, -Math.sin(r.angle) * r.distance).applyQuaternion(r.plane);
    r.mesh.rotation.x += r.spin.x * dt;
    r.mesh.rotation.y += r.spin.y * dt;
    r.mesh.rotation.z += r.spin.z * dt;
  }
}
