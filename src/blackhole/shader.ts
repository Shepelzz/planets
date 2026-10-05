import * as THREE from 'three';
import { NOISE_GLSL } from '../noise';
import { SRGB_GLSL } from '../textures';

// A black hole drawn the way Interstellar's Gargantua was: not a model but light traced backwards.
// For every pixel a ray leaves the camera and is bent, step by step, by the hole's gravity
// (Schwarzschild metric: a photon's path obeys a'' = -3/2 · h² · r / |r|⁵, h = |r × v| fixed per ray).
// Where it crosses the flat disk of glowing gas we pick up its light, where it falls below the horizon
// it is black, where it flies off we look up the sky in its final direction. That alone gives the
// film's look: the far side of the disk lensed into an arch over and under the hole, the thin photon
// ring hugging the shadow, the stars smeared round it.
// Units: the horizon's radius is 1 (that is what the equation above assumes), so the photon sphere is
// at r = 1.5 and rays aimed closer than b = 1.5·√3 ≈ 2.6 fall in: that is the shadow's edge.

export const BLACK_HOLE_FRAG = (maxSteps: number) => /* glsl */ `
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform mat3 uCamRot;     // camera orientation: right, up, back (columns)
uniform float uTanHalfFov;
uniform float uRoll;      // tilt of the picture (the film's diagonal disk)
uniform float uTime;
uniform float uDoppler;   // 0: symmetric, as in the film; 1: the side coming at us brighter and bluer
uniform float uStep;      // step size factor (quality)
uniform float uRing;
uniform float uDebug;     // 1: show how fast the sky direction changes between pixels (seams)      // the thin bright photon ring at the shadow's edge (0..1)
uniform sampler2D uSky;   // the Milky Way (equirectangular)
uniform vec2 uSkySize;    // its size in texels
uniform sampler2D uStreaks; // the disk's streaks, baked once (bakeStreaks): angle across, radius down
${NOISE_GLSL}
${SRGB_GLSL}

const float HORIZON = 1.0;
const float DISK_IN = 2.3; // close to the shadow, as round a fast-spinning hole like Gargantua
const float DISK_OUT = 12.0;
const float STREAKS_IN = ${STREAKS_IN.toFixed(2)};
const float STREAKS_OUT = ${STREAKS_OUT.toFixed(2)};
const float FAR = 400.0; // far enough that the light's last bit of bending no longer matters
const float CRITICAL_B = 2.598076; // 1.5·√3: rays aimed closer than this fall in (the shadow's edge)

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// The sky in a direction. Called once per pixel after the loop (not inside it), so the texture's
// mip level and the pixel size, taken from how fast the direction changes between pixels, are well
// defined: far from the hole the sky is sharp, close to it (light smeared round the hole) it blurs.
vec2 skyUV(vec3 d, bool wrapHalf) {
  float phi = atan(d.z, d.x) / 6.2831853;
  float u = wrapHalf ? fract(phi + 0.5) - 0.5 : fract(phi);
  return vec2(u + 0.5, 1.0 - acos(clamp(d.y, -1.0, 1.0)) / 3.1415927);
}
// d: where the light came from; even: the same by the simple far-field formula, for every pixel. The
// map's sharpness (mip level) is taken from how fast 'even' changes between pixels, not 'd': on the
// line where the stepped and the formula rays meet, neighbouring 'd's come from different sums and
// would read the map blurrier along a thin line.
vec3 sky(vec3 d, vec3 even) {
  // longitude: of the two ways to wrap it, take the one without a jump here (else a seam of blur)
  vec2 a1 = skyUV(even, false), a2 = skyUV(even, true);
  bool wrapped = fwidth(a1.x) > fwidth(a2.x);
  vec2 g = fwidth(wrapped ? a2 : a1) * uSkySize;
  // never the sharpest level: the map is very dark, and at full detail its 8-bit steps and JPEG grain,
  // brightened, show as black ripples; the Milky Way is a soft glow anyway (the stars are drawn apart)
  float lod = clamp(log2(max(max(g.x, g.y), 1e-4)), 2.0, 12.0);
  vec2 uv = skyUV(d, wrapped);
  vec3 c = srgbToLinear(texture2DLodEXT(uSky, uv, lod).rgb) * 1.4;
  // sharp stars (the first prototype's)
  vec3 cell = floor(d * 260.0);
  float h = hash3(cell);
  if (h > 0.993) {
    vec3 centre = (cell + 0.5) / 260.0;
    float s = smoothstep(0.0017, 0.0, length(d - normalize(centre)));
    c += s * (h - 0.993) * 300.0 * mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash3(cell + 7.0));
  }
  return c;
}

// soft glow of the hot gas just above and below the disk (gives it thickness, like the film's haze)
float haze(vec3 p) {
  float r = length(p.xz);
  float inner = smoothstep(DISK_IN + 0.2, DISK_IN + 1.4, r) * (1.0 - smoothstep(DISK_OUT * 0.5, DISK_OUT, r));
  return inner * pow(DISK_IN / r, 2.5) * exp(-abs(p.y) * 7.0);
}

// the disk's streaks at angle a (already turned) and radius r, from the baked map: copy 1 in red,
// copy 2 in green
vec2 streaksAt(float a, float r) {
  vec2 uv = vec2(a / 6.2831853, (r - STREAKS_IN) / (STREAKS_OUT - STREAKS_IN));
  return texture2D(uStreaks, uv).rg * 2.0 - 1.0;
}

// The gas disk at point p (on the plane y = 0); ray is the direction we are tracing (from the camera).
vec4 disk(vec3 p, vec3 ray) {
  float r = length(p.xz);
  if (r < DISK_IN - 0.4 || r > DISK_OUT) return vec4(0.0);
  // Kepler: the inner gas circles much faster than the outer, so the streaks shear and flow
  float spin = 2.2 * pow(r, -1.5);
  float phi = atan(p.z, p.x);
  // Turned for ever, the shear would wind the streaks ever tighter until they look frozen. So two
  // copies of the pattern take turns: each is turned for one period from a fresh start, and fades in
  // while the other, by then wound up, fades out. The flow never slows down.
  float T = 14.0;
  float t1 = mod(uTime, T);
  float t2 = mod(uTime + 0.5 * T, T);
  float w = abs(2.0 * t1 / T - 1.0); // 1 when the first copy restarts: show the second
  float n = mix(streaksAt(phi - t1 * spin * 2.6, r).r, streaksAt(phi - t2 * spin * 2.6, r).g, w);
  n /= sqrt(w * w + (1.0 - w) * (1.0 - w)); // two blended noises are flatter: keep the contrast
  float streak = clamp(0.6 + 0.9 * n, 0.0, 1.6);
  float edge = smoothstep(DISK_IN - 0.4, DISK_IN + 0.5, r) * (1.0 - smoothstep(DISK_OUT * 0.55, DISK_OUT, r));
  float heat = pow(DISK_IN / r, 2.3);
  vec3 col = mix(vec3(1.0, 0.38, 0.06), vec3(1.0, 0.8, 0.5), clamp(pow(DISK_IN / r, 1.2), 0.0, 1.0));
  float glow = heat * edge * streak * 3.2;
  if (uDoppler > 0.0) {
    // the gas coming towards us looks brighter and bluer, going away dimmer and redder
    vec3 v = normalize(vec3(p.z, 0.0, -p.x)) * sqrt(1.0 / r); // the way the streaks turn (a decreases)
    float beta = length(v);
    float cosT = dot(normalize(v), -normalize(ray));
    float D = sqrt(1.0 - beta * beta) / (1.0 - beta * cosT);
    float boost = mix(1.0, pow(D, 3.0), uDoppler);
    glow *= boost;
    col = mix(col, col * vec3(0.75, 0.9, 1.25), clamp((D - 1.0) * 1.5 * uDoppler, 0.0, 1.0));
    col = mix(col, col * vec3(1.15, 0.7, 0.45), clamp((1.0 - D) * 1.5 * uDoppler, 0.0, 1.0));
  }
  float alpha = clamp(glow * 0.6, 0.0, 0.92) * edge;
  return vec4(col * glow, alpha);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  ndc.x *= uRes.x / uRes.y;
  float cr = cos(uRoll), sr = sin(uRoll);
  ndc = vec2(cr * ndc.x - sr * ndc.y, sr * ndc.x + cr * ndc.y);
  vec3 dir = normalize(uCamRot * vec3(ndc * uTanHalfFov, -1.0));
  vec3 pos = uCamPos;
  vec3 hv = cross(pos, dir);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float covered = 0.0; // how much of the pixel is already filled by disk light in front
  float skyPart = 1.0; // how much of the sky shows through (0 if the ray fell in)
  vec3 acc = -1.5 * h2 * pos / pow(dot(pos, pos), 2.5);
  float b0 = sqrt(h2);
  float r0 = length(pos);
  // A ray that never comes within the disk (most of the sky) needs no stepping: weak-field bending,
  // 2M/b·(1 − cos) to infinity, is exact enough out there and costs nothing.
  bool straight = b0 > DISK_OUT + 1.5 && r0 < FAR;
  vec3 evenDir = normalize(dir + (1.0 - dot(pos, dir) / r0) / max(b0, 0.5) * normalize(dot(pos, dir) * dir - pos + vec3(0.0, 1e-6, 0.0)));
  if (straight) dir = evenDir;
  if (!straight) for (int i = 0; i < ${maxSteps}; i++) {
    float r = length(pos);
    // fine steps near the hole, long ones far away
    float dt = clamp(min(0.0075 * r * r, 0.12 * r), 0.01, 60.0) * uStep;
    // velocity Verlet: second order, so neighbouring pixels agree (no rings of noise far out)
    vec3 next = pos + dir * dt + 0.5 * acc * dt * dt;
    vec3 acc2 = -1.5 * h2 * next / pow(dot(next, next), 2.5);
    dir += 0.5 * (acc + acc2) * dt;
    acc = acc2;
    if (pos.y * next.y < 0.0) {
      vec3 hit = mix(pos, next, pos.y / (pos.y - next.y));
      vec4 d = disk(hit, dir);
      col += (1.0 - covered) * d.rgb;
      covered += (1.0 - covered) * d.a;
      if (covered > 0.97) break;
    }
    col += (1.0 - covered) * vec3(1.0, 0.55, 0.2) * haze(next) * dt * 0.5;
    pos = next;
    if (dot(pos, pos) < HORIZON * HORIZON) { skyPart = 0.0; break; } // fell in: black
    if (r > FAR && dot(pos, dir) > 0.0) break;
  }
  // The last bit of bending from where the stepping stopped out to infinity, by the same formula as
  // the far rays: without it neighbouring pixels stop at slightly different places, their directions
  // jitter, the sky map is read blurrier there than next to them, and a seam shows where the two meet.
  if (!straight && skyPart > 0.0) {
    vec3 nd = normalize(dir);
    float rr = length(pos);
    float bb = max(length(cross(pos, nd)), 0.001);
    dir = normalize(nd + (1.0 - dot(pos, nd) / rr) / bb * normalize(dot(pos, nd) * nd - pos + vec3(0.0, 1e-6, 0.0)));
  }
  if (uDebug > 0.5) { gl_FragColor = vec4(vec3(length(fwidth(normalize(dir))) * 250.0), 1.0); return; }
  col += (1.0 - covered) * skyPart * sky(normalize(dir), evenDir);
  // the photon ring: light that circled the hole just outside the shadow, a thin bright line round it
  float b = sqrt(h2);
  // (squares written out: pow() of a negative number is undefined in GLSL, NaN on most GPUs; inside
  // the shadow that was invisible black, but the glow pass smeared it into black ripples)
  float x1 = (b - CRITICAL_B - 0.02) / 0.025, x2 = (b - CRITICAL_B - 0.05) / 0.12;
  float ring = exp(-x1 * x1) + 0.3 * exp(-x2 * x2);
  col += uRing * ring * vec3(1.0, 0.86, 0.66) * 0.9 * (1.0 - covered * 0.6);
  // filmic exposure
  col = vec3(1.0) - exp(-col * 1.35);
  // linear out: three turns it into screen colour (or the glow pass works on it first)
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// ---------- the disk's streaks, baked once ----------
// Six noise evaluations per disk crossing per pixel per frame were most of the cost: the pattern only
// turns, so it is drawn once into a map (angle across, radius down; two independent copies in red and
// green for the cross-fade) and the disk just reads it.
const STREAKS_IN = 1.9;
const STREAKS_OUT = 12.0;
const BAKE_FRAG = /* glsl */ `
uniform vec2 uSize;
${NOISE_GLSL}
float streaks(float a, float r, float seed) {
  float n = snoise(vec3(cos(a) * 1.4, sin(a) * 1.4, r * 2.4 + seed));
  n = 0.55 * n + 0.35 * snoise(vec3(cos(a) * 3.2, sin(a) * 3.2, r * 7.0 + 11.0 + seed));
  return n + 0.18 * snoise(vec3(cos(a) * 7.0, sin(a) * 7.0, r * 16.0 + 5.0 + seed));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float a = uv.x * 6.2831853;
  float r = ${STREAKS_IN.toFixed(2)} + uv.y * ${(STREAKS_OUT - STREAKS_IN).toFixed(2)};
  gl_FragColor = vec4(clamp(vec2(streaks(a, r, 0.0), streaks(a, r, 37.0)) * 0.5 + 0.5, 0.0, 1.0), 0.0, 1.0);
}`;

/** Draw the streak map (once). No mipmaps: the disk reads it inside the ray loop. */
export function bakeStreaks(renderer: THREE.WebGLRenderer) {
  const w = 2048, h = 512;
  const target = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false });
  target.texture.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({ vertexShader: BLACK_HOLE_VERT, fragmentShader: BAKE_FRAG, uniforms: { uSize: { value: new THREE.Vector2(w, h) } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const keep = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.Camera());
  renderer.setRenderTarget(keep);
  mat.dispose();
  quad.geometry.dispose();
  return target.texture;
}

export const BLACK_HOLE_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
