// Pointer Events polyfill for Safari < 13 (iOS 12 iPads); a no-op where they're native.
import 'pepjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetUrl } from '../assets';
import { keepPointersOnCanvas } from '../pointerFix';
import { createSky } from '../sky';
import { createPanel } from './panel';
import {
  auToScene, habitableZone, MAX_PLANETS, sceneToAu, STARS, starColor, starSceneRadius, tempBand, temperatureC, yearDays,
  type PlanetKind, type PlanetSize, type StarKind,
} from './physics';
import './builder.css';

// «Моя система»: the child picks a star and adds planets, drags them nearer or farther, and sees what
// follows by real physics (physics.ts): the year, the warmth, the weight, whether life could be there.
// The system is kept in this browser (one system).

export interface PlanetState {
  id: number;
  kind: PlanetKind;
  size: PlanetSize;
  /** distance from the star, AU */
  au: number;
  /** where on its orbit it is now, radians */
  angle: number;
}
export interface State {
  star: StarKind;
  planets: PlanetState[];
}
const STORE = 'planets.builder.v1';

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? '') as State;
    if (s && STARS[s.star] && Array.isArray(s.planets)) return s;
  } catch {
    /* nothing kept yet, or storage unavailable */
  }
  return { star: 'sun', planets: [] };
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* private mode: the system lives until the page closes */
    }
  }, 300);
}
const state = load();
let selected: number | null = null;

// ---------- renderer, camera, sky ----------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const lowEnd = !document.createElement('canvas').getContext('webgl2');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEnd, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x000000);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 40000);
keepPointersOnCanvas(canvas);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
const sky = createSky();
scene.add(sky.group);
scene.add(new THREE.AmbientLight(0xffffff, 0.06));

// ---------- textures (plain three materials here: sRGB maps) ----------
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
const LITE = new Set(['earth_day.jpg', 'jupiter.jpg', 'moon.jpg', 'mars.jpg']);
function texture(file: string) {
  let t = cache.get(file);
  if (!t) {
    t = loader.load(assetUrl((LITE.has(file) ? 'textures/lite/' : 'textures/') + file));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(file, t);
  }
  return t;
}

// ---------- the star ----------
const starGroup = new THREE.Group();
scene.add(starGroup);
// the photo of the Sun's surface, but only its light and shade: the colour is this star's own
const starMat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: texture('sun.jpg') }, uColor: { value: new THREE.Color() } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      float lum = dot(texture2D(uMap, vUv).rgb, vec3(0.3, 0.59, 0.11));
      float limb = 0.55 + 0.45 * max(vNormal.z, 0.0); // darker towards the edge, as real stars are
      vec3 c = uColor * (0.55 + 0.9 * lum) * limb + vec3(0.25) * lum * limb;
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
});
const starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), starMat);
starGroup.add(starMesh);
const glowCanvas = document.createElement('canvas');
glowCanvas.width = glowCanvas.height = 256;
{
  const g = glowCanvas.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
}
const glowTex = new THREE.CanvasTexture(glowCanvas);
glowTex.colorSpace = THREE.SRGBColorSpace;
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
starGroup.add(glow);
const light = new THREE.PointLight(0xffffff, 3, 0, 0);
scene.add(light);

