import * as THREE from 'three';
import { assetUrl } from './assets';

export const loadingManager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loadingManager);
const detailLoader = new THREE.TextureLoader(); // close-up maps: not part of the start-up progress
const cache = new Map<string, THREE.Texture>();

// The heaviest maps exist in two sizes: 2K in textures/lite/ and 4K in textures/. Every device starts
// with the 2K ones (a fraction of the download and of the video memory: 4K maps of all bodies at once
// took ~400 MB, enough for Safari to reload the tab on 2–3 GB iPads). The body we fly to gets its 4K
// map while we are there (bodies.ts: showDetail), except on old WebGL 1 devices.
const LITE_FILES = new Set(['earth_day.jpg', 'earth_clouds.jpg', 'moon.jpg', 'mars.jpg', 'jupiter.jpg', 'milky_way.jpg', 'pluto.jpg']);
let detailAllowed = true;

/** Old devices (WebGL 1, 1 GB iPads): never load the 4K maps. Call before any texture is requested. */
export function setDetailAllowed(on: boolean) {
  detailAllowed = on;
}

function prepare(t: THREE.Texture) {
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8; // three clamps this to what the GPU supports
  return t;
}

/**
 * Load a map from public/textures (2K if there is a 2K copy, unless `full` asks for the big one where
 * allowed). Maps are uploaded as raw bytes (no sRGB format) so WebGL 1 keeps mipmaps; shaders decode
 * colour maps with srgbToLinear() from SRGB_GLSL.
 */
export function loadTexture(file: string, opts: { full?: boolean } = {}): THREE.Texture {
  const big = !LITE_FILES.has(file) || (opts.full && detailAllowed);
  const path = (big ? 'textures/' : 'textures/lite/') + file;
  let t = cache.get(path);
  if (!t) {
    t = prepare(loader.load(assetUrl(path)));
    cache.set(path, t);
  }
  return t;
}

/** True if this map has a sharper version to load for close-ups on this device. */
export const hasDetail = (file: string) => detailAllowed && LITE_FILES.has(file);

/** The 4K version of a map, loaded on its own (not cached: the caller disposes it when leaving). */
export function loadDetail(file: string): Promise<THREE.Texture> {
  return detailLoader.loadAsync(assetUrl('textures/' + file)).then(prepare);
}

export const SRGB_GLSL = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}`;
