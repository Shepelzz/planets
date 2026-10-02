import * as THREE from 'three';
import { BODIES, type BodyInfo } from './content';
import type { CometOrbit } from './data';
import { BUMP_GLSL, NOISE_GLSL } from './noise';
import { BUMP, SURFACES, TEXTURE_FILES } from './surfaces';
import { hasDetail, loadDetail, loadTexture, SRGB_GLSL } from './textures';
import { makeStation, trackSun, type Station } from './station';
import { loadStationModel, turnWings, type RealStation } from './stationModel';

const DEG = Math.PI / 180;

// Cut-away: a wedge between two half-planes through the centre (normals uCutA, uCutB) is not drawn,
// so the layer faces (cutaway.ts) show through. The wedge lives in world space, facing the camera.
export interface CutUniforms {
  uCutOn: { value: number };
  uCutA: { value: THREE.Vector3 };
  uCutB: { value: THREE.Vector3 };
}
const CUT_GLSL = /* glsl */ `
uniform float uCutOn;
uniform vec3 uCutA;
uniform vec3 uCutB;
void cutAway(vec3 rel) {
  if (uCutOn > 0.5 && dot(rel, uCutA) > 0.0 && dot(rel, uCutB) > 0.0) discard;
}`;
const makeCutUniforms = (): CutUniforms => ({
  uCutOn: { value: 0 },
  uCutA: { value: new THREE.Vector3(1, 0, 0) },
  uCutB: { value: new THREE.Vector3(-1, 0, 0) },
});

export interface Body {
  info: BodyInfo;
  /** Positioned at the body's centre in world space, not rotated. */
  anchor: THREE.Group;
  /** Carries the axial tilt; the spinning mesh and rings live inside it. */
  tilt: THREE.Group;
  /** the spinning ball, or a station's model */
  mesh: THREE.Object3D;
  clouds?: THREE.Mesh;
  /** a spacecraft: flies nose first, turns its wings to the Sun, hides in Earth's shadow */
  station?: Station & { occluder: THREE.Vector4; real?: RealStation; loading?: boolean };
  /** Radius that must fit on screen when we fly to this body (rings included). */
  viewRadius: number;
  orbitAngle: number;
  /**
   * Current orbit radius when it differs from info.orbit: while we visit a planet, the neighbours'
   * orbits move aside so its moons never run into them (main.ts), and come back for the overview.
   */
  orbitR?: number;
  spinAngle: number;
  materials: THREE.ShaderMaterial[];
  /** shared by the surface, cloud and Sun shaders */
  cut: CutUniforms;
  /** atmosphere glow, hidden while the planet is cut open */
  atmosphere?: THREE.ShaderMaterial;
  /** a comet's glowing head and tails, changed every frame by how close it is to the Sun */
  comet?: CometParts;
}

/** The surface's map file; none for a made-up surface (the comet's nucleus). */
const mapFile = (info: BodyInfo): string | undefined => (TEXTURE_FILES as Record<string, string>)[info.surface!];

// set in createBodies: old devices get far fewer triangles (the maps carry the detail anyway)
let sphereGeo: THREE.SphereGeometry;
let lowDetail = false;

const VERT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vObjPos = position;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Earth's cloud cover. Close up (uFlow > 0) the winds come alive: a slowly changing swirl pushes the
// map around (bounded, so it never smears) and clouds thicken and thin out. Far away it is the plain
// map, so the overview costs nothing extra. p is the direction in the cloud shell's own space.
const CLOUD_GLSL = /* glsl */ `
uniform sampler2D uClouds;
uniform float uFlow;
float cloudCover(vec2 uv, vec3 p) {
  if (uFlow <= 0.0) return texture2D(uClouds, uv).r;
  float t = uTime * 0.07;
  vec3 q = p * 2.4 + vec3(0.0, t, 0.0);
  uv += vec2(snoise(q), snoise(q + vec3(19.1, 7.3, 3.7))) * vec2(0.006, 0.004) * uFlow;
  float c = texture2D(uClouds, uv).r;
  return c * (1.0 + snoise(p * 6.0 + vec3(t * 1.3, 0.0, -t)) * 0.3 * uFlow);
}`;

// Close up, clouds cast shadows on the ground: follow the ray towards the Sun up to the cloud shell
// and look up the cloud cover there (uWorldToCloud turns a world direction into the shell's own space).
const CLOUD_SHADOW_GLSL = /* glsl */ `
${CLOUD_GLSL}
uniform mat3 uWorldToCloud;
float cloudShadow(vec3 rel, vec3 Ng, vec3 L) {
  if (uFlow <= 0.0) return 1.0;
  vec3 d = normalize(uWorldToCloud * (rel + L * (uRadius * 0.02 / max(dot(Ng, L), 0.2))));
  // longitude from the direction, picking the branch without a jump so the seam keeps its mipmap
  float phi = atan(d.z, -d.x) / 6.2831853;
  float u1 = fract(phi);
  float u2 = fract(phi + 0.5) - 0.5;
  float u = fwidth(u1) <= fwidth(u2) ? u1 : u2;
  vec2 uv = vec2(u, 1.0 - acos(clamp(d.y, -1.0, 1.0)) / 3.1415927);
  return 1.0 - smoothstep(0.1, 0.9, cloudCover(uv, d)) * 0.45 * uFlow;
}`;

