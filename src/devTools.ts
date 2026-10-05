import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Body } from './bodies';
import type { CameraDirector } from './camera';
import { UI } from './content';
import type { BodyId } from './data';

// Dev-only tools, run from the browser console on `npm run dev` (the tab must be visible):
//   space.makeOgCards()          link-preview cards → public/og/<id>.jpg (all bodies, or a list of ids)
//   space.makeIcon('saturn')     home-screen icon source → public/icons/source.png
// Shots come from the real renderer; the dev server saves them (ogCards() in vite.config.ts).

export interface DevContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sky: THREE.Object3D;
  bodies: Body[];
  lines: Map<string, THREE.LineLoop>;
  director: CameraDirector;
  flyTo: (b: Body | null, duration?: number, address?: 'push' | 'replace' | 'none') => void;
  hideInfo: () => void;
  resize: () => void;
  /** draw the current realm's picture to the screen (the black hole is not a scene: it is traced) */
  draw: () => void;
  /** a hyperjump is under way */
  busy: () => boolean;
}

export function createDevTools(ctx: DevContext) {
  const { renderer, scene, camera, controls, bodies, lines, director } = ctx;
  const byId = new Map(bodies.map((b) => [b.info.id, b]));
  let pending: ((png: string) => void) | null = null;
  let size: [number, number, number, number] = [1200, 630, -0.2, 0.66];
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Render the focused body at W×H, shifted sideways, filling `fill` of the height; restores the view after. */
  function shot(W: number, H: number, shift: number, fill: number) {
    const b = director.focus!;
    const keep = { pos: camera.position.clone(), aspect: camera.aspect, near: camera.near };
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const dir = keep.pos.clone().sub(controls.target).normalize();
    // ringed planets: let the rings run wide, so the ball itself is big enough
    const r = b.info.rings ? b.viewRadius * 0.62 : b.viewRadius;
    // the black hole: close, its disk running off the card
    const dist = b.info.blackHole ? 15 : r / Math.sin(Math.atan(Math.tan((camera.fov * Math.PI) / 360) * fill));
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.lookAt(controls.target);
    camera.near = Math.max(0.01, (dist - b.viewRadius) * 0.2);
    camera.setViewOffset(W, H, W * shift, 0, W, H); // for cards the body sits right of centre, text goes left
    ctx.sky.position.copy(camera.position);
    // only the body and its own moons: no other planets or orbit lines behind the title
    const home = b.info.parent ?? b.info.id;
    const hidden: THREE.Object3D[] = [];
    for (const o of bodies) if ((o.info.parent ?? o.info.id) !== home && o.anchor.visible) hidden.push(o.anchor);
    for (const l of lines.values()) if (l.visible) hidden.push(l);
    for (const o of hidden) o.visible = false;
    camera.updateProjectionMatrix();
    if (b.info.blackHole) ctx.draw();
    else renderer.render(scene, camera);
    const png = renderer.domElement.toDataURL('image/png');
    for (const o of hidden) o.visible = true;
    camera.position.copy(keep.pos);
    camera.aspect = keep.aspect;
    camera.near = keep.near;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    ctx.resize();
    return png;
  }

  /** Called by the frame loop before rendering: takes a requested shot once the camera has arrived. */
  function beforeRender() {
    if (!pending || !director.focus || director.flying || ctx.busy()) return;
    const done = pending;
    pending = null;
    done(shot(...size));
  }

  async function visit(b: Body) {
    ctx.flyTo(b, 0.01, 'none');
    ctx.hideInfo();
    await wait(100);
    for (let i = 0; i < 160 && (ctx.busy() || director.flying || (b.station && !b.station.real)); i++) await wait(50);
    await wait(1500); // orbits make room, moons appear
  }

  async function makeOgCards(ids?: BodyId[]) {
    const load = (src: string) => new Promise<HTMLImageElement>((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    for (const id of ids ?? bodies.map((b) => b.info.id)) {
      const b = byId.get(id)!;
      await visit(b);
      const png = await new Promise<string>((r) => (pending = r));
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 630;
      const g = c.getContext('2d')!;
      g.drawImage(await load(png), 0, 0);
      const shade = g.createLinearGradient(0, 0, 760, 0);
      shade.addColorStop(0, 'rgba(4,8,20,0.85)');
      shade.addColorStop(0.65, 'rgba(4,8,20,0.45)');
      shade.addColorStop(1, 'rgba(4,8,20,0)');
      g.fillStyle = shade;
      g.fillRect(0, 0, 1200, 630);
      const font = '-apple-system, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      g.fillStyle = '#ffffff';
      g.font = `700 ${b.info.name.length > 9 ? 84 : 104}px ${font}`;
      g.fillText(b.info.name, 72, 300);
      g.fillStyle = '#f3c66b';
      g.font = `600 42px ${font}`;
      // the kind, wrapped to the text column
      let line = '', y = 368;
      for (const word of b.info.kind.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (g.measureText(next).width > 560 && line) {
          g.fillText(line, 72, y);
          line = word;
          y += 52;
        } else line = next;
      }
      g.fillText(line, 72, y);
      g.fillStyle = 'rgba(220,228,245,0.85)';
      g.font = `500 30px ${font}`;
      g.fillText(UI.title, 72, 560);
      const jpg = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.88));
      await fetch(`/__og/${id}`, { method: 'POST', body: jpg });
      console.log('og card:', id);
    }
    ctx.flyTo(null, undefined, 'replace');
  }

  /** The home-screen icon: the body on black, square, rings included. */
  async function makeIcon(id: BodyId = 'saturn') {
    await visit(byId.get(id)!);
    size = [1024, 1024, 0, 0.56];
    const png = await new Promise<string>((r) => (pending = r));
    size = [1200, 630, -0.2, 0.66];
    await fetch('/__og/icon', { method: 'POST', body: await (await fetch(png)).blob() });
    ctx.flyTo(null, undefined, 'replace');
  }

  return { beforeRender, makeOgCards, makeIcon };
}
