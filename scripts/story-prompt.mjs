#!/usr/bin/env node
// Prints a prompt for writing a graded story with any model: the rules from docs/STORIES.md and
// every word allowed at the level.
//   npm run story-prompt -- <level> [path unit id]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [levelArg = '1', unitId] = process.argv.slice(2);
const level = Number(levelArg);
const words = JSON.parse(readFileSync(join(root, 'src/content/generated/hsk.json'), 'utf8')).filter(w => w.level <= level);
const path = JSON.parse(readFileSync(join(root, 'src/content/generated/path.json'), 'utf8'));
const unit = unitId ? path.units.find(u => u.id === unitId) : null;
if (unitId && !unit) {
  console.error(`No path unit "${unitId}". Units: ${path.units.map(u => u.id).join(', ')}`);
  process.exit(1);
}
const byId = new Map(words.map(w => [w.id, w]));
const unitWords = unit ? unit.lessons.flatMap(l => l.words).map(id => byId.get(id)).filter(Boolean) : [];

console.log(`Write a short story in Simplified Chinese for learners at HSK level ${level} (2025 syllabus).

Rules:
1. Use ONLY words from the word list below. Check every word. Numbers are written in characters (十八, not 18).
2. Names that are not in the list are written {characters=pinyin}, like {王丽=Wáng Lì}. Use two or three names at most.
3. 150–300 Chinese characters in total, 8–20 sentences, in short paragraphs.
4. Short sentences (about 20 characters at most), each ending in 。 or ？ or ！. Use only 。？！， as punctuation.
5. Plain, natural Chinese a native speaker would write for a learner: no idioms, no literary style, no slang. An everyday situation with a small turn or a gentle joke at the end.
6. Give a natural English translation for every sentence.${unit ? `
7. The story belongs to the unit "${unit.title}" (${unit.topic}). Use these words often: ${unitWords.map(w => w.h).join(' ')}` : ''}

Reply with exactly this format and nothing else:

story <short-id-in-english> | <English title> | <Chinese title> | ${level} | ${unit ? unit.id : '-'}
by <your model name> | CC0

<Chinese sentence> | <English sentence>
<Chinese sentence> | <English sentence>

<Chinese sentence> | <English sentence>
(a blank line starts a new paragraph)

Word list (${words.length} words, with pinyin and meaning):
${words.map(w => `${w.h} ${w.p} ${w.e}`).join('\n')}
`);
