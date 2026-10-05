// Pointer Events polyfill for Safari < 13 (iOS 12 iPads); a no-op where they're native.
import 'pepjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetUrl } from '../assets';
import { keepPointersOnCanvas } from '../pointerFix';
import { createSky } from '../sky';
import { dab, newPainting, oceanShare, paintedMaterial, paintingFromData, paintingToData, type Painting } from './paint';
import { createAwards } from './awards';
import { createBlast, mergePlanets, type EventKind } from './events';
import { createPanel } from './panel';
import { createStudio, type Climate } from './studio';
import {
  auToScene, habitableZone, MAX_PLANETS, tooClose, pairStars, pairYearDays, sceneToAu, separation, unstableWithin, STARS, starColor, starSceneRadius, tempBand, temperatureC, yearDays,
  type Air, type PlanetKind, type PlanetSize, type StarKind,
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
  /** a rocky planet's air and water (giants: always gas, no surface water) */
  air: Air;
  water: boolean;
  rings: boolean;
  /** 0–3 */
  moons: number;
  /** a rocky planet painted by hand: its map of kinds of ground (two PNG pictures, paint.ts) */
  paint?: [string, string];
  /** 1 just after a collision (molten all over), cooling to 0 */
  molten?: number;
}
export interface State {
  star: StarKind;
  /** a second star (the pair circles its centre of mass; planets circle both) */
  star2?: StarKind | null;
  planets: PlanetState[];
}

/** The star(s) as the planets feel them: one star, or the pair's light and mass added up. */
const pairOf = (s: State) => pairStars(s.star, s.star2);
/** Is this planet inside the pair's unstable zone (no lasting orbit there)? */
const unstable = (s: State, au: number) => !!s.star2 && au < unstableWithin(pairOf(s));
const STORE = 'planets.builder.v1';

/** A new planet's make-up, like its kind usually is in our system. */
export function defaults(kind: PlanetKind): Pick<PlanetState, 'air' | 'water' | 'rings' | 'moons'> {
  if (kind === 'gas') return { air: 'thick', water: false, rings: false, moons: 3 };
  if (kind === 'ice') return { air: 'thick', water: false, rings: true, moons: 2 };
  return { air: 'earth', water: true, rings: false, moons: 1 };
}

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? '') as State;
    if (s && STARS[s.star] && Array.isArray(s.planets)) {
      // systems kept before planets had air, water, rings and moons
      s.planets = s.planets.map((p) => ({ ...defaults(p.kind), ...p }));
      return s;
    }
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
/** the painted planets' maps, by planet id */
const paintings = new Map<number, Painting>();
for (const p of state.planets) if (p.paint) paintings.set(p.id, paintingFromData(p.paint));
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

// ---------- the star(s) ----------
// the photo of the Sun's surface, but only its light and shade: the colour is each star's own
const STAR_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const STAR_FRAG = /* glsl */ `
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
  }`;
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
const starGeo = new THREE.SphereGeometry(1, 64, 48);

/** A star: its ball, its glow and its light, moving together. */
function makeStar() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uMap: { value: texture('sun.jpg') }, uColor: { value: new THREE.Color() } } });
  const mesh = new THREE.Mesh(starGeo, mat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const light = new THREE.PointLight(0xffffff, 3, 0, 0);
  group.add(mesh, glow, light);
  scene.add(group);
  return { group, mesh, mat, glow, light, r: 8 };
}
const suns = [makeStar(), makeStar()];

/** the unstable zone round a pair of stars: a faint red disc with a red edge */
const unstableDisc = new THREE.Mesh(new THREE.RingGeometry(0.0001, 1, 128), new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
unstableDisc.rotation.x = -Math.PI / 2;
const unstableEdge = new THREE.LineLoop(circle(1), new THREE.LineBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.6 }));
scene.add(unstableDisc, unstableEdge);
/** the pair's turn round each other, radians, and their drawn distance apart */
let pairAngle = 0;
let pairSep = 0;

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

