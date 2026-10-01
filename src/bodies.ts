import * as THREE from 'three';
import { BODIES, type BodyInfo } from './data';
import { BUMP_GLSL, NOISE_GLSL } from './noise';
import { BUMP, SURFACES, TEXTURE_FILES } from './surfaces';
import { loadTexture, SRGB_GLSL } from './textures';

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
  mesh: THREE.Mesh;
  clouds?: THREE.Mesh;
  /** Radius that must fit on screen when we fly to this body (rings included). */
  viewRadius: number;
  orbitAngle: number;
  spinAngle: number;
  materials: THREE.ShaderMaterial[];
  /** shared by the surface, cloud and Sun shaders */
  cut: CutUniforms;
  /** atmosphere glow, hidden while the planet is cut open */
  atmosphere?: THREE.ShaderMaterial;
}

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

const PLANET_FRAG = (surface: string) => /* glsl */ `
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
uniform sampler2D uClouds;
uniform vec3 uCenter;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
${CUT_GLSL}
void main() {
  cutAway(vWorldPos - uCenter);
  float a = smoothstep(0.08, 0.95, texture2D(uClouds, vUv).r) * 0.95;
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
  scene.add(anchor);

  return { info, anchor, tilt, mesh, viewRadius: info.radius * 1.4, orbitAngle: 0, spinAngle: 0, materials: [mat], cut };
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
    uMap: { value: loadTexture(TEXTURE_FILES[info.surface!]) },
    uNight: { value: info.surface === 'earth' ? loadTexture('earth_night.jpg') : null },
    uCenter: { value: anchor.position },
    uHasRings: { value: hasRings ? 1 : 0 },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: PLANET_FRAG(SURFACES[info.surface!]),
    uniforms,
    extensions: { derivatives: true }, // dFdx/dFdy for bump mapping on WebGL 1
  });
  materials.push(mat);
  const mesh = new THREE.Mesh(sphereGeo, mat);
  mesh.scale.setScalar(info.radius);
  tilt.add(mesh);

  let clouds: THREE.Mesh | undefined;
  if (info.clouds) {
    const cm = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: { uSunPos: uniforms.uSunPos, uClouds: { value: loadTexture('earth_clouds.jpg') }, uCenter: { value: anchor.position }, ...cut },
      transparent: true,
      depthWrite: false,
    });
    materials.push(cm);
    clouds = new THREE.Mesh(sphereGeo, cm);
    clouds.scale.setScalar(info.radius * 1.012);
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

export function createBodies(scene: THREE.Scene, lowEnd = false): Body[] {
  lowDetail = lowEnd;
  sphereGeo = lowEnd ? new THREE.SphereGeometry(1, 72, 48) : new THREE.SphereGeometry(1, 160, 120);
  return BODIES.map((info) => (info.id === 'sun' ? makeSun(info, scene) : makePlanet(info, scene)));
}

export function createOrbitLines(scene: THREE.Scene, bodies: Body[]): Map<string, THREE.LineLoop> {
  const lines = new Map<string, THREE.LineLoop>();
  for (const b of bodies) {
    if (!b.info.orbit) continue;
    const pts: THREE.Vector3[] = [];
    const n = 512;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * b.info.orbit, 0, -Math.sin(a) * b.info.orbit));
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

/** Advance orbits and spins by dt seconds, then refresh positions and shader uniforms. */
export function updateBodies(bodies: Body[], dt: number, time: number, lines: Map<string, THREE.LineLoop>) {
  const byId = new Map(bodies.map((b) => [b.info.id, b]));
  for (const b of bodies) {
    const i = b.info;
    if (i.orbitSeconds > 0) b.orbitAngle += (dt / i.orbitSeconds) * Math.PI * 2;
    if (i.spinSeconds > 0) b.spinAngle += (dt / i.spinSeconds) * Math.PI * 2;
  }
  // parents first: BODIES order already lists Earth before the Moon
  for (const b of bodies) {
    const i = b.info;
    const parent = i.parent ? byId.get(i.parent)! : null;
    const origin = parent ? parent.anchor.position : tmp.set(0, 0, 0);
    const tiltY = parent ? Math.sin(b.orbitAngle) * 0.09 : 0;
    b.anchor.position.set(
      origin.x + Math.cos(b.orbitAngle) * i.orbit,
      origin.y + tiltY * i.orbit,
      origin.z - Math.sin(b.orbitAngle) * i.orbit,
    );
    // the Moon keeps one face towards Earth
    b.mesh.rotation.y = i.id === 'moon' ? b.orbitAngle + Math.PI : b.spinAngle;
    if (b.clouds) b.clouds.rotation.y = b.spinAngle * 1.08;
    for (const m of b.materials) if (m.uniforms.uTime) m.uniforms.uTime.value = time;
    if (i.id === 'moon' && parent) {
      const line = lines.get('moon');
      line?.position.copy(parent.anchor.position);
    }
  }
  for (const b of bodies) {
    b.tilt.updateMatrixWorld(true);
    const u = b.materials[0].uniforms;
    if (u.uRingNormal) u.uRingNormal.value.set(0, 1, 0).applyQuaternion(b.tilt.getWorldQuaternion(new THREE.Quaternion()));
  }
}
