// Pointer Events polyfill for Safari < 13 (iOS 12 iPads); a no-op where they're native.
import 'pepjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBodies, createOrbitLines, loadRealStation, showDetail, updateBodies, type Body } from './bodies';
import { CameraDirector } from './camera';
import { NARRATION, UI } from './content';
import { Cutaway } from './cutaway';
import type { BodyId } from './data';
import { createDevTools } from './devTools';
import { createLabels, listenForTaps, pickBody } from './labels';
import { onAddressChange, pathSegment, showAddress } from './routes';
import { createSky } from './sky';
import { preload, say } from './speech';
import { createSystems } from './systems';
import { loadingManager, setDetailAllowed } from './textures';
import { renderThumbnails } from './thumbnails';
import { createUI } from './ui';
import './style.css';

// The app: sets up the scene and ties the parts together — bodies (bodies.ts), the camera
// (camera.ts), moon systems (systems.ts), addresses (routes.ts), labels and taps (labels.ts), the
// panels (ui.ts), narration (speech.ts) — and runs the frame loop.

const canvas = document.getElementById('scene') as HTMLCanvasElement;
// `?webgl1` forces the WebGL 1 path (how old iPads on iOS 12 run) for testing on a modern browser
const forceWebGL1 = new URLSearchParams(location.search).has('webgl1');
// No WebGL 2 means an old device (iOS 12 iPads: A7/A8 GPU, 1 GB RAM). Decided before creating the
// context because MSAA can't be switched off later: light mode = 2K maps, fewer triangles, no MSAA,
// fewer pixels, no blur behind the panels.
const lowEnd = forceWebGL1 || !document.createElement('canvas').getContext('webgl2');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !lowEnd,
  powerPreference: 'high-performance',
  context: forceWebGL1 ? (canvas.getContext('webgl', { antialias: false }) as WebGLRenderingContext) : undefined,
});
setDetailAllowed(!lowEnd);
document.body.classList.toggle('low-end', lowEnd);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 40000);

// ---------- loading screen ----------
const loaderEl = document.getElementById('loader')!;
const loaderText = loaderEl.querySelector('.loader-text')!;
let texturesReady = false;
loadingManager.onProgress = (_url, done, total) => {
  loaderText.textContent = `${UI.loading} ${Math.round((done / total) * 100)}%`;
};
loadingManager.onLoad = () => {
  texturesReady = true;
  // real planet pictures for the dock, info card and size comparison
  ui.setThumbnails(renderThumbnails(bodies.map((b) => b.info.id)));
  // each body's intro plays the moment it is chosen: fetch them ahead, in the background
  preload(bodies.map((b) => NARRATION[b.info.id].intro));
};
loadingManager.onError = (url) => console.warn('texture failed to load', url);

// ---------- the scene ----------
const sky = createSky();
scene.add(sky.group);
const bodies = createBodies(scene, lowEnd);
const lines = createOrbitLines(scene, bodies);
const byId = new Map(bodies.map((b) => [b.info.id, b]));
const sunBody = byId.get('sun')!;
const systems = createSystems(bodies, lines);

// textbook cut-away of the focused body ("З чого складається" block)
const cutLabels = document.createElement('div');
cutLabels.id = 'cut-labels';
document.body.appendChild(cutLabels);
const cutaway = new Cutaway(scene, camera, cutLabels);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;
const director = new CameraDirector(camera, controls, byId);

// ---------- sizing ----------
// Pixel ratio starts at a sensible level and is lowered automatically if frames are slow (see frame()).
const maxPixelRatio = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2);
const minPixelRatio = lowEnd ? 0.75 : 1;
let pixelRatio = maxPixelRatio;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sky.setPixelRatio(pixelRatio);
}
window.addEventListener('resize', resize);
resize();

// ---------- going somewhere ----------
/**
 * Fly to a body (null: the whole system): address, card, narration, maps, then the camera.
 * card: 'later' — its card slides in when we arrive (chosen from the dock, a link…); 'hidden' — no
 * card (the body was tapped in the scene: tapping it again opens the card).
 */
function flyTo(b: Body | null, duration?: number, address: 'push' | 'replace' | 'none' = 'push', card: 'later' | 'hidden' = 'later') {
  showAddress(b ? { id: b.info.id, name: b.info.name } : null, address);
  cutaway.close();
  if (b?.station) loadRealStation(b); // fetch the detailed model while we fly
  // the 4K map of where we are going (for the ISS: Earth below it)
  showDetail(b?.station ? byId.get(b.info.parent!)! : b);
  if (b) say(NARRATION[b.info.id].intro);
  ui.setSelected(b ? b.info.id : null, card); // before the camera: the panel's place changes the framing
  director.flyTo(b, duration);
}
director.onArrive = () => ui.revealInfo();
const bodyFromPath = () => byId.get(pathSegment() as BodyId) ?? null;
onAddressChange(() => flyTo(bodyFromPath(), undefined, 'none'));

