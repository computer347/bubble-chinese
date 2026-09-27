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
const WOTD_OUT = join(root, 'src/content/generated/word-of-day.json');
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
    const { chunks, punct, text } = parseChunks(chunkText, byHanzi, SENTENCE_FILE);
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

/**
 * Words of the day: syllabus words above the shipped levels, with a short meaning from their
 * CC-CEDICT definition (the first sense, without classifiers or cross-references). A small daily
 * look beyond what the app teaches; a fetched source can replace this list later.
 */
export function shortGloss(def) {
  const sense = def.split('/').map(s => s.replace(/\(bound form\)\s*/g, '').replace(/CL:\S+/g, '').trim())
    .find(s => s && !/^(variant of|see |used in |old variant|surname )/i.test(s));
  if (!sense) return '';
  const parts = sense.split(';').map(s => s.trim()).filter(Boolean);
  let out = parts[0];
  if (parts[1] && (out + '; ' + parts[1]).length <= 32) out += '; ' + parts[1];
  return out.length > 40 ? out.slice(0, 39).replace(/\s+\S*$/, '') + '…' : out;
}

export function buildWordOfDay(words) {
  const known = new Set(words.map(w => w.h));
  const [header, ...rows] = tsv('data/vendor/hsk2025-syllabus.tsv');
  const cols = header.split('\t');
  const out = [], seen = new Set();
  for (const line of rows) {
    const r = Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v]));
    const level = Number(r.level);
    if (LEVELS.includes(level)) continue;
    const h = r.word.replace(/\d/g, '');
    if (known.has(h) || seen.has(h)) continue;
    const e = shortGloss(r.cedict ?? '');
    if (!e) continue;
    seen.add(h);
    out.push({ h, p: r.pinyin.split('/')[0], pn: r.numbered.split('/')[0], e, level });
  }
  return { list: out, json: '[\n' + out.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n' };
}

const PATH_FILE = 'data/content/path-hsk1.txt';
const PATH_OUT = join(root, 'src/content/generated/path.json');
/** New words a lesson may teach: 10 is the aim. */
const LESSON_WORDS = [8, 12];

/**
 * Parses role-tagged chunks ("我/S 很/A 好/V 。") into chunks of word ids and punctuation.
 * `where` names the line in error messages.
 */
function parseChunks(chunkText, byHanzi, where) {
  const chunks = [], punct = [];
  let text = '';
  for (const tok of chunkText.trim().split(/\s+/)) {
    if (PUNCT.has(tok)) { text += tok; punct.push({ at: chunks.length, p: tok }); continue; }
    const m = tok.match(/^(.+)\/([A-Z])$/);
    if (!m) throw new Error(`${where}: chunk "${tok}" needs a role, e.g. 学生/O ("${chunkText}")`);
    const [, body, role] = m;
    if (!ROLES.includes(role)) throw new Error(`${where}: unknown role ${role} in "${chunkText}"`);
    const ws = body.split('+').map(h => {
      const w = byHanzi.get(h);
      if (!w) throw new Error(`${where}: "${h}" is not in the HSK word list ("${chunkText}")`);
      return w.id;
    });
    text += body.replace(/\+/g, '');
    chunks.push({ role, words: ws });
  }
  return { chunks, punct, text, pattern: chunks.map(c => c.role).join(' ') };
}

/**
 * The path: units (topics) of lessons, each with its new words, a short dialogue and sentences to
 * build. Fails the build if a lesson uses a word that is not an HSK word of the path's level, or
 * not yet taught (in this lesson or an earlier one), teaches a word twice, or teaches a word it
 * never uses.
 */
