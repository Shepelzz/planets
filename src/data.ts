import type { SurfaceKind } from './surfaces';

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

export interface Atmosphere {
  color: [number, number, number];
  scale: number; // shell radius / body radius
  intensity: number;
}

export interface BodyInfo {
  id: BodyId;
  name: string;
  kind: string;
  /** CSS gradient for the dock icon */
  icon: string;
  /** Real diameter in km, used for the "compared to Earth" picture */
  diameterKm: number;
  stats: [string, string][];
  facts: string[];

  // Scene parameters (visual, not to scale)
  radius: number;
  orbit: number; // distance from parent
  orbitSeconds: number; // one lap, in seconds of app time
  spinSeconds: number; // one rotation (retrograde spin comes from tilt > 90°)
  tilt: number; // axial tilt, degrees
  startAngle: number;
  surface?: SurfaceKind;
  atmosphere?: Atmosphere;
  clouds?: boolean;
  rings?: boolean;
  parent?: BodyId;
}

// Earth's year ≈ 150 s on screen; other orbits follow the real period ratios.
const YEAR = 150;

// Show sizes, not real ones: real proportions leave tiny dots around a huge Sun. The power < 1
// squeezes the range while keeping the order (Jupiter > Saturn > … > Mercury); Earth ≈ 9.9.
const size = (earthDiameters: number) => 9.9 * Math.pow(earthDiameters, 0.45);

