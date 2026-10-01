// Records the app's narration with ElevenLabs instead of the macOS voice.
//
// Voice, model and intonation settings are fixed in scripts/elevenlabs-config.json (committed), so
// every run — with any key — records in the same voice. Only the key is secret, in planets/.env.local
// (git-ignored):
//   ELEVENLABS_API_KEY=...
// ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL in the environment override the config, e.g. to try voices.
//
//   npm run voice:el -- --samples id1,id2,...   record a short test phrase per voice → voice-samples/
//   npm run voice:el                            continue recording the phrases not done yet
//   npm run voice:el -- --status                show what's done / left without spending anything
//
// The free quota doesn't cover everything, so progress is kept in scripts/elevenlabs-progress.json
// (committed): which phrases are recorded with which voice and how many characters it cost, plus a
// readable `pending` list of what is still to do. When the quota runs out the script stops cleanly;
// run it again later (or with another key) to continue. Phrases not recorded yet keep their macOS
// (Lesya) recording.
//
// Output is the same as scripts/build-voice.ts: public/voice/<key>.m4a + src/voice-manifest.json.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spokenPhrases } from '../src/phrases.ts';
import * as content from './content.ts';
const { NARRATION } = content;
import { voiceKey } from '../src/voiceKey.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.elevenlabs.io/v1';
const progressFile = join(root, 'scripts', 'elevenlabs-progress.json');

interface Pending {
  what: string;
  key: string;
  chars: number;
  text: string;
}

interface Progress {
  voiceId: string;
  voiceName?: string;
  model: string;
  /** voice key → characters charged */
  done: Record<string, number>;
  charsSpent: number;
  /** still recorded with the macOS voice: what it is, where, and the text */
  pending?: Pending[];
}

function loadEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

interface Config {
  voice: { id: string; name: string };
  model: string;
  /** optional: without it the model's own defaults are used (how Eleven v4 sounds best) */
  voiceSettings?: Record<string, number | boolean>;
  outputFormat: string;
}
const config = JSON.parse(readFileSync(join(root, 'scripts', 'elevenlabs-config.json'), 'utf8')) as Config;
const model = process.env.ELEVENLABS_MODEL || config.model;
const args = process.argv.slice(2);

const phrasesByPriority = () => spokenPhrases(content);

class QuotaError extends Error {}

async function speak(voiceId: string, text: string, outM4a: string, attempt = 0): Promise<number> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is missing: add it to planets/.env.local');
  const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=${config.outputFormat}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      ...(config.voiceSettings ? { voice_settings: config.voiceSettings } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // too many requests at once or a busy server: not the quota, wait and try again
    if ((res.status === 429 || res.status === 503) && /concurren|busy|rate/i.test(body) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return speak(voiceId, text, outM4a, attempt + 1);
    }
    if (res.status === 429 || /quota|credits|limit/i.test(body)) throw new QuotaError(body.slice(0, 300));
    throw new Error(`${res.status}: ${body.slice(0, 300)}`);
  }
  const mp3 = outM4a.replace(/\.m4a$/, '.mp3');
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  // AAC in .m4a plays everywhere, Safari 12 included, and matches the macOS recordings
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', mp3, outM4a]);
  rmSync(mp3);
  return Number(res.headers.get('character-cost')) || text.length;
}

function readProgress(voiceId: string): Progress {
  if (existsSync(progressFile)) {
    const p = JSON.parse(readFileSync(progressFile, 'utf8')) as Progress;
    if (p.voiceId === voiceId && p.model === model) return p;
    console.log(`voice or model changed (was ${p.voiceId} / ${p.model}): starting over`);
  }
  return { voiceId, model, done: {}, charsSpent: 0 };
}

/** Refresh the readable list of phrases still waiting for ElevenLabs. */
function markPending(p: Progress, phrases: { text: string; what: string }[]) {
  p.pending = phrases
    .filter(({ text }) => !(voiceKey(text) in p.done))
    .map(({ text, what }) => ({ what, key: voiceKey(text), chars: text.length, text }));
}

function report(p: Progress, phrases: { text: string }[]) {
  const left = p.pending ?? [];
  const leftChars = left.reduce((n, x) => n + x.chars, 0);
  console.log(`ElevenLabs (${p.voiceName ?? p.voiceId}, ${p.model}): ${phrases.length - left.length}/${phrases.length} phrases done, ${p.charsSpent} characters spent; ${left.length} left (~${leftChars} characters)`);
  for (const x of left) console.log(`  · ${x.what}`);
}

if (args[0] === '--samples') {
  const dir = join(root, 'voice-samples');
  mkdirSync(dir, { recursive: true });
  const text = args[2] || NARRATION.moon.intro;
  let spent = 0;
  for (const id of (args[1] || '').split(',').filter(Boolean)) {
    spent += await speak(id, text, join(dir, `${id}.m4a`));
    console.log('sample:', join('voice-samples', `${id}.m4a`));
  }
  console.log(`${spent} characters spent`);
} else {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || config.voice.id;
  const phrases = phrasesByPriority();
  const progress = readProgress(voiceId);
  if (voiceId === config.voice.id) progress.voiceName = config.voice.name;
  const save = () => {
    markPending(progress, phrases);
    writeFileSync(progressFile, JSON.stringify(progress, null, 2) + '\n');
  };
  if (args[0] === '--status') {
    save();
    report(progress, phrases);
    process.exit(0);
  }
  const outDir = join(root, 'public', 'voice');
  try {
    // a few requests at once (paid plans allow several): v4 takes seconds per phrase
    const todo = phrases.map((p) => p.text).filter((t) => !(voiceKey(t) in progress.done));
    const CONCURRENCY = Number(process.env.ELEVENLABS_CONCURRENCY) || 4;
    let next = 0;
    let quota: QuotaError | null = null;
    const worker = async () => {
      while (next < todo.length && !quota) {
        const text = todo[next++];
        const k = voiceKey(text);
        try {
          const cost = await speak(voiceId, text, join(outDir, `${k}.m4a`));
          progress.done[k] = cost;
          progress.charsSpent += cost;
          save();
          process.stdout.write(`\r${Object.keys(progress.done).length}/${phrases.length} recorded`);
        } catch (e) {
          if (e instanceof QuotaError) quota = e;
          else throw e;
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (quota) throw quota;
    console.log('\nall phrases recorded');
  } catch (e) {
    save();
    if (e instanceof QuotaError) console.log(`\nquota used up, stopping here (${e.message})`);
    else throw e;
  } finally {
    report(progress, phrases);
  }
}