const PLANET_FRAG = (surface: string, cloudShadows = false) => /* glsl */ `
uniform vec3 uSunPos;
uniform float uTime;
uniform float uRadius;
uniform float uBump;
uniform vec3 uCenter;
uniform float uHasRings;
uniform vec3 uRingNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
${NOISE_GLSL}
${BUMP_GLSL}
${SRGB_GLSL}
${CUT_GLSL}
${surface}
${cloudShadows ? CLOUD_SHADOW_GLSL : ''}

float ringShadow(vec3 pos, vec3 L) {
  if (uHasRings < 0.5) return 1.0;
  float denom = dot(L, uRingNormal);
  if (abs(denom) < 1e-4) return 1.0;
  float t = dot(uCenter - pos, uRingNormal) / denom;
  if (t <= 0.0) return 1.0;
  float r = length(pos + L * t - uCenter) / uRadius;
  return 1.0 - ringDensity(r) * 0.85;
}

void main() {
  cutAway(vWorldPos - uCenter);
  vec3 p = normalize(vObjPos);
  float h = 0.0, spec = 0.0;
  vec3 night = vec3(0.0);
  vec3 albedo = surface(p, vUv, h, spec, night);

  vec3 Ng = normalize(vWorldNormal);
  vec3 N = uBump > 0.0 ? perturbNormal(vWorldPos, Ng, h, uRadius * uBump) : Ng;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);

  float geo = dot(Ng, L);
  float terminator = smoothstep(-0.03, 0.12, geo);
  float diff = max(dot(N, L), 0.0) * terminator;
  float shadow = ringShadow(vWorldPos, L);
  ${cloudShadows ? 'shadow *= cloudShadow(vWorldPos - uCenter, Ng, L);' : ''}

  vec3 sun = vec3(1.0, 0.97, 0.92) * 2.0;
  vec3 col = albedo * diff * shadow * sun;
  vec3 H = normalize(L + V);
  col += spec * pow(max(dot(N, H), 0.0), 160.0) * 0.28 * terminator * shadow * vec3(1.0, 0.9, 0.75);
  col += spec * pow(1.0 - max(dot(Ng, V), 0.0), 5.0) * 0.08 * terminator * vec3(0.4, 0.6, 1.0);
  col += night * smoothstep(0.08, -0.18, geo);
  // soft light on the night side (starlight / light bounced off neighbours): the surface stays
  // readable, a bit stronger towards the viewer for a sense of volume; city lights still show
  col += albedo * (0.035 + 0.075 * max(dot(Ng, V), 0.0));
  // seen from far away (the overview), light the side facing the camera a little, so planets
  // between us and the Sun read as planets instead of black dots; close up the night stays dark
  // (small bodies count as Earth-sized, or the Moon would get the fill light even up close)
  float far = smoothstep(12.0, 30.0, distance(cameraPosition, uCenter) / max(uRadius, 9.0));
  col += albedo * far * 0.45 * max(dot(Ng, V), 0.0);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform float uTime;
uniform vec3 uCenter;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
${NOISE_GLSL}
${CUT_GLSL}
${CLOUD_GLSL}
void main() {
  cutAway(vWorldPos - uCenter);
  float a = smoothstep(0.08, 0.95, cloudCover(vUv, normalize(vObjPos))) * 0.95;
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uSunPos - vWorldPos);
  float geo = dot(N, L);
  float lit = max(geo, 0.0) * smoothstep(-0.05, 0.15, geo);
  vec3 col = vec3(1.0) * lit * 2.2 + vec3(0.05); // night-side clouds stay faintly visible
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Glow computed analytically from how close the view ray passes to the planet.
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform vec3 uCenter;
uniform float uR;
uniform float uRa;
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vWorldPos;
void main() {
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec3 oc = uCenter - cameraPosition;
  float tca = dot(oc, rd);
  float d = length(oc - rd * tca);
  float h = (d - uR) / (uRa - uR);
  float g;
  if (h < 0.0) g = pow(clamp(d / uR, 0.0, 1.0), 14.0) * 0.55;
  else g = pow(1.0 - clamp(h, 0.0, 1.0), 3.0) * 0.8;
  vec3 pc = cameraPosition + rd * tca;
  vec3 n = normalize(pc - uCenter);
  vec3 L = normalize(uSunPos - uCenter);
  float lit = smoothstep(-0.35, 0.5, dot(n, L));
  // warm tint at sunset line
  vec3 col = mix(uColor * vec3(1.4, 0.8, 0.6), uColor, smoothstep(-0.1, 0.4, dot(n, L)));
  gl_FragColor = vec4(col * g * lit * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uRingNormal;
uniform sampler2D uRingTex;
varying vec3 vLocal;
varying vec3 vWorldPos;
${SRGB_GLSL}
void main() {
  float r = length(vLocal.xy);
  float t = (r - 1.24) / (2.27 - 1.24);
  if (t < 0.0 || t > 1.0) discard;
  vec4 ring = texture2D(uRingTex, vec2(t, 0.5));
  float dens = ring.a;
  if (dens < 0.004) discard;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  // planet's shadow on the rings
  vec3 oc = vWorldPos - uCenter;
  float b = dot(oc, L);
  float closest = length(oc - L * b);
  // soft, partial shadow: fully black rings looked too harsh
  float inShadow = b < 0.0 ? 1.0 - smoothstep(uRadius * 0.88, uRadius * 1.08, closest) : 0.0;
  float shadow = 1.0 - inShadow * 0.55;
  float sameSide = sign(dot(uRingNormal, L)) * sign(dot(uRingNormal, V));
  float lit = sameSide > 0.0 ? 1.0 : 0.6 * (1.0 - dens * 0.45); // light seeping through from the sunlit side
  vec3 col = srgbToLinear(ring.rgb) * 2.3 * lit * shadow * (0.6 + 0.4 * abs(dot(uRingNormal, L)) + 0.3);
  gl_FragColor = vec4(col, dens * 0.95);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDetail;
uniform sampler2D uMap;
uniform vec3 uCenter;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
${NOISE_GLSL}
${SRGB_GLSL}
${CUT_GLSL}
void main() {
  cutAway(vWorldPos - uCenter);
  vec3 p = normalize(vObjPos);
  float t = uTime * 0.04;
  // the real map plus a slowly boiling granulation on top
  float gran = uDetail > 0.5 ? fbm(p * 30.0 + vec3(t, -t, t * 0.7), 3) : 0.0;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = max(dot(normalize(vWorldNormal), V), 0.0);
  float limb = 0.3 + 0.7 * pow(mu, 0.55);
  vec3 col = srgbToLinear(texture2D(uMap, vUv).rgb) * (1.7 + 0.35 * gran);
  col = mix(col, vec3(1.0, 0.9, 0.62), pow(mu, 3.0) * 0.3);
  col = mix(vec3(0.85, 0.14, 0.0), col, limb);
  gl_FragColor = vec4(min(col * (0.45 + 0.7 * limb), vec3(1.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function glowTexture(stops: [number, string][]): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSun(info: BodyInfo, scene: THREE.Scene): Body {
  const anchor = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = info.tilt * DEG;
  anchor.add(tilt);
  const cut = makeCutUniforms();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: SUN_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uDetail: { value: lowDetail ? 0 : 1 },
      uMap: { value: loadTexture(TEXTURE_FILES.sun) },
      uCenter: { value: anchor.position },
      ...cut,
    },
    toneMapped: false, // keep the Sun's colours saturated instead of ACES-washed white
  });
  const mesh = new THREE.Mesh(sphereGeo, mat);
  mesh.scale.setScalar(info.radius);
  tilt.add(mesh);

  const glowMat = (tex: THREE.Texture, opacity: number) =>
    new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, toneMapped: false });
  const inner = new THREE.Sprite(glowMat(glowTexture([
    [0, 'rgba(255,240,200,1)'], [0.46, 'rgba(255,205,120,0.95)'], [0.5, 'rgba(255,170,70,0.55)'],
    [0.62, 'rgba(255,135,45,0.2)'], [0.8, 'rgba(255,110,30,0.05)'], [1, 'rgba(255,100,30,0)'],
  ]), 1));
  inner.scale.setScalar(info.radius * 4.2);
  const outer = new THREE.Sprite(glowMat(glowTexture([
    [0, 'rgba(255,220,170,0.5)'], [0.2, 'rgba(255,190,120,0.12)'], [0.5, 'rgba(255,160,90,0.03)'], [1, 'rgba(255,150,80,0)'],
  ]), 1));
  outer.scale.setScalar(info.radius * 12);
  anchor.add(inner, outer);
  anchor.userData.halo = outer;
  anchor.userData.glow = inner;
  scene.add(anchor);

  return { info, anchor, tilt, mesh, viewRadius: info.radius * 1.4, orbitAngle: 0, spinAngle: 0, materials: [mat], cut };
}

// ---------- close-up maps ----------
// Only the body we visit gets its 4K maps; leaving it puts the 2K ones back and frees the big ones.
interface Detail {
  body: Body;
  swaps: { uniform: { value: THREE.Texture | null }; base: THREE.Texture; big?: THREE.Texture }[];
}
let detail: Detail | null = null;

export function showDetail(b: Body | null) {
  if (detail?.body === b) return;
  if (detail) {
    for (const s of detail.swaps) {
      s.uniform.value = s.base;
      s.big?.dispose();
    }
    detail = null;
  }
  if (!b || !b.info.surface) return;
  const u = b.materials[0].uniforms;
  const file = mapFile(b.info);
  if (!file) return; // a made-up surface (the comet): nothing to sharpen
  const maps: [string, string][] = [['uMap', file]];
  if (b.info.clouds) maps.push(['uClouds', 'earth_clouds.jpg']);
  const mine: Detail = { body: b, swaps: [] };
  detail = mine;
  for (const [name, file] of maps) {
    if (!hasDetail(file) || !u[name]) continue;
    const swap: Detail['swaps'][number] = { uniform: u[name], base: u[name].value };
    mine.swaps.push(swap);
    loadDetail(file)
      .then((big) => {
        if (detail !== mine) return big.dispose(); // already gone elsewhere
        big.wrapS = swap.base.wrapS; // the clouds wrap around the date line
        swap.big = big;
        swap.uniform.value = big;
      })
      .catch(() => {}); // keep the 2K map
  }
}

/** Cloud shell radius; a little above the ground so close up it floats over the land. */
const CLOUD_HEIGHT = 1.018;

function cloudMap() {
  const t = loadTexture('earth_clouds.jpg');
  t.wrapS = THREE.RepeatWrapping; // the winds push the map across the date line (set before the first upload)
  return t;
}

function makePlanet(info: BodyInfo, scene: THREE.Scene): Body {
  const anchor = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = info.tilt * DEG;
  anchor.add(tilt);
  const materials: THREE.ShaderMaterial[] = [];

  const hasRings = !!info.rings;
  const cut = makeCutUniforms();
  const uniforms = {
    ...cut,
    uSunPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRadius: { value: info.radius },
    uBump: { value: BUMP[info.surface!] ?? 0 },
    uMap: { value: mapFile(info) ? loadTexture(mapFile(info)!) : null },
    uNight: { value: info.surface === 'earth' ? loadTexture('earth_night.jpg') : null },
    uCenter: { value: anchor.position },
    uHasRings: { value: hasRings ? 1 : 0 },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
    // cloud shadows (Earth only), shared with the cloud shell
    uClouds: { value: info.clouds ? cloudMap() : null },
    uFlow: { value: 0 },
    uWorldToCloud: { value: new THREE.Matrix3() },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: PLANET_FRAG(SURFACES[info.surface!], info.clouds),
    uniforms,
    extensions: { derivatives: true }, // dFdx/dFdy for bump mapping on WebGL 1
  });
  materials.push(mat);
  const mesh = new THREE.Mesh(info.shape ? lumpyGeometry(info.shape, info.id) : sphereGeo, mat);
  mesh.scale.setScalar(info.radius);
  tilt.add(mesh);

  let clouds: THREE.Mesh | undefined;
  if (info.clouds) {
    const cm = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uSunPos: uniforms.uSunPos,
        uTime: { value: 0 },
        uClouds: uniforms.uClouds,
        uFlow: uniforms.uFlow,
        uCenter: { value: anchor.position },
        ...cut,
      },
      transparent: true,
      depthWrite: false,
    });
    materials.push(cm);
    clouds = new THREE.Mesh(sphereGeo, cm);
    clouds.scale.setScalar(info.radius * CLOUD_HEIGHT);
    tilt.add(clouds);
  }

  let atmosphere: THREE.ShaderMaterial | undefined;
  if (info.atmosphere) {
    const a = info.atmosphere;
    const am = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: {
        uSunPos: uniforms.uSunPos,
        uCenter: { value: anchor.position },
        uR: { value: info.radius },
        uRa: { value: info.radius * a.scale },
        uColor: { value: new THREE.Vector3(...a.color) },
        uIntensity: { value: a.intensity },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materials.push(am);
    atmosphere = am;
    const shell = new THREE.Mesh(sphereGeo, am);
    shell.scale.setScalar(info.radius * a.scale);
    anchor.add(shell);
  }

  let viewRadius = info.radius * (info.atmosphere ? info.atmosphere.scale : 1);
  if (hasRings) {
    const inner = 1.2, outer = 2.3;
    const geo = new THREE.RingGeometry(inner, outer, 360, 12);
    const rm = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uSunPos: uniforms.uSunPos,
        uCenter: { value: anchor.position },
        uRadius: { value: info.radius },
        uRingNormal: uniforms.uRingNormal,
        uRingTex: { value: loadTexture('saturn_ring.png') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    materials.push(rm);
    const ring = new THREE.Mesh(geo, rm);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(info.radius);
    ring.renderOrder = 1;
    tilt.add(ring);
    viewRadius = info.radius * outer;
  }

  scene.add(anchor);
  return { info, anchor, tilt, mesh, clouds, viewRadius, orbitAngle: info.startAngle, spinAngle: 0, materials, cut, atmosphere };
}

/** Phobos, Deimos: a squashed ball with a few broad bumps and dents (largest axis = 1). */
function lumpyGeometry(shape: [number, number, number], id: string) {
  const g = (lowDetail ? new THREE.SphereGeometry(1, 48, 32) : new THREE.SphereGeometry(1, 96, 64));
  let seed = 0;
  for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bumps = Array.from({ length: 9 }, () => ({
    dir: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    amount: (rand() - 0.5) * 0.22,
  }));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const b of bumps) r += b.amount * Math.max(v.dot(b.dir), 0) ** 3;
    v.multiplyScalar(r).set(v.x * shape[0], v.y * shape[1], v.z * shape[2]);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function makeStationBody(info: BodyInfo, scene: THREE.Scene): Body {
  const anchor = new THREE.Group();
  const tilt = new THREE.Group(); // carries the flight attitude, set every frame
  anchor.add(tilt);
  const occluder = new THREE.Vector4();
  const station = makeStation(info.radius, new THREE.Vector3(), occluder);
  tilt.add(station.model);
  scene.add(anchor);
  return {
    info, anchor, tilt, mesh: station.model, viewRadius: info.radius, orbitAngle: info.startAngle, spinAngle: 0,
    materials: station.materials, cut: makeCutUniforms(), station: { ...station, occluder },
  };
}

// ---------- the comet ----------
// The nucleus is an ordinary lumpy body (makePlanet). Around it: a glowing head (coma) and two tails
// pointing away from the Sun — the straight blue gas tail and the wider, curved dust tail, which lags
// behind along the path. All of them grow and brighten near the Sun and shrink far from it. The
// body's tilt group is turned every frame so its x axis points away from the Sun and its y axis
// along the loop's "up": the tails live in it, and the camera rides in it (the tails stay sideways).

interface CometParts {
  ion: THREE.ShaderMaterial;
  dust: THREE.ShaderMaterial;
  ionSparks: THREE.ShaderMaterial;
  dustSparks: THREE.ShaderMaterial;
  core: THREE.Sprite;
  haze: THREE.Sprite;
  veil: THREE.Sprite;
}

const TAIL_VERT = /* glsl */ `
uniform float uLength;
uniform float uR0;
uniform float uR1;
uniform float uBend;
uniform float uWave;
uniform float uTime;
varying float vS;
varying vec3 vRing;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  // position = (along the tail 0..1, cos, sin of the angle around it)
  float s = position.x;
  float r = mix(uR0, uR1, pow(s, 0.75));
  vec3 p = vec3(s * uLength, position.y * r, position.z * r);
  p.z += uBend * s * s * uLength; // the dust tail curves back along the path
  // the solar wind shakes the tail: slow waves running from the head outwards
  p.y += uWave * sin(s * 9.0 - uTime * 1.5) * s * r * 0.45;
  p.z += uWave * sin(s * 6.0 - uTime * 1.1 + 1.7) * s * r * 0.3;
  vS = s;
  vRing = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, position.y, position.z));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const TAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBright;
