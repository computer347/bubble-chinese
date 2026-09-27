#!/usr/bin/env node
// Copies stroke-order data for every character the app teaches from hanzi-writer-data into
// public/strokes/, unchanged, with its licence.
//   node scripts/copy-strokes.mjs          copy
//   node scripts/copy-strokes.mjs --check  fail if a file is missing or differs (used in CI)
//
// The data comes from Make Me a Hanzi, derived from Arphic's fonts, and is under the Arphic Public
// License: each file is copied verbatim, and ARPHICPL.TXT goes with them, unaltered.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'node_modules/hanzi-writer-data');
const OUT = join(root, 'public/strokes');
const words = JSON.parse(readFileSync(join(root, 'src/content/generated/hsk.json'), 'utf8'));

/** A character's file name: its code point, so URLs stay plain ASCII ("u4f60.json" for 你). */
export const strokeFile = ch => `u${ch.codePointAt(0).toString(16)}.json`;

const chars = [...new Set(words.flatMap(w => [...w.h].filter(c => /\p{Script=Han}/u.test(c))))].sort();
const version = JSON.parse(readFileSync(join(SRC, 'package.json'), 'utf8')).version;
const NOTICE = `Stroke-order data for the ${chars.length} characters Squish teaches, copied unchanged from
hanzi-writer-data ${version} (https://github.com/chanind/hanzi-writer-data), which takes it from
Make Me a Hanzi (https://github.com/skishore/makemeahanzi), derived from Arphic Technology's
"AR PL KaitiM GB" and "AR PL UKai" fonts.

The files are redistributed under the Arphic Public License; see ARPHICPL.TXT in this folder.
Each file is named by its character's code point (u4f60.json is 你). The complete data set is
freely available from the hanzi-writer-data repository above.
`;

const missing = chars.filter(c => !existsSync(join(SRC, `${c}.json`)));
if (missing.length) {
  console.error(`No stroke data for: ${missing.join(' ')}`);
  process.exit(1);
}

const check = process.argv.includes('--check');
const problems = [];
if (!check) mkdirSync(OUT, { recursive: true });
for (const c of chars) {
  const from = join(SRC, `${c}.json`), to = join(OUT, strokeFile(c));
  if (check) {
    if (!existsSync(to) || !readFileSync(to).equals(readFileSync(from))) problems.push(c);
  } else copyFileSync(from, to);
}
const extra = existsSync(OUT) ? readdirSync(OUT).filter(f => f.endsWith('.json') && !chars.some(c => strokeFile(c) === f)) : [];
const licence = join(SRC, 'ARPHICPL.TXT');
if (check) {
  if (!existsSync(join(OUT, 'ARPHICPL.TXT')) || !readFileSync(join(OUT, 'ARPHICPL.TXT')).equals(readFileSync(licence))) problems.push('ARPHICPL.TXT');
  if (!existsSync(join(OUT, 'NOTICE.txt')) || readFileSync(join(OUT, 'NOTICE.txt'), 'utf8').replace(/\r\n/g, '\n') !== NOTICE) problems.push('NOTICE.txt');
  if (problems.length || extra.length) {
    console.error(`Stroke data is out of date (${[...problems, ...extra].slice(0, 10).join(' ')}…). Run: npm run strokes`);
    process.exit(1);
  }
  console.log(`Stroke data is up to date (${chars.length} characters).`);
} else {
  copyFileSync(licence, join(OUT, 'ARPHICPL.TXT'));
  writeFileSync(join(OUT, 'NOTICE.txt'), NOTICE);
  if (extra.length) console.log(`Not taught any more, remove by hand: ${extra.join(' ')}`);
  console.log(`Copied stroke data for ${chars.length} characters to public/strokes/.`);
}
