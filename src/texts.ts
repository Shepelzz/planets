import { isBall, PHYSICS, type BodyId, type BodyPhysics } from './data.ts';
import { LAYERS } from './structure.ts';

// texts.yaml is the single source of every text in the app. This module joins it with the physical
// data (data.ts, structure.ts) and checks it, so a missing or misspelt entry fails the build with a
// clear message instead of showing a blank on screen. Used by the app (content.ts, via Vite) and by
// the voice scripts (scripts/content.ts, via Node).

export interface Stat {
  /** stable id from texts.yaml: diameter, distance, day_year, moons, temperature, inside, … */
  id: string;
  label: string;
  /** shown on the card; may contain line breaks */
  value: string;
}

export interface BodyInfo extends BodyPhysics {
  name: string;
  /** "of <name>", for «Супутники Землі» */
  nameGenitive?: string;
  kind: string;
  stats: Stat[];
  facts: string[];
}

export interface Narration {
  intro: string;
  /** stat id → what the voice says (no entry for the «inside» block: it opens the cut-away) */
  stats: Record<string, string>;
  /** the «compared to Earth» picture; none for the station and the comet */
  compare?: string;
}

export interface Layer {
  id: string;
  name: string;
  /** outer edge, fraction of the radius */
  to: number;
  color: string;
  text: string;
}

export interface Structure {
  intro: string;
  /** surface first */
  layers: Layer[];
}

/** The stat block that opens the cut-away instead of talking. */
export const INSIDE_STAT = 'inside';

export const UI_KEYS = [
  'title', 'title_short', 'description', 'share_description', 'share_image_alt', 'loading', 'hint',
  'did_you_know', 'more_fact', 'cut_hint', 'compare_earth', 'compare_same', 'compare_bigger',
  'compare_smaller', 'compare_width', 'moons_of', 'credit', 'pause', 'play', 'overview', 'sound_on',
  'sound_off', 'labels_show', 'labels_hide', 'close',
] as const;
export type UiTexts = Record<(typeof UI_KEYS)[number], string>;

// «Моя система» (builder.html): labels on screen, and what the voice explains when a speaker is tapped
export const BUILDER_LABELS = [
  'title', 'back', 'star', 'planets', 'add_planet', 'full', 'kind', 'size', 'remove', 'clear', 'drag_hint',
  'year', 'temperature', 'weight', 'life', 'zone',
  'star_red', 'star_sun', 'star_white', 'star_blue', 'type_rocky', 'type_ice', 'type_gas',
  'size_small', 'size_medium', 'size_large', 'days', 'years', 'lighter', 'heavier', 'same_weight', 'no_ground',
  'life_yes', 'life_hot', 'life_cold', 'life_gas', 'life_no_air', 'life_no_water',
  'air', 'air_none', 'air_thin', 'air_earth', 'air_thick', 'water', 'water_yes', 'water_no',
  'rings', 'rings_yes', 'rings_no', 'moons', 'sky', 'sky_black', 'sky_pink', 'sky_blue', 'sky_orange',
  'inside', 'layer_ocean', 'layer_crust', 'layer_mantle', 'layer_iron', 'layer_air', 'layer_ice', 'layer_rock', 'layer_metal',
  'paint', 'paint_hint', 'paint_draw', 'paint_turn', 'paint_clear', 'paint_done', 'brush_big', 'brush_small',
  'surf_ocean', 'surf_forest', 'surf_desert', 'surf_mountains', 'surf_ice',
  'stars_count', 'one_star', 'two_stars', 'second_star', 'unstable_zone', 'suns', 'suns_two', 'life_unstable',
  'awards', 'award_new',
  'neighbours', 'too_close', 'what_happens', 'undo', 'moon_closer', 'molten', 'ev_merge', 'ev_swallow', 'ev_giants', 'ev_ring',
  'overview', 'close', 'win_new', 'planet_n', 'orbit', 'nearer', 'farther', 'smaller', 'bigger', 'stars_chip', 'start_hint',
] as const;
export const BUILDER_SAY = [
  'hint', 'zone', 'star_red', 'star_sun', 'star_white', 'star_blue', 'type_rocky', 'type_ice', 'type_gas',
  'size_small', 'size_medium', 'size_large', 'year_short', 'year_earth', 'year_long',
  'temp_scorching', 'temp_hot', 'temp_mild', 'temp_cold', 'temp_frozen',
  'weight_light', 'weight_earth', 'weight_heavy', 'weight_gas', 'life_yes', 'life_hot', 'life_cold', 'life_gas',
  'life_no_air', 'life_no_water', 'air_none', 'air_thin', 'air_earth', 'air_thick', 'water_yes', 'water_no',
  'rings_yes', 'rings_no', 'moons_none', 'moons_some', 'sky_black', 'sky_pink', 'sky_blue', 'sky_orange',
  'inside_rocky', 'inside_ice', 'inside_gas',
  'paint_hint', 'paint_climate', 'surf_ocean', 'surf_forest', 'surf_desert', 'surf_mountains', 'surf_ice',
  'two_stars', 'unstable_zone', 'suns_two', 'life_unstable',
  'too_close', 'moon_closer', 'molten', 'ev_merge', 'ev_swallow', 'ev_giants', 'ev_ring', 'orbit',
] as const;
/** «Мої відкриття»: discoveries the child can make in their own system (builder/awards.ts) */
export const BUILDER_AWARDS = [
  'first_planet', 'life', 'red_life', 'two_suns', 'rings', 'three_moons', 'gas_giant', 'venus', 'frozen',
  'short_year', 'long_year', 'painted', 'unstable', 'full', 'collision', 'moon_ring',
] as const;
export type AwardId = (typeof BUILDER_AWARDS)[number];
export interface BuilderTexts {
  labels: Record<(typeof BUILDER_LABELS)[number], string>;
  say: Record<(typeof BUILDER_SAY)[number], string>;
  awards: Record<AwardId, { title: string; say: string }>;
}