uniform float uStreaks;
uniform float uSoft;
uniform float uTime;
varying float vS;
varying vec3 vRing;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${NOISE_GLSL}
void main() {
  // a see-through glowing tube: brightest where we look through its middle, fading at the sides
  vec3 V = normalize(cameraPosition - vWorldPos);
  float body = pow(abs(dot(normalize(vWorldNormal), V)), uSoft);
  float along = smoothstep(0.0, 0.04, vS) * pow(1.0 - vS, 1.3);
  // thin streaks of gas flowing away from the head
  float n = fbm(vec3(vRing.y * 1.7, vRing.z * 1.7, vS * 6.0 - uTime * 0.5), 3);
  float streak = mix(1.0, 0.35 + 1.4 * max(n + 0.3, 0.0), uStreaks);
  // glowing knots that break off near the head and race down the tail
  float knot = pow(max(sin(vS * 22.0 - uTime * 2.4 + n * 3.0), 0.0), 6.0) * uStreaks * (1.0 - vS);
  // a gentle flicker of the whole tail
  float flicker = 0.88 + 0.12 * sin(uTime * 3.1 + vS * 4.0);
  gl_FragColor = vec4(uColor * (1.0 + knot), clamp(body * along * (streak + knot * 1.5) * flicker * uBright, 0.0, 1.0));
}`;

let tailGeo: THREE.BufferGeometry | null = null;
/** A tube along x from 0 to 1 (more rings near the head), radius 1: the tail shader shapes it. */
function tailGeometry() {
  if (tailGeo) return tailGeo;
  const rings = 72, around = 28;
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const s = Math.pow(i / rings, 1.7);
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      pos.push(s, Math.cos(a), Math.sin(a));
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j, b = a + around + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tailGeo.setIndex(index);
  return tailGeo;
}

/** streaks: how stripy (gas) vs smooth (dust); soft: how much the glow keeps to the middle of the tube; wave: how much it sways */
function makeTail(color: THREE.Color, streaks: number, soft: number, wave: number) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: TAIL_VERT,
    fragmentShader: TAIL_FRAG,
    uniforms: {
      uLength: { value: 100 },
      uR0: { value: 1 },
      uR1: { value: 10 },
      uBend: { value: 0 },
      uColor: { value: color },
      uBright: { value: 1 },
      uStreaks: { value: streaks },
      uSoft: { value: soft },
      uWave: { value: wave },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(tailGeometry(), mat);
  mesh.frustumCulled = false; // the shader stretches it far beyond its 0..1 box
  return { mesh, mat };
}

// Sparks: grains of dust and puffs of gas leaving the head and drifting down a tail, twinkling. Each
// point only carries random numbers; the shader moves it along the same curve as its tail.
const SPARK_VERT = /* glsl */ `
attribute vec4 seed; // start along the tail, angle around it, distance from its middle, pace
uniform float uLength;
uniform float uR0;
uniform float uR1;
uniform float uBend;
uniform float uTime;
uniform float uSpeed;
uniform float uSize;
uniform float uBright;
uniform float uViewH;
varying float vA;
void main() {
  float s = fract(seed.x + uTime * uSpeed * (0.6 + 0.8 * seed.w));
  float r = mix(uR0, uR1, pow(s, 0.75)) * seed.z;
  vec3 p = vec3(s * uLength, cos(seed.y) * r, sin(seed.y) * r);
  p.z += uBend * s * s * uLength;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * (0.5 + seed.w) * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.001), 48.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * (3.0 + 5.0 * seed.w) + seed.x * 40.0);
  vA = uBright * smoothstep(0.0, 0.06, s) * pow(1.0 - s, 1.5) * twinkle;
}`;
const SPARK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.0, d));
}`;

