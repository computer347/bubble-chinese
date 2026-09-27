#!/usr/bin/env node
// Builds src/content/generated/hsk.json from the 2025 HSK syllabus and our hand-written glosses.
//   node scripts/build-content.mjs          write the file
//   node scripts/build-content.mjs --check  fail if the committed file is out of date (used in CI)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { segment, contextPinyin, readingProblem } from './segment.mjs';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/content/generated/hsk.json');
const SENTENCES_OUT = join(root, 'src/content/generated/sentences.json');
const SENTENCE_FILE = 'data/content/sentences.tsv';
const TATOEBA_FILE = 'data/content/sentences-tatoeba.tsv';
export const ROLES = ['S', 'T', 'P', 'A', 'V', 'O', 'X'];
const PUNCT = new Set(['。', '？', '！', '，']);
/** Levels that have hand-written glosses and are shipped in the app. */
const LEVELS = [1, 2];
const GLOSS_FILES = ['data/content/glosses-hsk1-2.tsv'];

const POS = { 名: 'n', 动: 'v', 形: 'adj', 副: 'adv', 代: 'pron', 量: 'mw', 数: 'num', 连: 'conj', 介: 'prep', 助: 'part', 叹: 'interj', 后缀: 'suffix', 前缀: 'prefix', 数量: 'numMw', 拟声: 'onom' };
/** Grammar words are taught in sentences (Plug mode), not by "what does it mean?". */
const NOT_QUIZZED = new Set(['part', 'suffix', 'prefix']);

// accepts Windows (CRLF) line endings too, in case git converted the files on checkout
const tsv = file => readFileSync(join(root, file), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));

function readGlosses() {
  const map = new Map();
  for (const f of GLOSS_FILES) {
    for (const line of tsv(f)) {
      const [key, gloss] = line.split('\t');
      if (!gloss) throw new Error(`${f}: no gloss for "${key}"`);
      if (map.has(key)) throw new Error(`${f}: duplicate key "${key}"`);
      map.set(key, gloss.trim());
    }
  }
  return map;
}

/** Measure words from a CC-CEDICT definition, e.g. "CL:個|个[ge4],位[wei4]" → ["个", "位"]. */
function measureWords(def) {
  const out = [];
  for (const m of def.matchAll(/CL:([^/)]+)/g)) {
    for (const item of m[1].split(',')) {
      const hanzi = item.split('[')[0];
      const simp = hanzi.includes('|') ? hanzi.split('|')[1] : hanzi;
      if (simp && !out.includes(simp)) out.push(simp);
    }
  }
  return out;
}

export function build() {
  const glosses = readGlosses();
  const [header, ...rows] = tsv('data/vendor/hsk2025-syllabus.tsv');
  const cols = header.split('\t');
  const byKey = new Map();
  for (const line of rows) {
    const r = Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v]));
    const level = Number(r.level);
    if (!LEVELS.includes(level)) continue;
    const h = r.word.replace(/\d/g, '');           // sense numbers: 点1, 点2 → 点
    const p = r.pinyin.split('/')[0];              // alternate readings: shéi/shuí → shéi
    const pn = r.numbered.split('/')[0];           // one numbered syllable per character: "ba4 ba5"
    const key = `${h}|${p}`;
    if (byKey.has(key)) continue;                  // homograph entries at a higher level keep the lower level
    const pos = r.pos ? r.pos.split('、').map(t => POS[t] ?? t) : [];
    byKey.set(key, { h, p, pn, level, pos, mw: pos.includes('n') ? measureWords(r.cedict) : [] });
  }
  const sharedHanzi = new Set();
  const counts = new Map();
  for (const w of byKey.values()) counts.set(w.h, (counts.get(w.h) ?? 0) + 1);
  for (const [h, n] of counts) if (n > 1) sharedHanzi.add(h);

  const words = [...byKey.values()].map(w => {
    const e = glosses.get(`${w.h}|${w.p}`) ?? (sharedHanzi.has(w.h) ? undefined : glosses.get(w.h));
    if (!e) throw new Error(`No gloss for ${w.h} (${w.p}). Add it to ${GLOSS_FILES.join(' or ')}.`);
    const quiz = !(w.pos.length && w.pos.every(t => NOT_QUIZZED.has(t)));
    return { id: `${w.h}|${w.p}`, h: w.h, p: w.p, pn: w.pn, e, level: w.level, pos: w.pos, ...(w.mw.length ? { mw: w.mw } : {}), ...(quiz ? {} : { quiz: false }) };
  });

  const used = new Set(words.map(w => (sharedHanzi.has(w.h) ? `${w.h}|${w.p}` : w.h)));
  const unused = [...glosses.keys()].filter(k => !used.has(k));
  if (unused.length) throw new Error(`Glosses for words not in the syllabus levels: ${unused.join(', ')}`);

  const json = '[\n' + words.map(w => '  ' + JSON.stringify(w)).join(',\n') + '\n]\n';
  return { words, json };
}

/**
 * Builds the example sentences. Each chunk is a group of words with one grammatical role
 * (the pieces of Plug mode); each word is linked to the word list, so a sentence's level is
 * the highest level of its words.
 */