// the habitable zone: a soft green band
const zoneMat = new THREE.MeshBasicMaterial({ color: 0x4ee08a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
const zone = new THREE.Mesh(new THREE.RingGeometry(1, 2, 160), zoneMat);
zone.rotation.x = -Math.PI / 2;
scene.add(zone);
const zoneEdges = [0, 1].map(() => {
  const l = new THREE.LineLoop(circle(1), new THREE.LineBasicMaterial({ color: 0x7af0aa, transparent: true, opacity: 0.45 }));
  scene.add(l);
  return l;
});

function circle(r: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 192; i++) {
    const a = (i / 192) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

let starR = 8;
function applyStar(frame: boolean) {
  const s = STARS[state.star];
  const [r, g, b] = starColor(s.temp);
  starR = starSceneRadius(s);
  starMesh.scale.setScalar(starR);
  starMat.uniforms.uColor.value.setRGB(r, g, b);
  (glow.material as THREE.SpriteMaterial).color.setRGB(r, g, b);
  glow.scale.setScalar(starR * 7);
  light.color.setRGB(r, g, b);
  const hz = habitableZone(s);
  const inner = auToScene(hz.inner), outer = auToScene(hz.outer);
  zone.geometry.dispose();
  zone.geometry = new THREE.RingGeometry(inner, outer, 160);
  zoneEdges[0].scale.setScalar(inner);
  zoneEdges[1].scale.setScalar(outer);
  if (frame) frameView();
}

/** The part of the screen the panel leaves free (the panel is on the right, or a sheet at the bottom). */
function freeArea() {
  const w = window.innerWidth, h = window.innerHeight;
  const rc = document.getElementById('panel')!.getBoundingClientRect();
  const sheet = rc.top > h * 0.25; // a bottom sheet rather than a side column
  const right = sheet ? w : rc.left - 8;
  const bottom = sheet ? rc.top - 8 : h;
  const top = 64; // under the back button
  return { cx: right / 2, cy: (top + bottom) / 2, w: right, h: bottom - top };
}

/** Look at the whole system (the zone and every planet) from above at a slant, filling the free area. */
function frameView() {
  const outer = auToScene(habitableZone(STARS[state.star]).outer);
  const far = Math.max(outer, ...state.planets.map((p) => drawnR(p) + planetRadius(p))) * 1.15 + 10;
  const a = freeArea();
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  // the half-size of the free area as a slope from the camera; the system's disk, seen at a slant, is
  // about as tall as it is wide times 0.75
  const fit = Math.min((tanV * a.w) / window.innerHeight, (tanV * a.h) / window.innerHeight / 0.75);
  const dir = new THREE.Vector3(0, 0.75, 1).normalize();
  camera.position.copy(dir.multiplyScalar(far / fit));
  controls.target.set(0, 0, 0);
  controls.minDistance = starR * 2.5;
  controls.maxDistance = camera.position.length() * 3;
}

/** Shift the picture's centre into the free area (smoothly, as the panel grows and shrinks). */
const shift = { x: 0, y: 0 };
function followFreeArea() {
  const w = window.innerWidth, h = window.innerHeight;
  const a = freeArea();
  shift.x += (w / 2 - a.cx - shift.x) * 0.15;
  shift.y += (h / 2 - a.cy - shift.y) * 0.15;
  camera.setViewOffset(w, h, shift.x, shift.y, w, h);
}

// ---------- planets ----------
interface PlanetView {
  group: THREE.Group;
  mesh: THREE.Mesh;
  orbit: THREE.LineLoop;
  mat: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
}
const views = new Map<number, PlanetView>();
const sphere = new THREE.SphereGeometry(1, 64, 48);
const orbitMat = new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.22 });
const orbitSelMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7 });
const selRingMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });

/** How a planet looks: a rocky one by its warmth (scorched, desert, seas, icy), giants by kind. */
function planetMap(p: PlanetState) {
  if (p.kind === 'gas') return 'jupiter.jpg';
  if (p.kind === 'ice') return 'neptune.jpg';
  return { scorching: 'venus.jpg', hot: 'mars.jpg', mild: 'earth_day.jpg', cold: 'ganymede.jpg', frozen: 'europa.jpg' }[tempBand(temperatureC(STARS[state.star], p.au, p.kind))];
}
// drawn sizes: not to scale (next to the zone's width real planets would be invisible specks)
const planetRadius = (p: PlanetState) => (p.kind === 'gas' ? 17 : p.kind === 'ice' ? 13 : { small: 5, medium: 7.5, large: 10 }[p.size]);
/** drawn distance: never inside the star */
const drawnR = (p: PlanetState) => Math.max(auToScene(p.au), starR + planetRadius(p) + 3);

function viewOf(p: PlanetState) {
  let v = views.get(p.id);
  if (!v) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.userData.id = p.id;
    const group = new THREE.Group();
    group.add(mesh);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.5, 64), selRingMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    const orbit = new THREE.LineLoop(circle(1), orbitMat);
    scene.add(group, orbit);
    v = { group, mesh, orbit, mat, ring };
    views.set(p.id, v);
  }
  return v;
}

function refreshPlanet(p: PlanetState) {
  const v = viewOf(p);
  const file = planetMap(p);
  if (v.mat.map !== texture(file)) {
    v.mat.map = texture(file);
    v.mat.needsUpdate = true;
  }
  const r = planetRadius(p);
  v.mesh.scale.setScalar(r);
  v.ring.scale.setScalar(r);
  v.ring.visible = p.id === selected;
  v.orbit.material = p.id === selected ? orbitSelMat : orbitMat;
  const d = drawnR(p);
  v.orbit.scale.setScalar(d);
  v.group.position.set(Math.cos(p.angle) * d, 0, Math.sin(p.angle) * d);
}