function makeSparks(count: number, color: THREE.Color, speed: number, size: number, seedOf: number) {
  let n = seedOf;
  const rand = () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seeds.set([rand(), rand() * Math.PI * 2, Math.sqrt(rand()), rand()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // unused, three needs it
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    uniforms: {
      uLength: { value: 100 },
      uR0: { value: 1 },
      uR1: { value: 10 },
      uBend: { value: 0 },
      uTime: { value: 0 },
      uSpeed: { value: speed },
      uSize: { value: size },
      uBright: { value: 1 },
      uViewH: { value: 800 },
      uColor: { value: color },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat };
}

function makeComet(info: BodyInfo, scene: THREE.Scene): Body {
  const b = makePlanet(info, scene);
  const ion = makeTail(new THREE.Color(0.42, 0.66, 1.0), 1, 1.6, 1);
  const dust = makeTail(new THREE.Color(1.0, 0.88, 0.7), 0.35, 3, 0.35);
  b.tilt.add(dust.mesh, ion.mesh);
  const dustSparks = makeSparks(lowDetail ? 140 : 320, new THREE.Color(1.0, 0.86, 0.62), 0.05, 0.22, 7);
  const ionSparks = makeSparks(lowDetail ? 80 : 180, new THREE.Color(0.55, 0.78, 1.0), 0.11, 0.16, 13);
  b.tilt.add(dustSparks.points, ionSparks.points);
  const glow = (stops: [number, string][]) =>
    new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(stops), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  const core = glow([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(225,245,255,0.8)'], [0.4, 'rgba(150,215,255,0.22)'], [1, 'rgba(120,200,255,0)']]);
  const haze = glow([[0, 'rgba(190,240,235,0.55)'], [0.3, 'rgba(140,210,230,0.16)'], [1, 'rgba(100,180,220,0)']]);
  // close up a thin veil of glowing gas over the nucleus (drawn over it: the gas surrounds it)
  const veil = glow([[0, 'rgba(220,245,255,0.5)'], [0.35, 'rgba(180,230,255,0.25)'], [1, 'rgba(150,215,255,0)']]);
  veil.material.depthTest = false;
  veil.renderOrder = 2;
  veil.scale.setScalar(info.radius * 3.4);
  b.anchor.add(haze, core, veil);
  b.comet = { ion: ion.mat, dust: dust.mat, ionSparks: ionSparks.mat, dustSparks: dustSparks.mat, core, haze, veil };
  b.viewRadius = info.radius * 4.5; // frame the glowing head and the start of the tails, not just the nucleus
  return b;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Where on its loop a comet is at this moment of its lap (0..2π), relative to the Sun. */
function cometPosition(c: CometOrbit, lap: number, out: THREE.Vector3) {
  const a = (c.perihelion + c.aphelion) / 2;
  const e = (c.aphelion - c.perihelion) / (c.aphelion + c.perihelion);
  // Kepler's equation with a softened pace: faster near the Sun, slower far away
  let E = lap;
  for (let i = 0; i < 6; i++) E -= (E - c.rush * Math.sin(E) - lap) / (1 - c.rush * Math.cos(E));
  out.set(a * (Math.cos(E) - e), 0, -a * Math.sqrt(1 - e * e) * Math.sin(E));
  return out.applyAxisAngle(X_AXIS, c.inclination * DEG).applyAxisAngle(Y_AXIS, c.turn * DEG);
}

/** Closer to the Sun than this (scene units) a comet's head and tails are at full size. */
const ACTIVE_FROM = 100;
const cometAhead = new THREE.Vector3();
const cometAway = new THREE.Vector3();
const cometUp = new THREE.Vector3();
const cometSide = new THREE.Vector3();
/** Turn the comet's frame away from the Sun and size its head and tails for its distance. */
function updateComet(b: Body, time: number, viewer?: THREE.Vector3) {
  const c = b.info.comet!;
  const parts = b.comet!;
  const r = b.anchor.position.length();
  cometPosition(c, b.orbitAngle + 0.002, cometAhead).sub(b.anchor.position); // direction of travel
  cometAway.copy(b.anchor.position).normalize();
  cometUp.crossVectors(cometAway, cometAhead).normalize();
  if (cometUp.y < 0) cometUp.negate();
  cometSide.crossVectors(cometAway, cometUp);
  b.tilt.quaternion.setFromRotationMatrix(basis.makeBasis(cometAway, cometUp, cometSide));
  // grows near the Sun, fades far away (a comet wakes up only near the Sun)
  const act = THREE.MathUtils.clamp(Math.pow(ACTIVE_FROM / r, 1.4), 0.05, 1);
  const len = 25 + 270 * act;
  // from afar the thin glow would melt into a speck: there the head and tails get bolder
  const far = viewer ? THREE.MathUtils.smoothstep(viewer.distanceTo(b.anchor.position), 80, 500) : 0;
  const bold = 1 + 0.7 * far, wide = 1 + 0.3 * far;
  const behind = cometAhead.dot(cometSide) > 0 ? -1 : 1; // the dust lags behind the head
  const ion = parts.ion.uniforms, dust = parts.dust.uniforms;
  ion.uLength.value = len;
  ion.uR0.value = b.info.radius * 0.7;
  ion.uR1.value = (2 + len * 0.035) * wide;
  ion.uBright.value = (0.18 + 0.55 * act) * bold;
  dust.uLength.value = len * 0.62;
  dust.uR0.value = b.info.radius * 1.1;
  dust.uR1.value = (3 + len * 0.15) * wide;
  dust.uBend.value = 0.3 * behind;
  dust.uBright.value = (0.08 + 0.3 * act) * bold;
  ion.uTime.value = dust.uTime.value = time;
  // sparks follow their tail's shape; only close up (from afar they would be noise)
  for (const [sp, tail, bright] of [[parts.ionSparks, ion, 0.9], [parts.dustSparks, dust, 0.8]] as const) {
    const u = sp.uniforms;
    for (const k of ['uLength', 'uR0', 'uR1', 'uBend'] as const) u[k].value = tail[k].value;
    u.uTime.value = time;
    u.uBright.value = bright * (0.3 + 0.7 * act) * (1 - far);
    u.uViewH.value = window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
  }
  const R = b.info.radius;
  // the head breathes: its glow swells and settles
  const breath = 1 + 0.07 * Math.sin(time * 2.3) + 0.04 * Math.sin(time * 3.7 + 1);
  parts.core.scale.setScalar(R * (4 + 4 * act) * breath);
  parts.haze.scale.setScalar(R * (10 + 22 * act) * (1 + 0.8 * far) * (2 - breath));
  parts.haze.material.opacity = 0.35 + 0.65 * act;
  parts.veil.material.opacity = (0.4 + 0.6 * act) * (1 - far); // only close up: from afar it would shine through planets
}

// ---------- the ship (hidden «Passengers» mode) ----------
// Placeholder until the real model arrives: a spine with a shield dish at the front, engines at the
// back and three living-quarter blades round the middle. The mesh spins about the spine (the tilt
// group lays the spine across the view), like the ship's quarters turning to make gravity.
function makeShipBody(info: BodyInfo, scene: THREE.Scene): Body {
  const anchor = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = info.tilt * DEG;
  anchor.add(tilt);
  const R = info.radius;
  const hull = new THREE.MeshBasicMaterial({ color: 0x9aa8bd });
  const dark = new THREE.MeshBasicMaterial({ color: 0x4a566a });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8fd0ff });
  const ship = new THREE.Group();
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * R, 0.06 * R, 1.8 * R, 12), hull);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(0.3 * R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  shield.position.y = 0.9 * R; // the front
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * R, 0.1 * R, 0.25 * R, 16), glow);
  engine.position.y = -0.95 * R;
  ship.add(spine, shield, engine);
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12 * R, 0.9 * R, 0.5 * R), hull);
    const a = (k / 3) * Math.PI * 2;
    blade.position.set(Math.cos(a) * 0.32 * R, 0, Math.sin(a) * 0.32 * R);
    blade.rotation.y = -a;
    blade.rotation.z = 0.35; // a twist, like the real ship's spiral
    ship.add(blade);
  }
  tilt.add(ship);
  scene.add(anchor);
  return { info, anchor, tilt, mesh: ship, viewRadius: R, orbitAngle: 0, spinAngle: 0, materials: [], cut: makeCutUniforms() };
}

