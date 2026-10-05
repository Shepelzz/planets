// All texts of the app, from texts.yaml (turned into data at build time by the yaml plugin in
// vite.config.ts), joined with the physical data and checked. Import BODIES, NARRATION, STRUCTURE
// and UI from here.
import raw from '../texts.yaml';
import { buildContent } from './texts.ts';

export const { BODIES, NARRATION, STRUCTURE, UI, BUILDER } = buildContent(raw);
export { INSIDE_STAT } from './texts.ts';
export type { BodyInfo, Layer, Narration, Stat, Structure } from './texts.ts';
