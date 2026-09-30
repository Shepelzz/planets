import * as THREE from 'three';
import type { BodyId } from './data';
import { TEXTURE_FILES } from './surfaces';
import { loadTexture } from './textures';

/**
 * Render a small lit sphere of every body from its real map and return PNG data URLs
 * for the UI icons. Call once the textures have loaded.
 */
export function renderThumbnails(ids: BodyId[], size = 160): Record<string, string> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  // light from the upper left, matching the 3D scene's three-quarter view
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(-4, 2.5, 5);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.12));

  const geo = new THREE.SphereGeometry(1, 96, 64);
  const out: Record<string, string> = {};
  const fitRadius = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;

  for (const id of ids) {
    const file = TEXTURE_FILES[id as keyof typeof TEXTURE_FILES];
    const map = loadTexture(file);
    const mat = id === 'sun' ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    const ball = new THREE.Mesh(geo, mat);
    ball.scale.setScalar(fitRadius * 0.94);
    // show the interesting side: the Americas for Earth (u=0.25 faces +z), the near side for the Moon
    ball.rotation.y = id === 'earth' ? 0.2 : id === 'moon' ? -Math.PI / 2 : 0.4;
    ball.rotation.x = 0.25;
    scene.add(ball);

    let clouds: THREE.Mesh | undefined;
    if (id === 'earth') {
      clouds = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: loadTexture('earth_clouds.jpg', false), transparent: true, depthWrite: false }),
      );
      clouds.scale.setScalar(fitRadius * 0.95);
      clouds.rotation.copy(ball.rotation);
      scene.add(clouds);
    }

    renderer.render(scene, camera);
    out[id] = canvas.toDataURL('image/png');

    scene.remove(ball);
    mat.dispose();
    if (clouds) {
      scene.remove(clouds);
      (clouds.material as THREE.Material).dispose();
    }
  }

  geo.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
