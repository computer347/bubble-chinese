import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { WORDS } from '../../src/content/words';
import manifest from '../../src/content/generated/audio.json';
import { Voice, type AudioManifest } from '../../src/audio/voice';
import type { Speech } from '../../src/audio/speech';
// @ts-expect-error plain ESM script without types
import { pronunciationRule, requestBody, requestHash, clipFile, polyphones, SPEEDS } from '../../scripts/audio-lib.mjs';

const word = (h: string) => WORDS.find(w => w.h === h)!;

describe('pronunciation rules pin the syllabus reading', () => {
  it('forces every syllable with tone numbers', () => {
    expect(pronunciationRule('大学生', 'da4 xue2 sheng1')).toBe('大学生/(da4)(xue2)(sheng1)');
    expect(pronunciationRule('爸爸', 'ba4 ba5')).toBe('爸爸/(ba4)(ba5)');
  });
  it('keeps the tone changes the syllabus prints (不客气 → bu2)', () => {
    const w = word('不客气');
    expect(pronunciationRule(w.h, w.pn)).toBe('不客气/(bu2)(ke4)(qi5)');
  });
  it('leaves ü syllables and erhua 儿 as characters', () => {
    expect(pronunciationRule('女儿', 'nü3 er2')).toBe('女儿/女(er2)');
    expect(pronunciationRule('一点儿', 'yi4 dian3 r5')).toBe('一点儿/(yi4)(dian3)儿');
    expect(pronunciationRule('绿', 'lü4')).toBeNull();
  });
  it('builds a rule for every word except those made only of ü syllables', () => {
    const missing = WORDS.filter(w => !pronunciationRule(w.h, w.pn)).map(w => w.h);
    expect(missing.every(h => word(h).pn.split(' ').every(s => s.includes('ü') || s === 'r5'))).toBe(true);
  });
});

describe('requests', () => {
  it('ask for the syllabus reading at two speeds, and hash stably', () => {
    const w = word('学生');
    const n = requestBody(w, SPEEDS.normal), s = requestBody(w, SPEEDS.slow);
    expect(n.pronunciation_dict.tone).toEqual(['学生/(xue2)(sheng1)']);
    expect(n.voice_setting.speed).toBeGreaterThan(s.voice_setting.speed);
    expect(requestHash(n)).toBe(requestHash(requestBody(w, SPEEDS.normal)));
    expect(requestHash(n)).not.toBe(requestHash(s));
    expect(clipFile(w, 'normal')).toMatch(/^[0-9a-f]{10}-n\.mp3$/);
  });
});

describe('polyphones', () => {
  it('finds characters read more than one way', () => {
    const p = polyphones(WORDS);
    expect(p.get('长')).toBeUndefined();          // only cháng at HSK 1–2
    expect(p.get('还')).toBeUndefined();
    const all = [...p.keys()];
    for (const c of all) expect(p.get(c)!.length).toBeGreaterThan(1);
  });
});

describe('audio manifest', () => {
  const m = manifest as AudioManifest;
  it('every clip exists and was made for the current pinyin', () => {
    for (const [id, e] of Object.entries(m)) {
      const w = WORDS.find(x => x.id === id);
      expect(w, `manifest has unknown word ${id}`).toBeDefined();
      expect(e.p, `${id} was recorded for an older reading`).toBe(w!.p);
      for (const c of [e.normal, e.slow]) if (c) expect(existsSync(`public/audio/${c.file}`), c.file).toBe(true);
    }
  });
});

describe('Voice', () => {
  const calls: string[] = [];
  const speech = { speak: (t: string, slow?: boolean) => calls.push(`${t}${slow ? ' slow' : ''}`), cancel: () => {} } as unknown as Speech;
  const w = word('学生');
  it('falls back to browser speech when there is no clip', () => {
    const v = new Voice(speech, {});
    expect(v.hasClip(w)).toBe(false);
    v.say(w, true);
    expect(calls.pop()).toBe('学生 slow');
  });
  it('ignores a clip recorded for a different reading', () => {
    const v = new Voice(speech, { [w.id]: { p: 'xuésheng', normal: { file: 'x.mp3', hash: 'h' } } });
    expect(v.hasClip(w)).toBe(false);
  });
  it('uses a clip made for the current reading', () => {
    const v = new Voice(speech, { [w.id]: { p: w.p, normal: { file: 'x.mp3', hash: 'h' } } });
    expect(v.hasClip(w)).toBe(true);
  });
});

describe('Voice with sentences', () => {
  it('falls back to speaking the sentence text, and single-word clips, without recordings', async () => {
    const calls: string[] = [];
    const speech = { speak: (t: string) => calls.push(t), cancel: () => {} } as unknown as Speech;
    const { SENTENCES } = await import('../../src/content/sentences');
    const s = SENTENCES[0];
    const v = new Voice(speech, {}, '/', {});
    await v.saySentence(s);
    expect(calls.pop()).toBe(s.text);
    await v.sayWordIn(s, 0, WORDS.find(w => w.h === '我')!);
    expect(calls.pop()).toBe('我');
  });
});