export interface Content {
  BODIES: BodyInfo[];
  NARRATION: Record<BodyId, Narration>;
  /** only bodies with layers (structure.ts) */
  STRUCTURE: Partial<Record<BodyId, Structure>>;
  UI: UiTexts;
  BUILDER: BuilderTexts;
}

type Obj = Record<string, unknown>;

function fail(where: string, what: string): never {
  throw new Error(`texts.yaml: ${where}: ${what}`);
}
function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || !v.trim()) fail(where, `потрібен текст «${key}»`);
  return v;
}
function obj(v: unknown, where: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(where, 'очікувався розділ з ключами');
  return v as Obj;
}

export function buildContent(raw: unknown): Content {
  const root = obj(raw, 'файл');
  const bodies = obj(root.bodies, 'bodies');
  const BODIES: BodyInfo[] = [];
  const NARRATION = {} as Record<BodyId, Narration>;
  const STRUCTURE: Partial<Record<BodyId, Structure>> = {};

  for (const phys of PHYSICS) {
    const id = phys.id;
    const where = `bodies.${id}`;
    const t = obj(bodies[id], where);

    const statsRaw = obj(t.stats, `${where}.stats`);
    const stats: Stat[] = [];
    const say: Record<string, string> = {};
    for (const [sid, sv] of Object.entries(statsRaw)) {
      const s = obj(sv, `${where}.stats.${sid}`);
      stats.push({ id: sid, label: str(s, 'label', `${where}.stats.${sid}`), value: str(s, 'value', `${where}.stats.${sid}`) });
      if (sid !== INSIDE_STAT) say[sid] = str(s, 'say', `${where}.stats.${sid}`);
    }
    const layered = LAYERS[id];
    if (layered && !(INSIDE_STAT in statsRaw)) fail(`${where}.stats`, `немає блока «${INSIDE_STAT}» (розріз)`);
    if (!layered && (INSIDE_STAT in statsRaw || t.inside)) fail(`${where}`, `розрізу для цього тіла немає (structure.ts)`);

    const facts = t.facts;
    if (!Array.isArray(facts) || !facts.length || facts.some((f) => typeof f !== 'string' || !f.trim()))
      fail(`${where}.facts`, 'потрібен список фактів (рядки з «- »)');

    if (layered) {
      const inside = obj(t.inside, `${where}.inside`);
      const layerTexts = obj(inside.layers, `${where}.inside.layers`);
      const layers: Layer[] = layered.map((l) => {
        const lt = obj(layerTexts[l.id], `${where}.inside.layers.${l.id}`);
        return { ...l, name: str(lt, 'name', `${where}.inside.layers.${l.id}`), text: str(lt, 'say', `${where}.inside.layers.${l.id}`) };
      });
      for (const lid of Object.keys(layerTexts))
        if (!layered.some((l) => l.id === lid)) fail(`${where}.inside.layers.${lid}`, 'такого шару в коді немає (structure.ts)');
      STRUCTURE[id] = { intro: str(inside, 'intro', `${where}.inside`), layers };
    }

    BODIES.push({
      ...phys,
      name: str(t, 'name', where),
      nameGenitive: typeof t.name_of === 'string' ? t.name_of : undefined,
      kind: str(t, 'kind', where),
      stats,
      facts: facts as string[],
    });
    if (!isBall(phys) && t.compare) fail(`${where}.compare`, 'для станції й комети порівняння із Землею не показується');
    NARRATION[id] = { intro: str(t, 'intro', where), stats: say, compare: isBall(phys) ? str(t, 'compare', where) : undefined };
  }
  for (const id of Object.keys(bodies)) if (!PHYSICS.some((p) => p.id === id)) fail(`bodies.${id}`, 'такого тіла в коді немає (data.ts)');

  const uiRaw = obj(root.ui, 'ui');
  const UI = {} as UiTexts;
  for (const k of UI_KEYS) UI[k] = str(uiRaw, k, 'ui');
  const b = obj(root.builder, 'builder');
  const bl = obj(b.labels, 'builder.labels'), bs = obj(b.say, 'builder.say');
  const BUILDER = { labels: {}, say: {}, awards: {} } as BuilderTexts;
  for (const k of BUILDER_LABELS) BUILDER.labels[k] = str(bl, k, 'builder.labels');
  for (const k of BUILDER_SAY) BUILDER.say[k] = str(bs, k, 'builder.say');
  const ba = obj(b.awards, 'builder.awards');
  for (const k of BUILDER_AWARDS) {
    const a = obj(ba[k], `builder.awards.${k}`);
    BUILDER.awards[k] = { title: str(a, 'title', `builder.awards.${k}`), say: str(a, 'say', `builder.awards.${k}`) };
  }
  return { BODIES, NARRATION, STRUCTURE, UI, BUILDER };
}
