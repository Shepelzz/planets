import * as THREE from 'three';
import { assetUrl } from './assets';

export const loadingManager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loadingManager);
const cache = new Map<string, THREE.Texture>();

// 2K copies of the 4K maps, for old WebGL 1 devices (e.g. 1 GB iPads on iOS 12).
const LITE_FILES = new Set(['earth_day.jpg', 'earth_clouds.jpg', 'moon.jpg', 'mars.jpg', 'jupiter.jpg', 'milky_way.jpg', 'pluto.jpg']);
let lite = false;

/** Call before any texture is requested. */
export function useLiteTextures(on: boolean) {
  lite = on;
}

/**
 * Load a map from public/textures. Maps are uploaded as raw bytes (no sRGB format) so WebGL 1
 * keeps mipmaps; shaders decode colour maps with srgbToLinear() from SRGB_GLSL.
 */
export function loadTexture(file: string): THREE.Texture {
  let t = cache.get(file);
  if (!t) {
    const dir = lite && LITE_FILES.has(file) ? 'textures/lite/' : 'textures/';
    t = loader.load(assetUrl(dir + file));
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8; // three clamps this to what the GPU supports
    cache.set(file, t);
  }
  return t;
}

export const SRGB_GLSL = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}`;
