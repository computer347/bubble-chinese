import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORDS } from '../../src/content/words';
// @ts-expect-error plain ESM script without types
import { build } from '../../scripts/build-content.mjs';

// The app follows the 2025 HSK syllabus (新版HSK考试大纲), in force since July 2026:
// 300 words at level 1, 500 cumulative at level 2, 1,000 at level 3.
const crosscheck = new Map<string, number>();
for (const line of readFileSync('data/vendor/hsk2025-levels-crosscheck.tsv', 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || line.startsWith('word\t')) continue;
  const [w, l] = line.split('\t');
  const h = w.replace(/\d/g, '');
  crosscheck.set(h, Math.min(Number(l), crosscheck.get(h) ?? 99));
}

describe('HSK 2025 syllabus', () => {
  it('has exactly the 300 distinct level-1 words', () => {
    const l1 = new Set(WORDS.filter(w => w.level === 1).map(w => w.h));
    expect(l1.size).toBe(300);
    const expected = [...crosscheck].filter(([, l]) => l === 1).map(([h]) => h);
    expect(expected.length).toBe(300);
    expect([...l1].sort()).toEqual(expected.sort());
  });

  it('every word matches the level in an independent extraction of the same syllabus', () => {
    const wrong = WORDS.filter(w => crosscheck.get(w.h) !== w.level).map(w => `${w.h}: ${w.level} vs ${crosscheck.get(w.h)}`);
    expect(wrong).toEqual([]);
  });

  it('includes every level-2 word of the syllabus', () => {
    const have = new Set(WORDS.map(w => w.h));
    const missing = [...crosscheck].filter(([h, l]) => l === 2 && !have.has(h)).map(([h]) => h);
    expect(missing).toEqual([]);
  });

  it('the generated file is up to date with its sources', () => {
    const { json } = build();
    expect(readFileSync('src/content/generated/hsk.json', 'utf8').replace(/\r\n/g, '\n')).toBe(json);
  });
});