export function createBodies(scene: THREE.Scene, lowEnd = false): Body[] {
  lowDetail = lowEnd;
  sphereGeo = lowEnd ? new THREE.SphereGeometry(1, 72, 48) : new THREE.SphereGeometry(1, 160, 120);
  return BODIES.map((info) =>
    info.star ? makeSun(info, scene)
      : info.station ? makeStationBody(info, scene)
      : info.ship ? makeShipBody(info, scene)
      : info.comet ? makeComet(info, scene)
      : makePlanet(info, scene));
}

/**
 * Position on a circular orbit relative to its centre. Planets move in the x–z plane; an inclined
 * orbit (Pluto, 17°) is tipped about the x axis; moons wobble a little above and below their planet.
 */
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const TILT = new Map(BODIES.map((b) => [b.id as string, b.tilt]));

function orbitOffset(info: BodyInfo, angle: number, out: THREE.Vector3, d = info.orbit) {
  const along = Math.sin(angle) * d;
  const inc = (info.inclination ?? 0) * DEG;
  const wobble = info.parent && !info.inclination && !info.equatorial ? Math.sin(angle) * 0.09 * d : 0;
  out.set(Math.cos(angle) * d, along * Math.sin(inc) + wobble, -along * Math.cos(inc));
  // moons of tilted planets circle in the planet's equatorial plane (Saturn's in its ring plane)
  if (info.equatorial && info.parent) out.applyAxisAngle(Z_AXIS, (TILT.get(info.parent) ?? 0) * DEG);
  return out;
}

