import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5210, strictPort: true, host: true },
  build: {
    // old iPads stay on iOS 12 (Safari 12): lower modern JS syntax and CSS for them
    target: ['es2017', 'safari12'],
    cssTarget: ['safari12'],
  },
});
