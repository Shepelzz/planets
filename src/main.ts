// Pointer Events polyfill for Safari < 13 (iOS 12 iPads); a no-op where they're native.
import 'pepjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBodies, createOrbitLines, loadRealStation, updateBodies, type Body } from './bodies';
import type { BodyId } from './data';
import { createSky } from './sky';
import { createUI } from './ui';
import { Cutaway } from './cutaway';
import { loadingManager, useLiteTextures } from './textures';
import { renderThumbnails } from './thumbnails';
import { NARRATION, UI } from './content';
import { say } from './speech';
import './style.css';

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
useLiteTextures(lowEnd);
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
};
loadingManager.onError = (url) => console.warn('texture failed to load', url);

const sky = createSky();
scene.add(sky.group);

const bodies = createBodies(scene, lowEnd);
const lines = createOrbitLines(scene, bodies);
const byId = new Map(bodies.map((b) => [b.info.id, b]));
const sunBody = byId.get('sun')!;

// ---------- moon systems shown only while visiting ----------
// A giant's moons (and Mars's) appear when we fly to the planet or one of its moons. While there,
// another planet or moon passing through the system is hidden: the squeezed orbits overlap.
const systemReach = new Map<BodyId, number>();
for (const b of bodies) {
  const p = b.info.parent;
  if (!p || !byId.get(p)!.info.moonsWhenNear) continue;
  const reach = b.info.orbit + b.info.radius;
  systemReach.set(p, Math.max(systemReach.get(p) ?? 0, reach));
}
// While visiting a planet with moons, the orbits make room for its moon system: the planet itself
// moves out a little if the inner neighbours are too close, and every planet beyond it moves further
// out, just enough to clear it. The camera rides along; back in the overview all return to place.
const planets = bodies.filter((b) => !b.info.parent && b !== sunBody);
/** How far a planet's always-shown things reach: rings, or moons like the Moon and Charon. */
function extent(b: Body) {
  let e = b.viewRadius;
  if (!b.info.moonsWhenNear)
    for (const m of bodies) if (m.info.parent === b.info.id) e = Math.max(e, m.info.orbit + m.viewRadius);
  return e;
}
const extents = new Map(planets.map((b) => [b, extent(b)]));
const ROOM = 4; // gap left between systems
function updateSpread(dt: number) {
  const visiting = focus ? byId.get(focus.info.parent ?? focus.info.id)! : null;
  const reach = visiting ? systemReach.get(visiting.info.id) : undefined;
  const target = new Map<Body, number>(planets.map((p) => [p, p.info.orbit]));
  if (visiting && reach !== undefined) {
    const r = visiting.info.orbit, band = Math.max(reach, visiting.viewRadius) + ROOM;
    let inner = 0;
    for (const p of planets) if (p.info.orbit < r) inner = Math.max(inner, p.info.orbit + extents.get(p)!);
    const at = Math.max(r, inner + band);
    target.set(visiting, at);
    let limit = at + band;
    for (const p of planets.filter((x) => x.info.orbit > r).sort((x, y) => x.info.orbit - y.info.orbit)) {
      const e = extents.get(p)!;
      const t = Math.max(p.info.orbit, limit + e);
      target.set(p, t);
      limit = t + e + ROOM;
    }
  }
  const k = 1 - Math.exp(-dt * 2.5);
  for (const p of planets) {
    const t = target.get(p)!;
    const now = p.orbitR ?? p.info.orbit;
    p.orbitR = Math.abs(t - now) < 0.01 ? t : now + (t - now) * k;
  }
}

function updateSystems() {
  const visiting = focus ? focus.info.parent ?? focus.info.id : null;
  const host = visiting ? byId.get(visiting)! : null;
  const reach = visiting ? systemReach.get(visiting) : undefined;
  for (const b of bodies) {
    const p = b.info.parent;
    const mine = (p ?? b.info.id) === visiting;
    let show = !p || !byId.get(p)!.info.moonsWhenNear || p === visiting;
    if (show && reach !== undefined && host && !mine && b !== sunBody)
      show = b.anchor.position.distanceTo(host.anchor.position) > reach + b.viewRadius;
    b.anchor.visible = show;
    const line = lines.get(b.info.id);
    if (line) line.visible = show;
  }
}

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

// ---------- sizing ----------
// Pixel ratio starts at a sensible level and is lowered automatically if frames are slow (see frame()).
const maxPixelRatio = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2);
const minPixelRatio = lowEnd ? 0.75 : 1;
let pixelRatio = maxPixelRatio;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = pixelRatio;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sky.setPixelRatio(pr);
}
window.addEventListener('resize', resize);
resize();

