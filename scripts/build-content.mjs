#!/usr/bin/env node
// Builds src/content/generated/hsk.json from the 2025 HSK syllabus and our hand-written glosses.
//   node scripts/build-content.mjs          write the file
//   node scripts/build-content.mjs --check  fail if the committed file is out of date (used in CI)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/content/generated/hsk.json');
/** Levels that have hand-written glosses and are shipped in the app. */
const LEVELS = [1, 2];
const GLOSS_FILES = ['data/content/glosses-hsk1-2.tsv'];

const POS = { 名: 'n', 动: 'v', 形: 'adj', 副: 'adv', 代: 'pron', 量: 'mw', 数: 'num', 连: 'conj', 介: 'prep', 助: 'part', 叹: 'interj', 后缀: 'suffix', 前缀: 'prefix', 数量: 'numMw', 拟声: 'onom' };
/** Grammar words are taught in sentences (Plug mode), not by "what does it mean?". */
const NOT_QUIZZED = new Set(['part', 'suffix', 'prefix']);

const tsv = file => readFileSync(join(root, file), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { words, json } = build();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (current !== json) {
      console.error('src/content/generated/hsk.json is out of date. Run: npm run build:content');
      process.exit(1);
    }
    console.log(`hsk.json is up to date (${words.length} words).`);
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, json);
    const per = LEVELS.map(l => `HSK ${l}: ${words.filter(w => w.level === l).length}`).join(', ');
    console.log(`Wrote ${words.length} words (${per}) to src/content/generated/hsk.json`);
  }
}
