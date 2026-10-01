import versions from 'virtual:asset-versions';

/**
 * URL of a file in public/textures or public/models with its fingerprint: these are cached for a
 * year, so a replaced file must come under a new URL (see assetVersions in vite.config.ts).
 */
export function assetUrl(path: string) {
  const v = versions[path];
  return `${import.meta.env.BASE_URL}${path}${v ? `?v=${v}` : ''}`;
}
