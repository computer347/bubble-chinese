# Stories for the Read tab

Short graded stories, one set per HSK level. Each story may only use words at or below its level
(plus names), so a learner can read all of it. The build checks this, so a story written by a
person or by a model is equally welcome: if it breaks a rule, the build says which word and where.

## Getting a story from a model

```bash
npm run story-prompt -- 1 family      # HSK 1, tied to the path's "family" unit
npm run story-prompt -- 1             # HSK 1, any topic
```

This prints a prompt with the rules below and the full list of allowed words. Paste it into any
capable model (Qwen, DeepSeek, Kimi, GLM, Claude…), then save the reply as
`data/content/stories/<level>-<id>.txt` and run `npm run build:content`. Fix whatever it reports,
or ask the model to replace the words it names.

## What a story is

- **150–300 characters**, in **8–20 sentences**, split into short paragraphs.
- **Only words from the list** for its level (the syllabus words, not characters: 电脑 is fine at
  HSK 1 because it is a word there; 电灯 is not). Numbers written as characters (十八, not 18).
- **Names** that are not HSK words are written `{characters=pinyin}`, like `{王丽=Wáng Lì}`.
  Keep to two or three names a story.
- **Short sentences** (at most about 20 characters), ending in 。？！ Only 。？！， as punctuation.
- **Plain, natural Chinese** a native speaker would write for a learner: no idioms (成语), no
  literary style, no slang. Everyday situations with a small turn or a gentle joke at the end.
- **An English line for every sentence**: a natural translation, not word for word.
- Tied to a path unit when asked (family, food, shopping…), reusing that unit's words often.

## The file format

```
story family-cat | The cat who wanted dinner | 想吃饭的猫 | 1 | family
by Qwen 3, reviewed by <name> | CC0

我家有一只猫。 | We have a cat.
它叫{大黑=Dà Hēi}。 | It's called Dahei.

晚上七点，大黑很想吃饭。 | At seven in the evening, Dahei really wants dinner.
…
```

- Line 1: `story <id> | <English title> | <Chinese title> | <level> | <path unit id, or ->`
- Line 2: `by <who wrote it> | <licence>`. For stories made for this project, CC0 or CC BY 4.0.
- Then one sentence per line, `Chinese | English`. A blank line starts a new paragraph.
- The Chinese needs no spaces between words: the build splits it into syllabus words, and reports
  anything it cannot.

## Stories from StoryWeaver

StoryWeaver (Pratham Books) publishes children's books under CC BY 4.0, 182 of them in Simplified
Chinese. They are not graded to HSK, so an importer keeps only those whose words are (nearly) all
within a level, and credits each book's authors, illustrators and translators as CC BY requires.