// ---------- taps and labels ----------
listenForTaps(canvas, (x, y) => {
  const b = pickBody(camera, bodies, x, y);
  if (!b) ui.hideInfo(); // tap on empty space puts the card away
  else if (b === director.focus) ui.toggleInfo(); // tap the body we are at: card away, or back again
  else flyTo(b, undefined, 'push', 'hidden'); // just go there; the card waits for a second tap
});
// stop Safari's page pinch-zoom from fighting the 3D pinch
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
const labels = createLabels(document.getElementById('labels')!, camera, bodies, (b) => flyTo(b, undefined, 'push', 'hidden'));

// ---------- UI ----------
let playing = true;
const ui = createUI({
  onSelect: (id: BodyId) => {
    const b = byId.get(id)!;
    if (b !== director.focus || director.flying) flyTo(b);
    else {
      ui.showInfo();
      say(NARRATION[b.info.id].intro); // tapping the same planet again repeats the intro
    }
  },
  onOverview: () => flyTo(null),
  onTogglePlay: () => {
    playing = !playing;
    ui.setPlaying(playing);
  },
  onTalk: () => cutaway.fold(),
  onStructure: (onEnd) => {
    const focus = director.focus;
    if (!focus) return false;
    if (cutaway.isOpen(focus)) {
      cutaway.close();
      return false;
    }
    cutaway.open(focus, onEnd);
    return true;
  },
});
ui.setPlaying(playing);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') flyTo(null);
  if (e.key === ' ') {
    e.preventDefault();
    playing = !playing;
    ui.setPlaying(playing);
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const i = director.focus ? bodies.indexOf(director.focus) : -1;
    const n = bodies.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
    flyTo(bodies[next < 0 ? n - 1 : next]);
  }
  if (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш') ui.toggleInfo();
  if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') ui.toggleLabels();
  if (e.key === 's' || e.key === 'S' || e.key === 'і' || e.key === 'І' || e.key === 'ы' || e.key === 'Ы') ui.toggleSound();
});

// ---------- initial view ----------
updateBodies(bodies, 0, 0, lines);
{
  // open at the body in the address (a shared link), or the whole system
  const start = bodyFromPath();
  flyTo(start, undefined, 'replace');
  if (!start) ui.setSelected(null);
}

// dev tools (link-preview cards, icon): only in `npm run dev`, left out of the build
const dev = import.meta.env.DEV
  ? createDevTools({ renderer, scene, camera, controls, sky: sky.group, bodies, lines, director, flyTo, hideInfo: () => ui.hideInfo(), resize })
  : null;

// debug handle
(window as unknown as { space: unknown }).space = {
  scene, lowEnd, getPixelRatio: () => pixelRatio, renderer, bodies, camera, controls,
  flyTo: (id: BodyId | null, d?: number) => flyTo(id ? byId.get(id)! : null, d),
  ...(dev ? { makeOgCards: dev.makeOgCards, makeIcon: dev.makeIcon } : {}),
};

// ---------- loop ----------
let lastNow = performance.now();
// adaptive resolution: two slow seconds in a row → render fewer pixels (never goes back up)
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let slowSeconds = 0;
function adaptResolution(now: number) {
  fpsFrames++;
  if (now - fpsWindowStart < 1000) return;
  const fps = (fpsFrames * 1000) / (now - fpsWindowStart);
  fpsFrames = 0;
  fpsWindowStart = now;
  if (!loaded || document.visibilityState !== 'visible') return;
  slowSeconds = fps < 40 ? slowSeconds + 1 : 0;
  if (slowSeconds >= 2 && pixelRatio > minPixelRatio) {
    pixelRatio = Math.max(minPixelRatio, pixelRatio - 0.25);
    slowSeconds = 0;
    resize();
  }
}
let simTime = 0;
let loaded = false;

function frame(now: number) {
  const rawDt = Math.max(0, (now - lastNow) / 1000);
  lastNow = now;
  adaptResolution(now);
  const dt = Math.min(rawDt, 0.1);
  if (playing) simTime += dt;
  systems.spread(director.focus, rawDt > 0.5 ? 0.5 : rawDt);
  updateBodies(bodies, playing ? dt : 0, simTime, lines, camera.position);
  systems.visibility(director.focus);
  director.update(rawDt);
  cutaway.update(Math.min(rawDt, 0.1));
  sky.group.position.copy(camera.position);
  // the wide halo looks like fog up close, so fade it in with distance
  const halo = sunBody.anchor.userData.halo as THREE.Sprite;
  halo.material.opacity = THREE.MathUtils.smoothstep(camera.position.length(), 150, 450);
  labels.update(director.focus, director.flying);
  dev?.beforeRender();
  renderer.render(scene, camera);
  if (!loaded && texturesReady) {
    loaded = true;
    loaderEl.classList.add('done');
  }
  requestAnimationFrame(frame);
}

// offline: the built site keeps what it has loaded (dist/sw.js, see offline() in vite.config.ts)
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

// compile every shader up front so the first flight doesn't stutter
renderer.compile(scene, camera);
requestAnimationFrame(frame);