function refreshAll() {
  for (const [id, v] of views)
    if (!state.planets.some((p) => p.id === id)) {
      scene.remove(v.group, v.orbit);
      v.mat.dispose();
      views.delete(id);
    }
  for (const p of state.planets) refreshPlanet(p);
  panel.render();
}

// ---------- the panel ----------
const panel = createPanel({
  state,
  selected: () => selected,
  setStar(k) {
    state.star = k;
    applyStar(true);
    refreshAll();
    save();
  },
  addPlanet(kind) {
    if (state.planets.length >= MAX_PLANETS) return;
    const hz = habitableZone(STARS[state.star]);
    // rocky ones start in the zone of life; giants farther out, as in our system
    const base = kind === 'rocky' ? (hz.inner + hz.outer) / 2 : hz.outer * (kind === 'gas' ? 3.5 : 9);
    const p: PlanetState = {
      id: Math.max(0, ...state.planets.map((x) => x.id)) + 1,
      kind,
      size: 'medium',
      au: base * (0.85 + Math.random() * 0.3),
      angle: Math.random() * Math.PI * 2,
    };
    state.planets.push(p);
    selected = p.id;
    refreshAll();
    save();
  },
  select(id) {
    selected = id;
    refreshAll();
  },
  update(id, change) {
    const p = state.planets.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, change);
    refreshAll();
    save();
  },
  remove(id) {
    state.planets = state.planets.filter((p) => p.id !== id);
    if (selected === id) selected = null;
    refreshAll();
    save();
  },
  clear() {
    state.planets = [];
    state.star = 'sun';
    selected = null;
    applyStar(true);
    refreshAll();
    save();
  },
});

// ---------- dragging planets ----------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
let dragging: PlanetState | null = null;
let down: { x: number; y: number } | null = null;

function aim(e: PointerEvent) {
  const rc = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  aim(e);
  // a little generous: small planets are hard to hit with a finger
  const meshes = [...views.values()].map((v) => v.mesh);
  let found = ray.intersectObjects(meshes)[0]?.object;
  if (!found) {
    let best = Infinity;
    for (const v of views.values()) {
      const s = v.group.position.clone().project(camera);
      const rc = canvas.getBoundingClientRect();
      const d = Math.hypot(((s.x + 1) / 2) * rc.width + rc.left - e.clientX, ((1 - s.y) / 2) * rc.height + rc.top - e.clientY);
      if (d < 34 && d < best) {
        best = d;
        found = v.mesh;
      }
    }
  }
  if (found) {
    dragging = state.planets.find((p) => p.id === found!.userData.id) ?? null;
    selected = dragging?.id ?? null;
    controls.enabled = false;
    refreshAll();
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  aim(e);
  if (!ray.ray.intersectPlane(plane, hit)) return;
  const outer = auToScene(habitableZone(STARS[state.star]).outer);
  const r = THREE.MathUtils.clamp(Math.hypot(hit.x, hit.z), starR + planetRadius(dragging) + 3, outer * 3.2);
  dragging.au = sceneToAu(r);
  dragging.angle = Math.atan2(hit.z, hit.x);
  refreshPlanet(dragging);
  panel.render();
});
const endDrag = (e: PointerEvent) => {
  const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8;
  if (dragging) save();
  else if (tap && selected !== null) {
    selected = null; // a tap on empty space puts the planet's card away
    refreshAll();
  }
  dragging = null;
  down = null;
  controls.enabled = true;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- sizing, loop ----------
const pixelRatio = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2);
function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  sky.setPixelRatio(pixelRatio);
}
window.addEventListener('resize', resize);
resize();
applyStar(false);
refreshAll(); // the panel first: the view is framed into the space it leaves
frameView();

/** one Earth year on screen, seconds: real ratios between the planets' years, sped up */
const EARTH_YEAR_S = 20;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  for (const p of state.planets) {
    if (p === dragging) continue;
    const period = THREE.MathUtils.clamp((yearDays(STARS[state.star], p.au) / 365.25) * EARTH_YEAR_S, 2, 600);
    p.angle -= (dt / period) * Math.PI * 2;
    const v = views.get(p.id);
    if (v) {
      const d = drawnR(p);
      v.group.position.set(Math.cos(p.angle) * d, 0, Math.sin(p.angle) * d);
      v.mesh.rotation.y += dt * 0.3;
    }
  }
  starMesh.rotation.y += dt * 0.02;
  followFreeArea();
  controls.update();
  sky.group.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { builder: unknown }).builder = { state, scene, camera };
