// Speaks phrases aloud. Every text the app says is pre-recorded (public/voice, see README: Kira on
// ElevenLabs), because devices without a Ukrainian voice — old iPads on iOS 12 — would read it with
// a Russian one. The browser's speech synthesis is only a fallback for phrases with no recording.
//
// A recording fetched on the tap itself starts late on an iPad over Wi-Fi (Safari downloads and
// buffers it first), so the phrases likely to be needed next — the open card's, the planets'
// intros — are fetched ahead into memory (preload) and played from there.
//
// Between phrases the system may put the audio output to sleep; waking it (Bluetooth headphones
// and speakers especially) swallows a second or two of the next phrase's start. While the child is
// using the app, a silent Web Audio loop keeps the output awake (keepOutputAwake).

import manifest from './voice-manifest.json';
import { VOICE_PITCH, voiceKey } from './voiceKey';

/** recorded phrase key → fingerprint of its file (changes when the phrase is re-recorded) */
const recorded = new Map<string, string>(Object.entries(manifest as Record<string, string>));
const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let enabled = true;
let voice: SpeechSynthesisVoice | null = null;
// One element reused for every phrase: iOS unlocks playback per element on the first tap.
let audio: HTMLAudioElement | null = null;
/** How a phrase ended: played to the end, replaced by another phrase, or cut off by muting. */
export type SpeechEnd = 'ended' | 'replaced' | 'muted';

let finishCurrent: ((how: SpeechEnd) => void) | null = null;

function pickVoice() {
  if (!synth) return;
  const uk = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('uk'));
  // prefer an on-device voice (works offline, starts instantly)
  voice = uk.find((v) => v.localService) ?? uk[0] ?? null;
}

if (synth) {
  pickVoice();
  // voices load asynchronously in most browsers (Safari 12 has no EventTarget methods here)
  synth.onvoiceschanged = pickVoice;
}

export const speechSupported = recorded.size > 0 || !!synth;

// ---------- recordings kept in memory ----------
// the fingerprint in the URL: a re-recorded phrase is a new URL, so no browser keeps the old take
const fileUrl = (key: string) => `${import.meta.env.BASE_URL}voice/${key}.m4a?v=${recorded.get(key)}`;
/** key → object URL of the downloaded recording, oldest first */
const ready = new Map<string, string>();
const queue: string[] = [];
let fetching = 0;
const KEEP = 120; // ~8 MB of AAC at most
const PARALLEL = 2;

function pump() {
  while (fetching < PARALLEL && queue.length) {
    const key = queue.shift()!;
    if (ready.has(key)) continue;
    fetching++;
    fetch(fileUrl(key))
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || ready.has(key)) return;
        ready.set(key, URL.createObjectURL(blob));
        // forget the oldest, except what is playing right now
        for (const [k, url] of ready) {
          if (ready.size <= KEEP) break;
          if (audio && audio.src === url) continue;
          URL.revokeObjectURL(url);
          ready.delete(k);
        }
      })
      .catch(() => {})
      .then(() => {
        fetching--;
        pump();
      });
  }
}

/**
 * Fetch these phrases' recordings ahead of time, so tapping them starts the voice at once. Later
 * calls go first (the open card matters more than the background intros).
 */
export function preload(texts: string[]) {
  const keys = texts.map(voiceKey).filter((k) => recorded.has(k) && !ready.has(k) && !queue.includes(k));
  queue.unshift(...keys);
  pump();
}

// ---------- keeping the audio output awake ----------
type AudioCtx = AudioContext;
let ctx: AudioCtx | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | undefined;
const AWAKE_AFTER_LAST_PHRASE = 90_000; // ms

/** Call from a tap (browsers start audio only on a user gesture). */
function keepOutputAwake() {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      // one second of silence, looped: a running source keeps the output device open
      const silence = ctx.createBufferSource();
      silence.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      silence.loop = true;
      silence.connect(ctx.destination);
      silence.start(0);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(letOutputSleep, AWAKE_AFTER_LAST_PHRASE);
  } catch {
    // no Web Audio: phrases just start a little later
  }
}

function letOutputSleep() {
  clearTimeout(sleepTimer);
  if (ctx && ctx.state === 'running') void ctx.suspend();
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') letOutputSleep();
  });

/** Stop whatever is playing and report why. */
function stop(how: SpeechEnd) {
  if (audio) audio.pause();
  synth?.cancel();
  const f = finishCurrent;
  finishCurrent = null;
  f?.(how);
}

export function setSpeechEnabled(on: boolean) {
  enabled = on;
  if (!on) {
    stop('muted');
    letOutputSleep();
  }
}

/**
 * Say a phrase, interrupting whatever is being said. Call from a tap/click handler (iOS needs a
 * user gesture). onDone tells how the phrase ended (see SpeechEnd). Returns false when muted.
 */
export function say(text: string, onDone?: (how: SpeechEnd) => void): boolean {
  if (!enabled) return false;
  stop('replaced');
  keepOutputAwake();

  let done = false;
  const finish = (how: SpeechEnd = 'ended') => {
    if (done) return;
    done = true;
    if (finishCurrent === finish) finishCurrent = null;
    onDone?.(how);
  };
  finishCurrent = finish;

  const key = voiceKey(text);
  if (recorded.has(key)) {
    if (!audio) audio = new Audio();
    audio.onended = () => finish();
    audio.onerror = () => {
      // recording missing or not playable: read it with the built-in voice instead
      if (!done) speakWithSynth(text, finish);
    };
    const url = ready.get(key);
    if (url) {
      // used again: move to the end, so it stays in memory longest
      ready.delete(key);
      ready.set(key, url);
    }
    audio.src = url ?? fileUrl(key);
    const p = audio.play();
    if (p)
      p.catch((err: DOMException) => {
        // AbortError: another phrase replaced this one (already reported). Anything else, e.g. the
        // browser refusing to play: report it as ended so a narration sequence keeps going.
        if (err && err.name !== 'AbortError') finish();
      });
    return true;
  }
  if (!synth) {
    finish();
    return false;
  }
  speakWithSynth(text, finish);
  return true;
}

function speakWithSynth(text: string, finish: (how?: SpeechEnd) => void) {
  if (!synth) return finish();
  if (!voice) pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'uk-UA';
  if (voice) u.voice = voice;
  // a brighter, livelier voice: higher pitch, normal tempo (slower sounds sleepy)
  u.rate = 1.0;
  u.pitch = VOICE_PITCH;
  u.onend = () => finish();
  u.onerror = () => finish();
  // some Safari versions never fire onend: don't leave the block highlighted forever
  setTimeout(() => finish(), 1500 + text.length * 110);
  synth.speak(u);
}