/** how far from the middle the star(s) reach, drawn: planets stay outside it */
let starR = 8;
function applyStar(frame: boolean) {
  const kinds = [state.star, state.star2 ?? null];
  suns.forEach((sun, i) => {
    const k = kinds[i];
    sun.group.visible = !!k;
    if (!k) return;
    const [r, g, b] = starColor(STARS[k].temp);
    sun.r = starSceneRadius(STARS[k]);
    sun.mesh.scale.setScalar(sun.r);
    sun.mat.uniforms.uColor.value.setRGB(r, g, b);
    (sun.glow.material as THREE.SpriteMaterial).color.setRGB(r, g, b);
    sun.glow.scale.setScalar(sun.r * 7);
    sun.light.color.setRGB(r, g, b);
    // two lights add up: each gives its share of the pair's light (kept in a pleasant range)
    sun.light.intensity = state.star2 ? 3 * Math.min(Math.max(STARS[k].lum / pairOf(state).lum, 0.25), 0.75) * 1.6 : 3;
  });
  const s = pairOf(state);
  pairSep = state.star2 ? auToScene(separation(s)) : 0;
  starR = state.star2 ? pairSep / 2 + Math.max(suns[0].r, suns[1].r) : suns[0].r;
  unstableDisc.visible = unstableEdge.visible = !!state.star2;
  if (state.star2) {
    const u = auToScene(unstableWithin(s));
    unstableDisc.scale.setScalar(u);
    unstableEdge.scale.setScalar(u);
  }
  placeStars();
  const hz = habitableZone(s);
  const inner = auToScene(hz.inner), outer = auToScene(hz.outer);
  zone.geometry.dispose();
  zone.geometry = new THREE.RingGeometry(inner, outer, 160);
  zoneEdges[0].scale.setScalar(inner);
  zoneEdges[1].scale.setScalar(outer);
  if (frame) frameView();
}

/** The pair circles its centre of mass: the heavier star nearer the middle, on a smaller circle. */
function placeStars() {
  if (!state.star2) {
    suns[0].group.position.set(0, 0, 0);
    return;
  }
  const m1 = STARS[state.star].mass, m2 = STARS[state.star2].mass;
  const r1 = (pairSep * m2) / (m1 + m2), r2 = (pairSep * m1) / (m1 + m2);
  suns[0].group.position.set(Math.cos(pairAngle) * r1, 0, Math.sin(pairAngle) * r1);
  suns[1].group.position.set(-Math.cos(pairAngle) * r2, 0, -Math.sin(pairAngle) * r2);
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
  const outer = auToScene(habitableZone(pairOf(state)).outer);
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
  air: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** the painted look, when the planet has a painting */
  painted: THREE.ShaderMaterial | null;
  /** the Roche limit, shown while a moon is pulled in */
  roche: THREE.LineLoop;
  rings: THREE.Mesh;
  moons: THREE.Mesh[];
}
const views = new Map<number, PlanetView>();
const sphere = new THREE.SphereGeometry(1, 64, 48);
const orbitMat = new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.22 });
const orbitSelMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7 });
const orbitBadMat = new THREE.LineBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.5 });
const orbitWarnMat = new THREE.LineBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.6 });

/** A planet whose orbit is too near this one's to last (physics.ts), or so near they would touch on screen. */
function neighbourOf(p: PlanetState) {
  return state.planets.find((q) => q !== p && (tooClose(pairOf(state), p, q) || Math.abs(drawnR(p) - drawnR(q)) < planetRadius(p) + planetRadius(q) + 2)) ?? null;
}

/** Molten after a collision: glowing lava (painted planets in their shader, others by their material). */
function showMolten(v: PlanetView, p: PlanetState) {
  const m = p.molten ?? 0;
  if (v.painted) v.painted.uniforms.uMolten.value = m;
  v.mat.emissive.setRGB(1, 0.35, 0.08).multiplyScalar(m * 1.3);
  v.mat.color.setScalar(1 - 0.7 * m);
}
const selRingMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });

/**
 * How a planet looks (real maps of the planets and moons that are like it): a rocky one by its warmth,
 * water and air — scorched, a desert, seas, ice, or Venus's clouds under thick air; giants by kind.
 */