// ---------- camera focus & flights ----------
let focus: Body | null = null;
const lastFocusPos = new THREE.Vector3();
const lastFocusQuat = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

interface Flight {
  t: number;
  duration: number;
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  to: Body | null;
  offset: THREE.Vector3; // final camera position relative to target (in a station's own frame for a station)
  overviewTarget?: THREE.Vector3;
  fromUp: THREE.Vector3;
}
let flight: Flight | null = null;

const OVERVIEW_OFFSET = new THREE.Vector3(0, 308, 555);

/** Screen area not covered by the top bar, dock and info panel. */
function freeArea() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = 70, bottom = h, right = w;
  const dock = document.getElementById('dock')!.getBoundingClientRect();
  bottom = Math.min(bottom, dock.top - 8);
  const moons = document.getElementById('moons');
  if (moons && moons.classList.contains('show')) bottom = Math.min(bottom, moons.getBoundingClientRect().top - 8);
  const info = document.getElementById('info')!;
  if (!info.hidden) {
    const rc = info.getBoundingClientRect();
    if (rc.height > h * 0.55 && rc.left > w * 0.4) right = rc.left - 8; // side panel
    else bottom = Math.min(bottom, rc.top - 8); // bottom sheet
  }
  return { cx: right / 2, cy: (top + bottom) / 2, w: right, h: bottom - top };
}

/** Distance at which a sphere of radius r fills a comfortable part of the free screen area. */
function fitDistance(r: number) {
  const a = freeArea();
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const t = tanV * Math.min(a.w, a.h) / window.innerHeight;
  return (r / Math.sin(Math.atan(t))) * 1.18;
}

// Shift the projection centre into the free area so the planet isn't hidden behind the panel.
const viewShift = { x: 0, y: 0 };
function updateViewOffset() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const a = freeArea();
  const tx = w / 2 - a.cx;
  const ty = h / 2 - a.cy;
  viewShift.x += (tx - viewShift.x) * 0.08;
  viewShift.y += (ty - viewShift.y) * 0.08;
  camera.setViewOffset(w, h, viewShift.x, viewShift.y, w, h);
}

/** Where the camera ends up relative to the body it flies to; for a station in the station's own frame. */
function focusOffset(b: Body) {
  // a station: from behind, a bit to the side and above, so the planet sweeps by below it
  if (b.station) return new THREE.Vector3(-0.55, -0.45, 0.7).normalize().multiplyScalar(fitDistance(b.viewRadius));
  const pos = b.anchor.position;
  const toSun = pos.lengthSq() > 0 ? pos.clone().negate().normalize() : new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, toSun).normalize();
  // three-quarter lit view: sun behind-left of the camera, slightly from above
  const dir = toSun.multiplyScalar(0.62).addScaledVector(side, 0.78).addScaledVector(up, 0.2).normalize();
  if (b.info.id === 'sun') dir.set(0.3, 0.25, 1).normalize();
  if (b.info.rings) dir.addScaledVector(up, 0.25).normalize();
  return dir.multiplyScalar(fitDistance(b.viewRadius));
}

function flyTo(b: Body | null, duration?: number) {
  cutaway.close();
  if (b?.station) loadRealStation(b); // fetch the detailed model while we fly
  if (b) say(NARRATION[b.info.id].intro);
  ui.setSelected(b ? b.info.id : null); // first, so the panel's size is known for framing
  flight = {
    t: 0,
    duration: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    to: b,
    offset: b ? focusOffset(b) : OVERVIEW_OFFSET.clone(),
    overviewTarget: b ? undefined : new THREE.Vector3(),
    fromUp: camera.up.clone(),
  };
  // longer trips take a little longer, so the speed always feels calm
  const dest = (b ? b.anchor.position : flight.overviewTarget!).clone().add(worldOffset(flight));
  flight.duration = duration ?? THREE.MathUtils.clamp(2.2 + camera.position.distanceTo(dest) / 350, 2.4, 4.2);
  focus = b;
  controls.enabled = false;
}

function worldOffset(f: Flight) {
  return f.to?.station ? f.offset.clone().applyQuaternion(f.to.tilt.quaternion) : f.offset;
}

