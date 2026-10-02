// Surface functions sampling real planetary maps. Each defines:
//   vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night)
// returning linear albedo; h is a height proxy used for bump shading.

export type SurfaceKind =
  | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto' | 'charon'
  | 'io' | 'europa' | 'ganymede' | 'callisto' | 'titan' | 'enceladus' | 'triton' | 'phobos' | 'deimos' | 'comet';

const TEXTURED = /* glsl */ `
uniform sampler2D uMap;
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  spec = 0.0; night = vec3(0.0);
  vec3 c = srgbToLinear(texture2D(uMap, uv).rgb);
  h = dot(c, vec3(0.299, 0.587, 0.114));
  return c;
}`;

const EARTH = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uNight;
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  vec3 c = srgbToLinear(texture2D(uMap, uv).rgb);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // oceans are the dark, blue-dominant pixels of the day map
  float ocean = smoothstep(0.004, 0.03, c.b - c.r) * (1.0 - smoothstep(0.06, 0.16, lum));
  spec = ocean;
  h = (1.0 - ocean) * lum;
  vec3 n = srgbToLinear(texture2D(uNight, uv).rgb);
  night = max(n - 0.01, 0.0) * 3.2 * (1.0 - ocean);
  return c;
}`;

// New Horizons flew by during southern winter: below ~30°S the maps of Pluto and Charon are black
// (never seen). Fill that part with the mirrored northern surface, a bit darker and shifted in
// longitude so it doesn't look like a copy.
export const UNSEEN_FILL_GLSL = /* glsl */ `
vec3 fillUnseen(sampler2D map, vec2 uv, vec3 raw) {
  float unseen = 1.0 - smoothstep(0.02, 0.14, max(raw.r, max(raw.g, raw.b)));
  vec3 mirrored = texture2D(map, vec2(fract(uv.x + 0.37), 1.0 - uv.y)).rgb * 0.82;
  return mix(raw, mirrored, unseen);
}`;

// Charon's mosaic is greyscale: tint it pale grey-beige and add the red-brown north polar cap
// (Mordor Macula) seen by New Horizons.
export const CHARON_TINT_GLSL = /* glsl */ `
vec3 charonColour(vec3 grey, vec3 p) {
  vec3 c = grey * vec3(0.93, 0.89, 0.85);
  float cap = smoothstep(0.8, 0.93, p.y);
  return mix(c, grey * vec3(0.78, 0.48, 0.34), cap * 0.85);
}`;

const PLUTO = /* glsl */ `
uniform sampler2D uMap;
${UNSEEN_FILL_GLSL}
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  spec = 0.0; night = vec3(0.0);
  vec3 c = srgbToLinear(fillUnseen(uMap, uv, texture2D(uMap, uv).rgb));
  h = dot(c, vec3(0.299, 0.587, 0.114));
  return c;
}`;

const CHARON = /* glsl */ `
uniform sampler2D uMap;
${UNSEEN_FILL_GLSL}
${CHARON_TINT_GLSL}
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  spec = 0.0; night = vec3(0.0);
  vec3 c = srgbToLinear(charonColour(fillUnseen(uMap, uv, texture2D(uMap, uv).rgb), p));
  h = dot(c, vec3(0.299, 0.587, 0.114));
  return c;
}`;

// Moons (NASA 3D Resources maps, public domain). Several maps are greyscale or have gaps where no
// spacecraft looked; each moon below gets its real colours and its gaps filled.
const moonSurface = (colour: string) => /* glsl */ `
uniform sampler2D uMap;
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  spec = 0.0; night = vec3(0.0);
  vec3 raw = texture2D(uMap, uv).rgb;
  float g = dot(raw, vec3(0.299, 0.587, 0.114));
  vec3 c;
  ${colour}
  h = g;
  return c;
}`;

// Io: the map is in colour but black along the poles: take the nearest imaged row instead
const IO = moonSurface(/* glsl */ `
  if (g < 0.06) raw = texture2D(uMap, vec2(uv.x, clamp(uv.y, 0.07, 0.93))).rgb;
  c = srgbToLinear(raw);`);
// Europa: white-beige ice crossed by red-brown cracks
const EUROPA = moonSurface(/* glsl */ `
  c = srgbToLinear(mix(vec3(0.52, 0.32, 0.2), vec3(0.95, 0.91, 0.84), smoothstep(0.25, 0.95, g)));`);
// Ganymede: dark old and bright grooved terrain, slightly brownish
const GANYMEDE = moonSurface(/* glsl */ `
  c = srgbToLinear(raw * vec3(0.98, 0.93, 0.86));`);
// Callisto: dark and full of craters; the big white patch is a gap in the pictures, filled with
// made-up cratered ground of the same tone
const CALLISTO = moonSurface(/* glsl */ `
  float gap = smoothstep(0.78, 0.9, g);
  float made = 0.36 + 0.16 * fbm(p * 9.0, 4) + 0.35 * smoothstep(0.55, 0.8, fbm(p * 26.0 + 3.0, 2));
  g = mix(g, made, gap);
  c = srgbToLinear(vec3(g) * vec3(0.9, 0.82, 0.72));`);
// Titan: the surface glimpsed through a thick orange haze
const TITAN = moonSurface(/* glsl */ `
  c = srgbToLinear(mix(raw, vec3(0.86, 0.6, 0.26), 0.35));`);
// Enceladus: the whitest thing in the Solar System, a touch of blue in the cracks
const ENCELADUS = moonSurface(/* glsl */ `
  c = srgbToLinear(raw * vec3(0.97, 0.99, 1.03));`);
// Triton: Voyager 2 saw only part of it; the rest is filled with its «cantaloupe» terrain and the
// pinkish south polar cap
const TRITON = moonSurface(/* glsl */ `
  float seen = smoothstep(0.03, 0.1, max(raw.r, max(raw.g, raw.b)));
  float n = fbm(p * 7.0, 4);
  vec3 made = mix(vec3(0.6, 0.55, 0.5), vec3(0.8, 0.74, 0.68), n * 0.5 + 0.5);
  made = mix(made, vec3(0.86, 0.72, 0.68), 1.0 - smoothstep(-0.55, -0.2, p.y));
  c = srgbToLinear(mix(made, raw, seen));
  g = dot(c, vec3(0.3));`);
// Phobos and Deimos: dusty grey-brown rock
const MARS_MOON = moonSurface(/* glsl */ `
  c = srgbToLinear(raw * vec3(0.9, 0.8, 0.7));`);

// A comet's nucleus: dust darker than coal, a few bright patches of bare ice (made up: no map)
const COMET = /* glsl */ `
vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night) {
  spec = 0.0; night = vec3(0.0);
  float n = fbm(p * 4.0, 5);
  float fine = fbm(p * 19.0 + 7.0, 3);
  h = n * 0.7 + fine * 0.3;
  vec3 c = mix(vec3(0.07, 0.062, 0.055), vec3(0.2, 0.18, 0.16), smoothstep(-0.5, 0.6, n + fine * 0.3));
  float ice = smoothstep(0.42, 0.6, fbm(p * 7.0 + 3.0, 3));
  return mix(c, vec3(0.62, 0.7, 0.78), ice * 0.7);
}`;

export const SURFACES: Record<SurfaceKind, string> = {
  mercury: TEXTURED,
  venus: TEXTURED,
  earth: EARTH,
  moon: TEXTURED,
  mars: TEXTURED,
  jupiter: TEXTURED,
  saturn: TEXTURED,
  uranus: TEXTURED,
  neptune: TEXTURED,
  pluto: PLUTO,
  charon: CHARON,
  io: IO,
  europa: EUROPA,
  ganymede: GANYMEDE,
  callisto: CALLISTO,
  titan: TITAN,
  enceladus: ENCELADUS,
  triton: TRITON,
  phobos: MARS_MOON,
  deimos: MARS_MOON,
  comet: COMET,
};

/** Texture files in public/textures (Solar System Scope, CC BY 4.0, based on NASA data). */
export const TEXTURE_FILES: Record<Exclude<SurfaceKind, 'comet'> | 'sun', string> = {
  sun: 'sun.jpg',
  mercury: 'mercury.jpg',
  venus: 'venus.jpg',
  earth: 'earth_day.jpg',
  moon: 'moon.jpg',
  mars: 'mars.jpg',
  jupiter: 'jupiter.jpg',
  saturn: 'saturn.jpg',
  uranus: 'uranus.jpg',
  neptune: 'neptune.jpg',
  pluto: 'pluto.jpg', // NASA / New Horizons global mosaic, public domain
  charon: 'charon.jpg', // NASA / New Horizons / USGS global mosaic, public domain
  // moons: NASA 3D Resources, public domain
  io: 'io.jpg',
  europa: 'europa.jpg',
  ganymede: 'ganymede.jpg',
  callisto: 'callisto.jpg',
  titan: 'titan.jpg',
  enceladus: 'enceladus.jpg',
  triton: 'triton.jpg',
  phobos: 'phobos.jpg',
  deimos: 'deimos.jpg',
};

/** Bump strength (fraction of radius per unit of map brightness). */
export const BUMP: Partial<Record<SurfaceKind, number>> = {
  mercury: 0.02,
  moon: 0.02,
  mars: 0.012,
  earth: 0.006,
  pluto: 0.012,
  charon: 0.015,
  io: 0.006,
  ganymede: 0.008,
  callisto: 0.015,
  enceladus: 0.008,
  phobos: 0.03,
  deimos: 0.025,
  comet: 0.04,
};
