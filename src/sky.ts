import * as THREE from 'three';
import { loadTexture, SRGB_GLSL } from './textures';

// Galactic plane orientation (arbitrary but fixed) and the direction of the galactic core.
const GAL_N = new THREE.Vector3(0.35, 0.86, 0.37).normalize();
const GAL_CORE = new THREE.Vector3().crossVectors(GAL_N, new THREE.Vector3(0, 0, 1)).normalize();

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_COLORS: [number, [number, number, number]][] = [
  [0.1, [0.62, 0.72, 1.0]], // hot blue
  [0.25, [0.8, 0.86, 1.0]], // blue-white
  [0.5, [1.0, 1.0, 1.0]], // white
  [0.75, [1.0, 0.93, 0.8]], // yellow
  [0.92, [1.0, 0.8, 0.6]], // orange
  [1.0, [1.0, 0.64, 0.45]], // red
];

export function createSky(): { group: THREE.Group; setPixelRatio: (r: number) => void } {
  const group = new THREE.Group();
  const R = 9000;
  const rnd = rand(1234);

  // ---- stars ----
  const count = 4500;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const u = new THREE.Vector3().crossVectors(GAL_N, new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(GAL_N, u).normalize();
  const d = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.0) {
      // concentrated along the Milky Way band, denser towards the core
      let a = rnd() * Math.PI * 2;
      if (rnd() < 0.4) a = Math.atan2(GAL_CORE.dot(v), GAL_CORE.dot(u)) + (rnd() - 0.5) * 1.6;
      const g = (rnd() + rnd() + rnd() - 1.5) * 0.22;
      d.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(GAL_N, g).normalize();
    } else {
      const z = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      d.set(s * Math.cos(t), z, s * Math.sin(t));
    }
    pos.set([d.x * R * 0.9, d.y * R * 0.9, d.z * R * 0.9], i * 3);
    const k = rnd();
    const c = STAR_COLORS.find(([p]) => k <= p)![1];
    const m = Math.pow(rnd(), 9); // few bright, many faint
    const bright = 0.35 + m * 3.0;
    col.set([c[0] * bright, c[1] * bright, c[2] * bright], i * 3);
    size[i] = 1.1 + m * 3.2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 color;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPixelRatio * 1.6;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r2 = dot(c, c) * 4.0;
        float core = exp(-r2 * 9.0);
        float halo = exp(-r2 * 3.0) * 0.25;
        float a = core + halo;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: false, // opaque pass, drawn first (renderOrder) so planets cover the stars
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  stars.frustumCulled = false;

  // ---- Milky Way panorama (real all-sky map), dimmed so it stays a backdrop ----
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: loadTexture('milky_way.jpg') } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      ${SRGB_GLSL}
      void main() {
        gl_FragColor = vec4(srgbToLinear(texture2D(uMap, vUv).rgb) * 0.55, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const skySphere = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), skyMat);
  // tilt the galactic plane so the band crosses the sky diagonally
  skySphere.rotation.set(1.05, 0.4, 0.3);
  skySphere.renderOrder = -10;
  skySphere.frustumCulled = false;

  group.add(skySphere, stars);
  return {
    group,
    setPixelRatio: (r) => {
      starMat.uniforms.uPixelRatio.value = r;
    },
  };
}
