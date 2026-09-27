# Roadmap

Phases are built in order. Each one is either a dependency of a later phase (**Gives**) or a separate module that plugs into what exists (**Needs** only earlier phases, nothing later needs it). Content and human checks run alongside in their own tracks and never block code.

Each phase ends with green CI, a preview deploy, and the checks under "Verify".

```
0 Foundation ─ 1 Content, audio, memory ─ 2 Mode framework ─┬─ 3 Listen ─ 4 Path ┐
                                                            ├─ 4b Writing        │
                                                            ├─ 5 Many bodies ─ 6 Plug
                                                            │        └──────── 7 Review and arcade
                                                            ├─ 8 Speak
                                                            └─ 9 Ship
Content track: path lessons for HSK 1, then 2 (→ 4) · HSK 3 glosses · role tags for Tatoeba sentences (→ 6) · read-throughs
Human checks:  frame rate on real devices · listening review · gloss review
```

## Phase 0: Foundation ✔

Vite, strict TypeScript, three.js, GSAP; modules for engine, render, audio, game, content, ui; progress in IndexedDB with migration from the single-file version; CI with type-check, unit tests, build, Playwright and GitHub Pages; `?fps` meter.
Verified: feature parity with the single-file version, unit tests for content, questions, scheduler, progress and physics, end-to-end play.

## Phase 1: Content, audio and memory ✔

- 2025 HSK syllabus, levels 1–2 (498 words) with hand-written glosses, part of speech and measure words; `scripts/build-content.mjs`, checked in CI
- FSRS (ts-fsrs), one card per word; progress v2 with migration; home screen with level choice; words panel with mastery and due times
- MiniMax voice clips for every word and example sentence at two speeds, with pinned readings and word timestamps; browser speech fallback
- 467 Tatoeba sentences and 55 role-tagged hand-written sentences; example sentence on the fortune slip

Verified: levels against an independent extraction, unambiguous quiz options, FSRS intervals, scheduler order, generator against a mock server, pronunciation rules, manifest integrity.
Open items moved to the tracks below.

## Phase 2: Mode framework ✔

Today `src/game/game.ts` is one closure holding the stage, the bubble, the quiz, the slip, the drawer and the home screen, and memory is one card per word. Every later mode needs these apart, and needs its reviews kept apart from the Words reviews.

**Gives:** every later phase.

- [x] Memory by skill: a card per (skill, item), so Words, tones, listening, speaking, writing and sentences each have their own schedule; the scheduler works on any item with an id and a level
- [x] Progress v3: cards per skill, plus a compact review log (item, skill, grade, time) for per-tone accuracy (3), the streak calendar (7) and return rates (9); v2 migrates automatically into the `words` skill
- [x] `src/stage/`: renderer, camera and sizing, palettes, backdrop, frame loop, screen shake, performance guard
- [x] `src/bubble/`: the layered soft body, dragging and pulling to an edge, popping a film and the core. It knows nothing about words: it reports "pulled to this edge" and is told to pop or refuse
- [x] `src/ui/`: answer chips, HUD, fortune slip with example sentence, words drawer, home screen
- [x] `src/modes/`: a mode interface, with Words as the first mode; the home screen builds its mode bubbles from a registry

**Verify**
- [x] Every existing end-to-end test passes unchanged; no visible difference in play
- [x] Unit tests: v2 → v3 migration keeps every card and the best streak; two skills schedule independently; the review log round-trips through storage
- [x] `game.ts` only wires modules together

## Phase 3: Listen ✔

The first new mode, and the cheapest: it reuses the single bubble and its four edges, with a sound as the prompt.

**Needs:** 2. **Gives:** audio prompts (used by 4 and 8), typed answers, the `tone` and `listen` skills.

- [x] Audio as a prompt: the word plays as each layer comes up, tapping the bubble plays it again, a wrong answer replays it slowly
- [x] The next word is chosen while the slip is up and its clip decoded ahead, so it starts at once
- [x] Tone layer: hear the word, pick the pinyin with the right tones; one-syllable words offer all four tones. Built from the existing word clips, so no syllable recordings are needed. The third-tone change (nǐhǎo said níhǎo) is never offered as a wrong answer
- [x] Listen and pick: the meaning layer, never offering a word that sounds the same (tā: he, she, it)
- [x] Minimal pairs: the characters layer offers words that differ only in tone, then by one syllable
- [x] Pinyin dictation: once a word's listening has graduated, its core asks you to type the pinyin (tone numbers or marks); `?dictation` turns it on for every word
- [x] Per-tone accuracy from the review log, shown in the words panel; new Listen words with your weakest tone come first
- [x] Listen draws words you have met in Words first
- [x] Nothing comes in a set order: layers are shuffled in every bubble, the right answer never sits on the same edge twice running, and due words are drawn at random from the most overdue
- [x] "Ask about" on the home screen: any mix of meaning, pinyin and characters, for Words and Listen

