import { describe, it, expect } from 'vitest';
import { TOPICS, kindGroups, setLabel, setWords } from '../../src/content/wordsets';
import { QUIZ_WORDS } from '../../src/content/words';

const hsk1 = QUIZ_WORDS.filter(w => w.level === 1);
const ids = (name: string) => TOPICS.find(t => t.title === name)!.words.map(w => w.id);

describe('word sets', () => {
  it('has a topic per path unit with its quizzed words, and kinds of word', () => {
    expect(TOPICS.length).toBe(15);
    for (const t of TOPICS) for (const w of t.words) expect(w.quiz).not.toBe(false);
    const kinds = kindGroups(hsk1);
    expect(kinds.find(k => k.title === 'Numbers')!.words.map(w => w.h)).toContain('三');
    expect(kinds.find(k => k.title === 'Verbs')!.words.map(w => w.h)).toContain('吃');
  });

  it('names a set by its whole groups, or by its size', () => {
    const groups = [...TOPICS, ...kindGroups(hsk1)];
    expect(setLabel(ids('Family'), groups)).toBe('Family');
    expect(setLabel([...ids('Family'), ...ids('Eating')], groups)).toBe('Family + Eating');
    expect(setLabel([...ids('Family'), ...ids('Eating'), ...ids('Shopping')], groups)).toBe('Family + 2 more');
    expect(setLabel(ids('Family').slice(0, 5), groups)).toBe('5 words');
  });

  it('turns saved ids back into words, skipping any that no longer exist', () => {
    expect(setWords([ids('Family')[0], 'gone|gone']).length).toBe(1);
  });
});
