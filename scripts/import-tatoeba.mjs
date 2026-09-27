#!/usr/bin/env node
// Picks example sentences from Tatoeba (https://tatoeba.org, CC BY 2.0 FR): real Mandarin sentences
// by native speakers, with English translations, kept only if every word is in the HSK word list
// that the app ships (2025 syllabus). Writes data/content/sentences-tatoeba.tsv.
//
//   node scripts/import-tatoeba.mjs              download the exports (cached in .cache/tatoeba) and select
//   node scripts/import-tatoeba.mjs --per-word 3 sentences to keep per word (default 2)
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import bz2 from 'unbzip2-stream';
import { segment, readingProblem, compoundProblem, boundWords, parseCedict, hanziCount, PUNCT } from './segment.mjs';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, '.cache/tatoeba');
const OUT = join(root, 'data/content/sentences-tatoeba.tsv');
const EXCLUDE = join(root, 'data/content/tatoeba-exclude.tsv');
const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
const BASE = 'https://downloads.tatoeba.org/exports/per_language';
const FILES = { cmn: 'cmn/cmn_sentences_detailed.tsv.bz2', links: 'cmn/cmn-eng_links.tsv.bz2', eng: 'eng/eng_sentences.tsv.bz2' };
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PER_WORD = Number(opt('per-word', 2));

async function download(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, FILES[name].split('/').pop());
  if (!existsSync(file)) {
    console.log(`Downloading ${FILES[name]} …`);
    const res = await fetch(`${BASE}/${FILES[name]}`);
    if (!res.ok) throw new Error(`Tatoeba download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  }
  return file;
}

async function* lines(file) {
  const rl = createInterface({ input: createReadStream(file).pipe(bz2()), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

const words = JSON.parse(readFileSync(join(root, 'src/content/generated/hsk.json'), 'utf8'));
const vocab = new Map();
for (const w of words) if (!vocab.has(w.h) || w.quiz !== false) vocab.set(w.h, w);

const [cmnFile, linksFile, engFile] = [await download('cmn'), await download('links'), await download('eng')];

// CC-CEDICT (CC BY-SA 4.0) is used only to spot compounds, names and changed readings.
const cedictFile = join(CACHE, 'cedict.txt');
if (!existsSync(cedictFile)) {
  console.log('Downloading CC-CEDICT …');
  const res = await fetch(CEDICT_URL);
  if (!res.ok) throw new Error(`CC-CEDICT download failed: HTTP ${res.status}`);
  writeFileSync(cedictFile, gunzipSync(Buffer.from(await res.arrayBuffer())));
}
const cedict = parseCedict(readFileSync(cedictFile, 'utf8'));
// Sentences a person has checked and rejected: one Tatoeba id per line, a tab, and why.
const excluded = new Set(existsSync(EXCLUDE) ? readFileSync(EXCLUDE, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => Number(l.split('\t')[0])) : []);

const reasons = new Map();
const skip = r => reasons.set(r, (reasons.get(r) ?? 0) + 1);
const candidates = [];
for await (const line of lines(cmnFile)) {
  const [id, , text, author] = line.split('\t');
  const n = hanziCount(text);
  if (n < 4 || n > 12) { skip('length outside 4–12 characters'); continue; }
  if (!/[。？！]$/.test(text) || /[^\u3400-\u9fff。？！，]/.test(text)) { skip('other characters or no final punctuation'); continue; }
  const toks = segment(text, vocab);
  if (!toks) { skip('uses words outside HSK 1–2'); continue; }
  if (excluded.has(Number(id))) { skip('excluded by review'); continue; }
  const problem = readingProblem(toks);
  if (problem) { skip(problem); continue; }
  const compound = compoundProblem(toks, cedict, vocab);
  if (compound) { skip(compound.replace(/^\S+ /, '… ')); continue; }
  const ws = toks.filter(t => !PUNCT.has(t));
  const bound = boundWords(toks, cedict, vocab);
  candidates.push({ id: Number(id), author: author === '\\N' ? '' : author, text, toks, bound, free: ws.filter(t => !bound.includes(t)), level: Math.max(...ws.map(t => vocab.get(t).level)), n });
}

const byId = new Map(candidates.map(c => [c.id, c]));
const engFor = new Map();
for await (const line of lines(linksFile)) {
  const [a, b] = line.split('\t').map(Number);
  if (byId.has(a)) engFor.set(a, [...(engFor.get(a) ?? []), b]);
}
const needed = new Set([...engFor.values()].flat());
const eng = new Map();
for await (const line of lines(engFile)) {
  const tab = line.indexOf('\t');
  const id = Number(line.slice(0, tab));
  if (needed.has(id)) eng.set(id, line.slice(line.indexOf('\t', tab + 1) + 1));
}
const withEnglish = candidates.filter(c => {
  const opts = (engFor.get(c.id) ?? []).map(i => ({ id: i, text: eng.get(i) })).filter(e => e.text && e.text.length <= 80 && /[.?!]$/.test(e.text));
  if (!opts.length) { skip('no short English translation'); return false; }
  c.en = opts.sort((a, b) => a.text.length - b.text.length)[0];
  return true;
});

// Keep a few good sentences per word: short, at or below the word's level, and not near-duplicates.
const score = c => Math.abs(c.n - 7) + c.toks.length * 0.2;
const pool = withEnglish.sort((a, b) => score(a) - score(b));
const seenText = new Set();
const unique = pool.filter(c => { const k = c.text.replace(/[。？！，]/g, ''); if (seenText.has(k)) return false; seenText.add(k); return true; });
const quiz = words.filter(w => w.quiz !== false);
const uses = new Map(quiz.map(w => [w.h, unique.filter(c => c.free.includes(w.h))]));
const picked = new Map();
for (const w of [...quiz].sort((a, b) => uses.get(a.h).length - uses.get(b.h).length)) {
  const have = [...picked.values()].filter(c => c.free.includes(w.h)).length;
  const fit = uses.get(w.h).filter(c => !picked.has(c.id));
  const ordered = [...fit.filter(c => c.level <= w.level), ...fit.filter(c => c.level > w.level)];
  for (const c of ordered.slice(0, Math.max(0, PER_WORD - have))) picked.set(c.id, c);
}

const rows = [...picked.values()].sort((a, b) => a.level - b.level || a.id - b.id);
writeFileSync(OUT, [
  '# Example sentences from Tatoeba (https://tatoeba.org), licensed CC BY 2.0 FR. Selected by scripts/import-tatoeba.mjs.',
  '# Every word is in the HSK 1–2 list (2025 syllabus); sentences where a character would be read differently from its syllabus entry are left out.',
  '# Columns: Tatoeba sentence id, author, Mandarin, English sentence id, English, and words that are part of a larger word here (not used as examples for them; - for none).',
  'id\tauthor\tzh\ten_id\ten\tbound',
  ...rows.map(c => [c.id, c.author, c.text, c.en.id, c.en.text, c.bound.join(',') || '-'].join('\t'))
].join('\n') + '\n');

const covered = quiz.filter(w => rows.some(c => c.free.includes(w.h))).length;
console.log(`Kept ${rows.length} sentences (HSK 1: ${rows.filter(c => c.level === 1).length}, HSK 2: ${rows.filter(c => c.level === 2).length}); ${covered} of ${quiz.length} quiz words have an example.`);
console.log('Skipped:', [...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`).join('; '));
