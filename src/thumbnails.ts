import * as THREE from 'three';
import { PHYSICS, type BodyId } from './data';
import { NOISE_GLSL } from './noise';
import { makeStation } from './station';
import { SURFACES, TEXTURE_FILES, type SurfaceKind } from './surfaces';
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

/** The comet's icon: a glowing head with its tail streaming to the upper right. */
function cometIcon(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const hx = size * 0.34, hy = size * 0.66; // the head
  const angle = -Math.PI / 4;
  g.save();
  g.translate(hx, hy);
  g.rotate(angle);
  // the tails: a wide warm dust fan and a narrow blue gas streak, fading out
  const tail = (len: number, w: number, rgb: string, alpha: number) => {
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -size * 0.05);
    g.quadraticCurveTo(len * 0.5, -w * 0.6, len, -w);
    g.lineTo(len, w * 0.4);
    g.quadraticCurveTo(len * 0.5, w * 0.3, 0, size * 0.05);
    g.fill();
  };
  tail(size * 0.72, size * 0.2, '255,236,200', 0.75);
  tail(size * 0.8, size * 0.07, '130,190,255', 0.9);
  g.restore();
  const head = g.createRadialGradient(hx, hy, 0, hx, hy, size * 0.2);
  head.addColorStop(0, 'rgba(255,255,255,1)');
  head.addColorStop(0.25, 'rgba(220,240,255,0.9)');
  head.addColorStop(0.6, 'rgba(140,200,255,0.3)');
  head.addColorStop(1, 'rgba(120,190,255,0)');
  g.fillStyle = head;
  g.fillRect(0, 0, size, size);
  return c.toDataURL('image/png');
}

/**
 * Render a small lit picture of every body (spheres from their real maps, the ISS from its model) and return PNG data URLs for the UI icons. Call once the textures have loaded.
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
          uMap: { value: loadTexture(TEXTURE_FILES[kind as Exclude<typeof kind, 'comet'>]) },
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

  const out: Record<string, string> = {};
  for (const id of ids) {
    const phys = PHYSICS.find((p) => p.id === id)!;
    if (phys.comet) {
      out[id] = cometIcon(size);
      continue;
    }
    const special = phys.station ? stationView : null;
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
  stationView.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
