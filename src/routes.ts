import { UI } from './content';

// Every view has its own address: /solar-system for the whole Solar System, /earth, /moon, /iss… for
// a body. A link opens straight at that body; back/forward (and the iPad's swipe back) move between
// visited ones. Each address also has its own page with its own link preview (vite.config.ts,
// render.yaml).

export const SYSTEM_PATH = 'solar-system';

/** The last part of the address: a body id, SYSTEM_PATH, '' for the root, or anything typed. */
export function pathSegment() {
  return decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop() ?? '');
}

/** Show a view in the address bar and the tab title: push a history entry, replace the current one, or neither. */
export function showAddress(body: { id: string; name: string } | null, how: 'push' | 'replace' | 'none') {
  document.title = body ? `${body.name} — ${UI.title}` : UI.title;
  const path = `/${body ? body.id : SYSTEM_PATH}`;
  if (how === 'none' || location.pathname === path) return;
  const url = path + location.search; // keep test flags like ?webgl1
  if (how === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

/** Back/forward: the address changed under us. */
export function onAddressChange(handler: () => void) {
  window.addEventListener('popstate', handler);
}
