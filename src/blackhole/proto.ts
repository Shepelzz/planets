import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { bakeStreaks, BLACK_HOLE_FRAG, BLACK_HOLE_VERT } from './shader';

// Prototype of the black hole (blackhole.html, not linked from the app yet): the shader on a full-screen quad, a camera
// to turn round it, an fps counter and two toggles. Not part of the app yet.

const canvas = document.getElementById('c') as HTMLCanvasElement;
const lowEnd = new URLSearchParams(location.search).has('low') || !document.createElement('canvas').getContext('webgl2');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
camera.position.set(0, 1.6, 26); // almost edge-on, like the film
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 7;
controls.maxDistance = 60;

const sky = new THREE.TextureLoader().load(lowEnd ? '/textures/lite/milky_way.jpg' : '/textures/milky_way.jpg');
sky.colorSpace = THREE.NoColorSpace;
sky.wrapS = THREE.RepeatWrapping;
sky.anisotropy = 8;



// quality levels: pixel ratio, steps, step size
const LEVELS = [
  { name: 'низька', ratio: 0.5, steps: 160, step: 1.8 },
  { name: 'середня', ratio: 0.75, steps: 260, step: 1.25 },
  { name: 'висока', ratio: 1, steps: 400, step: 1 },
  { name: 'максимальна', ratio: Math.min(devicePixelRatio, 1.5), steps: 400, step: 1 },
];
let level = lowEnd ? 0 : 3; // maximum by default; old devices (no WebGL 2, or ?low) start low

const uniforms = {
  uRes: { value: new THREE.Vector2() },
  uCamPos: { value: new THREE.Vector3() },
  uCamRot: { value: new THREE.Matrix3() },
  uInvProj: { value: new THREE.Matrix4() },
  uRoll: { value: -0.32 },
  uTime: { value: 0 },
  uDoppler: { value: 0 },
  uStep: { value: 1 },
  uRing: { value: 1 },
  uDebug: { value: 0 },
  uSky: { value: sky },
  uSkySize: { value: new THREE.Vector2(lowEnd ? 2048 : 4096, lowEnd ? 1024 : 2048) },
  uStreaks: { value: bakeStreaks(renderer) },
};
const scene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
scene.add(quad);

function setLevel(i: number) {
  level = i;
  const l = LEVELS[i];
  quad.material = new THREE.ShaderMaterial({
    vertexShader: BLACK_HOLE_VERT,
    fragmentShader: BLACK_HOLE_FRAG(l.steps),
    uniforms,
    depthTest: false,
    depthWrite: false,
    extensions: { derivatives: true, shaderTextureLOD: true }, // fwidth and texture2DLodEXT on WebGL 1
  });
  uniforms.uStep.value = l.step;
  resize();
}
// the film's soft glow round the brightest light (optional: post-processing)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.45, 0.7);
composer.addPass(bloom);
composer.addPass(new OutputPass()); // linear → screen colour, as a direct render does
let bloomOn = true;

function resize() {
  renderer.setPixelRatio(LEVELS[level].ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(LEVELS[level].ratio);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.getDrawingBufferSize(uniforms.uRes.value);
  document.getElementById('res')!.textContent = `${uniforms.uRes.value.x}×${uniforms.uRes.value.y}, ${LEVELS[level].name}`;
}
addEventListener('resize', resize);
setLevel(level);

const btnDoppler = document.getElementById('doppler')!;
btnDoppler.addEventListener('click', () => {
  uniforms.uDoppler.value = uniforms.uDoppler.value ? 0 : 1;
  btnDoppler.textContent = `Доплер: ${uniforms.uDoppler.value ? 'увімк' : 'вимк'}`;
});
const btnRing = document.getElementById('ring')!;
btnRing.addEventListener('click', () => {
  uniforms.uRing.value = uniforms.uRing.value ? 0 : 1;
  btnRing.textContent = `Кільце: ${uniforms.uRing.value ? 'увімк' : 'вимк'}`;
});
const btnBloom = document.getElementById('bloom')!;
btnBloom.addEventListener('click', () => {
  bloomOn = !bloomOn;
  btnBloom.textContent = `Сяйво: ${bloomOn ? 'увімк' : 'вимк'}`;
});
document.getElementById('quality')!.addEventListener('click', () => setLevel((level + 1) % LEVELS.length));

const fpsEl = document.getElementById('fps')!;
let frames = 0, since = performance.now(), last = since;
const FRAME_MS = new URLSearchParams(location.search).has('uncapped') ? 0 : 1000 / 60; // no more than 60 frames a second: more is wasted heat
function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - last < FRAME_MS - 2) return;
  uniforms.uTime.value += Math.min((now - last) / 1000, 0.1);
  last = now;
  controls.update();
  camera.updateMatrixWorld();
  uniforms.uCamPos.value.copy(camera.position);
  uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld);
  uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
  if (bloomOn) composer.render();
  else renderer.render(scene, camera);
  frames++;
  if (now - since > 1000) {
    fpsEl.textContent = String(Math.round((frames * 1000) / (now - since)));
    frames = 0;
    since = now;
  }
}
requestAnimationFrame(frame);
(window as unknown as { hole: unknown }).hole = { uniforms, camera, setLevel, bloom, renderer, scene };
