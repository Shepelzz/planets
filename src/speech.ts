// Speaks planet names aloud with the browser's built-in speech synthesis (Ukrainian voice, Lesya on Apple devices).

const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let enabled = true;
let voice: SpeechSynthesisVoice | null = null;

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

export const speechSupported = !!synth;

export function setSpeechEnabled(on: boolean) {
  enabled = on;
  if (!on) synth?.cancel();
}

/**
 * Say a phrase, interrupting whatever is being said. Call from a tap/click handler (iOS needs a
 * user gesture). onDone runs when this phrase ends or is cut off. Returns false when muted.
 */
export function say(text: string, onDone?: () => void): boolean {
  if (!enabled || !synth) return false;
  if (!voice) pickVoice();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'uk-UA';
  if (voice) u.voice = voice;
  // a brighter, livelier voice: higher pitch, normal tempo (slower sounds sleepy)
  u.rate = 1.0;
  u.pitch = 1.3;
  if (onDone) {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        onDone();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    // some Safari versions never fire onend: don't leave the block highlighted forever
    setTimeout(finish, 1500 + text.length * 110);
  }
  synth.speak(u);
  return true;
}
