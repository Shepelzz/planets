import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import YAML from 'yaml';

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

// texts.yaml is the single source of texts: `import x from '…/texts.yaml'` gives its data, and
// {{ui.key}} in index.html is replaced with the matching ui text.
function texts(): Plugin {
  const file = new URL('./texts.yaml', import.meta.url);
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return {
    name: 'texts-yaml',
    transform(code, id) {
      if (!id.endsWith('.yaml')) return null;
      return { code: `export default ${JSON.stringify(YAML.parse(code))};`, map: null };
    },
    transformIndexHtml(html) {
      const ui = (YAML.parse(readFileSync(file, 'utf8')).ui ?? {}) as Record<string, string>;
      return html.replace(/\{\{ui\.(\w+)\}\}/g, (_, key: string) => {
        if (typeof ui[key] !== 'string') throw new Error(`texts.yaml: ui.${key} is missing (used in index.html)`);
        return escapeHtml(ui[key]);
      });
    },
    handleHotUpdate({ file: changed, server }) {
      // texts change → reload the page (index.html texts come from the same file)
      if (changed.endsWith('texts.yaml')) server.ws.send({ type: 'full-reload' });
    },
  };
}

// Planet maps and models are served as immutable (render.yaml), so the app asks for them with a
// fingerprint of the file: textures/mars.jpg?v=1a2b3c4d. A replaced file gets a new URL and every
// browser fetches it right away; unchanged files stay cached. `import versions from
// 'virtual:asset-versions'` gives { 'textures/mars.jpg': '1a2b3c4d', … }.
function assetVersions(): Plugin {
  const id = 'virtual:asset-versions';
  const publicDir = new URL('./public/', import.meta.url).pathname;
  const dirs = ['textures', 'models'];
  const scan = () => {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (!name.startsWith('.'))
          out[relative(publicDir, path)] = createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 8);
      }
    };
    for (const d of dirs) walk(join(publicDir, d));
    return out;
  };
  return {
    name: 'asset-versions',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load: (key) => (key === '\0' + id ? `export default ${JSON.stringify(scan())};` : null),
    configureServer(server) {
      // a map or model replaced while the dev server runs: new fingerprints, reload the page
      server.watcher.add(dirs.map((d) => join(publicDir, d)));
      server.watcher.on('change', (file) => {
        if (!dirs.some((d) => file.startsWith(join(publicDir, d)))) return;
        const mod = server.moduleGraph.getModuleById('\0' + id);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [siteUrl(), texts(), assetVersions()],
  server: { port: 5210, strictPort: true, host: true },
  build: {
    // old iPads stay on iOS 12 (Safari 12): lower modern JS syntax and CSS for them
    target: ['es2017', 'safari12'],
    cssTarget: ['safari12'],
  },
});
