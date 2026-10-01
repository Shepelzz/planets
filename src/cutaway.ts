import * as THREE from 'three';
import type { Body } from './bodies';
import { say, type SpeechEnd } from './speech';
import { STRUCTURE } from './structure';

// Textbook-style cut-away: a wedge facing the camera opens like a book, the two cut faces show the
// layers as coloured rings, and each layer lights up while the voice tells about it.

const MAX_LAYERS = 5;
const OPEN_SECONDS = 1.4;
const CLOSE_SECONDS = 1.1;
// after the story: a moment to look at all the layers, then the slice closes by itself
const HOLD_AFTER_STORY = 2;
const HOLD_AFTER_INTERRUPT = 0.4;
const HOLD_WITHOUT_SOUND = 10;
const STAY_OPEN = Infinity; // muted mid-story: keep the slice until another block or planet is chosen
const FULL_ANGLE = Math.PI / 4; // half-angle of the removed wedge when fully open (a 90° slice)

const FACE_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FACE_FRAG = /* glsl */ `
uniform float uEdges[${MAX_LAYERS}];   // outer edge of each layer, centre outwards (fraction of radius)
uniform vec3 uColors[${MAX_LAYERS}];
uniform float uCount;
uniform float uHighlight;              // layer index (centre outwards), -1 = none
uniform float uTime;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xy);
  if (r > 1.0) discard;
  vec3 col = vec3(0.0);
  float lo = 0.0, hi = 1.0, idx = 0.0, prev = 0.0, found = 0.0;
  for (int i = 0; i < ${MAX_LAYERS}; i++) {
    if (float(i) >= uCount) break;
    if (found < 0.5 && r <= uEdges[i]) {
      col = uColors[i];
      lo = prev;
      hi = uEdges[i];
      idx = float(i);
      found = 1.0;
    }
    prev = uEdges[i];
  }
  // a little depth inside each band, and thin dark lines between layers
  float t = (r - lo) / max(hi - lo, 1e-3);
  col *= 0.82 + 0.3 * (1.0 - t);
  float edge = min(r - lo, hi - r);
  col *= mix(0.45, 1.0, smoothstep(0.0, 0.01, edge));
  if (uHighlight > -0.5) {
    if (abs(idx - uHighlight) < 0.5) col *= 1.15 + 0.12 * sin(uTime * 5.0);
    else col *= 0.38;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

interface Active {
  body: Body;
  phi: number;
  right: THREE.Vector3;
  front: THREE.Vector3;
  up: THREE.Vector3;
  /** surface first, as told */
  labels: HTMLElement[];
  atmosphereIntensity?: number;
  sequence: number;
  onEnd?: () => void;
  /** when (this.time) the slice starts closing by itself */
  closeAt?: number;
  closing?: boolean;
}

export class Cutaway {
  private faces: THREE.Mesh[];
  private material: THREE.ShaderMaterial;
  private active: Active | null = null;
  private sequence = 0;
  private time = 0;
  private A = new THREE.Vector3();
  private B = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private labelLayer: HTMLElement) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FACE_VERT,
      fragmentShader: FACE_FRAG,
      uniforms: {
        uEdges: { value: new Array(MAX_LAYERS).fill(1) },
        uColors: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Color()) },
        uCount: { value: 0 },
        uHighlight: { value: -1 },
        uTime: { value: 0 },
      },
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const geo = new THREE.CircleGeometry(1, 96, 0, Math.PI); // half disc, y ≥ 0
    this.faces = [new THREE.Mesh(geo, this.material), new THREE.Mesh(geo, this.material)];
    for (const f of this.faces) {
      f.visible = false;
      f.frustumCulled = false;
      scene.add(f);
    }
  }

  isOpen(body?: Body) {
    return !!this.active && (!body || this.active.body === body);
  }

  /** Open the planet and tell about its layers. onEnd runs when the story ends or is cut short. */
  open(body: Body, onEnd?: () => void) {
    this.close();
    const s = STRUCTURE[body.info.id];
    const inner = [...s.layers].reverse(); // centre outwards for the shader
    const u = this.material.uniforms;
    u.uCount.value = inner.length;
    inner.forEach((l, i) => {
      u.uEdges.value[i] = l.to;
      (u.uColors.value[i] as THREE.Color).set(l.color);
    });
    u.uHighlight.value = -1;

    const labels = s.layers.map((l) => {
      const el = document.createElement('div');
      el.className = 'cut-label';
      el.innerHTML = `<div class="cut-label-inner"><span>${l.name}</span><i style="background:${l.color}"></i></div>`;
      this.labelLayer.appendChild(el);
      return el;
    });

    const active: Active = {
      body,
      phi: 0,
      right: new THREE.Vector3(),
      front: new THREE.Vector3(),
      up: new THREE.Vector3(),
      labels,
      sequence: ++this.sequence,
      onEnd,
    };
    const glow = body.anchor.userData.glow as THREE.Sprite | undefined;
    if (glow) glow.visible = false; // the Sun's bright glow would wash over the cut faces
    if (body.atmosphere) {
      active.atmosphereIntensity = body.atmosphere.uniforms.uIntensity.value;
      body.atmosphere.uniforms.uIntensity.value = 0;
    }
    body.cut.uCutOn.value = 1;
    for (const f of this.faces) f.visible = true;
    this.active = active;
    this.update(0);
    this.tell(active, s.intro, s.layers.map((l) => l.text));
  }

  /** Fold the slice shut with the closing animation (another block on the card was tapped). */
  fold() {
    const a = this.active;
    if (!a || a.closing) return;
    a.sequence = ++this.sequence; // stop the story
    this.material.uniforms.uHighlight.value = -1;
    a.closeAt = this.time;
    const cb = a.onEnd;
    a.onEnd = undefined;
    cb?.();
  }

  close() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.sequence++;
    a.body.cut.uCutOn.value = 0;
    const glow = a.body.anchor.userData.glow as THREE.Sprite | undefined;
    if (glow) glow.visible = true;
    if (a.body.atmosphere && a.atmosphereIntensity !== undefined) a.body.atmosphere.uniforms.uIntensity.value = a.atmosphereIntensity;
    for (const f of this.faces) f.visible = false;
    for (const el of a.labels) el.remove();
    a.onEnd?.();
  }

  /** Intro, then one layer after another (surface first), each lit up while it is told. */
  private tell(a: Active, intro: string, texts: string[]) {
    const seq = a.sequence;
    const count = texts.length;
    // the story is over: show all layers, release the block, then close the slice after a pause
    const finish = (hold: number) => {
      if (this.active !== a || a.sequence !== seq) return;
      this.material.uniforms.uHighlight.value = -1;
      a.labels.forEach((el) => {
        el.classList.add('show');
        el.classList.remove('current');
      });
      a.closeAt = this.time + hold;
      const cb = a.onEnd;
      a.onEnd = undefined;
      cb?.();
    };
    const step = (i: number) => {
      if (this.active !== a || a.sequence !== seq) return;
      if (i >= count) return finish(HOLD_AFTER_STORY);
      this.material.uniforms.uHighlight.value = count - 1 - i; // shader counts from the centre
      a.labels.forEach((el, j) => el.classList.toggle('current', j === i));
      a.labels[i].classList.add('show');
      const spoke = say(texts[i], (how) => next(how, i + 1));
      if (!spoke) finish(HOLD_WITHOUT_SOUND);
    };
    // a phrase ended: go on; another block or planet spoke instead: close; muted: show all and stay
    const next = (how: SpeechEnd, i: number) =>
      how === 'ended' ? step(i) : finish(how === 'replaced' ? HOLD_AFTER_INTERRUPT : STAY_OPEN);
    const spoke = say(intro, (how) => next(how, 0));
    if (!spoke) finish(HOLD_WITHOUT_SOUND); // sound off: show everything for a while
  }

  update(dt: number) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    const a = this.active;
    if (!a) return;
    this.aimAtCamera(a);
    if (!a.closing && a.closeAt !== undefined && this.time >= a.closeAt) {
      a.closing = true;
      for (const el of a.labels) el.classList.remove('show');
    }
    if (a.closing) {
      a.phi -= (dt / CLOSE_SECONDS) * FULL_ANGLE;
      if (a.phi <= 0) {
        this.close();
        return;
      }
    } else a.phi = Math.min(FULL_ANGLE, a.phi + (dt / OPEN_SECONDS) * FULL_ANGLE);
    const k = a.phi / FULL_ANGLE;
    const phi = Math.max(0.01, FULL_ANGLE * (k * k * (3 - 2 * k))); // smoothstep easing
    const A = this.A.copy(a.right).multiplyScalar(Math.cos(phi)).addScaledVector(a.front, Math.sin(phi));
    const B = this.B.copy(a.right).multiplyScalar(-Math.cos(phi)).addScaledVector(a.front, Math.sin(phi));
    a.body.cut.uCutA.value.copy(A);
    a.body.cut.uCutB.value.copy(B);

    const center = a.body.anchor.position;
    const R = a.body.info.radius * 0.999;
    this.placeFace(this.faces[0], A, B, center, R);
    this.placeFace(this.faces[1], B, A, center, R);
    this.placeLabels(a, A, B, center, a.body.info.radius);
  }

  /**
   * The slice always faces the viewer — however the camera is turned, the child sees inside. It
   * points up and to the right of the camera (not straight at it), so the two cut faces are seen
   * at different angles, textbook-style.
   */
  private aimAtCamera(a: Active) {
    this.camera.updateMatrixWorld();
    const m = this.camera.matrixWorld;
    const camRight = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
    const camUp = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
    const toCam = this.camera.position.clone().sub(a.body.anchor.position).normalize();
    a.front.copy(toCam).addScaledVector(camRight, 0.75).addScaledVector(camUp, 0.5).normalize();
    a.right.copy(camRight).addScaledVector(a.front, -camRight.dot(a.front)).normalize();
    a.up.crossVectors(a.right, a.front).normalize();
    if (a.up.dot(camUp) < 0) a.up.negate();
  }

  /** Half disc in the plane ⟂ n, on the side where dot(p, other) > 0. */
  private placeFace(face: THREE.Mesh, n: THREE.Vector3, other: THREE.Vector3, center: THREE.Vector3, R: number) {
    const y = other.clone().addScaledVector(n, -other.dot(n)).normalize();
    const x = new THREE.Vector3().crossVectors(y, n);
    face.matrixAutoUpdate = true;
    face.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
    face.position.copy(center);
    face.scale.setScalar(R);
  }

  /** Labels sit on the left face along a ray going up, one per layer at its middle radius. */
  private placeLabels(a: Active, A: THREE.Vector3, B: THREE.Vector3, center: THREE.Vector3, R: number) {
    const inPlane = B.clone().addScaledVector(A, -B.dot(A)).normalize();
    const upOnFace = a.up.clone().addScaledVector(A, -a.up.dot(A)).normalize();
    const dir = inPlane.multiplyScalar(0.35).addScaledVector(upOnFace, 0.94).normalize();
    const layers = STRUCTURE[a.body.info.id].layers;
    const w = window.innerWidth, h = window.innerHeight;
    const p = new THREE.Vector3();
    layers.forEach((l, i) => {
      const lo = layers[i + 1]?.to ?? 0;
      const mid = (l.to + lo) / 2;
      p.copy(center).addScaledVector(dir, R * mid).project(this.camera);
      const el = a.labels[i];
      el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
    });
  }
}
