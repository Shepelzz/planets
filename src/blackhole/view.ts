import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { loadTexture } from '../textures';
import { bakeStreaks, BLACK_HOLE_FRAG, BLACK_HOLE_VERT } from './shader';

// The black hole in the app: while we are in the galaxy realm, this draws the whole picture instead of
// the scene (shader.ts traces the light round the hole and looks up the sky itself). It uses the app's
// camera, so turning, zooming and framing beside the panels work as everywhere else.
//
// Quality depends on the device and drops by itself if frames are slow: first the glow goes, then
// the resolution and the number of steps.

interface Level {
  /** the most pixels per CSS pixel */
  ratio: number;
  steps: number;
  /** step length factor: fewer, longer steps */
  step: number;
  bloom: boolean;
}
const LEVELS: Level[] = [
  { ratio: 0.5, steps: 150, step: 1.8, bloom: false }, // old iPads (WebGL 1)
  { ratio: 0.75, steps: 260, step: 1.25, bloom: false }, // phones, tablets
  { ratio: 1, steps: 400, step: 1, bloom: false },
  { ratio: 1.5, steps: 400, step: 1, bloom: true }, // computers
];

export function createHoleView(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, opts: { lowEnd: boolean; touch: boolean }) {
  const lod = renderer.capabilities.isWebGL2 || renderer.extensions.has('EXT_shader_texture_lod');
  let level = opts.lowEnd ? 0 : opts.touch ? 1 : 3;
  const sky = loadTexture('milky_way.jpg', { full: !opts.touch });
  const big = !opts.touch && !opts.lowEnd;
  const uniforms = {
    uRes: { value: new THREE.Vector2() },
    uCamPos: { value: new THREE.Vector3() },
    uCamRot: { value: new THREE.Matrix3() },
    uInvProj: { value: new THREE.Matrix4() },
    uRoll: { value: -0.25 }, // the film's diagonal disk
    uTime: { value: 0 },
    uDoppler: { value: 0 },
    uStep: { value: 1 },
    uRing: { value: 1 },
    uDebug: { value: 0 },
    uSky: { value: sky },
    uSkySize: { value: new THREE.Vector2(big ? 4096 : 2048, big ? 2048 : 1024) },
    uStreaks: { value: null as THREE.Texture | null },
  };
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  let built = -1;
  let composer: EffectComposer | null = null;

  /** Shader for the current level (compiled on first use: the hole is far from the start screen). */
  function build() {
    if (built === level) return;
    built = level;
    (quad.material as THREE.Material).dispose?.();
    quad.material = new THREE.ShaderMaterial({
      vertexShader: BLACK_HOLE_VERT,
      fragmentShader: BLACK_HOLE_FRAG(LEVELS[level].steps, lod),
      uniforms,
      depthTest: false,
      depthWrite: false,
      extensions: { derivatives: true, shaderTextureLOD: lod },
    });
    uniforms.uStep.value = LEVELS[level].step;
  }

  function bloomComposer() {
    if (!composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.45, 0.7));
      composer.addPass(new OutputPass());
    }
    const size = renderer.getSize(new THREE.Vector2());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    return composer;
  }

  return {
    /** the most pixels per CSS pixel at this quality (the app lowers its own ratio to this here) */
    get ratio() {
      return LEVELS[level].ratio;
    },
    /** Slow frames: glow off, or fewer pixels and steps. False if already at the lowest. */
    degrade() {
      if (level === 0) return false;
      level--;
      return true;
    },
    /** Draw it, to the screen (glow allowed) or into a target (the hyperjump's picture). */
    render(time: number, target: THREE.WebGLRenderTarget | null) {
      if (!uniforms.uStreaks.value) uniforms.uStreaks.value = bakeStreaks(renderer);
      build();
      camera.updateMatrixWorld();
      uniforms.uCamPos.value.copy(camera.position);
      uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld);
      uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      uniforms.uTime.value = time;
      if (target) uniforms.uRes.value.set(target.width, target.height);
      else renderer.getDrawingBufferSize(uniforms.uRes.value);
      renderer.setRenderTarget(target);
      if (!target && LEVELS[level].bloom) bloomComposer().render();
      else renderer.render(scene, camera);
    },
  };
}
