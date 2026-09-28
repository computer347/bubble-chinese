import { describe, it, expect } from 'vitest';
import { writableChars, stageOf, gradeOf } from '../../src/modes/write';
import { WORDS } from '../../src/content/words';
import { newCard, review, Rating, State, type Card } from '../../src/game/memory';

const now = new Date('2026-09-28T10:00:00Z');
const w = (h: string) => WORDS.find(x => x.h === h)!;

describe('Write', () => {
  it('practises the characters of met words only, each with its shortest word', () => {
    const met: Record<string, Card> = {};
    for (const h of ['学生', '学', '你好']) met[w(h).id] = newCard(now);
    const items = writableChars([w('学生'), w('学'), w('你好'), w('老师')], met);
    expect(items.map(x => x.id).sort()).toEqual(['你', '好', '学', '生'].sort());
    expect(items.find(x => x.id === '学')!.word.h).toBe('学');   // the shorter word wins
    expect(items.find(x => x.id === '生')!.word.h).toBe('学生');
  });

  it('watches a new character, traces a learning one, writes a known one from memory', () => {
    expect(stageOf(undefined)).toBe('new');
    const learning = review(newCard(now), Rating.Good, now);
    expect(stageOf(learning)).toBe('guided');
    expect(stageOf({ ...learning, state: State.Review })).toBe('memory');
  });

  it('grades clean as Good, a few slips Hard, many slips or a peek Again', () => {
    expect(gradeOf(0, false)).toBe(Rating.Good);
    expect(gradeOf(2, false)).toBe(Rating.Hard);
    expect(gradeOf(4, false)).toBe(Rating.Again);
    expect(gradeOf(0, true)).toBe(Rating.Again);
  });
});
