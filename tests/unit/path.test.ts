import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error: a plain JavaScript build script
import { build, buildPath } from '../../scripts/build-content.mjs';
import path from '../../src/content/generated/path.json';

const { words } = build();
const dir = 'tests/unit/fixtures';
/** Builds a path from the given course text, written to a fixture file. */
function pathFrom(name: string, text: string, sizes = [1, 20]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.txt`), text);
  return buildPath(words, `${dir}/${name}.txt`, 1, sizes).path;
}
const unit = 'unit u | Test | 测试 | a topic\nlesson l1 | One\n';

describe('the course file', () => {
  it('builds lessons with words, dialogue and sentences to build', () => {
    const p = pathFrom('ok', `${unit}new 你好 再见\nsay A | 你好 ！ | Hello!\nsay B | 再见 ， {大卫=Dàwèi} ！ | Bye, David!\nbuild 你好/X 。 | Hello.\n`);
    const l = p.units[0].lessons[0];
    expect(l.words).toHaveLength(2);
    expect(l.dialogue[1].text).toBe('再见，大卫！');
    expect(l.dialogue[1].tokens[2]).toEqual({ name: '大卫', py: 'Dàwèi' });
    expect(l.builds[0].text).toBe('你好。');
  });

  it('keeps culture notes with their unit, and lessons to their size', () => {
    const p = pathFrom('notes', `unit u | Test | 测试 | a topic
note First paragraph.
note Second | with a bar.
lesson l1 | One
new 你好
say A | 你好 ！ | Hi
`);
    expect(p.units[0].notes).toEqual(['First paragraph.', 'Second | with a bar.']);
    expect(() => pathFrom('small', `${unit}new 你好
say A | 你好 ！ | Hi
`, [8, 12])).toThrow(/teaches 1 words; a lesson teaches 8–12/);
    expect(() => pathFrom('lateNote', `${unit}new 你好
say A | 你好 ！ | Hi
note Too late.
`)).toThrow(/culture note belongs to a unit, before its lessons/);
  });

  it('refuses a word used before it is taught', () => {
    expect(() => pathFrom('early', `${unit}new 你好\nsay A | 你好 ， 老师 ！ | Hello, teacher!\n`)).toThrow(/"老师" is used before it is taught/);
  });

  it('refuses a word taught twice, one never used, and words that are not HSK 1', () => {
    expect(() => pathFrom('twice', `${unit}new 你好\nsay A | 你好 ！ | Hi\nlesson l2 | Two\nnew 你好\nsay A | 你好 ！ | Hi\n`)).toThrow(/already taught in l1/);
    expect(() => pathFrom('unused', `${unit}new 你好 再见\nsay A | 你好 ！ | Hi\n`)).toThrow(/teaches "再见" but never uses it/);
    expect(() => pathFrom('notHsk', `${unit}new 你好 电冰箱\n`)).toThrow(/"电冰箱" is not an HSK word/);
    expect(() => pathFrom('level', `${unit}new 绿色\n`)).toThrow(/HSK 2, above this path's level 1/);
  });
});

describe('the HSK 1 path', () => {
  const lessons = path.units.flatMap(u => u.lessons);
  it('covers every topic area with a unit, and teaches each word once', () => {
    expect(path.units.length).toBe(15);
    const ids = lessons.flatMap(l => l.words);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('gives every drafted lesson about ten new words, a dialogue and English for every line', () => {
    for (const u of path.units) if (u.lessons.length) expect(u.notes.length, `${u.id} culture note`).toBeGreaterThan(0);
    for (const l of lessons) {
      expect(l.words.length, l.id).toBeGreaterThanOrEqual(8);
      expect(l.words.length, l.id).toBeLessThanOrEqual(12);
      expect(l.dialogue.length, l.id).toBeGreaterThan(1);
      for (const d of l.dialogue) expect(d.en, `${l.id} ${d.text}`).toBeTruthy();
    }
  });
});