export function createOrbitLines(scene: THREE.Scene, bodies: Body[]): Map<string, THREE.LineLoop> {
  const lines = new Map<string, THREE.LineLoop>();
  for (const b of bodies) {
    if (!b.info.orbit) continue;
    const pts: THREE.Vector3[] = [];
    const n = 512;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // a tilted moon orbit keeps its tilt; the Moon's wobble is left out of the line
      pts.push(orbitOffset(b.info.equatorial ? b.info : { ...b.info, parent: undefined }, a, new THREE.Vector3()));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.16, depthWrite: false });
    const line = new THREE.LineLoop(geo, mat);
    scene.add(line);
    lines.set(b.info.id, line);
  }
  return lines;
}

const tmp = new THREE.Vector3();

const fwd = new THREE.Vector3();
const upV = new THREE.Vector3();
const sideV = new THREE.Vector3();
const basis = new THREE.Matrix4();

/** Closer than this (scene units) the real model replaces the hand-made one. */
const REAL_MODEL_RANGE = 30;

/** Start loading the real station model (once); the hand-made one stays until it arrives or if it fails. */
export function loadRealStation(b: Body) {
  const s = b.station;
  if (!s || s.real || s.loading) return;
  s.loading = true;
  loadStationModel(lowDetail ? 'iss-lite.glb' : 'iss.glb', b.info.radius, s.materials[0].uniforms.uSunPos.value, s.occluder)
    .then((real) => {
      s.real = real;
      real.model.visible = false;
      b.tilt.add(real.model);
    })
    .catch((e) => console.warn('station model failed to load', e));
}

