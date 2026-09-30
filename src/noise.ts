// Shared GLSL helpers: 3D simplex noise, fbm, hashes, crater field and derivative bump-mapping.
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p = p * 2.03 + vec3(17.1, 9.2, 3.7);
    amp *= 0.5;
  }
  return sum;
}

// Ridged fbm: sharp crests, good for mountain ranges.
float ridged(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p));
    sum += amp * n * n;
    p = p * 2.07 + vec3(5.3, 1.1, 8.9);
    amp *= 0.5;
  }
  return sum;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Crater height field on one voronoi scale: dark bowl, bright raised rim.
float craterLayer(vec3 p, float density) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float h = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 cell = i + g;
    if (hash13(cell + 3.7) > density) continue;
    vec3 r = g + hash33(cell) - f;
    float rad = 0.18 + 0.3 * hash13(cell + 7.1);
    float d = length(r) / rad;
    float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
    float rim = exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.35;
    h += bowl + rim;
  }
  return h;
}

// Bump mapping from screen-space derivatives of a scalar height (no tangents needed).
vec3 perturbNormal(vec3 pos, vec3 n, float h, float scale) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(h) * scale;
  float dhdy = dFdy(h) * scale;
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-12) return n;
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}

// Saturn-style ring optical density as a function of radius (in planet radii).
float ringDensity(float r) {
  float d = 0.0;
  d += (0.10 + 0.12 * smoothstep(1.24, 1.52, r)) * smoothstep(1.23, 1.25, r) * (1.0 - smoothstep(1.51, 1.53, r)); // C ring
  d += (0.62 + 0.3 * smoothstep(1.53, 1.78, r)) * smoothstep(1.52, 1.54, r) * (1.0 - smoothstep(1.94, 1.96, r)); // B ring
  d += 0.06 * smoothstep(1.95, 1.96, r) * (1.0 - smoothstep(2.02, 2.03, r)); // Cassini division
  d += 0.55 * smoothstep(2.02, 2.035, r) * (1.0 - smoothstep(2.26, 2.275, r)); // A ring
  d *= 1.0 - 0.9 * (1.0 - smoothstep(0.0, 0.006, abs(r - 2.215))); // Encke gap
  float fine = 0.72 + 0.14 * sin(r * 230.0) + 0.09 * sin(r * 611.0 + 1.3) + 0.05 * sin(r * 1450.0 + 0.4);
  return clamp(d * fine, 0.0, 1.0);
}
`;
