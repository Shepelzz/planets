// The science of «Моя система»: real relations, so what the child sees follows from what was chosen.
//   · a star's mass sets its temperature (colour), size and brightness (main-sequence stars);
//   · its brightness sets where water stays liquid: the habitable zone, ≈ 0.95–1.37 AU · √L
//     (Kasting et al.: the Sun's zone runs from about 0.95 to 1.37 AU);
//   · a planet's year follows Kepler's third law, P² = a³ / M (years, AU, Suns);
//   · its temperature: the balance of starlight it gets and heat it gives off, 255 K · L^¼ / √a for an
//     Earth-like planet, plus a greenhouse warming for a rocky planet with air (see temperatureC);
//   · gravity at the surface: g ∝ mass / radius², and for planets of the same stuff mass ∝ radius³,
//     so g ∝ radius.

/** how many planets a system can have here (the panel and the scene stay readable) */
export const MAX_PLANETS = 6;

export type StarKind = 'red' | 'sun' | 'white' | 'blue';
export type PlanetKind = 'rocky' | 'ice' | 'gas';
export type PlanetSize = 'small' | 'medium' | 'large';
/** a rocky planet's air: none (like the Moon), thin (Mars), like Earth's, thick (Venus) */
export type Air = 'none' | 'thin' | 'earth' | 'thick';

/** what a planet is made of and has, as far as the physics here needs */
export interface PlanetMake {
  kind: PlanetKind;
  air: Air;
  water: boolean;
}

export interface Star {
  /** in Suns */
  mass: number;
  /** luminosity, in Suns */
  lum: number;
  /** surface temperature, K */
  temp: number;
  /** radius, in Suns */
  radius: number;
}

// Typical main-sequence stars: an M dwarf, the Sun (G2), an A star like Sirius, a B star.
export const STARS: Record<StarKind, Star> = {
  red: { mass: 0.3, lum: 0.012, temp: 3300, radius: 0.32 },
  sun: { mass: 1, lum: 1, temp: 5780, radius: 1 },
  white: { mass: 2, lum: 20, temp: 9500, radius: 1.7 },
  blue: { mass: 10, lum: 5600, temp: 25000, radius: 4.8 },
};

// ---------- two stars ----------
// The two stars circle their common centre of mass; the planets circle both (like Tatooine — real ones
// exist, e.g. Kepler-16b). Their light adds up, so does their mass (for the planets' years). Too close
// to the pair a planet is pushed and pulled by turns until it is thrown out: closer than about 2.5
// times the stars' separation (Holman & Wiegert 1999) no orbit lasts. The stars are set apart so that
// the zone of life lies beyond that: separation = 0.3 × the zone's inner edge.

/** Two stars seen from far away, as one: their light and their mass added up. */
export function together(a: Star, b: Star | null): Star {
  if (!b) return a;
  return { mass: a.mass + b.mass, lum: a.lum + b.lum, temp: a.lum >= b.lum ? a.temp : b.temp, radius: Math.max(a.radius, b.radius) };
}
/** the star kinds chosen, as the planets feel them */
export const pairStars = (a: StarKind, b?: StarKind | null) => together(STARS[a], b ? STARS[b] : null);
/** distance between the two stars, AU */
export const separation = (pair: Star) => 0.3 * habitableZone(pair).inner;
/** inside this distance from the pair (AU) no planet's orbit lasts */
export const unstableWithin = (pair: Star) => 2.5 * separation(pair);
/** The stars' own year (how long one circle round each other takes), in Earth days. */
export const pairYearDays = (pair: Star) => yearDays(pair, separation(pair));

/** The habitable zone, AU. */
export function habitableZone(s: Star) {
  const r = Math.sqrt(s.lum);
  return { inner: 0.95 * r, outer: 1.37 * r };
}

/** A year, in Earth days. */
export const yearDays = (s: Star, au: number) => 365.25 * Math.sqrt((au * au * au) / s.mass);

/**
 * Average surface temperature, °C: the balance of starlight in and heat out, warmed by the planet's
 * air (the greenhouse effect). No air: none (the Moon). Thin air: a few degrees (Mars). Air like
 * Earth's: +33 K at Earth's distance, and more towards the outer edge of the zone — there the
 * planet's own thermostat (the carbonate–silicate cycle) lets carbon dioxide build up, which is why
 * the zone reaches out as far as it does; so the green band and «warm enough for water» stay the same
 * thing. Thick air: a runaway greenhouse, hundreds of degrees (Venus: +500 K). Giants have no surface:
 * the temperature at their cloud tops, from the balance alone.
 */
export function temperatureC(s: Star, au: number, p: PlanetMake) {
  const balance = (255 * Math.pow(s.lum, 0.25)) / Math.sqrt(au);
  const x = au / Math.sqrt(s.lum); // as far as from the Sun, in AU
  let greenhouse = 0;
  if (p.kind === 'rocky')
    greenhouse = { none: 0, thin: 5, earth: 33 + 90 * Math.min(Math.max(x - 1, 0), 0.37), thick: 450 }[p.air];
  return balance + greenhouse - 273;
}

/** The colour of the sky seen from the ground: black without air, blue like ours, pinkish like Mars's, orange under thick clouds. */
export type Sky = 'black' | 'pink' | 'blue' | 'orange';
export const skyOf = (p: PlanetMake): Sky | null =>
  p.kind !== 'rocky' ? null : ({ none: 'black', thin: 'pink', earth: 'blue', thick: 'orange' } as const)[p.air];

/** Surface gravity of a rocky planet, Earths; giants have no surface. */
export const gravity = (size: PlanetSize) => ({ small: 0.4, medium: 1, large: 1.6 })[size];

export type TempBand = 'scorching' | 'hot' | 'mild' | 'cold' | 'frozen';
export function tempBand(c: number): TempBand {
  if (c > 100) return 'scorching';
  if (c > 40) return 'hot';
  if (c >= -5) return 'mild';
  if (c > -80) return 'cold';
  return 'frozen';
}

export type LifeVerdict = 'yes' | 'hot' | 'cold' | 'gas' | 'no_air' | 'no_water' | 'unstable';
/**
 * Could life as we know it be there: a lasting orbit, solid ground, air, liquid water (so not too
 * hot or cold). unstable: the planet is inside the two stars' unstable zone.
 */
export function life(p: PlanetMake, c: number, unstable = false): LifeVerdict {
  if (unstable) return 'unstable';
  if (p.kind !== 'rocky') return 'gas';
  if (p.air === 'none' || p.air === 'thin') return 'no_air';
  if (c > 40) return 'hot';
  if (c < -5) return 'cold';
  if (!p.water) return 'no_water';
  return 'yes';
}

/** A star's colour from its temperature (black body, after Tanner Helland's fit), as 0..1 RGB. */
export function starColor(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = (x: number) => Math.min(Math.max(x, 0), 255) / 255;
  return [c(r), c(g), c(b)];
}

// ---------- the picture's scale ----------
// Real distances span from 0.1 AU (a red dwarf's zone) to 50 AU (a blue giant's): squeezed by a
// power so all of them fit, keeping the order (farther is always farther).
const SCALE = 90;
const POWER = 0.4;
export const auToScene = (au: number) => SCALE * Math.pow(au, POWER);
export const sceneToAu = (r: number) => Math.pow(r / SCALE, 1 / POWER);
/** the star's drawn radius (not to scale either, or planets would be dots) */
export const starSceneRadius = (s: Star) => 8 * Math.pow(s.radius, 0.6);
