// Speaks phrases aloud. Every text the app says is pre-recorded with the Ukrainian voice Lesya
// (scripts/build-voice.ts → public/voice), because devices without that voice — old iPads on
// iOS 12 — would read Ukrainian with a Russian one. The browser's speech synthesis is only a
// fallback for phrases that have no recording yet.

import manifest from './voice-manifest.json';
import { VOICE_PITCH, voiceKey } from './voiceKey';

const recorded = new Set<string>(manifest);
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
  if (!on) stop('muted');
}

/**
 * Say a phrase, interrupting whatever is being said. Call from a tap/click handler (iOS needs a
 * user gesture). onDone tells how the phrase ended (see SpeechEnd). Returns false when muted.
 */
export function say(text: string, onDone?: (how: SpeechEnd) => void): boolean {
  if (!enabled) return false;
  stop('replaced');

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
    audio.src = `${import.meta.env.BASE_URL}voice/${key}.m4a`;
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
