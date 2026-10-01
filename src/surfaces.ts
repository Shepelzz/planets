// Surface functions sampling real planetary maps. Each defines:
//   vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night)
// returning linear albedo; h is a height proxy used for bump shading.

export type SurfaceKind =
  | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto' | 'charon';

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
};

/** Texture files in public/textures (Solar System Scope, CC BY 4.0, based on NASA data). */
export const TEXTURE_FILES: Record<SurfaceKind | 'sun', string> = {
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
};

/** Bump strength (fraction of radius per unit of map brightness). */
export const BUMP: Partial<Record<SurfaceKind, number>> = {
  mercury: 0.02,
  moon: 0.02,
  mars: 0.012,
  earth: 0.006,
  pluto: 0.012,
  charon: 0.015,
};
