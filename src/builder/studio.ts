import * as THREE from 'three';
import { BUILDER } from '../content';
import { say } from '../speech';
import { clearPainting, dab, paintedMaterial, SURFACES, SWATCH, type Painting, type Surface } from './paint';

// The painting studio: the chosen planet big on the screen, a palette of kinds of ground below.
// «Малювати»: a finger paints on the globe; «Крутити»: a finger turns it. Same renderer and sky as the
// system view (the frame loop draws the studio instead while it is open).

const L = BUILDER.labels;
const S = BUILDER.say;
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export interface Climate {
  cold: number;
  dry: number;
  clouds: number;
  light: THREE.Color;
}

export function createStudio(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, sky: THREE.Object3D, home: THREE.Scene) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40000);
  camera.position.set(0, 0, 3.6);
  const globe = new THREE.Group();
  globe.rotation.set(0.35, -0.6, 0);
  scene.add(globe);
  const geo = new THREE.SphereGeometry(1, 160, 120);
  let mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  let painting: Painting | null = null;
  let onClose: (() => void) | null = null;
  let surface: Surface = 'forest';
  let big = true;
  let mode: 'paint' | 'turn' = 'paint';
  let time = 0;

  const bar = document.createElement('div');
  bar.id = 'studio';
  document.body.appendChild(bar);

  function renderBar() {
    bar.innerHTML = `
      <p class="hint">${L.paint_hint}<button class="say" data-say="paint_hint" aria-label="Послухати">${SPEAKER}</button></p>
      <div class="palette">${SURFACES.map((s) => `
        <div class="swatch-tile${s === surface ? ' on' : ''}">
          <button class="swatch" data-surface="${s}"><span style="background:${SWATCH[s]}"></span>${L[`surf_${s}`]}</button>
          <button class="say" data-say="surf_${s}" aria-label="Послухати">${SPEAKER}</button>
        </div>`).join('')}
      </div>
      <div class="tools">
        <button class="seg${mode === 'paint' ? ' on' : ''}" data-mode="paint">✏️ ${L.paint_draw}</button>
        <button class="seg${mode === 'turn' ? ' on' : ''}" data-mode="turn">✋ ${L.paint_turn}</button>
        <button class="seg${big ? ' on' : ''}" data-brush="big">${L.brush_big}</button>
        <button class="seg${!big ? ' on' : ''}" data-brush="small">${L.brush_small}</button>
        <button class="seg" data-clear="1">${L.paint_clear}</button>
        <button class="say" data-say="paint_climate" aria-label="Послухати">${SPEAKER}</button>
        <button class="done" data-done="1">${L.paint_done}</button>
      </div>`;
  }
  bar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    const d = t.dataset;
    if (d.say) return void say(S[d.say as keyof typeof S]);
    if (d.surface) surface = d.surface as Surface;
    if (d.mode) mode = d.mode as 'paint' | 'turn';
    if (d.brush) big = d.brush === 'big';
    if (d.clear && painting) clearPainting(painting, 'ocean');
    if (d.done) return close();
    renderBar();
  });

  // ---- painting and turning with a finger ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let last: { x: number; y: number } | null = null;
  function paintAt(x: number, y: number) {
    if (!mesh || !painting) return;
    const rc = canvas.getBoundingClientRect();
    ndc.set(((x - rc.left) / rc.width) * 2 - 1, -((y - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    globe.updateMatrixWorld(true); // turned since the last frame, or just opened
    const hit = ray.intersectObject(mesh)[0];
    if (hit?.uv) dab(painting, surface, hit.uv, big ? 22 : 9);
  }
  function down(e: PointerEvent) {
    if (!active()) return;
    last = { x: e.clientX, y: e.clientY };
    if (mode === 'paint') paintAt(e.clientX, e.clientY);
  }
  function move(e: PointerEvent) {
    if (!active() || !last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    if (mode === 'turn') {
      globe.rotation.y += dx * 0.008;
      globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + dy * 0.008, -1.2, 1.2);
    } else {
      // fill the gap of a quick stroke: a dab every few pixels along it
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
      for (let i = 1; i <= steps; i++) paintAt(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
    }
    last = { x: e.clientX, y: e.clientY };
  }
  const up = () => (last = null);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  function active() {
    return !!mesh;
  }

  function open(p: Painting, climate: Climate, done: () => void) {
    painting = p;
    onClose = done;
    mesh = new THREE.Mesh(geo, paintedMaterial(p));
    const u = mesh.material.uniforms;
    u.uLightPos.value.set(-40, 25, 50);
    u.uLightColor.value.copy(climate.light);
    u.uCold.value = climate.cold;
    u.uDry.value = climate.dry;
    u.uClouds.value = climate.clouds * 0.6; // lighter: the child wants to see the painting
    globe.add(mesh);
    scene.add(sky);
    mode = 'paint';
    document.body.classList.add('painting');
    renderBar();
  }

  function close() {
    if (!mesh) return;
    globe.remove(mesh);
    mesh.material.dispose();
    mesh = null;
    home.add(sky);
    document.body.classList.remove('painting');
    const done = onClose;
    onClose = null;
    done?.();
  }

  /** the globe fills the space above the palette */
  function frame(dt: number) {
    time += dt;
    if (mesh) mesh.material.uniforms.uTime.value = time;
    const w = window.innerWidth, h = window.innerHeight;
    const top = 60, bottom = bar.getBoundingClientRect().top - 10;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, 0, h / 2 - (top + bottom) / 2, w, h);
    const fit = Math.min((bottom - top) / h, w / h) * Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(0, 0, 1.12 / Math.sin(Math.atan(fit)));
    camera.updateProjectionMatrix();
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  }

  return { open, close, frame, active };
}
