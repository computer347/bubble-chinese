// Pure helpers for scripts/generate-audio.mjs, kept separate so they can be unit-tested.
import { createHash } from 'node:crypto';

export const MODEL = 'speech-2.8-hd';
export const DEFAULT_VOICE = 'Chinese (Mandarin)_News_Anchor';
/** Voices offered by `--sample` for a side-by-side listen (from MiniMax's system voice list). */
export const SAMPLE_VOICES = [
  'Chinese (Mandarin)_News_Anchor',
  'Chinese (Mandarin)_Male_Announcer',
  'Chinese (Mandarin)_Gentle_Youth',
  'Chinese (Mandarin)_Warm_Girl',
  'Chinese (Mandarin)_Radio_Host',
  'Chinese (Mandarin)_Sincere_Adult'
];
export const SPEEDS = { normal: 0.95, slow: 0.62 };
export const AUDIO_SETTING = { sample_rate: 24000, bitrate: 64000, format: 'mp3', channel: 1 };

/**
 * A MiniMax pronunciation rule that pins every character to the syllabus reading,
 * e.g. 大学生 + "da4 xue2 sheng1" → "大学生/(da4)(xue2)(sheng1)".
 * Syllables with ü and the erhua 儿 are left as characters, which the rule format allows
 * ("郑栅洁/(zheng4)(shan1)杰"), because their pinyin spelling is not reliably accepted.
 */
export function pronunciationRule(h, pn) {
  const chars = [...h];
  const syl = pn.split(' ');
  if (syl.length !== chars.length) return null;
  let forced = 0;
  const parts = chars.map((c, i) => {
    const s = syl[i];
    if (s.includes('ü') || s === 'r5' || s.startsWith('r') && c === '儿') return c;
    forced++;
    return `(${s})`;
  });
  return forced ? `${h}/${parts.join('')}` : null;
}

/** The request body for one clip. */
export function requestBody(word, speed, voice = DEFAULT_VOICE) {
  const rule = pronunciationRule(word.h, word.pn);
  return {
    model: MODEL,
    text: `${word.h}。`,
    stream: false,
    language_boost: 'Chinese',
    output_format: 'hex',
    voice_setting: { voice_id: voice, speed, vol: 1, pitch: 0 },
    audio_setting: AUDIO_SETTING,
    ...(rule ? { pronunciation_dict: { tone: [rule] } } : {})
  };
}

/** A clip is regenerated only when its request would change (text, reading, voice, speed, model). */
export function requestHash(body) {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
}

/** Stable, ASCII-only file name for a word's clip. */
export function clipFile(word, kind) {
  const slug = createHash('sha1').update(word.id).digest('hex').slice(0, 10);
  return `${slug}-${kind === 'slow' ? 's' : 'n'}.mp3`;
}

/**
 * Characters read more than one way across the syllabus words (ignoring neutral tone and the
 * 一/不 tone changes), e.g. 长 cháng/zhǎng. Words containing them get a listen in the review list.
 */
export function polyphones(words) {
  const readings = new Map();
  for (const w of words) {
    const chars = [...w.h], syl = w.pn.split(' ');
    chars.forEach((c, i) => {
      const s = syl[i];
      if (!s || s.endsWith('5') || c === '一' || c === '不') return;
      if (!readings.has(c)) readings.set(c, new Set());
      readings.get(c).add(s);
    });
  }
  return new Map([...readings].filter(([, r]) => r.size > 1).map(([c, r]) => [c, [...r].sort()]));
}

/* ---------- sentences ---------- */

/** Characters whose reading depends on the word (了 le/liǎo, 还 hái/huán, 长 cháng/zhǎng …). */
export const MULTI_READING = new Set([...'了还得地的着都觉好长行为少重教空数乐便只种发差看分干当调中相应更要和过给几']);

/**
 * Rules for a sentence: only words containing multi-reading characters are pinned, so the rest
 * keeps its natural connected speech. Words with 一 or 不 are left alone, because their tone
 * changes with the next syllable in a sentence.
 */