export const BODIES: BodyInfo[] = [
  {
    id: 'sun',
    name: 'Сонце',
    kind: 'Наша зоря',
    icon: 'radial-gradient(circle at 40% 38%, #fff6d0 0%, #ffd35a 35%, #ff8a1f 75%, #c9460c 100%)',
    diameterKm: 1_392_000,
    stats: [
      ['Діаметр', '1 392 000 км'],
      ['Температура поверхні', 'близько 5 500 °C'],
      ['Вік', '4,6 мільярда років'],
      ['З чого складається', 'водень і гелій'],
      ['Світло до Землі летить', '8 хвилин'],
    ],
    facts: [
      'Сонце — це зоря! Величезна куля розжареного газу, яка світить і гріє всі планети.',
      'Усередину Сонця помістилося б понад мільйон таких планет, як Земля.',
      'Світлу від Сонця потрібно лише 8 хвилин, щоб долетіти до Землі.',
      'Усі планети кружляють навколо Сонця, наче на каруселі.',
      'Ніколи не дивись на справжнє Сонце — це небезпечно для очей!',
    ],
    radius: 54, // not from the formula: big enough to stay clearly the largest
    orbit: 0,
    orbitSeconds: 0,
    spinSeconds: 400,
    tilt: 7,
    startAngle: 0,
  },
  {
    id: 'mercury',
    name: 'Меркурій',
    kind: 'Найменша й найближча до Сонця',
    icon: 'radial-gradient(circle at 35% 35%, #cfc8c0 0%, #8f8780 55%, #4a4541 100%)',
    diameterKm: 4879,
    stats: [
      ['Діаметр', '4 879 км'],
      ['Від Сонця', '58 млн км'],
      ['Доба', '176 земних днів'],
      ['Рік', '88 земних днів'],
      ['Супутники', 'немає'],
      ['Температура', 'від −180 до +430 °C'],
    ],
    facts: [
      'Рік на Меркурії коротший за добу: навколо Сонця він пролітає за 88 днів, а від світанку до світанку минає 176 днів.',
      'Меркурій увесь укритий кратерами — ямами від ударів метеоритів, зовсім як Місяць.',
      'Удень там спекотніше, ніж у духовці, а вночі холодніше, ніж у морозилці: у Меркурія немає повітря, щоб тримати тепло.',
      'Меркурій — найшвидша планета, він мчить навколо Сонця швидше за всіх.',
    ],
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
    name: 'Венера',
    kind: 'Найгарячіша планета',
    icon: 'radial-gradient(circle at 35% 35%, #fff3d2 0%, #e6c98e 50%, #a47f45 100%)',
    diameterKm: 12104,
    stats: [
      ['Діаметр', '12 104 км'],
      ['Від Сонця', '108 млн км'],
      ['Доба', '117 земних днів'],
      ['Рік', '225 земних днів'],
      ['Супутники', 'немає'],
      ['Температура', 'близько +465 °C'],
    ],
    facts: [
      'Венера обертається у зворотний бік — Сонце там сходить на заході, а сідає на сході.',
      'Її вкривають товсті хмари, які тримають тепло, як ковдра, тому на Венері спекотніше навіть, ніж на Меркурії.',
      'З Землі Венеру видно як дуже яскраву зірку. Її називають Вечірньою зорею.',
      'За розміром Венера майже як Земля — тому їх називають планетами-сестрами.',
    ],
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
    name: 'Земля',
    kind: 'Наш дім',
    icon: 'radial-gradient(circle at 35% 35%, #bfe3ff 0%, #3b86d6 40%, #2d6b3a 70%, #0d2a4a 100%)',
    diameterKm: 12742,
    stats: [
      ['Діаметр', '12 742 км'],
      ['Від Сонця', '150 млн км'],
      ['Доба', '24 години'],
      ['Рік', '365 днів'],
      ['Супутники', '1 — Місяць'],
      ['Температура', 'від −89 до +57 °C'],
    ],
    facts: [
      'Земля — єдина відома планета, де є життя: люди, тварини й рослини.',
      'Понад дві третини Землі вкрито водою — тому з космосу вона блакитна.',
      'Земля мчить навколо Сонця зі швидкістю 30 кілометрів на секунду!',
      'Повітря захищає нас від маленьких метеоритів: вони згоряють і стають «падаючими зірками».',
      'Уночі з космосу видно вогники міст.',
    ],
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
    name: 'Місяць',
    kind: 'Супутник Землі',
    icon: 'radial-gradient(circle at 35% 35%, #f2f2ee 0%, #b3b2ad 50%, #5b5a57 100%)',
    diameterKm: 3474,
    stats: [
      ['Діаметр', '3 474 км'],
      ['Від Землі', '384 400 км'],
      ['Облітає Землю за', '27 днів'],
      ['Вага на Місяці', 'у 6 разів менша'],
      ['Температура', 'від −170 до +120 °C'],
      ['Там побували', '12 людей'],
    ],
    facts: [
      'Місяць завжди повернутий до Землі одним і тим самим боком.',
      'На Місяці можна стрибнути в 6 разів вище, ніж на Землі!',
      'Сліди астронавтів на Місяці збережуться мільйони років — там немає вітру, який би їх здув.',
      'Місяць не світить сам — він відбиває світло Сонця, як дзеркало.',
      'Темні плями на Місяці — це застигла давня лава. Їх називають морями, хоча води там немає.',
    ],
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
    id: 'mars',
    name: 'Марс',
    kind: 'Червона планета',
    icon: 'radial-gradient(circle at 35% 35%, #ffc49a 0%, #d0643a 50%, #6e2a16 100%)',
    diameterKm: 6779,
    stats: [
      ['Діаметр', '6 779 км'],
      ['Від Сонця', '228 млн км'],
      ['Доба', '24 години 37 хвилин'],
      ['Рік', '687 земних днів'],
      ['Супутники', '2 — Фобос і Деймос'],
      ['Температура', 'у середньому −60 °C'],
    ],
    facts: [
      'Марс червоний, бо його пісок і каміння вкриті іржею.',
      'На Марсі є найвища гора в Сонячній системі — вулкан Олімп. Він майже в 2,5 раза вищий за Еверест.',
      'Марсом їздять роботи-марсоходи й надсилають нам фотографії.',
      'Захід сонця на Марсі блакитний, а вдень небо там рудувате.',
      'Доба на Марсі майже така сама, як на Землі, — лише на 37 хвилин довша.',
    ],
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
    name: 'Юпітер',
    kind: 'Найбільша планета',
    icon: 'repeating-linear-gradient(180deg, #e9dcc3 0 12%, #b98a61 12% 20%, #efe4cf 20% 32%, #a5714c 32% 40%), #d9c2a0',
    diameterKm: 139820,
    stats: [
      ['Діаметр', '139 820 км'],
      ['Від Сонця', '778 млн км'],
      ['Доба', 'близько 10 годин'],
      ['Рік', 'майже 12 земних років'],
      ['Супутники', 'понад 90'],
      ['Температура', 'близько −110 °C'],
    ],
    facts: [
      'Усередину Юпітера помістилося б понад 1 300 таких планет, як Земля.',
      'Велика Червона Пляма — це ураган, більший за всю Землю. Він крутиться вже сотні років!',
      'У Юпітера немає твердої поверхні — він складається з газу, на нього не можна стати.',
      'Юпітер крутиться швидше за всі планети: доба там триває лише 10 годин.',
      'У Юпітера теж є кільця, тільки дуже тонкі й темні — їх майже не видно.',
    ],
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
    name: 'Сатурн',
    kind: 'Планета з кільцями',
    icon: 'radial-gradient(circle at 35% 35%, #fbefcf 0%, #dcc08a 55%, #8e7447 100%)',
    diameterKm: 116460,
    stats: [
      ['Діаметр', '116 460 км'],
      ['Від Сонця', '1,4 млрд км'],
      ['Доба', 'близько 10,5 години'],
      ['Рік', 'майже 30 земних років'],
      ['Супутники', 'понад 270'],
      ['Температура', 'близько −140 °C'],
    ],
    facts: [
      'Кільця Сатурна складаються з мільярдів шматочків льоду й каміння — від піщинки до розміру будинку.',
      'Сатурн такий легкий, що міг би плавати у величезній-превеличезній ванні з водою.',
      'У Сатурна найбільше супутників у Сонячній системі.',
      'Кільця величезні завширшки, але дуже тонкі — місцями лише близько 10 метрів.',
      'На найбільшому супутнику Сатурна, Титані, є озера — тільки не з води, а з рідкого газу.',
    ],
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
    name: 'Уран',
    kind: 'Планета, що лежить на боці',
    icon: 'radial-gradient(circle at 35% 35%, #e6fbff 0%, #9fdde6 50%, #4d8f9c 100%)',
    diameterKm: 50724,
    stats: [
      ['Діаметр', '50 724 км'],
      ['Від Сонця', '2,9 млрд км'],
      ['Доба', 'близько 17 годин'],
      ['Рік', '84 земні роки'],
      ['Супутники', 'майже 30'],
      ['Температура', 'до −224 °C'],
    ],
    facts: [
      'Уран обертається, лежачи на боці, — ніби котиться своєю орбітою, як м’ячик.',
      'В Урана найхолодніша атмосфера серед усіх планет.',
      'Блакитним Уран робить газ метан.',
      'На полюсі Урана Сонце не заходить 42 роки поспіль, а потім 42 роки триває ніч!',
      'Супутники Урана назвали на честь героїв казок і п’єс: Титанія, Оберон, Міранда.',
    ],
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
    name: 'Нептун',
    kind: 'Найдальша планета',
    icon: 'radial-gradient(circle at 35% 35%, #bcd3ff 0%, #3f6fe0 50%, #16307a 100%)',
    diameterKm: 49244,
    stats: [
      ['Діаметр', '49 244 км'],
      ['Від Сонця', '4,5 млрд км'],
      ['Доба', 'близько 16 годин'],
      ['Рік', '165 земних років'],
      ['Супутники', '16'],
      ['Температура', 'близько −210 °C'],
    ],
    facts: [
      'На Нептуні дмуть найсильніші вітри в Сонячній системі — понад 2 000 км на годину!',
      'Нептун спочатку знайшли на папері: учені обчислили, де він має бути, і тільки потім побачили його в телескоп.',
      'Відтоді як Нептун відкрили у 1846 році, він облетів Сонце лише один раз.',
      'Світлу Сонця потрібно понад 4 години, щоб долетіти до Нептуна.',
    ],
    radius: size(3.86),
    orbit: 438,
    orbitSeconds: YEAR * 164.8,
    spinSeconds: 38,
    tilt: 28.3,
    startAngle: 4.6,
    surface: 'neptune',
    atmosphere: { color: [0.4, 0.62, 1.0], scale: 1.04, intensity: 1.0 },
  },
];

export const EARTH_DIAMETER = 12742;
