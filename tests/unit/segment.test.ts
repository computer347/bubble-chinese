import { describe, it, expect } from 'vitest';
import { WORDS, type Word } from '../../src/content/words';
// @ts-expect-error plain ESM script without types
import { segment, contextPinyin, readingProblem, compoundProblem, boundWords, parseCedict } from '../../scripts/segment.mjs';

const vocab = new Map<string, Word>();
for (const w of WORDS) if (!vocab.has(w.h) || w.quiz !== false) vocab.set(w.h, w);
const seg = (s: string) => segment(s, vocab) as string[] | null;

describe('segment', () => {
  it('splits into the fewest syllabus words', () => {
    expect(seg('我是大学生。')).toEqual(['我', '是', '大学生', '。']);
    expect(seg('你叫什么名字？')).toEqual(['你', '叫', '什么', '名字', '？']);
  });
  it('rejects sentences with words outside the list', () => {
    expect(seg('我喜欢熊猫。')).toBeNull();
  });
});

describe('contextPinyin', () => {
  const py = (s: string) => contextPinyin(seg(s), vocab).filter((p: string) => !/[。？！，]/.test(p)).join(' ');
  it('shows the tone changes of 不 and 一 as they are said', () => {
    expect(py('我不是学生。')).toBe('wǒ bú shì xuéshēng');
    expect(py('我不喝茶。')).toBe('wǒ bù hē chá');
    expect(py('我有一个孩子。')).toBe('wǒ yǒu yí gè háizi');
    expect(py('他有一只猫。')).toBe('tā yǒu yì zhī māo');
  });
});

describe('readingProblem', () => {
  const p = (s: string) => readingProblem(seg(s));
  it('skips characters read differently from their syllabus entry', () => {
    expect(p('我只有一个。')).toMatch(/zhǐ/);         // 只 "only", not the measure word
    expect(p('我得走了。')).toMatch(/děi/);
    expect(p('他有一只猫。')).toBeNull();
    expect(p('我觉得很好。')).toBeNull();
  });
});

describe('compoundProblem', () => {
  const cedict = parseCedict([
    '日本 日本 [Ri4 ben3] /Japan/',
    '十分 十分 [shi2 fen1] /very/completely/',
    '星期一 星期一 [Xing1 qi1 yi1] /Monday/',
    '不是 不是 [bu4 shi5] /fault/blame/',
    '家长 家长 [jia1 zhang3] /head of a household/parent/',
    '到了 到了 [dao4 liao3] /at last/finally/'
  ].join('\n'));
  const c = (s: string) => compoundProblem(seg(s), cedict, vocab);
  it('catches names and compounds that are not the sum of their parts', () => {
    expect(c('我去日本。')).toMatch(/name/);
    expect(c('我十分高兴。')).toMatch(/one word/);
  });
  it('catches compounds read differently from their parts', () => {
    expect(c('我家长很忙。')).toMatch(/jia1 zhang3/);
  });
  it('lets through weekdays, everyday compounds and particles in idioms', () => {
    expect(c('星期一我不去。')).toBeNull();
    expect(c('我不是学生。')).toBeNull();
    expect(c('我到了。')).toBeNull();
  });
});

describe('boundWords', () => {
  const cedict = parseCedict(['后天 后天 [hou4 tian1] /day after tomorrow/', '回家 回家 [hui2 jia1] /to return home/'].join('\n'));
  it('marks words that are part of a larger dictionary word', () => {
    expect(boundWords(seg('你后天有时间吗？'), cedict, vocab).sort()).toEqual(['后', '天'].sort());
    expect(boundWords(seg('我想回家。'), cedict, vocab).sort()).toEqual(['回', '家'].sort());
    expect(boundWords(seg('我是学生。'), cedict, vocab)).toEqual([]);
  });
});
