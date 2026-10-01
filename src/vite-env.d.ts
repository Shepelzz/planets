/// <reference types="vite/client" />
declare module 'pepjs';
declare module '*.yaml' {
  const data: unknown;
  export default data;
}
