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

- [x] Word bank follows the 2025 HSK syllabus (in force July 2026); levels 1–2 (498 words) with hand-written glosses, part of speech and measure words
- [x] Content pipeline: `scripts/build-content.mjs` builds the app's word list from the syllabus and the glosses; CI fails if it is stale
- [x] FSRS spaced repetition (ts-fsrs): one card per word, each bubble is a review; due words first, then new words from the lowest level
- [x] Progress v2 with automatic migration from v1 (IndexedDB) and the single-file game (localStorage)
- [x] Home screen: each mode is a bubble you pop to enter; HSK level choice; due and new counts
- [x] Words panel shows mastery from FSRS stability and when each word is next due
- [ ] Glosses for HSK 3 (500 words), then the level is switched on
- [ ] Pre-generated neural voice clips at normal and slow speed (waiting on the choice of text-to-speech provider)
- [ ] Sentence schema with role tags and all valid word orders (moved to the start of Phase 2, where Plug uses it)

**Verify**
- [x] Every word's level matches an independent extraction of the syllabus; all 300 level-1 words present
- [x] Every quiz question at HSK 1 and 1–2 has four distinct, unambiguous options (no shared glosses, look-alike lengths, within level)
- [x] FSRS: clean pops push reviews further out; a lapse brings a word back within a day; cards survive storage round trips
- [x] Scheduler: HSK 1 before HSK 2, due reviews before new words, no back-to-back repeats
- [x] End-to-end: home screen, level switch, back home, and the Words flow with review timing on the slip
- [ ] Human review of the glosses by a second Chinese speaker
- [ ] Polyphone review of generated audio clips (了, 长, 行, …)

## Phase 2: Plug (sentence mode)

Word pieces are soft bodies moulded to their grammatical role and plug into matching sockets:
subject = blue circle, time = amber hexagon, place = teal pill, verb = red triangle, object = green square, adverb = purple diamond, particle = grey droplet.
Scaffolding fades from shape and colour, to shape only, to neither. Progression: SV → SVO → S+T+VO → S+T+P+V+O → adverbs → 不/没 → 吗/呢 → measure words → 了/过 → 把/被.

- Sentence schema first: role tag per word, every valid word order, HSK level check (every word in a sentence at or below its level)

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
