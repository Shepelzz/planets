// src/voice-manifest.json: every recorded phrase → a short fingerprint of its file. The app asks for
// voice/<key>.m4a?v=<fingerprint>, so a phrase re-recorded under the same text (another voice, a
// better take) gets a new URL and browsers holding the old one in their cache fetch it again, while
// unchanged recordings stay cached (they are served as immutable for a year).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeVoiceManifest(root: string, keys: Iterable<string>) {
  const manifest: Record<string, string> = {};
  for (const key of [...new Set(keys)].sort()) {
    const file = readFileSync(join(root, 'public', 'voice', `${key}.m4a`));
    manifest[key] = createHash('sha1').update(file).digest('hex').slice(0, 8);
  }
  writeFileSync(join(root, 'src', 'voice-manifest.json'), JSON.stringify(manifest, null, 0) + '\n');
}
