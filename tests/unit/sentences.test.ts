import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { WORDS } from '../../src/content/words';
import { SENTENCES, examplesFor, sentenceWords } from '../../src/content/sentences';
import sentenceManifest from '../../src/content/generated/sentence-audio.json';
// @ts-expect-error plain ESM script without types
import { buildSentences, build, ROLES } from '../../scripts/build-content.mjs';
// @ts-expect-error plain ESM script without types
import { sentenceRules, sentenceRequestBody, wordTimings, timedPieces, SPEEDS } from '../../scripts/audio-lib.mjs';

const byId = new Map(WORDS.map(w => [w.id, w]));

describe('example sentences', () => {
  it('the generated file is up to date with data/content/sentences.tsv', () => {
    const { json } = buildSentences(build().words);
    expect(readFileSync('src/content/generated/sentences.json', 'utf8').replace(/\r\n/g, '\n')).toBe(json);
  });

  it.each(SENTENCES.map(s => [s.text, s]))('%s is well formed', (_t, s) => {
    const ids = sentenceWords(s);
    for (const id of ids) expect(byId.has(id), id).toBe(true);
    // the words spell the sentence, punctuation aside
    expect(ids.map(id => byId.get(id)!.h).join('')).toBe(s.text.replace(/[。？！，]/g, ''));
    expect(s.level).toBe(Math.max(...ids.map(id => byId.get(id)!.level)));
    for (const c of s.chunks) expect(ROLES).toContain(c.role);
    expect(s.pattern).toBe(s.chunks.map(c => c.role).join(' '));
    expect(s.text).toMatch(/[。？！]$/);
    expect(s.en).toMatch(/[.?!]$/);
    for (const a of s.alt ?? []) expect(a.split(' ').sort()).toEqual(s.pattern.split(' ').sort());
  });

  it('most sentences are at HSK 1, so beginners see examples', () => {
    expect(SENTENCES.filter(s => s.level === 1).length).toBeGreaterThan(40);
  });

  it('finds examples for a word within the learner level, shortest first', () => {
    const shi = WORDS.find(w => w.h === '是')!;
    const ex = examplesFor(shi.id, 1);
    expect(ex.length).toBeGreaterThan(3);
    for (const s of ex) expect(s.level).toBeLessThanOrEqual(1);
    for (let i = 1; i < ex.length; i++) expect(ex[i].text.length).toBeGreaterThanOrEqual(ex[i - 1].text.length);
  });
});

describe('sentence audio requests', () => {
  const s = SENTENCES.find(x => x.text === '我的猫在桌子上睡觉。')!;
  it('pin only words with multi-reading characters, and ask for word timings', () => {
    const body = sentenceRequestBody(s, byId, SPEEDS.normal);
    expect(body.pronunciation_dict.tone).toEqual(['的/(de5)', '睡觉/(shui4)(jiao4)']);
    expect(body.subtitle_enable).toBe(true);
    expect(body.subtitle_type).toBe('word');
    expect(body.text).toBe(s.text);
  });
  it('leave 一 and 不 to the voice, since their tone depends on the next syllable', () => {
    const neg = SENTENCES.find(x => x.text === '我不懂。')!;
    expect(sentenceRules(neg, byId)).toEqual([]);
  });
});

describe('word timings from subtitle files', () => {
  const s = SENTENCES.find(x => x.text === '我今天很忙。')!;       // 我 | 今天 | 很 | 忙
  it('work with character-level pieces nested under a sentence (ms)', () => {
    const json = [{ text: s.text, time_begin: 0, time_end: 1500, timestamped_words: [...'我今天很忙'].map((c, i) => ({ word: c, time_begin: i * 300, time_end: i * 300 + 280 })) }];
    expect(wordTimings(json, s, byId)).toEqual([[0, 280], [300, 880], [900, 1180], [1200, 1480]]);
  });
  it('work when the voice splits words differently (phrases spread over their characters)', () => {
    const json = { subtitles: [{ text: '我今天', start: 0, end: 900 }, { text: '很忙。', start: 900, end: 1500 }] };
    expect(wordTimings(json, s, byId)).toEqual([[0, 300], [300, 900], [900, 1200], [1200, 1500]]);
  });
  it('convert seconds to milliseconds', () => {
    const json = [{ word: '我', begin: 0, end: 0.25 }, { word: '今天', begin: 0.25, end: 0.75 }, { word: '很', begin: 0.75, end: 1.0 }, { word: '忙', begin: 1.0, end: 1.4 }];
    expect(timedPieces(json)[0]).toEqual({ text: '我', b: 0, e: 250 });
    expect(wordTimings(json, s, byId)).toEqual([[0, 250], [250, 750], [750, 1000], [1000, 1400]]);
  });
  it('return null when the subtitles do not cover the sentence', () => {
    expect(wordTimings([{ word: '我', time_begin: 0, time_end: 100 }], s, byId)).toBeNull();
    expect(wordTimings({ nothing: true }, s, byId)).toBeNull();
  });
});

describe('sentence audio manifest', () => {
  it('every clip exists, matches its sentence text, and has one timing per word', () => {
    const m = sentenceManifest as Record<string, { text: string; normal?: { file: string; words: unknown[] | null }; slow?: { file: string; words: unknown[] | null } }>;
    for (const [id, e] of Object.entries(m)) {
      const s = SENTENCES.find(x => x.id === id);
      if (!s) continue;                                   // an old sentence that was edited away
      expect(e.text).toBe(s.text);
      for (const c of [e.normal, e.slow]) {
        if (!c) continue;
        expect(existsSync(`public/audio/${c.file}`), c.file).toBe(true);
        if (c.words) expect(c.words.length).toBe(sentenceWords(s).length);
      }
    }
  });
});