**Verify**
- [x] Every HSK 1–2 word's Listen bubble can be answered by ear alone: four distinct options per layer, no homophones, no sandhi traps (unit tests)
- [x] Every HSK 1–2 word typed with tone numbers is accepted by dictation
- [x] Audio starts within 150 ms of being asked for, once primed (end-to-end, measured on the second bubble)
- [x] Wrong answers replay slowly; tone and listen items schedule separately from Words

## Phase 4: Path

A course alongside the general model, in the spirit of HelloChinese: units follow the HSK topic outline, and each lesson teaches a handful of words in context. The path feeds Today: words met in a lesson join the reviews; without the path, Today still introduces words in HSK order.

**Needs:** 2, 3 (audio prompts). **Gives:** the first meeting of new words, words in context; later upgraded by Plug (7).

- [x] Course file `data/content/path-hsk1.txt`: units → lessons → new words, a short dialogue, sentences to build; the build fails if a lesson uses a word not yet taught, teaches one twice, or never uses a word it teaches
- [x] Lessons of 10 new words (the build allows 8–12): a dialogue that reuses earlier words, four sentences to build. For scale: HSK Standard Course 1 has ~10 new words a lesson, Integrated Chinese ~25–30 a (1–2 week) lesson, Duolingo 1–2 a few-minute lesson
- [x] A culture note per unit
- [x] HSK 1 path complete in draft: 15 units, 30 lessons, all 300 words, each unit with a culture note
- [x] The path screen: units and lessons, locked, open and done, in both styles; units still to be written are listed
- [x] The lesson player: the unit's culture note (first lesson) → meet each word (sound, meaning, where it comes up) → pop (a bubble per word, each a review) → in context (the dialogue, tap a word, ▶ a line; two questions) → build (put four sentences in order) → checkpoint (one bubble, a layer for each of six words) → done. Grammar particles are met and used, not drilled
- [x] A "write" side lesson on each finished lesson (and from the lesson-complete card): stroke order for its new characters
- [x] Today takes its new words in path order (the next lesson's first), then the rest of the level
- [ ] Dialogue audio with the MiniMax generator
- [ ] The HSK 2 path (200 more words)

**Verify:** every lesson only uses taught words (build check); a lesson can be finished by keyboard; words finished in a lesson show up in Today's reviews; the path's order survives a reload.

## Phase 4b: Writing

**Needs:** 2. Separate module; the path's side lessons use it. (Its "first meeting" moved to the path.)

Hanzi Writer (MIT) animates stroke order and checks tracing, loading stroke data from the app's own `public/strokes/` rather than a CDN.

- [x] Licences confirmed: Hanzi Writer is MIT; hanzi-writer-data is under the Arphic Public License (redistribute unaltered with ARPHICPL.TXT; the app's own code is not affected, §2 "mere aggregation")
- [x] Stroke data pipeline: `npm run strokes` copies the 371 characters of HSK 1–2 verbatim into `public/strokes/` with the licence and a notice; CI checks they match; git keeps them byte for byte
- [x] Watch the stroke order in a practice grid (米字格), then trace it; each character a review in the `write` skill, graded by mistakes
- [ ] Writing reviews in Today (the `write` skill is recorded but not yet scheduled)
- [ ] Tracing on the bubble itself, not only in the lesson card
- [ ] Radical split: the parts of a character and what they hint at (Make Me a Hanzi's decomposition data is under a different licence, LGPL; check before using it)

**Verify:** tracing judged correctly across every HSK 1 character (checked in the end-to-end test for the first character of lesson 1 so far); new words enter review at the right intervals.

## Phase R: Revamp (one world, glass on top)

The app as one continuous place: the 3D scene always behind, every screen a glass panel over it, one motion language. Decided: four tabs (Path with Today on top, Practice, Read, You); stories written to a spec (by people or models) and checked by the build, plus CC BY stories from StoryWeaver filtered to each level.

**Needs:** 2–4. **Gives:** the shell every later mode lives in.

- [x] R1 Shell: floating glass tab bar (路 Path · 练 Practice · 读 Read · 我 You) with a sliding droplet; Today and the path together in Path; tiles with the task's character in Practice (字 听 写 句), Write opening stroke practice; the word of the day in Read; stats, your words and every setting in You (the ☰ menu and the drawer are gone); a task returns to the tab it was entered from; entering zooms and fills from the tapped orb
- [ ] R2 Motion: entering a task zooms and fills from its button, and the bubble inflates from there; press and tab micro-animations; the fortune slip unfolds as a glass card from the popped core; a compact result chip inside lessons
- [ ] R3 Read: story format and build checks (`docs/STORIES.md`, `npm run story-prompt`); the reader: pinyin over characters with an opacity slider, tap a word for its meaning above it, long-press for the sentence's translation (split at 。？！), play a sentence or the story; stories unlock with path units; a StoryWeaver importer (CC BY 4.0, level-filtered, credited); then one MiniMax run records dialogues and stories
- [ ] R4 Glass: liquid-glass materials (backdrop blur, specular edge, inner glow, refraction on large panels where supported), a rice-paper version for the ink style, a phone budget of two stacked glass layers with automatic fallback

**Verify:** every existing flow reachable from the tabs; layout tests on all sizes; frame rate holds on a phone with glass on; stories pass the level check.

## Phase 5: Many bodies

Engine work only, no new mode. The bubble is one sphere today; Plug needs several shaped bodies on screen that touch, and the arcade needs many bubbles at once.

**Needs:** 2. **Gives:** 6, and the arcade half of 7.

- [ ] Several soft bodies at once, each with its own centre, sharing one loop and one detail level
- [ ] Rest shapes besides the sphere: circle, hexagon, pill, triangle, square, diamond, droplet
- [ ] Contact between bodies, and sockets (a shaped hollow a body can settle into)
- [ ] Performance guard across all bodies

**Verify:** every shape stays stable at every detail level (unit tests, like the sphere's); eight bodies hold the frame-rate budget.

## Phase 6: Plug (sentence mode)

Word pieces are soft bodies moulded to their grammatical role and plug into matching sockets:
subject = blue circle, time = amber hexagon, place = teal pill, verb = red triangle, object = green square, adverb = purple diamond, particle = grey droplet.
Scaffolding fades from shape and colour, to shape only, to neither. Progression: SV → SVO → S+T+VO → S+T+P+V+O → adverbs → 不/没 → 吗/呢 → measure words → 了/过 → 把/被.

**Needs:** 5, role-tagged sentences (content track). **Gives:** the `sentence` skill.

- [x] Sentence schema: role-tagged chunks, other valid orders, level from its words; 55 HSK 1–2 sentences to start
- [x] 467 real example sentences from Tatoeba, every word in HSK 1–2
- [ ] Fit logic: which piece fits which socket, every valid order accepted
- [ ] The Plug mode on the framework, with scaffolding levels
- [ ] Progression through the grammar points above, scheduled by the `sentence` skill

**Verify:** every valid order is accepted; fit-logic unit tests; 20-sentence playtest per level; solvable by shape alone and by keyboard.

## Phase 7: Review and arcade

**Needs:** 2 for the boss bubble, the fortune jar and the streak calendar; 5 for rising bubbles and pairs.

- [ ] Boss bubble: one layer per due item, across skills
- [ ] Fortune jar: the slips you have collected
- [ ] Streak calendar from the review log
- [ ] Rising bubbles and pairs (arcade)

**Verify:** the boss bubble matches the scheduler's due list; arcade speed is fair on low-end devices.

## Phase 8: Speak

**Needs:** 2 and 3's audio prompts. Separate module.

- [ ] Say it to pop it (browser speech recognition), the `speak` skill
- [ ] A fallback where recognition is unavailable; speaking never blocks progress

**Verify:** accuracy on a fixed set of recordings; never blocks progress.

## Phase 9: Ship

**Needs:** 2 (a stable progress format). Separate module.

- [ ] Installable offline app, with the voice clips cached
- [ ] Optional accounts and sync
- [ ] Store builds via Capacitor

**Verify:** accessibility audit, airplane-mode play, ten-person beta, 7-day return rate.

## Design track

Separate modules that change how things look and fit, not how they play.

- [x] Layout from measurement, not device detection: after the answers are placed, the bubble is sized and placed in the space they and the panels leave, and re-fitted when anything changes size (late fonts, wrapping, rotation). Checked on seven screen sizes in `tests/e2e/layout.spec.ts`
- [x] Style choice on the home screen: soap bubbles, or ink and lanterns (paper wall with grain, brush calligraphy, paper-tag answers with a red seal, a ribbed silk lantern in paper shades with gold caps and a tassel, lanterns on the home screen)
- [x] Home screen: title bar (☰, centred name, day streak), fortune of the day, a Today bubble with what is left today, a words strip with a word of the day, and a carousel of modes with progress; every setting in the ☰ menu, on home and in play
- [x] Today: due reviews first across Words and Listen (the longest waiting), then new words up to a daily limit (menu: 5, 10, 15 or 20), then done
- [x] Word of the day from the level above the app's (HSK 3 syllabus, CC-CEDICT meanings), same all day; one function to swap for a fetched source
- [ ] Word of the day from an outside source (fetched), with audio
- [ ] More styles only if asked; each is a palette set, materials, fonts and CSS in `src/theme/`

## Content track

- [ ] Glosses for HSK 3 (500 words) and their voice clips, then the level is switched on
- [ ] Role tags for Tatoeba sentences, so Plug can use them (needed by 6)
- [ ] Read through the Tatoeba sentences once and list any to drop in `data/content/tatoeba-exclude.tsv`

## Human checks

- [ ] Frame rate on real devices with `?fps`: 60 fps on a mid-range laptop, 45 fps or more on a mid-range Android phone
- [ ] Listen through `data/audio-review.md` (words with multi-reading characters)
- [ ] Review of the glosses by a second Chinese speaker
- [ ] Review of the path dialogues by a Chinese speaker (natural, polite enough, right for the level)
- [ ] Check the path's topic outline against the official 2025 HSK syllabus (it comes from a secondary source)
- [ ] Play Listen on a phone with sound: the voice starts promptly and is not drowned by the inflating sound
