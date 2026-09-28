import { QUIZ_WORDS, type Word } from './words';
import { PATH } from './path';

/** A group of words to practise: a path topic, or a kind of word. */
export interface WordGroup { id: string; title: string; zh: string; words: Word[] }

const byId = new Map(QUIZ_WORDS.map(w => [w.id, w]));

/** The path's topics, each with the words its lessons teach (the grammar particles are left out: they are not quizzed). */
export const TOPICS: readonly WordGroup[] = PATH.units
  .filter(u => u.lessons.length)
  .map(u => ({ id: `topic:${u.id}`, title: u.title, zh: u.zh, words: u.lessons.flatMap(l => l.words).flatMap(id => byId.get(id) ?? []) }));

/** Kinds of word, from the syllabus's parts of speech; a word can be of more than one. */
const KINDS: readonly { id: string; title: string; zh: string; pos: readonly string[] }[] = [
  { id: 'kind:num', title: 'Numbers', zh: '数字', pos: ['num', 'numMw'] },
  { id: 'kind:mw', title: 'Measure words', zh: '量词', pos: ['mw', 'numMw'] },
  { id: 'kind:n', title: 'Nouns', zh: '名词', pos: ['n'] },
  { id: 'kind:v', title: 'Verbs', zh: '动词', pos: ['v'] },
  { id: 'kind:adj', title: 'Adjectives', zh: '形容词', pos: ['adj'] },
  { id: 'kind:adv', title: 'Adverbs', zh: '副词', pos: ['adv'] },
  { id: 'kind:pron', title: 'Pronouns', zh: '代词', pos: ['pron'] },
  { id: 'kind:link', title: 'Linking words', zh: '连词和介词', pos: ['conj', 'prep'] }
];

/** The kinds of word among the words of the chosen levels (kinds with none are left out). */
export function kindGroups(pool: readonly Word[]): WordGroup[] {
  return KINDS.map(k => ({ id: k.id, title: k.title, zh: k.zh, words: pool.filter(w => w.pos.some(p => k.pos.includes(p))) })).filter(g => g.words.length);
}

/** The words a saved set holds, among those that can be quizzed. */
export const setWords = (ids: readonly string[]): Word[] => ids.flatMap(id => byId.get(id) ?? []);

/**
 * A short name for a set: the groups it is made of when it is exactly some whole groups
 * ("Family + Eating", "Verbs"), otherwise its size ("24 words").
 */
export function setLabel(ids: readonly string[], groups: readonly WordGroup[]): string {
  const chosen = new Set(ids);
  const whole = groups.filter(g => g.words.length && g.words.every(w => chosen.has(w.id)));
  const covered = new Set(whole.flatMap(g => g.words.map(w => w.id)));
  if (whole.length && covered.size === chosen.size) {
    // the fewest whole groups that make up the set, so "Family" does not also list a kind inside it
    const needed = whole.filter(g => g.words.some(w => whole.filter(o => o !== g).every(o => !o.words.includes(w))));
    const names = (needed.length ? needed : whole).map(g => g.title);
    return names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more`;
  }
  return `${chosen.size} ${chosen.size === 1 ? 'word' : 'words'}`;
}
