# Roadmap

Each phase ends with a preview deploy, green CI, and the checks listed under "Verify".

## Phase 0: Foundation

- [x] Repo with Vite, TypeScript (strict), current three.js and GSAP
- [x] Split into modules: engine, render, audio, game, content, ui
- [x] Progress in IndexedDB, with migration from the single-file version's localStorage
- [x] CI: type-check, unit tests, build, Playwright, deploy to GitHub Pages
- [x] `?fps` meter for on-device performance checks

**Verify**
- [x] Feature parity with the single-file version (layers, forgot, drag-to-pop, slip, words panel, slow voice)
- [x] Unit tests: content validation, question generation, tone distractors, forgot queue, scheduler, progress, physics stability at every detail level
- [x] End-to-end tests: render, full bubble to fortune slip, wrong answer, forgot, drag-to-pop, words panel
- [ ] Performance budget on real devices with `?fps`: 60 fps on a mid-range laptop, 45 fps or more on a mid-range Android phone

## Phase 1: Content, audio and memory engine

- Content schema: words with HSK level, pinyin, meanings, measure word, example sentences; sentences with a role tag per word and every valid word order
- Sources: HSK 3.0 lists, CC-CEDICT, Tatoeba (check each licence)
- Pre-generated neural voice clips at normal and slow speed, replacing browser speech
- FSRS spaced repetition shared by all modes
- Home screen: each mode is a bubble you pop to enter

**Verify:** content validation script (tone marks, duplicates, role tags); flagged human review for polyphones like 了, 长 and 行; scheduler tests on simulated study histories.

## Phase 2: Plug (sentence mode)

Word pieces are soft bodies moulded to their grammatical role and plug into matching sockets:
subject = blue circle, time = amber hexagon, place = teal pill, verb = red triangle, object = green square, adverb = purple diamond, particle = grey droplet.
Scaffolding fades from shape and colour, to shape only, to neither. Progression: SV → SVO → S+T+VO → S+T+P+V+O → adverbs → 不/没 → 吗/呢 → measure words → 了/过 → 把/被.

**Verify:** every valid order is accepted; fit-logic unit tests; 20-sentence playtest per level; solvable by shape alone and by keyboard.

## Phase 3: Listening

Tone mode (four edges = four tones), listen and pick, minimal pairs, pinyin dictation.

**Verify:** audio starts within 150 ms; wrong answers replay slowly; per-tone accuracy feeds the scheduler.

## Phase 4: Learning mode

Calm first meeting with new words; stroke-order tracing on the bubble (Make Me a Hanzi data, check the licence); radical split.

**Verify:** tracing judged correctly across HSK 1; new words enter review at the right intervals.

## Phase 5: Speaking

Say it to pop it (browser speech recognition), with a fallback where recognition is unavailable.

**Verify:** accuracy on a fixed set of recordings; never blocks progress.

## Phase 6: Review and arcade

Boss bubble (one layer per due word), rising bubbles, pairs, fortune jar, streak calendar.

**Verify:** boss bubble matches the scheduler's due list; arcade speed fair on low-end devices.

## Phase 7: Ship

Installable offline app, optional accounts and sync, store builds via Capacitor.

**Verify:** accessibility audit, airplane-mode play, ten-person beta, 7-day return rate.
