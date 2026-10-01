import type { SurfaceKind } from './surfaces.ts';

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto' | 'charon' | 'iss';

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
}

// Earth's year ≈ 150 s on screen; other orbits follow the real period ratios.
const YEAR = 150;

// Show sizes, not real ones: real proportions leave tiny dots around a huge Sun. The power < 1
// squeezes the range while keeping the order (Jupiter > Saturn > … > Mercury); Earth ≈ 9.9.
const size = (earthDiameters: number) => 9.9 * Math.pow(earthDiameters, 0.45);

export const PHYSICS: BodyPhysics[] = [
  {
    id: 'sun',
    icon: 'radial-gradient(circle at 40% 38%, #fff6d0 0%, #ffd35a 35%, #ff8a1f 75%, #c9460c 100%)',
    diameterKm: 1_392_000,
    radius: 54, // not from the formula: big enough to stay clearly the largest
    orbit: 0,
    orbitSeconds: 0,
    spinSeconds: 400,
    tilt: 7,
    startAngle: 0,
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
];

export const EARTH_DIAMETER = 12742;