/** Near a station "up" is away from its planet, so the planet always stays below; elsewhere it is world up. */
function upFor(b: Body | null) {
  return b?.station ? new THREE.Vector3(0, 0, 1).applyQuaternion(b.tilt.quaternion) : WORLD_UP;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function updateFlight(dt: number) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / flight.duration);
  const k = ease(flight.t);
  const target = flight.to ? flight.to.anchor.position : flight.overviewTarget!;
  const endPos = target.clone().add(worldOffset(flight));
  controls.target.lerpVectors(flight.fromTarget, target, k);
  camera.position.lerpVectors(flight.fromPos, endPos, k);
  // gentle arc so the path doesn't cut through planets
  const span = flight.fromPos.distanceTo(endPos);
  camera.position.y += Math.sin(Math.PI * k) * span * 0.12;
  camera.up.lerpVectors(flight.fromUp, upFor(flight.to), k).normalize();
  camera.lookAt(controls.target);
  if (flight.t >= 1) {
    flight = null;
    controls.enabled = true;
    configureLimits();
  }
  if (focus) {
    lastFocusPos.copy(focus.anchor.position);
    lastFocusQuat.copy(focus.tilt.quaternion);
  }
}

function configureLimits() {
  if (focus) {
    const r = focus.info.radius;
    controls.minDistance = r * (focus.info.id === 'sun' ? 1.6 : 1.25);
    controls.maxDistance = focus.station ? fitDistance(focus.viewRadius) * 3 : Math.max(fitDistance(focus.viewRadius) * 6, r * 20);
  } else {
    controls.minDistance = 120; // stay outside the Sun
    controls.maxDistance = 2200;
  }
}

/** Keep the camera riding along with the focused body as it orbits. */
function followFocus() {
  if (!focus || flight) return;
  if (focus.station) {
    // ride in the station's own frame: as it circles the planet the view turns with it
    const turn = focus.tilt.quaternion.clone().multiply(lastFocusQuat.invert());
    for (const p of [camera.position, controls.target]) p.sub(lastFocusPos).applyQuaternion(turn).add(focus.anchor.position);
    camera.up.copy(upFor(focus));
    lastFocusQuat.copy(focus.tilt.quaternion);
  } else {
    camera.position.add(focus.anchor.position).sub(lastFocusPos);
    controls.target.add(focus.anchor.position).sub(lastFocusPos);
  }
  lastFocusPos.copy(focus.anchor.position);
}

/** Around a station the camera can swing towards the planet below: never let it sink into it. */
function keepAbovePlanet() {
  if (!focus?.station) return;
  const planet = byId.get(focus.info.parent!)!;
  const min = planet.info.radius * 1.03;
  const rel = camera.position.clone().sub(planet.anchor.position);
  if (rel.length() < min) camera.position.copy(planet.anchor.position).addScaledVector(rel.normalize(), min);
}

function adaptNearPlane() {
  const dist = camera.position.distanceTo(controls.target);
  const surface = focus ? Math.max(dist - focus.info.radius * 1.02, 0.001) : dist;
  camera.near = THREE.MathUtils.clamp(surface * 0.25, 0.002, 5);
  camera.far = 40000;
  camera.updateProjectionMatrix();
}

// ---------- picking (screen-space, finger friendly) ----------
const v = new THREE.Vector3();
function screenInfo(b: Body) {
  v.copy(b.anchor.position).project(camera);
  const behind = v.z > 1;
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  const dist = camera.position.distanceTo(b.anchor.position);
  const vFov = (camera.fov * Math.PI) / 180;
  const pxRadius = (b.info.radius / (dist * Math.tan(vFov / 2))) * (window.innerHeight / 2);
  return { x, y, behind, pxRadius, dist };
}

function pick(px: number, py: number): Body | null {
  let best: Body | null = null;
  let bestDist = Infinity;
  for (const b of bodies) {
    if (!b.anchor.visible) continue;
    const s = screenInfo(b);
    if (s.behind) continue;
    const reach = Math.max(s.pxRadius, 26);
    const d = Math.hypot(s.x - px, s.y - py);
    if (d <= reach && s.dist < bestDist) {
      best = b;
      bestDist = s.dist;
    }
  }
  return best;
}

