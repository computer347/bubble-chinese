# Content data

`src/content/generated/hsk.json` is built from the files here by `npm run build:content`.
Never edit the generated file by hand; CI fails if it is out of date (`npm run check:content`).

## Sources

| File | What it is | Licence |
|---|---|---|
| `vendor/hsk2025-syllabus.tsv` | Word, level, pinyin and part of speech for levels 1–3 of the 2025 HSK syllabus (新版HSK考试大纲, published Nov 2025 by the Center for Language Education and Cooperation, in force July 2026). Extracted from the official PDF by [Punpuf/hsk-syllabus-vocabulary-parser](https://github.com/Punpuf/hsk-syllabus-vocabulary-parser). | Extraction MIT; the word-to-level mapping is factual data from a published national standard |
| `vendor/hsk2025-syllabus.tsv`, `cedict` column | CC-CEDICT definitions, used only to derive measure words (the `mw` field). | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), © CC-CEDICT contributors, https://cc-cedict.org |
| `vendor/hsk2025-levels-crosscheck.tsv` | An independent extraction of the same syllabus by [harukicoder/hsk30](https://github.com/harukicoder/hsk30), whose per-level counts reproduce the syllabus totals (300 / 500 / 1,000). Used only in tests to cross-check every level. | MIT |
| `content/glosses-hsk1-2.tsv` | Short English glosses, written for this project. | Same as this repository |

## Example sentences

`content/sentences.tsv` holds hand-written sentences, one per line: the sentence split into role-tagged chunks, a tab, the English, and optionally other valid chunk orders.

```
我/S 明天/T 去/V 学校/O 。	I'm going to school tomorrow.	T S V O
我+的+猫/S 在+桌子+上/P 睡觉/V 。	My cat is sleeping on the table.
```

- Roles: S subject, T time, P place, A adverb or helping verb, V verb or predicate, O object, X particle. These are the pieces and colours of Plug mode.
- Words inside a chunk are joined with `+`; every word must be in the HSK word list, and a sentence's level is the highest level of its words.
- The build fails on unknown words or roles, duplicates, or other orders that don't use the same roles.

## How words are built

- Sense numbers are dropped (`点1`, `点2` → `点`), and a word listed at two levels keeps the lower one.
- Alternate readings keep the first (`shéi/shuí` → `shéi`). Pinyin is kept exactly as the syllabus prints it, including tone-sandhi marks such as `búkèqi`.
- Particles and affixes (`了`, `吗`, `们`, …) are marked `quiz: false`. They are taught in sentences (Plug mode) instead of "what does it mean?".
- Words that share a gloss are treated as synonyms and are never offered against each other; the same goes for glosses that share a part (`time` vs `time; moment`).

## Adding a level

1. Write `content/glosses-hsk3.tsv` (one line per word: characters, a tab, the gloss).
2. Add `3` to `LEVELS` and the file to `GLOSS_FILES` in `scripts/build-content.mjs`.
3. Run `npm run build:content` and `npm test`. The tests check every word's level against the cross-check file, that every quiz question has four unambiguous options, and that glosses fit a chip.
