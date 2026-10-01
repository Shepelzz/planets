// Pre-records every phrase the app speaks with the macOS Ukrainian voice (Lesya), so devices without
// that voice (old iPads on iOS 12 fall back to a Russian one) sound the same as modern ones.
//
//   npm run voice        (macOS only; re-run after changing texts.yaml)
//
// Files are keyed by text only: after changing VOICE_PITCH, delete public/voice/ to re-record all.
// Output: public/voice/<key>.m4a (AAC, plays in Safari 12) and src/voice-manifest.json (list of keys).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spokenPhrases } from '../src/phrases.ts';
import * as content from './content.ts';
import { VOICE_PITCH, voiceKey } from '../src/voiceKey.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'voice');
const tmp = join(root, 'node_modules', '.cache', 'voice');
mkdirSync(outDir, { recursive: true });
mkdirSync(tmp, { recursive: true });

const phrases = new Set(spokenPhrases(content).map((p) => p.text));

const keys: string[] = [];
let made = 0;
for (const text of phrases) {
  const key = voiceKey(text);
  keys.push(key);
  const out = join(outDir, `${key}.m4a`);
  if (existsSync(out)) continue;
  const aiff = join(tmp, `${key}.aiff`);
  // Nuance control sequence: pitch in percent of normal
  const pitch = `\x1b\\pitch=${Math.round(VOICE_PITCH * 100)}\\`;
  execFileSync('say', ['-v', 'Lesya', '-o', aiff, pitch + text]);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', aiff, out]);
  rmSync(aiff);
  made++;
}

// drop recordings of phrases that no longer exist
const wanted = new Set(keys.map((k) => `${k}.m4a`));
let removed = 0;
for (const f of readdirSync(outDir)) {
  if (!wanted.has(f)) {
    rmSync(join(outDir, f));
    removed++;
  }
}

writeFileSync(join(root, 'src', 'voice-manifest.json'), JSON.stringify(keys.sort()) + '\n');
console.log(`${phrases.size} phrases: ${made} recorded, ${phrases.size - made} unchanged, ${removed} removed`);