export function sentenceRules(sentence, wordsById) {
  const rules = new Set();
  for (const c of sentence.chunks) {
    for (const id of c.words) {
      const w = wordsById.get(id);
      if (!w || /[一不]/.test(w.h)) continue;
      if (![...w.h].some(ch => MULTI_READING.has(ch))) continue;
      const r = pronunciationRule(w.h, w.pn);
      if (r) rules.add(r);
    }
  }
  return [...rules];
}

export function sentenceRequestBody(sentence, wordsById, speed, voice = DEFAULT_VOICE) {
  const rules = sentenceRules(sentence, wordsById);
  return {
    model: MODEL,
    text: sentence.text,
    stream: false,
    language_boost: 'Chinese',
    output_format: 'hex',
    subtitle_enable: true,
    subtitle_type: 'word',
    voice_setting: { voice_id: voice, speed, vol: 1, pitch: 0 },
    audio_setting: AUDIO_SETTING,
    ...(rules.length ? { pronunciation_dict: { tone: rules } } : {})
  };
}

export function sentenceFile(sentence, kind) { return `${sentence.id}-${kind === 'slow' ? 's' : 'n'}.mp3`; }

const TEXT_KEYS = ['text', 'word', 'content', 'token'];
const BEGIN_KEYS = ['time_begin', 'begin_time', 'start_time', 'begin', 'start', 'start_ms', 'begin_ms'];
const END_KEYS = ['time_end', 'end_time', 'end', 'stop', 'end_ms'];
const pick = (o, keys) => { for (const k of keys) if (typeof o[k] === 'number') return o[k]; return undefined; };

/**
 * Pulls timed text pieces out of a subtitle file, whatever its exact nesting: the finest-grained
 * objects that carry text plus a begin and end time.
 */
export function timedPieces(json) {
  const pieces = [];
  const walk = node => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const kids = Object.values(node).filter(v => Array.isArray(v) || (v && typeof v === 'object'));
    const before = pieces.length;
    kids.forEach(walk);
    if (pieces.length > before) return;                 // children were finer, keep them
    const text = TEXT_KEYS.map(k => node[k]).find(v => typeof v === 'string');
    const b = pick(node, BEGIN_KEYS), e = pick(node, END_KEYS);
    if (text !== undefined && b !== undefined && e !== undefined) pieces.push({ text, b, e });
  };
  walk(json);
  // seconds instead of milliseconds: small values with fractions
  if (pieces.length && pieces.every(p => p.e < 120) && pieces.some(p => p.e % 1 !== 0)) pieces.forEach(p => { p.b *= 1000; p.e *= 1000; });
  return pieces;
}

/**
 * Start and end (ms) of each word of the sentence, in reading order. Timed pieces are spread over
 * their characters and matched to the sentence character by character, so it works whether the
 * voice reports characters, its own word splits, or whole phrases. Returns null if it cannot align.
 */
export function wordTimings(json, sentence, wordsById) {
  const pieces = timedPieces(json);
  if (!pieces.length) return null;
  const chars = [...sentence.text];
  const times = chars.map(() => null);
  let cursor = 0;
  for (const p of pieces) {
    const pc = [...p.text].filter(c => /[\u3400-\u9fff]/.test(c));
    pc.forEach((c, i) => {
      const at = chars.indexOf(c, cursor);
      if (at < 0) return;
      const b = p.b + (p.e - p.b) * i / pc.length, e = p.b + (p.e - p.b) * (i + 1) / pc.length;
      times[at] = [b, e];
      cursor = at + 1;
    });
  }
  const out = [];
  let pos = 0;
  for (const c of sentence.chunks) {
    for (const id of c.words) {
      const h = wordsById.get(id)?.h ?? '';
      while (pos < chars.length && !/[\u3400-\u9fff]/.test(chars[pos])) pos++;
      const span = times.slice(pos, pos + [...h].length);
      pos += [...h].length;
      if (span.some(t => !t)) return null;
      out.push([Math.round(span[0][0]), Math.round(span[span.length - 1][1])]);
    }
  }
  return out;
}
