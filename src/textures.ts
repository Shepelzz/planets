import * as THREE from 'three';

export const loadingManager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(loadingManager);
const cache = new Map<string, THREE.Texture>();

/** Load a map from public/textures; colour maps are sRGB, data maps (clouds) are linear. */
export function loadTexture(file: string, color = true): THREE.Texture {
  const key = `${file}|${color}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(`${import.meta.env.BASE_URL}textures/${file}`);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8; // three clamps this to what the GPU supports
    cache.set(key, t);
  }
  return t;
}