/** Station attitude: nose along the orbit, truss across it, top away from the planet; wings to the Sun. */
function flyNoseFirst(b: Body, parent: Body, viewer?: THREE.Vector3) {
  const s = b.station!;
  orbitOffset(b.info, b.orbitAngle + 0.01, fwd).add(parent.anchor.position).sub(b.anchor.position).normalize();
  upV.subVectors(b.anchor.position, parent.anchor.position).normalize();
  sideV.crossVectors(upV, fwd).normalize();
  fwd.crossVectors(sideV, upV);
  b.tilt.quaternion.setFromRotationMatrix(basis.makeBasis(fwd, sideV, upV));
  const toSun = tmp.copy(b.anchor.position).negate().normalize();
  const near = !!viewer && viewer.distanceTo(b.anchor.position) < REAL_MODEL_RANGE;
  if (near) loadRealStation(b);
  const real = near && s.real;
  s.model.visible = !real;
  if (s.real) s.real.model.visible = !!real;
  if (real) turnWings(real, toSun.applyQuaternion(b.tilt.quaternion.clone().invert()));
  else trackSun(s, b.tilt.quaternion, toSun);
  s.occluder.set(parent.anchor.position.x, parent.anchor.position.y, parent.anchor.position.z, parent.info.radius);
}