function planetMap(p: PlanetState) {
  if (p.kind === 'gas') return 'jupiter.jpg';
  if (p.kind === 'ice') return 'neptune.jpg';
  const band = tempBand(temperatureC(pairOf(state), p.au, p));
  if (p.air === 'thick' && band !== 'cold' && band !== 'frozen') return 'venus.jpg'; // the clouds are all one sees
  if (band === 'scorching') return 'mercury.jpg';
  if (band === 'hot') return 'mars.jpg';
  if (band === 'mild') return p.water && (p.air === 'earth' || p.air === 'thick') ? 'earth_day.jpg' : 'mars.jpg';
  if (p.water) return 'europa.jpg'; // its seas frozen over
  return band === 'cold' ? 'ganymede.jpg' : 'callisto.jpg';
}

/** the glow of a planet's air at its rim: none, thin and reddish, blue like ours, thick and golden */
function airLook(p: PlanetState): [number, number, number, number] {
  if (p.kind === 'gas') return [1.0, 0.86, 0.62, 0.6];
  if (p.kind === 'ice') return [0.55, 0.82, 1.0, 0.8];
  return ({ none: [0, 0, 0, 0], thin: [1.0, 0.62, 0.48, 0.35], earth: [0.32, 0.6, 1.0, 1.0], thick: [1.0, 0.82, 0.48, 1.2] } as const)[p.air] as [number, number, number, number];
}
const AIR_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const AIR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  gl_FragColor = vec4(uColor * rim * uStrength, 1.0);
}`;

/** Saturn's ring photo is a strip from the inner edge to the outer one: map it across the ring. */
function ringGeometry(inner: number, outer: number) {
  const g = new THREE.RingGeometry(inner, outer, 128, 1);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
  return g;
}
const ringGeo = ringGeometry(1.35, 2.3);
const moonGeo = new THREE.SphereGeometry(1, 32, 24);
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
    const air = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 48, 32),
      new THREE.ShaderMaterial({ vertexShader: AIR_VERT, fragmentShader: AIR_FRAG, uniforms: { uColor: { value: new THREE.Color() }, uStrength: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    const rings = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: texture('saturn_ring.png'), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    rings.rotation.set(-Math.PI / 2 + 0.45, 0, 0.2);
    group.add(air, rings);
    const orbit = new THREE.LineLoop(circle(1), orbitMat);
    scene.add(group, orbit);
    const roche = new THREE.LineLoop(circle(1.6), new THREE.LineDashedMaterial({ color: 0xff6a5a, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.8 }));
    roche.computeLineDistances();
    roche.visible = false;
    group.add(roche);
    v = { group, mesh, orbit, mat, ring, air, rings, moons: [], painted: null, roche };
    views.set(p.id, v);
  }
  return v;
}

/** What the climate does to a painting: seas freeze when cold, dry up when hot or without air; clouds with air like ours. */
function climate(p: PlanetState): Climate {
  const c = temperatureC(pairOf(state), p.au, p);
  const [r, g, b] = starColor(pairOf(state).temp); // the brighter star's colour
  return {
    cold: THREE.MathUtils.smoothstep(-c, 5, 45),
    dry: Math.max(THREE.MathUtils.smoothstep(c, 45, 120), p.air === 'none' || p.air === 'thin' ? 0.9 : 0),
    clouds: p.air === 'earth' ? 0.7 : p.air === 'thick' ? 1 : 0,
    light: new THREE.Color(r, g, b),
  };
}

function refreshPlanet(p: PlanetState) {
  const v = viewOf(p);
  const painting = p.kind === 'rocky' ? paintings.get(p.id) : undefined;
  if (painting) {
    if (!v.painted) v.painted = paintedMaterial(painting);
    const u = v.painted.uniforms, cl = climate(p);
    u.uA.value = painting.textures[0];
    u.uB.value = painting.textures[1];
    u.uCold.value = cl.cold;
    u.uDry.value = cl.dry;
    u.uClouds.value = cl.clouds;
    u.uLightColor.value.copy(cl.light);
    v.mesh.material = v.painted;
  } else {
    v.mesh.material = v.mat;
    const file = planetMap(p);
    if (v.mat.map !== texture(file)) {
      v.mat.map = texture(file);
      v.mat.needsUpdate = true;
    }
  }
  const r = planetRadius(p);
  v.mesh.scale.setScalar(r);
  v.ring.scale.setScalar(r);
  const [ar, ag, ab, strength] = airLook(p);
  v.air.visible = strength > 0;
  v.air.material.uniforms.uColor.value.setRGB(ar, ag, ab);
  v.air.material.uniforms.uStrength.value = strength;
  v.air.scale.setScalar(r);
  v.rings.visible = p.rings;
  v.rings.scale.setScalar(r);
  v.roche.scale.setScalar(r);
  // moons: little grey worlds at a few planet-widths
  while (v.moons.length < p.moons) {
    const m = new THREE.Mesh(moonGeo, new THREE.MeshStandardMaterial({ map: texture('moon.jpg'), roughness: 1 }));
    m.userData.phase = Math.random() * Math.PI * 2;
    v.moons.push(m);
    v.group.add(m);
  }
  while (v.moons.length > p.moons) v.group.remove(v.moons.pop()!);
  v.moons.forEach((m, i) => {
    m.scale.setScalar(r * (0.22 - i * 0.03));
    m.userData.dist = r * (p.rings ? 2.8 : 2) + i * r * 0.8;
  });
  v.ring.visible = p.id === selected;
  v.orbit.material = p.id === selected ? orbitSelMat : unstable(state, p.au) ? orbitBadMat : neighbourOf(p) ? orbitWarnMat : orbitMat;
  showMolten(v, p);
  const d = drawnR(p);
  v.orbit.scale.setScalar(d);
  v.group.position.set(Math.cos(p.angle) * d, 0, Math.sin(p.angle) * d);
}

function refreshAll() {
  for (const [id, v] of views)
    if (!state.planets.some((p) => p.id === id)) {
      scene.remove(v.group, v.orbit);
      v.mat.dispose();
      v.painted?.dispose();
      paintings.delete(id);
      v.air.material.dispose();
      for (const m of v.moons) (m.material as THREE.Material).dispose();
      views.delete(id);
    }
  for (const p of state.planets) refreshPlanet(p);
  awards.check(state);
  panel.render();
}

// ---------- the panel, the discoveries ----------
const awards = createAwards();
const blast = createBlast(scene);

// ---------- what happens when worlds meet (events.ts) ----------
type Happening =
  | { kind: 'collide'; a: PlanetState; b: PlanetState; t: number; from: [number, number, number, number]; meet: number; meetR: number }
  | { kind: 'ring'; p: PlanetState; t: number };
let happening: Happening | null = null;
/** the last thing that happened (its card in the panel), and the system as it was before it */
let lastEvent: EventKind | null = null;
let before: string | null = null;
const APPROACH = 1.8; // seconds for two planets to come together
const PULL = 2.4; // seconds for a moon to spiral in

/** where an angle meets another the short way round */
const towards = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

function collide(id: number) {
  const a = state.planets.find((p) => p.id === id);
  const b = a && neighbourOf(a);
  if (!a || !b || happening) return;
  before = JSON.stringify(state);
  const meet = Math.atan2(Math.sin(a.angle) + Math.sin(b.angle), Math.cos(a.angle) + Math.cos(b.angle));
  happening = { kind: 'collide', a, b, t: 0, from: [towards(meet, a.angle), drawnR(a), towards(meet, b.angle), drawnR(b)], meet, meetR: (drawnR(a) + drawnR(b)) / 2 };
}

function pullMoon(id: number) {
  const p = state.planets.find((x) => x.id === id);
  if (!p || !p.moons || happening) return;
  before = JSON.stringify(state);
  happening = { kind: 'ring', p, t: 0 };
}

/** Back to how the system was before the last event. */
function undo() {
  if (!before) return;
  const s = JSON.parse(before) as State;
  for (const v of views.values()) {
    scene.remove(v.group, v.orbit);
    v.mat.dispose();
    v.painted?.dispose();
  }
  views.clear();
  paintings.clear();
  state.star = s.star;
  state.star2 = s.star2;
  state.planets = s.planets;
  for (const p of state.planets) if (p.paint) paintings.set(p.id, paintingFromData(p.paint));
  before = null;
  lastEvent = null;
  applyStar(false);
  refreshAll();
  save();
}

/** One frame of what is happening, if anything; planets in it are placed here, not by their orbits. */
function happen(dt: number) {
  const h = happening;
  if (!h) return;
  h.t += dt;
  if (h.kind === 'collide') {
    const k = Math.min(h.t / APPROACH, 1);
    const e = k * k * (3 - 2 * k);
    const place = (p: PlanetState, ang: number, r: number) => views.get(p.id)?.group.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    place(h.a, h.from[0] + (h.meet - h.from[0]) * e, h.from[1] + (h.meetR - h.from[1]) * e);
    place(h.b, h.from[2] + (h.meet - h.from[2]) * e, h.from[3] + (h.meetR - h.from[3]) * e);
    if (k < 1) return;
    // impact: the two become one (events.ts), a flash and a cloud of debris where they met
    const { keep, gone, kind } = mergePlanets(h.a, h.b);
    keep.angle = h.meet;
    const where = new THREE.Vector3(Math.cos(h.meet) * h.meetR, 0, Math.sin(h.meet) * h.meetR);
    state.planets = state.planets.filter((p) => p !== gone).map((p) => (p.id === keep.id ? keep : p));
    const painting = paintings.get(keep.id);
    if (painting && kind === 'merge') {
      // the scar of the impact on the painted map: a ring of mountains round a dark basin
      const at = new THREE.Vector2(Math.random(), 0.35 + Math.random() * 0.3);
      dab(painting, 'mountains', at, 26);
      dab(painting, 'desert', at, 13);
      keep.paint = paintingToData(painting);
    }
    blast.boom(where, planetRadius(keep));
    lastEvent = kind;
    selected = keep.id;
    happening = null;
    refreshAll();
    if (awards.check(state, ['collision'])) panel.render();
    save();
  } else {
    const v = views.get(h.p.id);
    const moon = v?.moons[0];
    if (!v || !moon) {
      happening = null;
      return;
    }
    // the moon spirals in, stretched by the tides more and more
    const k = Math.min(h.t / PULL, 1);
    const r = planetRadius(h.p);
    moon.userData.phase += dt * (2 + 6 * k);
    const dist = moon.userData.dist * (1 - k) + r * 1.05 * k;
    moon.position.set(Math.cos(moon.userData.phase) * dist, 0, Math.sin(moon.userData.phase) * dist);
    moon.scale.set(r * 0.22 * (1 + 2.5 * k * k), r * 0.22 * (1 - 0.5 * k), r * 0.22 * (1 - 0.5 * k));
    moon.rotation.y = -moon.userData.phase;
    v.roche.visible = true;
    if (k < 1) return;
    // torn apart: a ring
    v.roche.visible = false;
    h.p.moons -= 1;
    h.p.rings = true;
    blast.boom(v.group.position.clone().add(moon.position), r * 0.5);
    lastEvent = 'ring';
    selected = h.p.id;
    happening = null;
    refreshAll();
    if (awards.check(state, ['moon_ring'])) panel.render();
    save();
  }
}

const panel = createPanel({
  state,
  awards,
  neighbour: (id) => {
    const p = state.planets.find((x) => x.id === id);
    return !!p && !!neighbourOf(p);
  },
  event: () => lastEvent,
  busy: () => !!happening,
  collide,
  pullMoon,
  undo,
  selected: () => selected,
  setStar(k) {
    state.star = k;
    applyStar(true);
    refreshAll();
    save();
  },
  setStar2(k) {
    state.star2 = k;
    applyStar(true);
    refreshAll();
    save();
  },
  addPlanet(kind) {
    if (state.planets.length >= MAX_PLANETS) return;
    const hz = habitableZone(pairOf(state));
    // rocky ones start in the zone of life; giants farther out, as in our system
    const base = kind === 'rocky' ? (hz.inner + hz.outer) / 2 : hz.outer * (kind === 'gas' ? 3.5 : 9);
    const p: PlanetState = {
      id: Math.max(0, ...state.planets.map((x) => x.id)) + 1,
      kind,
      size: 'medium',
      au: base * (0.85 + Math.random() * 0.3),
      angle: Math.random() * Math.PI * 2,
      ...defaults(kind),
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
  paint(id) {
    const p = state.planets.find((x) => x.id === id);
    if (!p || p.kind !== 'rocky') return;
    // a first painting starts as the planet is: a water world, or bare desert without water
    const painting = paintings.get(id) ?? newPainting(p.water ? 'ocean' : 'desert');
    controls.enabled = false;
    studio.open(painting, climate(p), () => {
      paintings.set(id, painting);
      p.paint = paintingToData(painting);
      p.water = oceanShare(painting) > 0.02; // painted seas are its water
      controls.enabled = true;
      refreshAll();
      save();
    });
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
    state.star2 = null;
    selected = null;
    applyStar(true);
    refreshAll();
    save();
  },
});

const studio = createStudio(renderer, canvas, sky.group, scene);

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
  if (studio.active()) return; // the painting studio has the canvas
  down = { x: e.clientX, y: e.clientY };
  if (happening) return; // let it happen
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
  const outer = auToScene(habitableZone(pairOf(state)).outer);
  const r = THREE.MathUtils.clamp(Math.hypot(hit.x, hit.z), starR + planetRadius(dragging) + 3, outer * 3.2);
  dragging.au = sceneToAu(r);
  dragging.angle = Math.atan2(hit.z, hit.x);
  refreshPlanet(dragging);
  panel.render();
});
const endDrag = (e: PointerEvent) => {
  const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8;
  if (dragging) {
    save();
    if (awards.check(state)) panel.render(); // a planet dragged somewhere new may be a discovery
  }
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
  if (studio.active()) {
    studio.frame(dt);
    requestAnimationFrame(frame);
    return;
  }
  happen(dt);
  blast.frame(dt);
  const h = happening;
  for (const p of state.planets) {
    if (p.molten) {
      // cooling: a crust forms, the glow fades (about a quarter of a minute)
      const was = p.molten;
      p.molten = Math.max(0, was - dt / 16);
      const v = views.get(p.id);
      if (v) showMolten(v, p);
      if (was > 0.25 && p.molten <= 0.25) panel.render();
      if (!p.molten) {
        delete p.molten;
        save();
      }
    }
    if (p === dragging) continue;
    if (h?.kind === 'collide' && (p === h.a || p === h.b)) continue; // placed by happen()
    const period = THREE.MathUtils.clamp((yearDays(pairOf(state), p.au) / 365.25) * EARTH_YEAR_S, 2, 600);
    p.angle -= (dt / period) * Math.PI * 2;
    const v = views.get(p.id);
    if (v) {
      const d = drawnR(p);
      v.group.position.set(Math.cos(p.angle) * d, 0, Math.sin(p.angle) * d);
      v.mesh.rotation.y += dt * 0.3;
      v.moons.forEach((m, i) => {
        if (h?.kind === 'ring' && h.p === p && i === 0) return; // being pulled in (happen())
        m.userData.phase += dt * (1.2 - i * 0.25);
        m.position.set(Math.cos(m.userData.phase) * m.userData.dist, 0, Math.sin(m.userData.phase) * m.userData.dist);
      });
    }
  }
  for (const sun of suns) sun.mesh.rotation.y += dt * 0.02;
  if (state.star2) {
    // the pair's own year, sped up like the planets' (real ratio to them), at least a second and a half
    const period = THREE.MathUtils.clamp((pairYearDays(pairOf(state)) / 365.25) * EARTH_YEAR_S, 1.5, 60);
    pairAngle -= (dt / period) * Math.PI * 2;
    placeStars();
  }
  for (const v of views.values()) if (v.painted) v.painted.uniforms.uTime.value = now / 1000;
  followFreeArea();
  controls.update();
  sky.group.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { builder: unknown }).builder = { state, scene, camera };
