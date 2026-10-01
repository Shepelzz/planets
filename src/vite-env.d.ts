/// <reference types="vite/client" />
declare module 'pepjs';
declare module '*.yaml' {
  const data: unknown;
  export default data;
}
declare module 'virtual:asset-versions' {
  /** path under public/ → short fingerprint of the file (vite.config.ts) */
  const versions: Record<string, string>;
  export default versions;
}
