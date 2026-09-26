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
