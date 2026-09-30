// Records the app's narration with ElevenLabs instead of the macOS voice.
//
// Put the key (and later the chosen voice) in planets/.env.local (git-ignored):
//   ELEVENLABS_API_KEY=...
//   ELEVENLABS_VOICE_ID=...          (after picking one)
//   ELEVENLABS_MODEL=eleven_multilingual_v2   (optional)
//
//   npm run voice:el -- --list                  list voices available to the account
//   npm run voice:el -- --samples id1,id2,...   record one test phrase per voice → voice-samples/
//   npm run voice:el                            record every phrase that has no recording yet
//   npm run voice:el -- --force                 re-record everything (e.g. after changing the voice)
//
// Output is the same as scripts/build-voice.ts: public/voice/<key>.m4a + src/voice-manifest.json.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODIES } from '../src/data.ts';
import { NARRATION } from '../src/narration.ts';
import { voiceKey } from '../src/voiceKey.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.elevenlabs.io/v1';

function loadEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('ELEVENLABS_API_KEY is missing: add it to planets/.env.local');
  process.exit(1);
}
const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const args = process.argv.slice(2);

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'xi-api-key': key!, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function speak(voiceId: string, text: string, outM4a: string) {
  const res = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      model_id: model,
      // a lively storyteller: less stability = more expressive intonation
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
    }),
  });
  const mp3 = outM4a.replace(/\.m4a$/, '.mp3');
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  // AAC in .m4a plays everywhere, Safari 12 included, and matches the macOS recordings
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', mp3, outM4a]);
  rmSync(mp3);
}

function allPhrases(): string[] {
  const phrases = new Set<string>();
  for (const b of BODIES) {
    const n = NARRATION[b.id];
    phrases.add(n.intro);
    phrases.add(n.compare);
    phrases.add(`${b.name}. ${b.kind}.`);
    for (const [label] of b.stats) phrases.add(n.stats[label]);
    for (const f of b.facts) phrases.add(f);
  }
  return [...phrases];
}

if (args[0] === '--list') {
  const { voices } = (await (await api('/voices')).json()) as {
    voices: { voice_id: string; name: string; labels?: Record<string, string>; category?: string }[];
  };
  for (const v of voices) {
    const l = v.labels || {};
    console.log(`${v.voice_id}  ${v.name.padEnd(22)} ${[l.gender, l.age, l.accent, l.description, l.use_case].filter(Boolean).join(', ')}`);
  }
} else if (args[0] === '--samples') {
  const dir = join(root, 'voice-samples');
  mkdirSync(dir, { recursive: true });
  const text = NARRATION.moon.stats['Вага на Місяці'] + ' ' + NARRATION.earth.intro;
  for (const id of (args[1] || '').split(',').filter(Boolean)) {
    const out = join(dir, `${id}.m4a`);
    await speak(id, text, out);
    console.log('sample:', out);
  }
} else {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    console.error('ELEVENLABS_VOICE_ID is missing: pick a voice (--list / --samples) and add it to .env.local');
    process.exit(1);
  }
  const force = args.includes('--force');
  const outDir = join(root, 'public', 'voice');
  mkdirSync(outDir, { recursive: true });
  const phrases = allPhrases();
  const keys: string[] = [];
  let made = 0;
  for (const text of phrases) {
    const k = voiceKey(text);
    keys.push(k);
    const out = join(outDir, `${k}.m4a`);
    if (existsSync(out) && !force) continue;
    await speak(voiceId, text, out);
    made++;
    process.stdout.write(`\r${made} recorded`);
  }
  const wanted = new Set(keys.map((k) => `${k}.m4a`));
  for (const f of readdirSync(outDir)) if (!wanted.has(f)) rmSync(join(outDir, f));
  writeFileSync(join(root, 'src', 'voice-manifest.json'), JSON.stringify(keys.sort()) + '\n');
  console.log(`\n${phrases.length} phrases, ${made} recorded with ElevenLabs (${model})`);
}
