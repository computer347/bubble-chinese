import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript build script
import { build, buildStories } from '../../scripts/build-content.mjs';
import path from '../../src/content/generated/path.json';
import stories from '../../src/content/generated/stories.json';
import { WORDS } from '../../src/content/words';

const { words } = build();
const head = 'story s | A story | 故事 | 1 | family\nby Test | CC0\n\n';
/** A story's body, padded with a harmless sentence to the minimum length. */
const pad = '我是学生，你也是学生。 | I am a student, and so are you.\n'.repeat(13);

/** Builds stories from files written into a fresh fixture folder. */
function storiesFrom(name: string, files: Record<string, string>) {
  const dir = `tests/unit/fixtures/stories-${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  return buildStories(words, path, dir).stories;
}

describe('the story files', () => {
  it('splits sentences into words with pinyin in context, keeping names and paragraphs', () => {
    const [s] = storiesFrom('ok', { 'a.txt': `${head}我叫{大卫=Dàwèi}。 | I'm David.\n\n我不是老师。 | I'm not a teacher.\n${pad}` });
    expect(s.paras.length).toBe(2);
    const first = s.paras[0][0];
    expect(first.text).toBe('我叫大卫。');
    expect(first.tokens[2]).toEqual({ name: '大卫', py: 'Dàwèi' });
    expect(s.paras[1][0].tokens.map((t: { py?: string; p?: string }) => t.py ?? t.p)).toEqual(['wǒ', 'bú', 'shì', 'lǎoshī', '。']);
    expect(first.id).toMatch(/^r[0-9a-f]{8}$/);
  });

  it('names the word it cannot read at the level', () => {
    expect(() => storiesFrom('above', { 'a.txt': `${head}我们一起去。 | Let's go together.\n${pad}` })).toThrow(/一起/);
    expect(() => storiesFrom('digit', { 'a.txt': `${head}我18岁。 | I'm 18.\n${pad}` })).toThrow(/"1" is not allowed/);
    expect(() => storiesFrom('only', { 'a.txt': `${head}我只有一个。 | I only have one.\n${pad}` })).toThrow(/zhǐ/);
  });

  it('lets a space force a split, and a colon mark speech', () => {
    const [s] = storiesFrom('split', { 'a.txt': `${head}它不 要米饭。 | It doesn't want rice.\n妈妈说：好。 | Mum says: "OK."\n${pad}` });
    const ids = s.paras[0][0].tokens.map((t: { id?: string }) => t.id?.split('|')[0]);
    expect(ids).toContain('不');
    expect(ids).toContain('要');
    expect(s.paras[0][1].tokens.some((t: { p?: string }) => t.p === '：')).toBe(true);
  });

  it('checks the header, the licence and the length', () => {
    expect(() => storiesFrom('lic', { 'a.txt': head.replace('CC0', 'all rights reserved') + pad })).toThrow(/licence/);
    expect(() => storiesFrom('unit', { 'a.txt': head.replace('family', 'nowhere') + pad })).toThrow(/not a path unit/);
    expect(() => storiesFrom('short', { 'a.txt': `${head}我是学生。 | I'm a student.\n`.repeat(1) + '你好！ | Hi!\n'.repeat(4) })).toThrow(/characters; a story has/);
    expect(() => storiesFrom('noen', { 'a.txt': `${head}我是学生。\n${pad}` })).toThrow(/Chinese \| English/);
  });

  it('opens a story after the lesson that teaches its last word', () => {
    const [s] = storiesFrom('after', { 'a.txt': `${head}我有一只猫。 | I have a cat.\n${pad}` });
    expect(s.after).toBe('family-2');     // 猫 and 只 are taught there
  });
});

describe('the stories', () => {
  it('only use words at their level, each with an English line', () => {
    const byId = new Map(WORDS.map(w => [w.id, w]));
    expect(stories.length).toBeGreaterThan(0);
    for (const s of stories) for (const p of s.paras) for (const line of p) {
      expect(line.en).not.toBe('');
      for (const t of line.tokens) if ('id' in t && t.id) expect(byId.get(t.id)!.level).toBeLessThanOrEqual(s.level);
    }
  });
});
