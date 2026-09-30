// Shared by the app and scripts/build-voice.ts: a recorded phrase is stored as public/voice/<key>.m4a.

/** FNV-1a hash of the phrase, as 8 hex digits. */
export function voiceKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Voice pitch, +30 % over normal: brighter and more cheerful for a child. */
export const VOICE_PITCH = 1.3;
