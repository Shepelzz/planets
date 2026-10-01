import * as THREE from 'three';
import { PHYSICS, type BodyId } from './data';
import { makeStation } from './station';
import { CHARON_TINT_GLSL, TEXTURE_FILES, UNSEEN_FILL_GLSL } from './surfaces';
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

const THUMB_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uClouds;
uniform float uHasClouds;
uniform float uEmissive;
uniform float uKind; // 1 = Pluto (fill the unseen south), 2 = Charon (fill + tint the grey map)
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObj;
${SRGB_GLSL}
${UNSEEN_FILL_GLSL}
${CHARON_TINT_GLSL}
void main() {
  vec3 raw = texture2D(uMap, vUv).rgb;
  if (uKind > 0.5) raw = fillUnseen(uMap, vUv, raw);
  if (uKind > 1.5) raw = charonColour(raw, normalize(vObj));
  vec3 albedo = srgbToLinear(raw);
  if (uHasClouds > 0.5) albedo = mix(albedo, vec3(1.0), texture2D(uClouds, vUv).r);
  // light from the upper left, matching the 3D scene's three-quarter view
  float light = max(dot(normalize(vNormal), normalize(vec3(-4.0, 2.5, 5.0))), 0.0) + 0.04;
  vec3 col = uEmissive > 0.5 ? albedo * 1.2 : albedo * light;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Render a small lit sphere of every body from its real map and return PNG data URLs
 * for the UI icons. Call once the textures have loaded.
 */
export function renderThumbnails(ids: BodyId[], size = 160): Record<string, string> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  const geo = new THREE.SphereGeometry(1, 96, 64);
  const mat = new THREE.ShaderMaterial({
    vertexShader: THUMB_VERT,
    fragmentShader: THUMB_FRAG,
    uniforms: {
      uMap: { value: null },
      uClouds: { value: loadTexture('earth_clouds.jpg') },
      uHasClouds: { value: 0 },
      uEmissive: { value: 0 },
      uKind: { value: 0 },
    },
  });
  const ball = new THREE.Mesh(geo, mat);
  ball.scale.setScalar(Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * 0.94);
  scene.add(ball);

  // the ISS: its model seen from above, wings towards us, lit from the upper left
  const station = makeStation(1, new THREE.Vector3(-4, 2.5, 5).multiplyScalar(1000), new THREE.Vector4(0, 0, 0, 0));
  const stationView = new THREE.Group();
  station.model.rotation.set(0, 0, Math.PI / 2); // truss across the picture
  station.model.scale.multiplyScalar(Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * 0.92);
  stationView.add(station.model);
  stationView.rotation.set(0.5, -0.35, 0);
  for (const g of station.arrays) g.rotation.y = -1.25; // wings almost facing us (their face is along x)

  const out: Record<string, string> = {};
  for (const id of ids) {
    const isStation = PHYSICS.some((p) => p.id === id && p.station);
    ball.visible = !isStation;
    if (isStation) {
      scene.add(stationView);
      renderer.render(scene, camera);
      scene.remove(stationView);
      out[id] = canvas.toDataURL('image/png');
      continue;
    }
    mat.uniforms.uMap.value = loadTexture(TEXTURE_FILES[id as keyof typeof TEXTURE_FILES]);
    mat.uniforms.uHasClouds.value = id === 'earth' ? 1 : 0;
    mat.uniforms.uEmissive.value = id === 'sun' ? 1 : 0;
    mat.uniforms.uKind.value = id === 'pluto' ? 1 : id === 'charon' ? 2 : 0;
    // show the interesting side: the Americas for Earth (u=0.25 faces +z), the near side for the
    // Moon and Pluto's heart (both around u=0.5)
    ball.rotation.set(0.25, id === 'earth' ? 0.2 : id === 'moon' || id === 'pluto' ? -Math.PI / 2 : 0.4, 0);
    renderer.render(scene, camera);
    out[id] = canvas.toDataURL('image/png');
  }

  geo.dispose();
  mat.dispose();
  for (const m of station.materials) m.dispose();
  stationView.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
