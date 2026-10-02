import type { SurfaceKind } from './surfaces.ts';

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto' | 'charon' | 'iss'
  | 'phobos' | 'deimos' | 'io' | 'europa' | 'ganymede' | 'callisto' | 'enceladus' | 'titan' | 'triton'
  | 'comet'
  // the hidden "Passengers" mode (?homestead=true): the Homestead II system and the ship on its way
  | 'homestead_star' | 'homestead' | 'perlyna' | 'burshtyn' | 'zharynka' | 'sapfir' | 'avalon' | 'arcturus';

/**
 * Where a body lives. Each realm is its own place with its own centre: only one is shown at a time,
 * and going to another one is a hyperjump (main.ts). 'sol' — our Solar System; 'homestead' — the
 * Homestead II system from «Passengers»; 'voyage' — deep space halfway, with the ship.
 */
export type Realm = 'sol' | 'homestead' | 'voyage';

export interface Atmosphere {
  color: [number, number, number];
  scale: number; // shell radius / body radius
  intensity: number;
}

// Physical and visual data of each body. All texts (names, facts, narration) live in texts.yaml
// and are joined to this in texts.ts.
export interface BodyPhysics {
  id: BodyId;
  /** dwarf planet: shown in its own group in the dock */
  dwarf?: boolean;
  /** CSS gradient for the dock icon */
  icon: string;
  /** Real diameter in km, used for the "compared to Earth" picture */
  diameterKm: number;

  // Scene parameters (visual, not to scale)
  radius: number;
  orbit: number; // distance from parent
  orbitSeconds: number; // one lap, in seconds of app time
  spinSeconds: number; // one rotation (retrograde spin comes from tilt > 90°)
  tilt: number; // axial tilt, degrees
  startAngle: number;
  /** orbit tilted out of the planets' plane, degrees (Pluto) */
  inclination?: number;
  surface?: SurfaceKind;
  atmosphere?: Atmosphere;
  clouds?: boolean;
  rings?: boolean;
  parent?: BodyId;
  /** a spacecraft, not a ball: drawn from its own model, no cut-away or size comparison */
  station?: boolean;
  /** not a ball but a lumpy potato: relative size along x, y, z (the largest is 1) */
  shape?: [number, number, number];
  /** a moon circling in its planet's equatorial plane (tilted with the planet) */
  equatorial?: boolean;
  /**
   * A big planet's moons are shown only while we visit it: from afar they would be specks, and the
   * giants' moon systems are wider than the gaps between the (squeezed) orbits.
   */
  moonsWhenNear?: boolean;
  /**
   * A comet: a long, stretched loop around the Sun instead of a circle (orbit and inclination are
   * unused, startAngle is where on the loop it starts), with tails that grow near the Sun. Drawn by
   * bodies.ts (makeComet).
   */
  comet?: CometOrbit;
  /** not in our Solar System (default 'sol'); only with ?homestead=true in the address */
  realm?: Realm;
  /** a star: drawn like the Sun, the centre of its realm (or, Arcturus, far away) */
  star?: boolean;
  /** a ship: drawn from its own model, no cut-away or size comparison */
  ship?: boolean;
  /** stands still at this spot of its realm instead of orbiting */
  fixedAt?: [number, number, number];
}

export interface CometOrbit {
  /** nearest and farthest distance from the Sun, scene units */
  perihelion: number;
  aphelion: number;
  /** tilt of the loop out of the planets' plane, degrees */
  inclination: number;
  /** direction of the nearest point, degrees around the Sun (0 = screen right in the overview, -90 = towards the viewer) */
  turn: number;
  /**
   * How much faster it moves near the Sun: 0 = even pace along the loop, a real comet = the loop's
   * stretch (eccentricity). Kept lower than real so it doesn't spend almost all its time far away.
   */
  rush: number;
}

/** Bodies without a ball to compare with Earth or to cut open: the station, the comet, the ship. */
export const isBall = (b: BodyPhysics) => !b.station && !b.comet && !b.ship;
export const realmOf = (b: BodyPhysics): Realm => b.realm ?? 'sol';

// Earth's year ≈ 150 s on screen; other orbits follow the real period ratios.
const YEAR = 150;

