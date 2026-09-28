#!/usr/bin/env node
// Builds src/content/generated/hsk.json from the 2025 HSK syllabus and our hand-written glosses.
//   node scripts/build-content.mjs          write the file
//   node scripts/build-content.mjs --check  fail if the committed file is out of date (used in CI)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
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
      // an id from the text names its recording, and its reviews in Plug
      lesson.builds.push({ id: 'b' + createHash('sha1').update(s.text).digest('hex').slice(0, 8), text: s.text, en, pattern: s.pattern, chunks: s.chunks, punct: s.punct, py });
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

const STORY_DIR = 'data/content/stories';
const STORIES_OUT = join(root, 'src/content/generated/stories.json');
/** Limits for a story: its length in characters, and a sentence's. */
const STORY_CHARS = [120, 360];
const SENTENCE_CHARS = 26;
const LICENCES = new Set(['CC0', 'CC BY 4.0']);

/** Hanzi count, ignoring punctuation and the pinyin of names. */
const hanziCount = s => [...s].filter(c => /[\u3400-\u9fff]/.test(c)).length;

/**
 * Splits a story sentence into tokens: syllabus words (with pinyin as said here), names written
 * {characters=pinyin}, and punctuation. Throws with the part it cannot split.
 */
export function storyTokens(zh, byHanzi, where) {
  const out = [];
  for (const piece of zh.match(/\{[^}]*\}|[^{]+/g) ?? []) {
    const name = piece.match(/^\{(.+)=(.+)\}$/);
    if (name) { out.push({ name: name[1], py: name[2].trim() }); continue; }
    if (piece.startsWith('{')) throw new Error(`${where}: a name is written {characters=pinyin}, not "${piece}"`);
    // a space forces a split where the fewest words would read wrongly: 不 要 (doesn't want), not 不要 (don't)
    // and a colon (before what someone says) is punctuation of its own
    for (const text of piece.split(/\s+|(：)/).filter(Boolean)) {
      if (text === '：') { out.push({ p: text }); continue; }
      const bad = [...text].find(c => !/[\u3400-\u9fff]/.test(c) && !PUNCT.has(c));
      if (bad) throw new Error(`${where}: "${bad}" is not allowed (only characters and 。？！，：; numbers in characters)`);
      const toks = segment(text, byHanzi);
      if (!toks) {
        // name the first stretch that no run of words can reach
        const chars = [...text];
        let reach = 0;
        for (let i = 1; i <= chars.length; i++) if (segment(chars.slice(0, i).join(''), byHanzi)) reach = i;
        const rest = chars.slice(reach).join('');
        throw new Error(`${where}: cannot split "${rest.slice(0, 4)}…" in "${text}" into words of the level (is one of them above it, or a name without {=}?)`);
      }
      out.push(...toks.map(t => (PUNCT.has(t) ? { p: t } : { h: t })));
    }
  }
  const problem = readingProblem(out.map(t => t.h ?? t.p ?? t.name));
  if (problem) throw new Error(`${where}: ${problem}: please reword "${zh}"`);
  const shown = out.map(t => t.h ?? t.p ?? t.name);
  const py = contextPinyin(shown, byHanzi);
  return out.map((t, k) => (t.h ? { id: byHanzi.get(t.h).id, py: py[k] } : t));
}

/**
 * The graded stories of the Read tab, one file each in data/content/stories (docs/STORIES.md).
 * Fails the build if a story uses a word above its level, reads a character ambiguously, runs too
 * long or short, or lacks an English line or a free licence. A story opens once the path has taught
 * every word in it: `after` is the lesson that teaches its last one (null when it goes beyond the path).
 */
