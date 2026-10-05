// texts.yaml for Node scripts (the app gets it through Vite instead, see src/content.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildContent } from '../src/texts.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const { BODIES, NARRATION, STRUCTURE, UI, BUILDER } = buildContent(YAML.parse(readFileSync(join(root, 'texts.yaml'), 'utf8')));
