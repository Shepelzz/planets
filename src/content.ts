// All texts of the app, from texts.yaml (turned into data at build time by the yaml plugin in
// vite.config.ts), joined with the physical data and checked. Import BODIES, NARRATION, STRUCTURE
// and UI from here.
import raw from '../texts.yaml';
import { buildContent } from './texts.ts';

const all = buildContent(raw);

/**
 * The hidden «Passengers» mode: on only while the address carries ?homestead=true (or the
 * misspelt ?homestage=true). The app keeps the query in every address it shows, so it stays on.
 */
export const SECRET = /[?&]home(stead|stage)=(true|1)\b/.test(location.search);

/** The bodies of this visit: without the hidden mode only our Solar System. */
export const BODIES = all.BODIES.filter((b) => SECRET || !b.realm);
export const { NARRATION, STRUCTURE, UI } = all;
export { INSIDE_STAT } from './texts.ts';
export type { BodyInfo, Layer, Narration, Stat, Structure } from './texts.ts';
