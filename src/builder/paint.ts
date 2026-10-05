import * as THREE from 'three';
import { BUMP_GLSL, NOISE_GLSL } from '../noise';

// Painting a planet. The child paints kinds of ground — ocean, forest, desert, mountains, ice — onto
// the globe with a finger. Underneath is a map of those kinds (equirectangular, two pictures: the
// share of each kind at every spot, ocean/forest/desert in one, mountains/ice in the other, so soft
// brush edges blend kinds smoothly). A shader turns that map into a world that looks real: deep and
// shallow sea, varied forest, dunes, ridges with snow, relief shading, glints of light on the water,
// clouds if the air is like Earth's. And the climate acts on the painting, as physics would: seas
// freeze on a cold planet, dry up near the star or without air.

export type Surface = 'ocean' | 'forest' | 'desert' | 'mountains' | 'ice';
export const SURFACES: Surface[] = ['ocean', 'forest', 'desert', 'mountains', 'ice'];
/** each kind's channel: [picture, channel] */
const CHANNEL: Record<Surface, [0 | 1, number]> = { ocean: [0, 0], forest: [0, 1], desert: [0, 2], mountains: [1, 0], ice: [1, 1] };
/** a swatch colour for the palette */
export const SWATCH: Record<Surface, string> = { ocean: '#2f6fc4', forest: '#3f8f3a', desert: '#e0b66a', mountains: '#8a6a4c', ice: '#eef6ff' };

const W = 512, H = 256;