export function buildStories(words, path, dir = STORY_DIR) {
  const lessonOf = new Map(path.units.flatMap(u => u.lessons).flatMap((l, i) => l.words.map(id => [id, { i, id: l.id }])));
  const unitIds = new Set(path.units.map(u => u.id));
  const byId = new Map(words.map(w => [w.id, w]));
  const full = join(root, dir);
  const files = existsSync(full) ? readdirSync(full).filter(f => f.endsWith('.txt')).sort() : [];
  const stories = [];
  for (const f of files) {
    const file = `${dir}/${f}`;
    const lines = readFileSync(join(full, f), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const need = (cond, n, msg) => { if (!cond) throw new Error(`${file}:${n}: ${msg}`); };
    let n = 0;
    const next = () => { while (n < lines.length && !lines[n].trim()) n++; return lines[n++]?.trim() ?? ''; };
    const head = next();
    const m = head.match(/^story\s+(\S+)\s*\|(.+)$/);
    need(m, n, 'the first line is: story <id> | English title | Chinese title | level | unit');
    const [title, zhTitle, levelText, unit] = m[2].split('|').map(s => s.trim());
    const id = m[1], level = Number(levelText);
    need(title && zhTitle && unit, n, 'the first line is: story <id> | English title | Chinese title | level | unit');
    need(/^[a-z0-9-]+$/.test(id), n, `story id "${id}": use lower case letters, digits and -`);
    need(!stories.some(s => s.id === id), n, `duplicate story id ${id}`);
    need(Number.isInteger(level) && level >= 1 && level <= 9, n, `level "${levelText}" should be 1–9`);
    need(unit === '-' || unitIds.has(unit), n, `"${unit}" is not a path unit (${[...unitIds].join(', ')}), or write -`);
    const credit = next();
    const cm = credit.match(/^by\s+(.+?)\s*\|\s*(.+)$/);
    need(cm, n, 'the second line is: by <who wrote it> | <licence>');
    need(LICENCES.has(cm[2]), n, `licence "${cm[2]}": use ${[...LICENCES].join(' or ')}`);
    const byHanzi = new Map();
    for (const w of words) if (w.level <= level && (!byHanzi.has(w.h) || w.quiz !== false)) byHanzi.set(w.h, w);
    const paras = [];
    let para = null, chars = 0;
    const used = new Set();
    for (; n < lines.length; n++) {
      const line = lines[n].trim();
      if (!line) { para = null; continue; }
      if (line.startsWith('#')) continue;
      const where = `${file}:${n + 1}`;
      const bar = line.indexOf('|');
      need(bar > 0, n + 1, 'a sentence line is: Chinese | English');
      const zh = line.slice(0, bar).trim(), en = line.slice(bar + 1).trim();
      need(zh && en, n + 1, 'a sentence line is: Chinese | English');
      need(/[。？！]$/.test(zh), n + 1, `a sentence ends in 。？！ ("${zh}")`);
      const tokens = storyTokens(zh, byHanzi, where);
      const text = tokens.map(t => t.p ?? t.name ?? byId.get(t.id).h).join('');
      const count = hanziCount(text);
      need(count <= SENTENCE_CHARS, n + 1, `a sentence of ${count} characters; keep them to about 20 (at most ${SENTENCE_CHARS})`);
      chars += count;
      for (const t of tokens) if (t.id) used.add(t.id);
      if (!para) paras.push(para = []);
      para.push({ id: 'r' + createHash('sha1').update(text).digest('hex').slice(0, 8), text, en, tokens });
    }
    const count = paras.flat().length;
    need(count >= 4, n, `only ${count} sentences; a story has 8–20`);
    need(chars >= STORY_CHARS[0] && chars <= STORY_CHARS[1], n, `${chars} characters; a story has 150–300 (${STORY_CHARS[0]}–${STORY_CHARS[1]} allowed)`);
    // the lesson after which every word in it has been taught
    const at = [...used].map(w => lessonOf.get(w));
    const after = at.some(x => !x) ? null : at.reduce((a, b) => (b.i > a.i ? b : a)).id;
    stories.push({ id, title, zh: zhTitle, level, unit: unit === '-' ? null : unit, by: cm[1], licence: cm[2], chars, after, words: [...used].sort(), paras });
  }
  // in the order they open along the path, then by level and title
  const order = new Map(path.units.flatMap(u => u.lessons).map((l, i) => [l.id, i]));
  stories.sort((a, b) => a.level - b.level || (order.get(a.after) ?? 1e9) - (order.get(b.after) ?? 1e9) || a.title.localeCompare(b.title));
  return { stories, json: JSON.stringify(stories) + '\n' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { words, json } = build();
  const { sentences, json: sjson } = buildSentences(words);
  const { list: wotd, json: wjson } = buildWordOfDay(words);
  const { path, json: pjson } = buildPath(words);
  const { stories, json: stjson } = buildStories(words, path);
  const read = f => { try { return readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
  if (process.argv.includes('--check')) {
    if (read(OUT) !== json || read(SENTENCES_OUT) !== sjson || read(WOTD_OUT) !== wjson || read(PATH_OUT) !== pjson || read(STORIES_OUT) !== stjson) {
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
    writeFileSync(STORIES_OUT, stjson);
    console.log(`Wrote ${stories.length} stories (${stories.reduce((k, s) => k + s.chars, 0)} characters).`);
    const lessons = path.units.flatMap(u => u.lessons);
    console.log(`Wrote the path: ${path.units.length} units, ${lessons.length} lessons, ${lessons.reduce((n, l) => n + l.words.length, 0)} words taught.`);
    console.log(`Wrote ${wotd.length} words of the day (above HSK ${Math.max(...LEVELS)}).`);
    const per = LEVELS.map(l => `HSK ${l}: ${words.filter(w => w.level === l).length}`).join(', ');
    console.log(`Wrote ${words.length} words (${per}) and ${sentences.length} sentences to src/content/generated/`);
  }
}