export function buildPath(words, file = PATH_FILE, level = 1, sizes = LESSON_WORDS) {
  const byHanzi = new Map();
  for (const w of words) if (!byHanzi.has(w.h) || w.quiz !== false) byHanzi.set(w.h, w);
  const byId = new Map(words.map(w => [w.id, w]));
  const units = [], taught = new Map();           // word id → lesson id
  let unit = null, lesson = null;
  const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
  const need = (cond, n, msg) => { if (!cond) throw new Error(`${file}:${n}: ${msg}`); };
  const known = (h, n) => {
    const w = byHanzi.get(h);
    need(w, n, `"${h}" is not an HSK word`);
    need(taught.has(w.id), n, `"${h}" is used before it is taught (add it to a "new" line in this lesson or an earlier one)`);
    return w;
  };
  lines.forEach((raw, i) => {
    const n = i + 1, line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const sp = line.indexOf(' ');
    const kind = sp < 0 ? line : line.slice(0, sp);
    const parts = (sp < 0 ? '' : line.slice(sp + 1)).split('|').map(s => s.trim());
    if (kind === 'unit') {
      const [id, title, zh, topic] = parts;
      need(id && title && zh && topic, n, 'a unit needs: id | title | Chinese title | topic');
      need(!units.some(u => u.id === id), n, `duplicate unit ${id}`);
      units.push(unit = { id, title, zh, topic, notes: [], lessons: [] });
      lesson = null;
    } else if (kind === 'note') {
      need(unit && !lesson, n, 'a culture note belongs to a unit, before its lessons');
      // a note is free text: the rest of the line as written, bars and all
      const text = line.slice(sp + 1).trim();
      need(sp > 0 && text, n, 'an empty note');
      unit.notes.push(text);
    } else if (kind === 'lesson') {
      need(unit, n, 'a lesson must follow a unit');
      const [id, title] = parts;
      need(id && title, n, 'a lesson needs: id | title');
      need(!units.some(u => u.lessons.some(l => l.id === id)), n, `duplicate lesson ${id}`);
      unit.lessons.push(lesson = { id, title, words: [], dialogue: [], builds: [], used: new Set() });
    } else if (kind === 'new') {
      need(lesson, n, '"new" must follow a lesson');
      for (const h of parts[0].split(/\s+/)) {
        const w = byHanzi.get(h);
        need(w, n, `"${h}" is not an HSK word`);
        need(w.level <= level, n, `"${h}" is HSK ${w.level}, above this path's level ${level}`);
        need(!taught.has(w.id), n, `"${h}" is already taught in ${taught.get(w.id)}`);
        taught.set(w.id, lesson.id);
        lesson.words.push(w.id);
      }
    } else if (kind === 'say') {
      need(lesson, n, '"say" must follow a lesson');
      const [who, zh, en] = parts;
      need(who && zh && en, n, 'a dialogue line needs: speaker | Chinese | English');
      // names in braces may contain spaces ({王丽=Wáng Lì})
      const tokens = zh.match(/\{[^}]*\}|\S+/g).map(t => {
        if (PUNCT.has(t)) return { p: t };
        const name = t.match(/^\{(.+)=(.+)\}$/);
        if (name) return { name: name[1], py: name[2] };
        const w = known(t, n);
        lesson.used.add(w.id);
        return { id: w.id };
      });
      // pinyin as said here (不 bú, 一 yí/yì), one per token so punctuation still marks the pauses;
      // names keep their own
      const shown = tokens.map(t => t.p ?? t.name ?? byId.get(t.id).h);
      const py = contextPinyin(shown, byHanzi);
      const text = shown.join('');
      lesson.dialogue.push({ id: 'd' + createHash('sha1').update(text).digest('hex').slice(0, 8), who, en, text, tokens: tokens.map((t, k) => (t.p || t.name ? t : { ...t, py: py[k] })) });
    } else if (kind === 'build') {
      need(lesson, n, '"build" must follow a lesson');
      const [chunkText, en] = parts;
      need(chunkText && en, n, 'a sentence to build needs: chunks | English');
      const s = parseChunks(chunkText, byHanzi, `${file}:${n}`);
      for (const c of s.chunks) for (const id of c.words) { known(byId.get(id).h, n); lesson.used.add(id); }
      const py = contextPinyin(s.chunks.flatMap(c => c.words.map(id => byId.get(id).h)), byHanzi);
      lesson.builds.push({ text: s.text, en, pattern: s.pattern, chunks: s.chunks, punct: s.punct, py });
    } else {
      need(false, n, `unknown line "${kind}" (expected unit, note, lesson, new, say or build)`);
    }
  });
  for (const u of units) for (const l of u.lessons) {
    if (l.words.length < sizes[0] || l.words.length > sizes[1]) throw new Error(`${file}: lesson ${l.id} teaches ${l.words.length} words; a lesson teaches ${sizes[0]}–${sizes[1]} (10 is the aim)`);
    for (const id of l.words) if (!l.used.has(id)) throw new Error(`${file}: lesson ${l.id} teaches "${byId.get(id).h}" but never uses it`);
    delete l.used;
  }
  const out = { level, units };
  return { path: out, json: JSON.stringify(out, null, 1) + '\n' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { words, json } = build();
  const { sentences, json: sjson } = buildSentences(words);
  const { list: wotd, json: wjson } = buildWordOfDay(words);
  const { path, json: pjson } = buildPath(words);
  const read = f => { try { return readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
  if (process.argv.includes('--check')) {
    if (read(OUT) !== json || read(SENTENCES_OUT) !== sjson || read(WOTD_OUT) !== wjson || read(PATH_OUT) !== pjson) {
      console.error('Generated content is out of date. Run: npm run build:content');
      process.exit(1);
    }
    console.log(`Generated content is up to date (${words.length} words, ${sentences.length} sentences).`);
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, json);
    writeFileSync(SENTENCES_OUT, sjson);
    writeFileSync(WOTD_OUT, wjson);
    writeFileSync(PATH_OUT, pjson);
    const lessons = path.units.flatMap(u => u.lessons);
    console.log(`Wrote the path: ${path.units.length} units, ${lessons.length} lessons, ${lessons.reduce((n, l) => n + l.words.length, 0)} words taught.`);
    console.log(`Wrote ${wotd.length} words of the day (above HSK ${Math.max(...LEVELS)}).`);
    const per = LEVELS.map(l => `HSK ${l}: ${words.filter(w => w.level === l).length}`).join(', ');
    console.log(`Wrote ${words.length} words (${per}) and ${sentences.length} sentences to src/content/generated/`);
  }
}