/** A planet's painting: the two pictures and their textures. */
export interface Painting {
  canvases: [HTMLCanvasElement, HTMLCanvasElement];
  textures: [THREE.CanvasTexture, THREE.CanvasTexture];
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/** A fresh painting: all ocean (most planets with water start as a water world). */
export function newPainting(fill: Surface = 'ocean'): Painting {
  const canvases: [HTMLCanvasElement, HTMLCanvasElement] = [canvas(), canvas()];
  const p: Painting = { canvases, textures: canvases.map((c) => new THREE.CanvasTexture(c)) as [THREE.CanvasTexture, THREE.CanvasTexture] };
  for (const t of p.textures) {
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
  }
  clearPainting(p, fill);
  return p;
}

const oneHot = (s: Surface, pic: 0 | 1) => {
  const [p, ch] = CHANNEL[s];
  const c = [0, 0, 0];
  if (p === pic) c[ch] = 255;
  return c;
};

export function clearPainting(p: Painting, fill: Surface) {
  p.canvases.forEach((c, i) => {
    const g = c.getContext('2d')!;
    const [r, gg, b] = oneHot(fill, i as 0 | 1);
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(0, 0, W, H);
  });
  p.textures.forEach((t) => (t.needsUpdate = true));
}

/** Kept as pictures (PNG data URLs) with the system. */
export const paintingToData = (p: Painting): [string, string] => [p.canvases[0].toDataURL('image/png'), p.canvases[1].toDataURL('image/png')];
export function paintingFromData(data: [string, string]): Painting {
  const p = newPainting();
  data.forEach((url, i) => {
    const img = new Image();
    img.onload = () => {
      p.canvases[i].getContext('2d')!.drawImage(img, 0, 0, W, H);
      p.textures[i].needsUpdate = true;
    };
    img.src = url;
  });
  return p;
}

/** How much of the planet is ocean (0..1): the planet «has water» if any is painted. */
export function oceanShare(p: Painting) {
  const d = p.canvases[0].getContext('2d')!.getImageData(0, 0, W, H).data;
  let sum = 0, n = 0;
  for (let y = 0; y < H; y += 4) {
    const w = Math.cos(((y + 0.5) / H - 0.5) * Math.PI); // rows near the poles are small circles
    for (let x = 0; x < W; x += 4) {
      sum += (d[(y * W + x) * 4] / 255) * w;
      n += w;
    }
  }
  return sum / n;
}

/** One dab of the brush at a spot of the map (uv as on the sphere), soft at its edge, wrapping round. */
export function dab(p: Painting, s: Surface, uv: THREE.Vector2, size: number) {
  const x = uv.x * W, y = (1 - uv.y) * H;
  const lat = (uv.y - 0.5) * Math.PI;
  const ry = size, rx = size / Math.max(Math.cos(lat), 0.12); // the map stretches towards the poles
  p.canvases.forEach((c, i) => {
    const g = c.getContext('2d')!;
    const [r, gg, b] = oneHot(s, i as 0 | 1);
    for (const ox of [-W, 0, W]) {
      g.save();
      g.translate(x + ox, y);
      g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
      grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.85)`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, ry, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  });
  p.textures.forEach((t) => (t.needsUpdate = true));
}

// ---------- the look ----------
const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWorldNormal;
void main() {
  vUv = uv;
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uA;      // ocean, forest, desert
uniform sampler2D uB;      // mountains, ice
uniform vec3 uLightPos;    // the star (world)
uniform vec3 uLightColor;
uniform float uCold;       // 0..1: seas freeze, snow on land
uniform float uDry;        // 0..1: seas dry up (heat, or no air to hold the water)
uniform float uClouds;     // 0..1
uniform float uTime;
uniform float uMolten;     // 1 just after a collision: a sea of lava, cooling to 0
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vWorldNormal;
${NOISE_GLSL}
${BUMP_GLSL}
void main() {
  vec3 a = texture2D(uA, vUv).rgb;
  vec2 b = texture2D(uB, vUv).rg;
  float total = a.r + a.g + a.b + b.r + b.g + 1e-4;
  float wOcean = a.r / total, wForest = a.g / total, wDesert = a.b / total, wMount = b.r / total, wIce = b.g / total;
  vec3 p = normalize(vObj);
  // the painted borders wobble a little, like real coasts
  float wob = fbm(p * 9.0, 3) * 0.18;
  wOcean = clamp(wOcean + wob * (wOcean - 0.5) * 2.0, 0.0, 1.0);
  float land = 1.0 - wOcean;
  float n = fbm(p * 6.0, 4);
  float fine = fbm(p * 28.0, 3);
  float ridge = ridged(p * 5.0, 4);

  // colours (linear)
  vec3 deep = vec3(0.004, 0.02, 0.07), shallow = vec3(0.02, 0.12, 0.2);
  vec3 ocean = mix(deep, shallow, smoothstep(0.55, 1.0, 1.0 - wOcean + 0.25 * fine));
  vec3 forest = mix(vec3(0.02, 0.08, 0.02), vec3(0.09, 0.16, 0.04), smoothstep(-0.4, 0.5, n + 0.4 * fine));
  vec3 desert = mix(vec3(0.42, 0.27, 0.12), vec3(0.62, 0.45, 0.24), smoothstep(-0.5, 0.6, fine + 0.5 * sin(p.x * 60.0 + n * 8.0)));
  vec3 rock = mix(vec3(0.12, 0.09, 0.07), vec3(0.3, 0.26, 0.22), ridge);
  vec3 mountains = mix(rock, vec3(0.85, 0.88, 0.92), smoothstep(0.68, 0.82, ridge)); // snow on the peaks
  vec3 ice = vec3(0.78, 0.84, 0.9) * (0.9 + 0.1 * fine) - vec3(0.12, 0.08, 0.03) * smoothstep(0.5, 0.9, ridged(p * 14.0, 2));
  // climate: a cold planet freezes its seas and whitens its land; heat (or no air) dries the seas
  vec3 dried = mix(vec3(0.35, 0.3, 0.26), vec3(0.5, 0.42, 0.32), fine * 0.5 + 0.5);
  ocean = mix(ocean, dried, uDry * (1.0 - uCold));
  ocean = mix(ocean, vec3(0.7, 0.8, 0.88) * (0.92 + 0.08 * fine), uCold);
  forest = mix(forest, vec3(0.3, 0.22, 0.1), uDry * (1.0 - uCold));
  forest = mix(forest, vec3(0.8, 0.84, 0.88), uCold * 0.85);
  desert = mix(desert, vec3(0.82, 0.85, 0.9), uCold * 0.7);
  vec3 albedo = ocean * wOcean + forest * wForest + desert * wDesert + mountains * wMount + ice * wIce;

  // relief: mountains high, sea low
  float h = wMount * (0.5 + 0.5 * ridge) + (wForest + wDesert) * 0.08 * fine + wIce * 0.1 * fine;
  vec3 Ng = normalize(vWorldNormal);
  vec3 N = perturbNormal(vWorld, Ng, h, 0.05);
  vec3 L = normalize(uLightPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = max(dot(N, L), 0.0);
  vec3 col = albedo * uLightColor * (diff * 1.6 + 0.03);
  // glints on open water
  float wet = wOcean * (1.0 - uCold) * (1.0 - uDry);
  col += uLightColor * pow(max(dot(reflect(-L, Ng), V), 0.0), 60.0) * 0.6 * wet * step(0.0, dot(Ng, L));
  // clouds drifting over (only with air like Earth's)
  float c = smoothstep(0.1, 0.55, fbm(p * 3.0 + vec3(uTime * 0.01, 0.0, uTime * 0.006), 5)) * uClouds;
  col = mix(col, vec3(1.0) * uLightColor * (max(dot(Ng, L), 0.0) * 1.4 + 0.02), c * 0.85);
  // molten after a collision: glowing lava in the cracks of a dark crust that thickens as it cools
  if (uMolten > 0.0) {
    float cracks = ridged(p * 7.0 + 5.0, 3);
    vec3 lava = vec3(1.5, 0.42, 0.08) * (smoothstep(0.78 - 0.5 * uMolten, 1.0, cracks) + 0.6 * uMolten * uMolten);
    col = mix(col, col * 0.2 + lava, smoothstep(0.0, 0.15, uMolten));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function paintedMaterial(p: Painting) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uA: { value: p.textures[0] },
      uB: { value: p.textures[1] },
      uLightPos: { value: new THREE.Vector3() },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uCold: { value: 0 },
      uDry: { value: 0 },
      uClouds: { value: 0 },
      uTime: { value: 0 },
      uMolten: { value: 0 },
    },
    extensions: { derivatives: true },
  });
}
