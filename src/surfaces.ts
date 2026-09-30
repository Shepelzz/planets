// Surface functions sampling real planetary maps. Each defines:
//   vec3 surface(vec3 p, vec2 uv, out float h, out float spec, out vec3 night)
// returning linear albedo; h is a height proxy used for bump shading.

export type SurfaceKind =
  | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

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
};

/** Bump strength (fraction of radius per unit of map brightness). */
export const BUMP: Partial<Record<SurfaceKind, number>> = {
  mercury: 0.02,
  moon: 0.02,
  mars: 0.012,
  earth: 0.006,
};