let down: { x: number; y: number; t: number } | null = null;
// a pinch is not a tap: remember if a second finger touched during the gesture
const pointersDown = new Set<number>();
let multiTouch = false;
canvas.addEventListener('pointerdown', (e) => {
  pointersDown.add(e.pointerId);
  if (pointersDown.size > 1) multiTouch = true;
  else multiTouch = false;
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
const pointerGone = (e: PointerEvent) => pointersDown.delete(e.pointerId);
canvas.addEventListener('pointercancel', pointerGone);
canvas.addEventListener('pointerup', (e) => {
  pointerGone(e);
  if (!down || multiTouch) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 450;
  down = null;
  if (moved > 10 || !quick) return; // a drag that turned the camera
  const b = pick(e.clientX, e.clientY);
  if (!b) ui.hideInfo(); // tap on empty space puts the card away
  else if (b === focus) ui.showInfo();
  else flyTo(b);
});
// stop Safari's page pinch-zoom from fighting the 3D pinch
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------- UI ----------
let playing = true;
const ui = createUI({
  onSelect: (id: BodyId) => {
    const b = byId.get(id)!;
    if (b !== focus || flight) flyTo(b);
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
    const i = focus ? bodies.indexOf(focus) : -1;
    const n = bodies.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
    flyTo(bodies[next < 0 ? n - 1 : next]);
  }
  if (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш') ui.toggleInfo();
  if (e.key === 'l' || e.key === 'L' || e.key === 'д' || e.key === 'Д') ui.toggleLabels();
  if (e.key === 's' || e.key === 'S' || e.key === 'і' || e.key === 'І' || e.key === 'ы' || e.key === 'Ы') ui.toggleSound();
});

// ---------- labels ----------
const labelLayer = document.getElementById('labels')!;
const labels = new Map<BodyId, HTMLButtonElement>();
for (const b of bodies) {
  const el = document.createElement('button');
  el.className = 'label';
  el.textContent = b.info.name;
  el.addEventListener('click', () => flyTo(b));
  labelLayer.appendChild(el);
  labels.set(b.info.id, el);
}

const toBody = new THREE.Vector3();
const toOther = new THREE.Vector3();
/** True if a bigger body sits between the camera and b. */
function occluded(b: Body) {
  toBody.subVectors(b.anchor.position, camera.position);
  const dist = toBody.length();
  toBody.divideScalar(dist);
  for (const o of bodies) {
    if (o === b || !o.anchor.visible || o.info.radius <= b.info.radius) continue;
    toOther.subVectors(o.anchor.position, camera.position);
    const along = toOther.dot(toBody);
    if (along <= 0 || along >= dist) continue;
    if (toOther.lengthSq() - along * along < o.info.radius * o.info.radius) return true;
  }
  return false;
}

function updateLabels() {
  for (const b of bodies) {
    const el = labels.get(b.info.id)!;
    const s = screenInfo(b);
    let show = b.anchor.visible && !s.behind && s.pxRadius < 90 && b !== focus && !flight && !occluded(b);
    // a moon or station drawn right next to its planet: the planet's label is enough
    if (b.info.parent && byId.get(b.info.parent) !== focus) {
      const p = screenInfo(byId.get(b.info.parent)!);
      if (Math.hypot(s.x - p.x, s.y - p.y) < p.pxRadius + 40) show = false;
    }
    el.classList.toggle('show', show);
    if (show) el.style.transform = `translate(-50%, 0) translate(${s.x.toFixed(1)}px, ${(s.y + s.pxRadius + 8).toFixed(1)}px)`;
  }
}

// ---------- initial view ----------
updateBodies(bodies, 0, 0, lines);
camera.position.copy(OVERVIEW_OFFSET).multiplyScalar(1.6);
controls.target.set(0, 0, 0);
configureLimits();
flyTo(null);
ui.setSelected(null);

// debug handle
(window as unknown as { space: unknown }).space = { scene, lowEnd, getPixelRatio: () => pixelRatio, renderer, bodies, camera, controls, flyTo: (id: BodyId | null, d?: number) => flyTo(id ? byId.get(id)! : null, d) };

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
  updateSpread(rawDt > 0.5 ? 0.5 : rawDt);
  updateBodies(bodies, playing ? dt : 0, simTime, lines, camera.position);
  updateSystems();
  updateFlight(Math.min(rawDt, 0.5)); // flights run on wall-clock time even when frames stutter
  cutaway.update(Math.min(rawDt, 0.1));
  followFocus();
  // during a flight the camera is ours: OrbitControls would clamp it to the old planet's zoom limits
  if (!flight) controls.update();
  keepAbovePlanet();
  updateViewOffset();
  adaptNearPlane();
  sky.group.position.copy(camera.position);
  // the wide halo looks like fog up close, so fade it in with distance
  const halo = sunBody.anchor.userData.halo as THREE.Sprite;
  halo.material.opacity = THREE.MathUtils.smoothstep(camera.position.length(), 150, 450);
  updateLabels();
  renderer.render(scene, camera);
  if (!loaded && texturesReady) {
    loaded = true;
    loaderEl.classList.add('done');
  }
  requestAnimationFrame(frame);
}
// compile every shader up front so the first flight doesn't stutter
renderer.compile(scene, camera);
requestAnimationFrame(frame);
