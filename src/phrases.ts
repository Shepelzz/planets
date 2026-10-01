import type { Content } from './texts.ts';
import { INSIDE_STAT } from './texts.ts';

/**
 * Every phrase the app can say, most important first (intros and headers before long facts),
 * exactly as it is passed to say(). Used by the voice recording scripts.
 */
export function spokenPhrases({ BODIES, NARRATION, STRUCTURE }: Omit<Content, 'UI'>): { text: string; what: string }[] {
  const out: { text: string; what: string }[] = [];
  const add = (text: string, what: string) => {
    if (!out.some((p) => p.text === text)) out.push({ text, what });
  };
  for (const b of BODIES) add(NARRATION[b.id].intro, `${b.name}: вступ`);
  for (const b of BODIES) add(`${b.name}. ${b.kind}.`, `${b.name}: заголовок картки`);
  for (const b of BODIES)
    for (const st of b.stats) if (st.id !== INSIDE_STAT) add(NARRATION[b.id].stats[st.id], `${b.name}: блок «${st.label}»`);
  for (const b of BODIES) {
    const s = STRUCTURE[b.id];
    if (!s) continue;
    add(s.intro, `${b.name}: будова, вступ`);
    for (const l of s.layers) add(l.text, `${b.name}: будова, ${l.name.toLowerCase()}`);
  }
  for (const b of BODIES) {
    const c = NARRATION[b.id].compare;
    if (c) add(c, `${b.name}: порівняння із Землею`);
  }
  for (const b of BODIES) b.facts.forEach((f, i) => add(f, `${b.name}: факт ${i + 1}`));
  return out;
}
