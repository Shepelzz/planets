# Текстуры для режима «Обитель 2» (Homestead II)

Что нужно, в каком виде и как это получить. **Основной путь — вариант A** (делаю сам из настоящих
снимков NASA). Вариант B (генерация нейросетью) — запасной, промпты ниже.

## Технические требования ко всем картам планет

- **Равнопромежуточная проекция (equirectangular)**, соотношение строго **2:1**: 8192×4096 (идеал),
  минимум 4096×2048. Из неё я сделаю 4K и 2K, как для остальных планет.
- **Бесшовная по долготе:** левый и правый края должны совпадать пиксель в пиксель, иначе на шаре будет
  видимый шов.
- **Полюса:** верхняя и нижняя строки — это одна точка. Шапки должны быть растянуты по ширине, как на
  настоящих картах Земли, а не нарисованы кругом. Нейросети здесь чаще всего ошибаются.
- **Без теней и освещения:** ровный «дневной» цвет, свет и тени даёт шейдер.
- **Без текста, рамок, сетки, водяных знаков.** JPG, sRGB.

## Вариант A (рекомендую): планета из настоящих данных NASA

Беру настоящие карты Земли (NASA Blue Marble — цвет поверхности, и рельеф дна и суши ETOPO/GEBCO —
высоты) и меняю их так, чтобы получилась **другая, но абсолютно фотореалистичная Земля**:

1. **Другой уровень моря:** поднимаю на 60–120 м — низменности уходят под воду, появляются новые
   заливы и острова; или опускаю на 80–130 м — из шельфов вырастают новые материки и перешейки.
2. **Перекладываю мир:** сдвиг по долготе, отражение север↔юг, поворот, чтобы ни один материк не
   узнавался.
3. **Перекрашиваю:** чуть более бирюзовые мелководья, сочнее зелень, меньше пустынь — «обетованный»
   вид, как в рекламе Homestead Company в фильме.
4. **Облака** — настоящая облачная карта NASA, сдвинутая и отражённая, чтобы не совпадала с земной.
5. **Ночные огни** — почти нет: колония только строится, лишь несколько точек-поселений.

Результат: те же реальные текстуры, рельеф и цвета, что у нашей Земли, без шва и с правильными
полюсами, но материки чужие. Мне для этого нужны только исходники NASA (общественное достояние),
скачаю сам после твоего «да».

## Вариант B: промпты для нейросети (запасной)

Подходят Midjourney, DALL·E, Flux, Stable Diffusion. **Честно:** почти все они плохо держат
равнопромежуточную проекцию: будут шов и «пятно» на полюсах. Если делаешь так, сгенерируй несколько
вариантов, пришли лучший, и я поправлю шов и полюса (смешаю края, перерисую полярные шапки), насколько
это возможно.

### 1. Поверхность Homestead II (дневная карта): `homestead_day.jpg`

```
Equirectangular 2:1 texture map of an Earth-like exoplanet surface, as seen from orbit, true-color
satellite mosaic in the style of NASA Blue Marble. Three large continents with irregular natural
coastlines, a scattering of island chains and archipelagos, wide turquoise continental shelves and
coral-like shallow seas fading into deep navy-blue oceans. Lush green temperate forests and grasslands
dominate, darker green rainforest belts near the equator, a few small ochre and tan deserts, long
mountain ranges with brown-grey ridges and snow-capped peaks, large rivers and lakes, fjords along the
high-latitude coasts. White polar ice caps at the very top and bottom edges, stretched horizontally
across the full width as in a real equirectangular projection. Flat even daylight, no shading, no
shadows, no clouds, no atmosphere haze, no city lights, no text, no grid, no borders. Seamless
horizontally: the left and right edges must continue into each other perfectly. Photorealistic,
ultra detailed, 8K, scientific planetary map.
```

Негативный промпт (где поддерживается):
```
clouds, terminator, night side, sphere, globe, planet in space, stars, lens flare, vignette, text,
labels, latitude lines, frame, border, seam, fisheye, distorted poles, cartoon, painting, fantasy colors
```

Параметры: `--ar 2:1` (Midjourney), стиль «raw/photographic», без стилизации.

### 2. Облака: `homestead_clouds.jpg`

```
Equirectangular 2:1 global cloud cover map of an Earth-like planet, white clouds on pure black
background, grayscale only. Realistic weather systems: spiral cyclones in mid-latitudes, long frontal
cloud bands, scattered cumulus over the tropics, the clear subtropical belts, thin wispy cirrus, dense
cloud near the polar regions. Cloud density varies smoothly from transparent (black) to opaque (white).
Seamless horizontally, poles stretched across the full width as in equirectangular projection.
Satellite-derived look like NASA cloud composite, no land, no ocean, no color, no text.
```

### 3. Ночные огни (необязательно): `homestead_night.jpg`

```
Equirectangular 2:1 night lights map of a newly settled planet, pure black background with only five
or six tiny clusters of warm yellow-orange city lights along coastlines and river mouths, a few faint
lines of lights connecting them like roads. 98% of the image is completely black. No land, no clouds,
no text. Seamless horizontally.
```

### 4. Небо другой части галактики (фон вместо Млечного Пути): `homestead_sky.jpg`

```
Equirectangular 2:1 panorama of a deep space night sky seen from a distant star system, for use as a
360° skybox. A dense band of the galaxy crossing the whole panorama with glowing star clouds and dark
dust lanes, a large soft magenta-and-teal emission nebula on one side, countless faint stars of varied
colors (blue-white, yellow, orange), a few bright stars. Realistic astrophotography look, like an
ESO / Hubble wide-field mosaic. Mostly dark sky, no planets, no moon, no foreground, no text.
Seamless horizontally, no distortion at the poles.
```

### 5. Звезда системы (если захочешь не шейдер, а свою текстуру): `homestead_sun.jpg`

Обычно не нужно: беру настоящую карту нашего Солнца (снимки обсерваторий) и перекрашиваю шейдером,
так же красиво. Если всё же генерировать:

```
Equirectangular 2:1 texture map of the surface of a sun-like star, photorealistic solar photosphere:
fine granulation cells across the whole surface, a few dark sunspot groups with penumbra, bright
faculae near them, warm yellow-white color. Flat, no limb darkening, no corona, no flare, no text.
Seamless horizontally.
```

## Что не нужно генерировать

- **Звёзды** — перекрашиваю настоящую карту Солнца.
- **Корабль** — твоя 3D-модель (лучше всего GLB/glTF; подойдут FBX/OBJ с текстурами). Ужму, как МКС.
- **Космическая пыль и мусор у корабля** — частицы и простые камешки в шейдере, без файлов.
