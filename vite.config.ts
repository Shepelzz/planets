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

function webManifest(ui: Record<string, string>) {
  return JSON.stringify({
    name: ui.title,
    short_name: ui.title_short,
    description: ui.description,
    lang: 'uk',
    start_url: '/solar-system',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2);
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
    // the web app manifest (home-screen name and icons), from the same texts
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(webManifest(YAML.parse(readFileSync(file, 'utf8')).ui));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: webManifest(YAML.parse(readFileSync(file, 'utf8')).ui) });
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

// Offline: dist/sw.js, a service worker written at build time with the file lists it needs.
//  · the app itself (JS, CSS, page, manifest, icons) is kept per release ("shell-<version>");
//  · the start-up 2K maps are fetched once at install; voice, 4K maps and the ISS model are kept as
//    they are used ("media"); all of these carry a fingerprint (?v=), so a cached copy is always right;
//  · old releases and files that are no longer part of the app are dropped when a new one activates;
//  · Safari asks for audio in byte ranges: answered from the cached file (206), or it won't play.
function offline(): Plugin {
  const root = new URL('./', import.meta.url).pathname;
  const fp = (file: string) => createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8);
  return {
    name: 'offline',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir ?? join(root, 'dist');
      const pub = join(root, 'public');
      const list = (dir: string) => (existsSync(join(pub, dir)) ? readdirSync(join(pub, dir)).filter((f) => !f.startsWith('.') && statSync(join(pub, dir, f)).isFile()) : []);
      const versioned = (path: string) => `/${path}?v=${fp(join(pub, path))}`;
      const lite = new Set(list('textures/lite'));
      const startMaps = [
        ...list('textures').filter((f) => !lite.has(f)).map((f) => versioned(`textures/${f}`)),
        ...[...lite].map((f) => versioned(`textures/lite/${f}`)),
      ];
      const shell = [
        '/index.html',
        '/manifest.webmanifest',
        ...readdirSync(join(out, 'assets')).map((f) => `/assets/${f}`),
        ...list('icons').map((f) => `/icons/${f}`),
      ];
      const voice = Object.entries(JSON.parse(readFileSync(join(root, 'src', 'voice-manifest.json'), 'utf8')) as Record<string, string>)
        .map(([k, v]) => `/voice/${k}.m4a?v=${v}`);
      const keep = [...startMaps, ...list('textures').map((f) => versioned(`textures/${f}`)), ...list('models').map((f) => versioned(`models/${f}`)), ...voice];
      const version = createHash('sha1').update(JSON.stringify([shell, shell.map((p) => (p.startsWith('/assets/') ? '' : existsSync(join(out, p)) ? fp(join(out, p)) : ''))])).digest('hex').slice(0, 10);
      const sw = readFileSync(join(root, 'scripts', 'sw.template.js'), 'utf8')
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__START_MAPS__', JSON.stringify(startMaps))
        .replace('__KEEP__', JSON.stringify([...new Set(keep)]));
      writeFileSync(join(out, 'sw.js'), sw);
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
          // 'icon' is the home-screen icon source (space.makeIcon()), the rest are link-preview cards
          const dir = new URL(id === 'icon' ? './public/icons/' : './public/og/', import.meta.url).pathname;
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, id === 'icon' ? 'source.png' : `${id}.jpg`), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  // absolute paths: pages live at /earth, /solar-system… and must still find /assets, /voice, /textures
  base: '/',
  plugins: [siteUrl(), texts(), assetVersions(), pages(), ogCards(), offline()],
  server: { port: 5210, strictPort: true, host: true },
  build: {
    // old iPads stay on iOS 12 (Safari 12): lower modern JS syntax and CSS for them
    target: ['es2017', 'safari12'],
    cssTarget: ['safari12'],
  },
});
