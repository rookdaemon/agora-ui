#!/usr/bin/env node
/**
 * Patches string-width to guard against Intl.Segmenter yielding undefined segments.
 * This is a known issue on certain Node.js/V8 versions where the segmenter
 * produces segments with undefined `segment` property, crashing .codePointAt().
 *
 * See: https://github.com/sindresorhus/string-width/issues/56
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = resolve(__dirname, '..', 'node_modules', 'string-width', 'index.js');

const ORIGINAL = `const codePoint = character.codePointAt(0);`;
const PATCHED = `if (!character) continue;\n\t\tconst codePoint = character.codePointAt(0);`;

try {
  let content = readFileSync(filePath, 'utf8');
  if (content.includes('if (!character) continue;')) {
    // Already patched
    process.exit(0);
  }
  content = content.replace(ORIGINAL, PATCHED);
  writeFileSync(filePath, content);
  console.log('Patched string-width: added guard for undefined Intl.Segmenter segments');
} catch (err) {
  console.warn('Could not patch string-width:', err.message);
}