export function buildSentences(words) {
  const byHanzi = new Map();
  for (const w of words) if (!byHanzi.has(w.h) || w.quiz !== false) byHanzi.set(w.h, w);
  const out = [], seen = new Set();
  for (const line of tsv(SENTENCE_FILE)) {
    const [chunkText, en, altText] = line.split('\t');
    if (!en) throw new Error(`${SENTENCE_FILE}: no English for "${chunkText}"`);
    const chunks = [], punct = [];
    let text = '';
    for (const tok of chunkText.trim().split(/\s+/)) {
      if (PUNCT.has(tok)) { text += tok; punct.push({ at: chunks.length, p: tok }); continue; }
      const m = tok.match(/^(.+)\/([A-Z])$/);
      if (!m) throw new Error(`${SENTENCE_FILE}: chunk "${tok}" needs a role, e.g. 学生/O ("${chunkText}")`);
      const [, body, role] = m;
      if (!ROLES.includes(role)) throw new Error(`${SENTENCE_FILE}: unknown role ${role} in "${chunkText}"`);
      const ws = body.split('+').map(h => {
        const w = byHanzi.get(h);
        if (!w) throw new Error(`${SENTENCE_FILE}: "${h}" is not in the HSK word list ("${chunkText}")`);
        return w.id;
      });
      text += body.replace(/\+/g, '');
      chunks.push({ role, words: ws });
    }
    if (seen.has(text)) throw new Error(`${SENTENCE_FILE}: duplicate sentence ${text}`);
    seen.add(text);
    const pattern = chunks.map(c => c.role).join(' ');
    const alt = altText ? altText.split('|').map(a => a.trim()).filter(Boolean) : [];
    for (const a of alt) {
      if (a.split(' ').sort().join(' ') !== pattern.split(' ').sort().join(' ')) throw new Error(`${SENTENCE_FILE}: order "${a}" does not use the same roles as ${pattern} ("${text}")`);
      if (new Set(pattern.split(' ')).size !== chunks.length) throw new Error(`${SENTENCE_FILE}: other orders need each role once ("${text}")`);
    }
    const level = Math.max(...chunks.flatMap(c => c.words.map(id => words.find(w => w.id === id).level)));
    const id = 's' + createHash('sha1').update(text).digest('hex').slice(0, 8);
    const py = contextPinyin(chunks.flatMap(c => c.words.map(wid => words.find(w => w.id === wid).h)), byHanzi);
    out.push({ id, text, en: en.trim(), level, pattern, chunks, punct, py, source: { name: 'Squish' }, ...(alt.length ? { alt } : {}) });
  }

  // Sentences from Tatoeba: real sentences by native speakers, split into syllabus words.
  // They have no roles yet (one word per chunk, role null); Plug mode uses the tagged ones above.
  for (const line of tsv(TATOEBA_FILE).slice(1)) {
    const [tid, author, zh, enId, en, boundText = ''] = line.split('\t');
    if (!en) throw new Error(`${TATOEBA_FILE}: malformed line "${line}"`);
    const toks = segment(zh, byHanzi);
    if (!toks) throw new Error(`${TATOEBA_FILE}: #${tid} ${zh} no longer splits into HSK words`);
    const problem = readingProblem(toks);
    if (problem) throw new Error(`${TATOEBA_FILE}: #${tid} ${zh}: ${problem}`);
    const key = zh.replace(/[。？！，]/g, '');
    if ([...seen].some(t => t.replace(/[。？！，]/g, '') === key)) continue;      // already one of ours
    seen.add(zh);
    const chunks = [], punct = [];
    for (const t of toks) {
      if (PUNCT.has(t)) punct.push({ at: chunks.length, p: t });
      else chunks.push({ role: null, words: [byHanzi.get(t).id] });
    }
    const level = Math.max(...chunks.map(c => words.find(w => w.id === c.words[0]).level));
    const py = contextPinyin(toks.filter(t => !PUNCT.has(t)), byHanzi);
    const bound = boundText && boundText !== '-' ? boundText.split(',').map(h => byHanzi.get(h).id) : [];
    out.push({ id: `t${tid}`, text: zh, en, level, pattern: '', chunks, punct, py, ...(bound.length ? { bound } : {}), source: { name: 'Tatoeba', id: Number(tid), author, enId: Number(enId) } });
  }
  const json = '[\n' + out.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n';
  return { sentences: out, json };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { words, json } = build();
  const { sentences, json: sjson } = buildSentences(words);
  const read = f => { try { return readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
  if (process.argv.includes('--check')) {
    if (read(OUT) !== json || read(SENTENCES_OUT) !== sjson) {
      console.error('Generated content is out of date. Run: npm run build:content');
      process.exit(1);
    }
    console.log(`Generated content is up to date (${words.length} words, ${sentences.length} sentences).`);
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, json);
    writeFileSync(SENTENCES_OUT, sjson);
    const per = LEVELS.map(l => `HSK ${l}: ${words.filter(w => w.level === l).length}`).join(', ');
    console.log(`Wrote ${words.length} words (${per}) and ${sentences.length} sentences to src/content/generated/`);
  }
}
