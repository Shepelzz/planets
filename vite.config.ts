import { defineConfig, type Plugin } from 'vite';

// Link previews (Telegram, WhatsApp, Viber, Facebook…) need absolute URLs in og:image / og:url.
// Render passes the site's address as RENDER_EXTERNAL_URL during the build; SITE_URL overrides it
// (e.g. for a custom domain). Without either, the tags fall back to root-relative paths.
function siteUrl(): Plugin {
  const url = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replace(/__SITE_URL__/g, url),
  };
}

export default defineConfig({
  base: './',
  plugins: [siteUrl()],
  server: { port: 5210, strictPort: true, host: true },
  build: {
    // old iPads stay on iOS 12 (Safari 12): lower modern JS syntax and CSS for them
    target: ['es2017', 'safari12'],
    cssTarget: ['safari12'],
  },
});
