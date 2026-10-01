// Collects every text the app shows or says into one readable file, TEXTS.md, grouped by body in the
// order a child meets them. Each spoken phrase is marked with the voice that currently reads it.
//
//   npm run texts
//
// TEXTS.md is generated: edit the texts in src/narration.ts, src/structure.ts and src/data.ts, then
// run this again (and `npm run voice` to re-record what changed).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODIES } from '../src/data.ts';
import { NARRATION } from '../src/narration.ts';
import { STRUCTURE_LABEL } from '../src/phrases.ts';
import { STRUCTURE } from '../src/structure.ts';
import { voiceKey } from '../src/voiceKey.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const progressFile = join(root, 'scripts', 'elevenlabs-progress.json');
const lily = new Set<string>(
  existsSync(progressFile) ? Object.keys(JSON.parse(readFileSync(progressFile, 'utf8')).done ?? {}) : [],
);

const voice = (text: string) => (lily.has(voiceKey(text)) ? '🎙 Lily' : '🤖 Lesya');
const said = (text: string) => `> ${text}\n>\n> <sub>${voice(text)}</sub>\n`;

const out: string[] = [];
out.push('# Тексти застосунку «Подорож до планет»');
out.push('');
out.push('Цей файл зібрано автоматично командою `npm run texts`, правити тут марно. Де що правити:');
out.push('');
out.push('| Що | Файл |');
out.push('|---|---|');
out.push('| Вступ, розповіді блоків, фраза під порівнянням | `src/narration.ts` |');
out.push('| Розріз «З чого складається» | `src/structure.ts` |');
out.push('| Назви, підписи, цифри на картках, факти «А ти знаєш?» | `src/data.ts` |');
out.push('');
out.push('Після правок: `npm run voice` (переозвучить змінене голосом Lesya), потім `npm run texts`.');
out.push('');
out.push('Позначки: 🎙 Lily — записано в ElevenLabs; 🤖 Lesya — поки безкоштовний голос macOS.');
out.push('');

let total = 0;
let lilyCount = 0;
const count = (text: string) => {
  total++;
  if (lily.has(voiceKey(text))) lilyCount++;
};

for (const b of BODIES) {
  const n = NARRATION[b.id];
  const s = STRUCTURE[b.id];
  out.push(`## ${b.name}`);
  out.push('');
  out.push(`*${b.kind}*${b.parent ? ` · супутник` : ''}`);
  out.push('');

  out.push('### Вступ (звучить, коли обираєш)');
  out.push('');
  out.push(said(n.intro));
  count(n.intro);

  const header = `${b.name}. ${b.kind}.`;
  out.push('### Заголовок картки (натиснути на назву)');
  out.push('');
  out.push(said(header));
  count(header);

  out.push('### Блоки картки');
  out.push('');
  for (const [label, value] of b.stats) {
    out.push(`**${label}** — ${value.replace(/\n/g, '; ')}`);
    out.push('');
    if (label === STRUCTURE_LABEL) {
      out.push('*Відкриває розріз, див. нижче.*');
      out.push('');
      continue;
    }
    const text = n.stats[label];
    if (text) {
      out.push(said(text));
      count(text);
    }
  }

  out.push('### Порівняння із Землею');
  out.push('');
  out.push(said(n.compare));
  count(n.compare);

  out.push('### Розріз «З чого складається»');
  out.push('');
  out.push(said(s.intro));
  count(s.intro);
  for (const l of s.layers) {
    out.push(`**${l.name}**`);
    out.push('');
    out.push(said(l.text));
    count(l.text);
  }

  out.push('### Факти «А ти знаєш?»');
  out.push('');
  b.facts.forEach((f, i) => {
    out.push(`**${i + 1}.**`);
    out.push('');
    out.push(said(f));
    count(f);
  });
}

out.splice(14, 0, `Усього озвучуваних фраз: ${total}; голосом Lily: ${lilyCount}, голосом Lesya: ${total - lilyCount}.`, '');
writeFileSync(join(root, 'TEXTS.md'), out.join('\n'));
console.log(`TEXTS.md: ${BODIES.length} bodies, ${total} spoken phrases (${lilyCount} Lily, ${total - lilyCount} Lesya)`);
