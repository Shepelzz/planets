import * as THREE from 'three';
import { PHYSICS, type BodyId } from './data';
import { NOISE_GLSL } from './noise';
import { makeStation } from './station';
import { SURFACES, TEXTURE_FILES, type SurfaceKind } from './surfaces';
import { rockGeometry, rockMaterial } from './swarm';
import { loadTexture, SRGB_GLSL } from './textures';

const THUMB_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObj;
void main() {
  vUv = uv;
  vObj = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// the body's own surface function (surfaces.ts), so tinted and gap-filled maps look as in 3D
const THUMB_FRAG = (surface: string) => /* glsl */ `
uniform sampler2D uClouds;
uniform float uHasClouds;
uniform float uEmissive;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObj;
${NOISE_GLSL}
${SRGB_GLSL}
${surface}
void main() {
  float h, spec; vec3 night;
  vec3 albedo = surface(normalize(vObj), vUv, h, spec, night);
  if (uHasClouds > 0.5) albedo = mix(albedo, vec3(1.0), texture2D(uClouds, vUv).r);
  // light from the upper left, matching the 3D scene's three-quarter view
  float light = max(dot(normalize(vNormal), normalize(vec3(-4.0, 2.5, 5.0))), 0.0) + 0.04;
  vec3 col = uEmissive > 0.5 ? albedo * 1.2 : albedo * light;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  #include <colorspace_fragment>
}`;

const SUN_SURFACE = /* glsl */ `
uniform sampler2D uMap;
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  h = 0.0; spec = 0.0; night = vec3(0.0);
  return srgbToLinear(texture2D(uMap, uv).rgb);
}`;

/**
 * Render a small lit picture of every body (spheres from their real maps, the ISS from its model, a
 * swarm as a handful of rocks) and return PNG data URLs for the UI icons. Call once the textures have loaded.
 */
export function renderThumbnails(ids: BodyId[], size = 160): Record<string, string> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  const fill = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z; // radius that fills the picture

  const geo = new THREE.SphereGeometry(1, 96, 64);
  const clouds = loadTexture('earth_clouds.jpg');
  const materials = new Map<string, THREE.ShaderMaterial>();
  const materialFor = (kind: SurfaceKind | 'sun') => {
    let m = materials.get(kind);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: THUMB_VERT,
        fragmentShader: THUMB_FRAG(kind === 'sun' ? SUN_SURFACE : SURFACES[kind]),
        uniforms: {
          uMap: { value: loadTexture(TEXTURE_FILES[kind]) },
          uNight: { value: null },
          uClouds: { value: clouds },
          uHasClouds: { value: kind === 'earth' ? 1 : 0 },
          uEmissive: { value: kind === 'sun' ? 1 : 0 },
        },
      });
      materials.set(kind, m);
    }
    return m;
  };
  const ball = new THREE.Mesh(geo);
  scene.add(ball);

  // the ISS: its model seen from above, wings towards us, lit from the upper left
  const station = makeStation(1, new THREE.Vector3(-4, 2.5, 5).multiplyScalar(1000), new THREE.Vector4(0, 0, 0, 0));
  const stationView = new THREE.Group();
  station.model.rotation.set(0, 0, Math.PI / 2); // truss across the picture
  station.model.scale.multiplyScalar(fill * 0.92);
  stationView.add(station.model);
  stationView.rotation.set(0.5, -0.35, 0);
  for (const g of station.arrays) g.rotation.y = -1.25; // wings almost facing us (their face is along x)

  // a swarm: a few rocks of different sizes
  const rockMat = rockMaterial('#9a8e82', new THREE.Vector3(-4, 2.5, 5).multiplyScalar(1000));
  const rocks = new THREE.Group();
  const spots: [number, number, number][] = [[-0.42, 0.32, 0.4], [0.45, 0.3, 0.28], [0.05, -0.36, 0.34], [-0.52, -0.46, 0.17], [0.56, -0.42, 0.19], [0.12, 0.66, 0.14]];
  spots.forEach(([x, y, r], i) => {
    const m = new THREE.Mesh(rockGeometry(100 + i), rockMat);
    m.position.set(x * fill, y * fill, 0);
    m.scale.setScalar(r * fill);
    m.rotation.set(i * 1.3, i * 0.7, i * 2.1);
    rocks.add(m);
  });

  const out: Record<string, string> = {};
  for (const id of ids) {
    const phys = PHYSICS.find((p) => p.id === id)!;
    const special = phys.station ? stationView : phys.swarm ? rocks : null;
    ball.visible = !special;
    if (special) {
      scene.add(special);
      renderer.render(scene, camera);
      scene.remove(special);
      out[id] = canvas.toDataURL('image/png');
      continue;
    }
    ball.material = materialFor(id === 'sun' ? 'sun' : phys.surface!);
    // Phobos and Deimos: a squashed ball hints at their potato shape
    const shape = phys.shape ?? [1, 1, 1];
    ball.scale.set(shape[0], shape[1], shape[2]).multiplyScalar(fill * 0.94);
    // show the interesting side: the Americas for Earth (u=0.25 faces +z), the near side for the
    // Moon and Pluto's heart (both around u=0.5)
    ball.rotation.set(0.25, id === 'earth' ? 0.2 : id === 'moon' || id === 'pluto' ? -Math.PI / 2 : 0.4, 0);
    renderer.render(scene, camera);
    out[id] = canvas.toDataURL('image/png');
  }

  geo.dispose();
  for (const m of materials.values()) m.dispose();
  for (const m of station.materials) m.dispose();
  rockMat.dispose();
  stationView.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  rocks.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
