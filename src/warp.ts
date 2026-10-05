import * as THREE from 'three';

// The hyperjump between realms: the picture blurs towards the middle, stars stream past as long
// lines, the view widens as if we were thrown forward, a flash, and the same backwards in the new
// place while the camera flies in. The frame is drawn into a picture first and this effect is laid
// over it, so it works the same over the Solar System and over the black hole.

const OUT = 1.1; // seconds: rushing away
const IN = 1.4; // seconds: arriving

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = (taps: number) => /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uS;      // strength 0..1
uniform float uTime;
uniform float uToneMap; // the scene picture still needs the app's tone mapping (the black hole's has its own)
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 d = uv - 0.5;
  // zoom blur: everything smeared along lines from the middle
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${taps}; i++) {
    float k = float(i) / float(${taps - 1});
    col += texture2D(uScene, 0.5 + d * (1.0 - uS * 0.45 * k)).rgb;
  }
  col /= float(${taps});
  // stars streaming past: thin lines along rays from the middle, racing outwards
  vec2 a = d * vec2(uRes.x / uRes.y, 1.0);
  float r = length(a);
  float ang = atan(a.y, a.x) / 6.2831853 + 0.5;
  float lanes = 140.0;
  float lane = floor(ang * lanes);
  float h = hash(lane);
  float across = abs(fract(ang * lanes) - 0.5) * 2.0; // 0 on the lane's line
  float head = fract(h * 7.3 + uTime * (0.35 + 0.9 * h) * (0.4 + 2.2 * uS)) * 1.2;
  float len = 0.04 + 0.5 * uS * uS;
  float streak = smoothstep(head - len, head, r) * step(r, head) * (1.0 - smoothstep(0.0, 0.25 + 0.5 * r, across));
  streak *= step(0.55, h) * smoothstep(0.05, 0.3, r) * uS;
  col += streak * vec3(0.75, 0.88, 1.0) * 2.5;
  // the light at the end of the tunnel: a glow from the middle, a flash at the turn
  col += vec3(0.6, 0.75, 1.0) * uS * uS * 0.9 * exp(-r * 3.0);
  col = mix(col, vec3(0.92, 0.96, 1.0), smoothstep(0.8, 1.0, uS) * 0.9);
  gl_FragColor = vec4(col, 1.0);
  #if defined( TONE_MAPPING )
  if (uToneMap > 0.5) gl_FragColor.rgb = toneMapping(gl_FragColor.rgb);
  #endif
  #include <colorspace_fragment>
}`;

export function createWarp(renderer: THREE.WebGLRenderer, lowEnd: boolean) {
  // half floats where there are (no banding in the dark sky while it blurs); bytes on old devices
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType });
  const uniforms = {
    uScene: { value: target.texture },
    uRes: { value: new THREE.Vector2() },
    uS: { value: 0 },
    uTime: { value: 0 },
    uToneMap: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG(lowEnd ? 8 : 20), uniforms, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new THREE.Camera();

  let t = -1; // seconds since the jump began; -1: no jump
  let turned = false;
  let onTurn: (() => void) | null = null;
  const ease = (x: number) => x * x * (3 - 2 * x);

  return {
    get active() {
      return t >= 0;
    },
    /** Start a jump; `turn` is called at its peak, behind the flash: switch to the new place there. */
    start(turn: () => void, reduced = false) {
      t = reduced ? OUT * 0.6 : 0; // «reduce motion»: a short flash, no rush
      turned = false;
      onTurn = turn;
    },
    /** How strong the effect is now (0..1), e.g. to widen the camera's view with it. */
    get strength() {
      return uniforms.uS.value;
    },
    /**
     * One frame: draw the picture with `draw` (into our target while jumping, else straight to the
     * screen). toneMap: whether the picture is the app's scene (needs its tone mapping), not the hole.
     */
    frame(dt: number, draw: (target: THREE.WebGLRenderTarget | null) => void, toneMap: () => boolean) {
      if (t < 0) return draw(null);
      t += Math.min(dt, 0.05);
      if (!turned && t >= OUT) {
        turned = true;
        onTurn?.();
      }
      uniforms.uS.value = t < OUT ? ease(t / OUT) : 1 - ease(Math.min((t - OUT) / IN, 1));
      uniforms.uTime.value += Math.min(dt, 0.05);
      uniforms.uToneMap.value = toneMap() ? 1 : 0; // after the turn: the new realm's picture
      const size = renderer.getDrawingBufferSize(uniforms.uRes.value);
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      draw(target);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      if (t >= OUT + IN) {
        t = -1;
        uniforms.uS.value = 0;
      }
    },
  };
}
