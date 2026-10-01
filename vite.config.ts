import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

// One page per address — /solar-system and /<body> (/earth, /moon, /iss…) — each a copy of index.html with
// its own title, description and link-preview card (og:*, twitter:*), because messengers read the
// page's tags and run no scripts. Card images: public/og/<id>.jpg (made with space.makeOgCards() in
// the dev console); the system page keeps public/og.jpg. render.yaml must map every path to its
// page: the build stops if one is missing.
function pages(): Plugin {
  const root = new URL('./', import.meta.url).pathname;
  const site = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fingerprint = (file: string) => createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8);
  const setMeta = (html: string, attr: 'name' | 'property', key: string, value: string) =>
    html.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), (_, a: string, b: string) => a + esc(value) + b);
  return {
    name: 'pages',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir ?? join(root, 'dist');
      const base = readFileSync(join(out, 'index.html'), 'utf8');
      const data = YAML.parse(readFileSync(join(root, 'texts.yaml'), 'utf8'));
      const ui = data.ui as Record<string, string>;
      const routes = readFileSync(join(root, 'render.yaml'), 'utf8');
      const image = (id: string | null) => {
        const file = id && existsSync(join(root, 'public', 'og', `${id}.jpg`)) ? `og/${id}.jpg` : 'og.jpg';
        return `${site}/${file}?v=${fingerprint(join(root, 'public', file))}`;
      };
      const page = (path: string, title: string, description: string, img: string, alt: string) => {
        if (!routes.includes(`source: /${path}\n`)) throw new Error(`render.yaml: no route for /${path} (add a rewrite to /${path}.html)`);
        let html = base.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
        html = setMeta(html, 'name', 'description', description);
        for (const [k, v] of [['og:title', title], ['og:description', description], ['og:url', `${site}/${path}`], ['og:image', img], ['og:image:alt', alt]])
          html = setMeta(html, 'property', k, v);
        for (const [k, v] of [['twitter:title', title], ['twitter:description', description], ['twitter:image', img]])
          html = setMeta(html, 'name', k, v);
        writeFileSync(join(out, `${path}.html`), html);
      };
      page('solar-system', ui.title, ui.share_description, image(null), ui.share_image_alt);
      for (const [id, b] of Object.entries(data.bodies as Record<string, { name: string; kind: string; intro: string }>))
        page(id, `${b.name} — ${ui.title}`, b.intro, image(id), `${b.name}: ${b.kind}`);
    },
  };
}

// Dev only: space.makeOgCards() posts each finished card here; saved as public/og/<id>.jpg.
function ogCards(): Plugin {
  return {
    name: 'og-cards',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__og/', (req, res) => {
        const id = (req.url ?? '').replace(/^\//, '');
        if (req.method !== 'POST' || !/^[a-z_]+$/.test(id)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = new URL('./public/og/', import.meta.url).pathname;
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${id}.jpg`), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  // absolute paths: pages live at /earth, /solar-system… and must still find /assets, /voice, /textures
  base: '/',
  plugins: [siteUrl(), texts(), assetVersions(), pages(), ogCards()],
  server: { port: 5210, strictPort: true, host: true },
  build: {
    // old iPads stay on iOS 12 (Safari 12): lower modern JS syntax and CSS for them
    target: ['es2017', 'safari12'],
    cssTarget: ['safari12'],
  },
});