// Show sizes, not real ones: real proportions leave tiny dots around a huge Sun. The power < 1
// squeezes the range while keeping the order (Jupiter > Saturn > … > Mercury); Earth ≈ 9.9.
const size = (earthDiameters: number) => 9.9 * Math.pow(earthDiameters, 0.45);
/** Moons at half the show scale, like the Moon. */
const moonSize = (km: number) => size(km / 12742) / 2;

export const PHYSICS: BodyPhysics[] = [
  {
    id: 'sun',
    icon: 'radial-gradient(circle at 40% 38%, #fff6d0 0%, #ffd35a 35%, #ff8a1f 75%, #c9460c 100%)',
    diameterKm: 1_392_000,
    radius: 43, // not from the formula: big enough to stay clearly the largest (was 54: looked too huge)
    orbit: 0,
    orbitSeconds: 0,
    spinSeconds: 400,
    tilt: 7,
    startAngle: 0,
    star: true,
  },
  {
    id: 'mercury',
    icon: 'radial-gradient(circle at 35% 35%, #cfc8c0 0%, #8f8780 55%, #4a4541 100%)',
    diameterKm: 4879,
    radius: size(0.383),
    orbit: 86,
    orbitSeconds: YEAR * 0.241,
    spinSeconds: 90,
    tilt: 0,
    startAngle: 2.1,
    surface: 'mercury',
  },
  {
    id: 'venus',
    icon: 'radial-gradient(circle at 35% 35%, #fff3d2 0%, #e6c98e 50%, #a47f45 100%)',
    diameterKm: 12104,
    radius: size(0.949),
    orbit: 105,
    orbitSeconds: YEAR * 0.615,
    spinSeconds: 300, // tilt 177° already makes it spin backwards
    tilt: 177,
    startAngle: 4.0,
    surface: 'venus',
    atmosphere: { color: [1.0, 0.82, 0.5], scale: 1.04, intensity: 0.55 },
  },
  {
    id: 'earth',
    icon: 'radial-gradient(circle at 35% 35%, #bfe3ff 0%, #3b86d6 40%, #2d6b3a 70%, #0d2a4a 100%)',
    diameterKm: 12742,
    radius: size(1),
    orbit: 142,
    orbitSeconds: YEAR,
    spinSeconds: 60,
    tilt: 23.4,
    startAngle: 0.6,
    surface: 'earth',
    atmosphere: { color: [0.28, 0.55, 1.0], scale: 1.05, intensity: 0.9 },
    clouds: true,
  },
  {
    id: 'moon',
    icon: 'radial-gradient(circle at 35% 35%, #f2f2ee 0%, #b3b2ad 50%, #5b5a57 100%)',
    diameterKm: 3474,
    radius: size(0.273) / 2, // half the show scale: next to the enlarged Earth it looked too big
    orbit: 22,
    orbitSeconds: 40,
    spinSeconds: 40, // tidally locked: same as its orbit
    tilt: 6.7,
    startAngle: 1.0,
    surface: 'moon',
    parent: 'earth',
  },
  {
    id: 'iss',
    icon: 'radial-gradient(circle at 50% 50%, #e8eef6 0%, #8a9bb4 45%, #1d2a44 100%)',
    diameterKm: 0.109, // 109 m from one end of the truss to the other
    radius: 0.85, // bounding radius of the model: big enough to spot next to Earth
    orbit: 13, // just above the atmosphere glow, well inside the Moon's orbit
    orbitSeconds: 30, // really 16 laps a day; here about two per Earth day so it can be caught
    spinSeconds: 0,
    tilt: 0,
    startAngle: 2.6,
    inclination: 51.6,
    parent: 'earth',
    station: true,
  },
  {
    id: 'mars',
    icon: 'radial-gradient(circle at 35% 35%, #ffc49a 0%, #d0643a 50%, #6e2a16 100%)',
    diameterKm: 6779,
    radius: size(0.532),
    orbit: 177,
    orbitSeconds: YEAR * 1.881,
    spinSeconds: 62,
    tilt: 25.2,
    startAngle: 5.2,
    surface: 'mars',
    atmosphere: { color: [0.95, 0.6, 0.4], scale: 1.035, intensity: 0.5 },
    moonsWhenNear: true,
  },
  {
    id: 'phobos',
    icon: 'radial-gradient(circle at 35% 35%, #b9ab9c 0%, #6f6358 55%, #2f2925 100%)',
    diameterKm: 22.5,
    radius: 0.75, // far bigger than true scale (it is a 27 km rock), or it would be invisible
    shape: [1, 0.8, 0.68],
    orbit: 11,
    orbitSeconds: 7, // really three laps a day: faster than Mars turns
    spinSeconds: 7,
    tilt: 0,
    startAngle: 0.4,
    surface: 'phobos',
    parent: 'mars',
    equatorial: true,
  },
  {
    id: 'deimos',
    icon: 'radial-gradient(circle at 35% 35%, #c9bcae 0%, #7d7166 55%, #35302b 100%)',
    diameterKm: 12.4,
    radius: 0.55,
    shape: [1, 0.78, 0.66],
    orbit: 14.5,
    orbitSeconds: 16,
    spinSeconds: 16,
    tilt: 0,
    startAngle: 3.4,
    surface: 'deimos',
    parent: 'mars',
    equatorial: true,
  },
  {
    id: 'jupiter',
    icon: 'repeating-linear-gradient(180deg, #e9dcc3 0 12%, #b98a61 12% 20%, #efe4cf 20% 32%, #a5714c 32% 40%), #d9c2a0',
    diameterKm: 139820,
    radius: size(10.97),
    orbit: 218,
    orbitSeconds: YEAR * 11.86,
    spinSeconds: 26,
    tilt: 3.1,
    startAngle: 1.9,
    surface: 'jupiter',
    atmosphere: { color: [0.85, 0.75, 0.6], scale: 1.025, intensity: 0.5 },
    moonsWhenNear: true,
  },
  {
    id: 'io',
    icon: 'radial-gradient(circle at 35% 35%, #fff2a8 0%, #d9b54a 50%, #6e4f17 100%)',
    diameterKm: 3643,
    radius: moonSize(3643),
    orbit: 36,
    orbitSeconds: 14,
    spinSeconds: 14, // tidally locked
    tilt: 0,
    startAngle: 0.3,
    surface: 'io',
    parent: 'jupiter',
    equatorial: true,
  },
  {
    id: 'europa',
    icon: 'radial-gradient(circle at 35% 35%, #fbf6ee 0%, #cbb9a2 55%, #6e5b48 100%)',
    diameterKm: 3122,
    radius: moonSize(3122),
    orbit: 42,
    orbitSeconds: 20,
    spinSeconds: 20, // tidally locked
    tilt: 0,
    startAngle: 2.0,
    surface: 'europa',
    parent: 'jupiter',
    equatorial: true,
  },
  {
    id: 'ganymede',
    icon: 'radial-gradient(circle at 35% 35%, #ddd5ca 0%, #8f857a 55%, #3c3631 100%)',
    diameterKm: 5268,
    radius: moonSize(5268),
    orbit: 49,
    orbitSeconds: 28,
    spinSeconds: 28, // tidally locked
    tilt: 0,
    startAngle: 3.9,
    surface: 'ganymede',
    parent: 'jupiter',
    equatorial: true,
  },
  {
    id: 'callisto',
    icon: 'radial-gradient(circle at 35% 35%, #b5a593 0%, #6b5e51 55%, #2b251f 100%)',
    diameterKm: 4821,
    radius: moonSize(4821),
    orbit: 57,
    orbitSeconds: 40,
    spinSeconds: 40, // tidally locked
    tilt: 0,
    startAngle: 5.3,
    surface: 'callisto',
    parent: 'jupiter',
    equatorial: true,
  },

  {
    id: 'saturn',
    icon: 'radial-gradient(circle at 35% 35%, #fbefcf 0%, #dcc08a 55%, #8e7447 100%)',
    diameterKm: 116460,
    radius: size(9.14),
    orbit: 313,
    orbitSeconds: YEAR * 29.45,
    spinSeconds: 28,
    tilt: 26.7,
    startAngle: 3.3,
    surface: 'saturn',
    atmosphere: { color: [0.9, 0.8, 0.6], scale: 1.025, intensity: 0.45 },
    rings: true,
    moonsWhenNear: true,
  },
  {
    id: 'enceladus',
    icon: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #dfe8f0 55%, #7d8a96 100%)',
    diameterKm: 504,
    radius: moonSize(504),
    orbit: 66,
    orbitSeconds: 12,
    spinSeconds: 12, // tidally locked
    tilt: 0,
    startAngle: 1.2,
    surface: 'enceladus',
    parent: 'saturn',
    equatorial: true,
  },
  {
    id: 'titan',
    icon: 'radial-gradient(circle at 35% 35%, #ffd38a 0%, #e09a3c 55%, #7a4a16 100%)',
    diameterKm: 5150,
    radius: moonSize(5150),
    orbit: 73,
    orbitSeconds: 34,
    spinSeconds: 34, // tidally locked
    tilt: 0,
    startAngle: 4.4,
    surface: 'titan',
    parent: 'saturn',
    equatorial: true,
    atmosphere: { color: [1.0, 0.62, 0.22], scale: 1.09, intensity: 1.1 }, // thick orange haze
  },

  {
    id: 'uranus',
    icon: 'radial-gradient(circle at 35% 35%, #e6fbff 0%, #9fdde6 50%, #4d8f9c 100%)',
    diameterKm: 50724,
    radius: size(3.98),
    orbit: 397,
    orbitSeconds: YEAR * 84,
    spinSeconds: 40, // tilt 98° already makes it retrograde
    tilt: 97.8,
    startAngle: 0.2,
    surface: 'uranus',
    atmosphere: { color: [0.6, 0.9, 1.0], scale: 1.04, intensity: 0.9 },
    moonsWhenNear: true,
  },

  {
    id: 'neptune',
    icon: 'radial-gradient(circle at 35% 35%, #bcd3ff 0%, #3f6fe0 50%, #16307a 100%)',
    diameterKm: 49244,
    radius: size(3.86),
    orbit: 438,
    orbitSeconds: YEAR * 164.8,
    spinSeconds: 38,
    tilt: 28.3,
    startAngle: 4.6,
    surface: 'neptune',
    atmosphere: { color: [0.4, 0.62, 1.0], scale: 1.04, intensity: 1.0 },
    moonsWhenNear: true,
  },
  {
    id: 'triton',
    icon: 'radial-gradient(circle at 35% 35%, #f3e3dc 0%, #b8a29a 55%, #4f4440 100%)',
    diameterKm: 2707,
    radius: moonSize(2707),
    orbit: 28,
    orbitSeconds: -24,
    spinSeconds: 24, // tidally locked
    tilt: 0,
    startAngle: 2.2,
    surface: 'triton',
    parent: 'neptune',
    equatorial: true,
    // orbits backwards (negative period), the only big moon that does
  },

  {
    id: 'pluto',
    dwarf: true,
    icon: 'radial-gradient(circle at 35% 35%, #f6e7d6 0%, #c9a588 50%, #6b4a3a 100%)',
    diameterKm: 2377,
    radius: size(0.187),
    orbit: 490,
    orbitSeconds: YEAR * 248,
    spinSeconds: 30, // turns with Charon: they always face each other
    tilt: 119.6,
    startAngle: 5.5,
    inclination: 17,
    surface: 'pluto',
    atmosphere: { color: [0.5, 0.66, 1.0], scale: 1.035, intensity: 0.5 }, // the thin blue haze New Horizons saw
  },
  {
    id: 'charon',
    icon: 'radial-gradient(circle at 35% 35%, #e9e6e2 0%, #9d9893 55%, #4c4846 100%)',
    diameterKm: 1212,
    radius: size(0.095),
    orbit: 14,
    orbitSeconds: 30,
    spinSeconds: 30, // tidally locked: same as its orbit
    tilt: 0,
    startAngle: 2.0,
    surface: 'charon',
    parent: 'pluto',
  },
  {
    id: 'comet',
    icon: 'radial-gradient(circle at 35% 50%, #ffffff 0%, #bfe4ff 22%, #4a7fc0 55%, #0d1a33 100%)',
    diameterKm: 11, // a typical big nucleus, like Halley's (15 × 8 km)
    radius: 1.6, // the nucleus, far bigger than true scale; the glowing head and tails are much bigger
    orbit: 0, // no circle: see comet
    orbitSeconds: 300, // one loop in about five minutes
    spinSeconds: 21,
    tilt: 35,
    startAngle: -1.2, // on its way in when the app opens, so it soon sweeps past the Sun
    surface: 'comet',
    shape: [1, 0.66, 0.58],
    comet: { perihelion: 195, aphelion: 820, inclination: 24, turn: -25, rush: 0.55 },
  },

  // ---------- the hidden «Passengers» mode: placeholders for now (borrowed maps), the look comes later ----------
  {
    id: 'homestead_star',
    realm: 'homestead',
    star: true,
    icon: 'radial-gradient(circle at 40% 38%, #fffbe8 0%, #ffe27a 35%, #ffa531 75%, #d0661a 100%)',
    diameterKm: 1_250_000, // made up: a star a little smaller than the Sun
    radius: 40,
    orbit: 0,
    orbitSeconds: 0,
    spinSeconds: 380,
    tilt: 4,
    startAngle: 0,
  },
  {
    id: 'zharynka',
    realm: 'homestead',
    icon: 'radial-gradient(circle at 35% 35%, #ffd0a8 0%, #c8683a 55%, #5a2412 100%)',
    diameterKm: 6100, // made up
    radius: size(0.48),
    orbit: 90,
    orbitSeconds: YEAR * 0.3,
    spinSeconds: 70,
    tilt: 2,
    startAngle: 1.2,
    surface: 'mars', // placeholder
  },
  {
    id: 'homestead',
    realm: 'homestead',
    icon: 'radial-gradient(circle at 35% 35%, #c8f0ff 0%, #2fa0c8 40%, #2f7a3e 70%, #0b2a40 100%)',
    diameterKm: 13_500, // made up: a little bigger than Earth
    radius: size(1.06),
    orbit: 150,
    orbitSeconds: YEAR * 1.1,
    spinSeconds: 64,
    tilt: 19,
    startAngle: 2.4,
    surface: 'earth', // placeholder: its own map (from NASA data, remixed) comes later
    atmosphere: { color: [0.3, 0.6, 1.0], scale: 1.05, intensity: 0.9 },
    clouds: true,
  },
  {
    id: 'perlyna',
    realm: 'homestead',
    icon: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #d6e2ea 50%, #6d7f8c 100%)',
    diameterKm: 2400, // made up
    radius: moonSize(2400),
    orbit: 22,
    orbitSeconds: 32,
    spinSeconds: 32, // tidally locked
    tilt: 0,
    startAngle: 0.4,
    surface: 'europa', // placeholder
    parent: 'homestead',
  },
  {
    id: 'burshtyn',
    realm: 'homestead',
    icon: 'radial-gradient(circle at 35% 35%, #fff0b0 0%, #e0a83a 50%, #6a4512 100%)',
    diameterKm: 1600, // made up
    radius: moonSize(1600),
    orbit: 31,
    orbitSeconds: 50,
    spinSeconds: 50, // tidally locked
    tilt: 0,
    startAngle: 3.3,
    surface: 'io', // placeholder
    parent: 'homestead',
  },
  {
    id: 'sapfir',
    realm: 'homestead',
    icon: 'radial-gradient(circle at 35% 35%, #d8f0ff 0%, #4f86d8 50%, #1a2c66 100%)',
    diameterKm: 98_000, // made up: a giant with rings
    radius: size(6.5),
    orbit: 270,
    orbitSeconds: YEAR * 6,
    spinSeconds: 30,
    tilt: 14,
    startAngle: 4.6,
    surface: 'neptune', // placeholder
    rings: true,
  },
  {
    id: 'avalon',
    realm: 'voyage',
    ship: true,
    icon: 'radial-gradient(circle at 50% 50%, #f2f6ff 0%, #9fb2cf 40%, #26324a 100%)',
    diameterKm: 1, // about a kilometre long
    radius: 7, // bounding radius of the (placeholder) model
    orbit: 0,
    orbitSeconds: 0,
    spinSeconds: 40, // its living quarters turn round the spine (that makes gravity on board)
    tilt: 90, // spine across the view; the spin turns it about its own length
    startAngle: 0,
    fixedAt: [0, 0, 0],
  },
  {
    id: 'arcturus',
    realm: 'voyage',
    star: true,
    icon: 'radial-gradient(circle at 40% 38%, #fff0d8 0%, #ffb257 35%, #e0641c 75%, #8a2a0a 100%)',
    diameterKm: 35_000_000, // a red giant: about 25 times wider than the Sun
    radius: 120,
    orbit: 0,
    orbitSeconds: 0,
    spinSeconds: 900,
    tilt: 0,
    startAngle: 0,
    fixedAt: [-2980, 160, -1840], // far behind the ship as first seen, a little above and to the left so it never hides it
  },
];

export const EARTH_DIAMETER = 12742;
