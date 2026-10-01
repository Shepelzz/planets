import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The International Space Station, built from boxes and cylinders (no model file to download).
// Laid out in metres like the real one, then scaled to the body's radius:
//   x — the direction of flight, along the chain of living modules
//   y — the long truss, at right angles to the orbit
//   z — up, away from Earth
// The eight solar wings turn about the truss to face the Sun, as the real ones do.

const VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform vec3 uColor;
uniform float uPanel;
uniform float uSpec;
uniform vec4 uOccluder; // Earth: centre and radius; the station goes dark in its shadow
varying vec3 vObj;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 N = normalize(vWorldNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 base = uColor;
  if (uPanel > 0.5) {
    // solar cells: a grid of dark gaps, the back of the wing plain
    vec2 g = abs(fract(vec2(vObj.z / 2.1, vObj.y / 1.2)) - 0.5);
    float gap = smoothstep(0.42, 0.5, max(g.x, g.y));
    base = mix(base, base * 0.3, gap);
  }
  vec3 toC = uOccluder.xyz - vWorldPos;
  float t = dot(toC, L);
  float d2 = dot(toC, toC) - t * t;
  float R2 = uOccluder.w * uOccluder.w;
  float lit = t > 0.0 ? smoothstep(R2 * 0.94, R2 * 1.06, d2) : 1.0;
  float diff = max(dot(N, L), 0.0) * lit;
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 48.0) * uSpec * lit;
  vec3 col = base * (diff * 2.1 + 0.07) + vec3(1.0, 0.95, 0.85) * spec;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** A cylinder lying along x (modules in the flight direction). */
const tubeX = (r: number, len: number, x: number, y = 0, z = 0) =>
  new THREE.CylinderGeometry(r, r, len, 20).rotateZ(Math.PI / 2).translate(x, y, z);
/** A cylinder lying along y (modules sticking out sideways). */
const tubeY = (r: number, len: number, x: number, y: number, z = 0) =>
  new THREE.CylinderGeometry(r, r, len, 20).translate(x, y, z);

const TRUSS_Z = 4.6; // the truss runs above the modules
const MODEL_RADIUS = 64; // metres from the centre to the tip of a wing

export interface Station {
  /** the whole station, already scaled to the body's radius */
  model: THREE.Group;
  /** port and starboard wings: turned about the truss (y) to face the Sun */
  arrays: THREE.Group[];
  materials: THREE.ShaderMaterial[];
}

export function makeStation(radius: number, sunPos: THREE.Vector3, occluder: THREE.Vector4): Station {
  const materials: THREE.ShaderMaterial[] = [];
  const mat = (color: string, opts: { panel?: boolean; spec?: number } = {}) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSunPos: { value: sunPos },
        uColor: { value: new THREE.Color(color) },
        uPanel: { value: opts.panel ? 1 : 0 },
        uSpec: { value: opts.spec ?? 0.15 },
        uOccluder: { value: occluder },
      },
      side: opts.panel ? THREE.DoubleSide : THREE.FrontSide,
    });
    materials.push(m);
    return m;
  };
  const model = new THREE.Group();
  const add = (parts: THREE.BufferGeometry[], m: THREE.ShaderMaterial, parent: THREE.Object3D = model) => {
    const g = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    parent.add(new THREE.Mesh(g, m));
  };

  // living and working modules: US/European/Japanese white, Russian a greyish green
  add([
    tubeX(2.2, 7.5, 31), // Harmony (Node 2)
    tubeX(2.2, 8.5, 22.5), // Destiny lab
    tubeX(2.2, 5.5, 15.5), // Unity (Node 1)
    tubeY(2.2, 7, 31, 6), // Columbus
    tubeY(2.2, 11, 31, -8), // Kibo
    box(5, 9, 1.2, 31, -14.5, 2.2), // Kibo's open porch
    tubeY(2.2, 6.5, 15.5, -6), // Tranquility (Node 3)
    tubeX(1.6, 2.2, 36, 0, 0), // docking port
  ], mat('#e9e7e1', { spec: 0.35 }));
  add([
    tubeX(2.05, 12.5, 6.5), // Zarya
    tubeX(2.1, 13, -6.5), // Zvezda
    tubeX(1.3, 3, -14.5), // Zvezda's back end
    tubeX(1.35, 7, -20.5), // a Progress cargo ship
    tubeY(1.7, 6, -3, 5, -1), // Poisk/Nauka, simplified
  ], mat('#c9ccbb', { spec: 0.25 }));
  // the Cupola window bay and the docked Soyuz: darker
  add([
    new THREE.CylinderGeometry(1.2, 1.5, 1.5, 8).rotateX(Math.PI).translate(15.5, -9.8, -1.3),
    tubeX(1.3, 6.5, 41.5), // Soyuz / Crew Dragon at the front
  ], mat('#8f949c', { spec: 0.4 }));

  // the truss and the white radiators hanging below it
  const grey = mat('#a3a9b1', { spec: 0.3 });
  add([
    box(4.5, 100, 4.5, 0, 0, TRUSS_Z),
    box(1.2, 4, 7, 0, 0, TRUSS_Z - 4), // the mast down to the lab
  ], grey);
  add([
    box(0.3, 3.2, 22, 0, 18, TRUSS_Z - 13),
    box(0.3, 3.2, 22, 0, 22, TRUSS_Z - 13),
    box(0.3, 3.2, 22, 0, -18, TRUSS_Z - 13),
    box(0.3, 3.2, 22, 0, -22, TRUSS_Z - 13),
  ], mat('#f2f2ee', { spec: 0.2 }));
  // Zvezda's own small dark-blue wings
  add([
    box(0.15, 13, 3.4, -6.5, 9.5, 0),
    box(0.15, 13, 3.4, -6.5, -9.5, 0),
  ], mat('#1d2f63', { panel: true, spec: 0.6 }));

  // the eight big golden wings: two pairs on each side, each pair spreading up and down
  const gold = mat('#b8772c', { panel: true, spec: 0.7 });
  const arrays: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(0, 0, TRUSS_Z);
    const wings: THREE.BufferGeometry[] = [];
    for (const y of [34, 47]) {
      for (const z of [1, -1]) {
        // two blankets with the mast between them
        wings.push(box(0.12, 4.6, 33, 0, side * y - 2.9, z * 19));
        wings.push(box(0.12, 4.6, 33, 0, side * y + 2.9, z * 19));
      }
    }
    add(wings, gold, g);
    add([box(0.5, 0.5, 70, 0, side * 34, 0), box(0.5, 0.5, 70, 0, side * 47, 0)], grey, g); // masts
    model.add(g);
    arrays.push(g);
  }

  model.scale.setScalar(radius / MODEL_RADIUS);
  return { model, arrays, materials };
}

const toSun = new THREE.Vector3();
const inv = new THREE.Quaternion();
/** Turn the wings about the truss so they face the Sun (sunWorld: direction to the Sun, world space). */
export function trackSun(s: Station, frame: THREE.Quaternion, sunWorld: THREE.Vector3) {
  toSun.copy(sunWorld).applyQuaternion(inv.copy(frame).invert());
  // a wing's face points along x; turning by a about y brings it to (cos a, 0, −sin a)
  const a = Math.atan2(-toSun.z, toSun.x);
  for (const g of s.arrays) g.rotation.y = a;
}
