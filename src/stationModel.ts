import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SRGB_GLSL } from './textures';

// The real ISS: NASA's model (public domain), slimmed down by scripts/iss-model.mjs. Loaded only when
// the camera comes close; until then, and far away, the light hand-made model from station.ts is shown.
//
// The file's axes: nose along −x, Earth along −y, truss along z; nodes «port» and «starboard» are the
// two wing assemblies that turn about the truss. Here everything is turned into the station frame of
// station.ts (x nose, y truss, z up) and lit like the rest of the scene.

const VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunPos;
uniform vec4 uOccluder;
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uFlat;
uniform float uTwoSided;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
${SRGB_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  // lattice parts come without normals: take the face normal from the screen-space derivatives
  vec3 N = uFlat > 0.5 ? normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))) : normalize(vWorldNormal);
  if (dot(N, V) < 0.0) N = -N; // thin double-sided panels: light the side we look at
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 base = uColor;
  if (uHasMap > 0.5) base *= srgbToLinear(texture2D(uMap, vUv).rgb);
  vec3 toC = uOccluder.xyz - vWorldPos;
  float t = dot(toC, L);
  float R2 = uOccluder.w * uOccluder.w;
  float lit = t > 0.0 ? smoothstep(R2 * 0.94, R2 * 1.06, dot(toC, toC) - t * t) : 1.0;
  // solar panels: their back gets light reflected off Earth, so they never turn into black holes
  float diff = (uTwoSided > 0.5 ? max(dot(N, L), -0.6 * dot(N, L)) : max(dot(N, L), 0.0)) * lit;
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 40.0) * 0.25 * lit;
  gl_FragColor = vec4(base * (diff * 2.1 + 0.07) + vec3(1.0, 0.95, 0.85) * spec, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface Wing {
  group: THREE.Object3D;
  base: THREE.Quaternion;
  /** a panel's face normal at the base pose, station frame */
  normal: THREE.Vector3;
}

export interface RealStation {
  /** in the station frame, scaled to the body's radius */
  model: THREE.Group;
  wings: Wing[];
}

/** Load the model (file in public/models) and give it the scene's lighting. */
export async function loadStationModel(
  file: string, radius: number, sunPos: THREE.Vector3, occluder: THREE.Vector4,
): Promise<RealStation> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`);

  const model = new THREE.Group();
  // file axes → station frame: −x is the nose (x), z the truss (y), y up (z)
  model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0),
  ));
  model.add(gltf.scene);
  model.updateMatrixWorld(true);
  const extent = new THREE.Box3().setFromObject(gltf.scene, true);
  const reach = Math.max(extent.min.length(), extent.max.length());
  model.scale.setScalar(radius / reach);
  model.updateMatrixWorld(true);

  const made = new Map<THREE.Material, THREE.ShaderMaterial>();
  const panels: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (src.name === 'TrussPanels') panels.push(mesh);
    let m = made.get(src);
    if (!m) {
      const map = src.map;
      if (map) map.colorSpace = THREE.NoColorSpace; // decoded in the shader, so WebGL 1 keeps mipmaps
      m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uSunPos: { value: sunPos },
          uOccluder: { value: occluder },
          uColor: { value: src.color.clone() },
          uMap: { value: map },
          uHasMap: { value: map ? 1 : 0 },
          uFlat: { value: mesh.geometry.attributes.normal ? 0 : 1 },
          uTwoSided: { value: /Panels|IROSA/.test(src.name) ? 1 : 0 },
        },
        side: src.side,
        extensions: { derivatives: true }, // dFdx/dFdy on WebGL 1
      });
      made.set(src, m);
      src.dispose();
    }
    mesh.material = m;
  });

  // the wing assemblies: hang them straight under the model so turning them is a plain rotation
  const wings: Wing[] = [];
  for (const name of ['port', 'starboard']) {
    const group = gltf.scene.getObjectByName(name);
    if (!group) continue;
    model.attach(group);
    const own = panels.filter((p) => isInside(p, group));
    wings.push({ group, base: group.quaternion.clone(), normal: own.length ? faceNormal(own, model) : new THREE.Vector3(1, 0, 0) });
  }
  return { model, wings };
}

function isInside(o: THREE.Object3D, parent: THREE.Object3D) {
  for (let p = o.parent; p; p = p.parent) if (p === parent) return true;
  return false;
}

/**
 * The direction the panels face, in the frame of `frame`: the dominant axis of their area-weighted
 * triangle normals (sign-free, so front and back faces agree and small parts don't matter).
 */
function faceNormal(meshes: THREE.Mesh[], frame: THREE.Object3D) {
  const toFrame = new THREE.Quaternion();
  frame.getWorldQuaternion(toFrame).invert();
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(k + 1) : k + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(k + 2) : k + 2).applyMatrix4(mesh.matrixWorld);
      n.crossVectors(b.sub(a), c.sub(a)); // length = 2 × area
      const w = n.length();
      if (w === 0) continue;
      n.divideScalar(w);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += w * n.getComponent(i) * n.getComponent(j);
    }
  }
  // power iteration for the main axis
  const v = new THREE.Vector3(0.3, 0.5, 0.8);
  for (let it = 0; it < 40; it++) {
    v.set(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z).normalize();
  }
  return v.applyQuaternion(toFrame).normalize();
}

const TRUSS = new THREE.Vector3(0, 1, 0);
const flat = new THREE.Vector3();
const turn = new THREE.Quaternion();
/** Turn both wing assemblies about the truss so the panels face the Sun (direction in the station frame). */
export function turnWings(s: RealStation, toSun: THREE.Vector3) {
  for (const w of s.wings) {
    flat.copy(toSun).addScaledVector(TRUSS, -toSun.dot(TRUSS));
    const n = w.normal;
    const a = Math.atan2(TRUSS.dot(flat.clone().cross(n).negate()), n.dot(flat));
    turn.setFromAxisAngle(TRUSS, a);
    // the base pose lives in the model's own (file) frame: express the turn there
    const local = new THREE.Quaternion().copy(s.model.quaternion).invert().multiply(turn).multiply(s.model.quaternion);
    w.group.quaternion.copy(local).multiply(w.base);
  }
}