const cloudQuat = new THREE.Quaternion();
const cloudRot = new THREE.Matrix4();

/** Advance orbits and spins by dt seconds, then refresh positions and shader uniforms. */
export function updateBodies(bodies: Body[], dt: number, time: number, lines: Map<string, THREE.LineLoop>, viewer?: THREE.Vector3) {
  const byId = new Map(bodies.map((b) => [b.info.id, b]));
  for (const b of bodies) {
    const i = b.info;
    if (i.orbitSeconds) b.orbitAngle += (dt / i.orbitSeconds) * Math.PI * 2;
    if (i.spinSeconds > 0) b.spinAngle += (dt / i.spinSeconds) * Math.PI * 2;
  }
  // parents first: BODIES order already lists Earth before the Moon
  for (const b of bodies) {
    const i = b.info;
    const parent = i.parent ? byId.get(i.parent)! : null;
    const origin = parent ? parent.anchor.position : tmp.set(0, 0, 0);
    if (i.fixedAt) b.anchor.position.fromArray(i.fixedAt);
    else if (i.comet) cometPosition(i.comet, b.orbitAngle, b.anchor.position);
    else b.anchor.position.copy(orbitOffset(i, b.orbitAngle, b.anchor.position, b.orbitR ?? i.orbit)).add(origin);
    if (b.comet) updateComet(b, time, viewer);
    if (b.station) flyNoseFirst(b, parent!, viewer);
    // moons (the Moon, Charon) keep one face towards their planet
    else b.mesh.rotation.y = parent ? b.orbitAngle + Math.PI : b.spinAngle;
    if (b.clouds) b.clouds.rotation.y = b.spinAngle * 1.08;
    for (const m of b.materials) if (m.uniforms.uTime) m.uniforms.uTime.value = time;
    if (parent) lines.get(i.id)?.position.copy(parent.anchor.position);
    else if (i.orbit) lines.get(i.id)?.scale.setScalar((b.orbitR ?? i.orbit) / i.orbit);
  }
  for (const b of bodies) {
    b.tilt.updateMatrixWorld(true);
    if (!b.materials.length) continue; // the ship (placeholder): nothing to light
    const u = b.materials[0].uniforms;
    if (u.uRingNormal) u.uRingNormal.value.set(0, 1, 0).applyQuaternion(b.tilt.getWorldQuaternion(new THREE.Quaternion()));
    if (b.clouds) {
      // living clouds only close up (and not on old devices): from about 14 planet radii in
      const d = viewer ? viewer.distanceTo(b.anchor.position) / b.info.radius : Infinity;
      u.uFlow.value = lowDetail ? 0 : 1 - THREE.MathUtils.smoothstep(d, 8, 14);
      if (u.uFlow.value > 0) {
        b.clouds.getWorldQuaternion(cloudQuat).invert();
        u.uWorldToCloud.value.setFromMatrix4(cloudRot.makeRotationFromQuaternion(cloudQuat));
      }
    }
  }
}
