import { BODIES } from './data.ts';
import { NARRATION } from './narration.ts';
import { STRUCTURE } from './structure.ts';

/** The structure block's label: tapping it opens the cut-away instead of reading a text. */
export const STRUCTURE_LABEL = 'З чого складається';

/**
 * Every phrase the app can say, most important first (intros and headers before long facts),
 * exactly as it is passed to say(). Used by the voice recording scripts.
 */
export function spokenPhrases(): { text: string; what: string }[] {
  const out: { text: string; what: string }[] = [];
  const add = (text: string, what: string) => {
    if (!out.some((p) => p.text === text)) out.push({ text, what });
  };
  for (const b of BODIES) add(NARRATION[b.id].intro, `${b.name}: вступ`);
  for (const b of BODIES) add(`${b.name}. ${b.kind}.`, `${b.name}: заголовок картки`);
  for (const b of BODIES)
    for (const [label] of b.stats) if (label !== STRUCTURE_LABEL) add(NARRATION[b.id].stats[label], `${b.name}: блок «${label}»`);
  for (const b of BODIES) {
    const s = STRUCTURE[b.id];
    add(s.intro, `${b.name}: будова, вступ`);
    for (const l of s.layers) add(l.text, `${b.name}: будова, ${l.name.toLowerCase()}`);
  }
  for (const b of BODIES) add(NARRATION[b.id].compare, `${b.name}: порівняння із Землею`);
  for (const b of BODIES) b.facts.forEach((f, i) => add(f, `${b.name}: факт ${i + 1}`));
  return out;
}
