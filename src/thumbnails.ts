import * as THREE from 'three';
import type { BodyId } from './data';
import { TEXTURE_FILES } from './surfaces';
import { loadTexture, SRGB_GLSL } from './textures';

const THUMB_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const THUMB_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uClouds;
uniform float uHasClouds;
uniform float uEmissive;
varying vec2 vUv;
varying vec3 vNormal;
${SRGB_GLSL}
void main() {
  vec3 albedo = srgbToLinear(texture2D(uMap, vUv).rgb);
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
    },
  });
  const ball = new THREE.Mesh(geo, mat);
  ball.scale.setScalar(Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * 0.94);
  scene.add(ball);

  const out: Record<string, string> = {};
  for (const id of ids) {
    mat.uniforms.uMap.value = loadTexture(TEXTURE_FILES[id as keyof typeof TEXTURE_FILES]);
    mat.uniforms.uHasClouds.value = id === 'earth' ? 1 : 0;
    mat.uniforms.uEmissive.value = id === 'sun' ? 1 : 0;
    // show the interesting side: the Americas for Earth (u=0.25 faces +z), the near side for the Moon
    ball.rotation.set(0.25, id === 'earth' ? 0.2 : id === 'moon' ? -Math.PI / 2 : 0.4, 0);
    renderer.render(scene, camera);
    out[id] = canvas.toDataURL('image/png');
  }

  geo.dispose();
  mat.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
