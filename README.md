# Squish

Pop soft, jiggly bubbles to learn Chinese.

Pick a mode on the home screen by popping its bubble. In Words, a bubble sits pinned in the middle of the screen with four answers on the edges. Pull it toward the right answer and stretch it until it bursts. Each bubble has layers: two soap films (meaning, then pinyin) around a coloured core (the characters). Popping the core sends it flying, spews a new colour scheme across the page and hands you a fortune slip with the word to learn.

In Listen, the word is heard instead of read: pick its tones, then its meaning, then its characters from words that sound alike. Tap the bubble to hear it again; a wrong answer replays it slowly. Once you hear a word reliably, its core asks you to type the pinyin instead.

Two looks, chosen on the home screen: soap bubbles, or ink and lanterns (paper, brush calligraphy, paper lanterns). The bubble sizes itself to the space the answers leave on any screen.

Layers come in a random order. "Ask about" on the home screen picks which ones a bubble has: meaning, pinyin, characters, or any mix.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Useful URL flags:

| Flag | What it does |
|---|---|
| `?fps` | Shows a frame-rate meter, for checking the performance budget on real devices. |
| `?dictation` | Every Listen bubble ends in dictation (normally only words whose listening has graduated). |
| `?e2e` | Test mode: fresh progress, a test handle on `window.__squish`, larger simulation steps for slow software rendering. |

## Check it

```bash
npm run typecheck    # TypeScript, strict
npm test             # unit tests: content validation, quiz logic, scheduler, progress, physics stability
npm run build        # production build into dist/
npm run e2e          # Playwright plays the game in headless Chromium
npm run check:content  # the generated word list matches its sources
npm run check        # all of the above
```

The end-to-end tests run WebGL in software (SwiftShader), so they are slow (about six minutes) but need no GPU. Locally you can point Playwright at an existing Chromium with `CHROMIUM_PATH=/path/to/chrome npm run e2e`.

CI (`.github/workflows/ci.yml`) runs the same checks on every push and pull request, and deploys `main` to GitHub Pages once everything passes.

## Layout

```
src/
  content/     words, sentences, fortunes, palettes (the data)
  engine/      icosphere mesh and the soft-body simulation (no rendering, unit-tested)
  render/      soap-film and core materials, studio environment, the backdrop canvas
  stage/       renderer, camera, palettes, frame loop and performance guard
  bubble/      the layered bubble: physics, dragging to an edge, popping (knows nothing about words)
  modes/       one file per way to play, and the registry the home screen is built from
  audio/       synthesised sound effects, voice clips, browser speech fallback
  game/        quizzes, scheduler, FSRS memory per skill, progress storage, and game.ts which wires it all
  ui/          answer chips, HUD, fortune slip, words drawer, home screen, fitting the bubble to the screen
  theme/       the two looks: palettes, lantern materials, ink CSS
tests/
  unit/        Vitest
  e2e/         Playwright
docs/PLAN.md   the phased roadmap with verification for each phase
```

## Where things come from

- **Vocabulary** follows the 2025 HSK syllabus (新版HSK考试大纲), in force since July 2026: 300 words at level 1, 500 cumulative at level 2, 1,000 at level 3. Levels 1–2 are in the app so far. See `data/README.md` for sources, licences and how to add a level.
- **Example sentences** are real sentences by native speakers from Tatoeba (CC BY 2.0 FR, credited on each slip), kept only if every word is in the HSK 1–2 list, plus a small role-tagged set written for Plug mode. See `data/README.md`.
- **Glosses** (the short English meanings) are written for this project, so they fit an answer chip and never make two answers correct.
- **Memory** uses FSRS (via ts-fsrs), with one card per skill and item, so reading a word and hearing it are scheduled separately. Each finished bubble is one review: a clean pop is Good, one miss is Hard, two misses or "I forgot" is Again. Every review is also kept in a log for statistics.

- **Sound effects** are synthesised live with the Web Audio API. There are no audio files.
- **Pronunciation** comes from voice clips generated with MiniMax text-to-speech (`speech-2.8-hd`), at normal and slow speed, stored in `public/audio/`. Each clip pins the syllabus reading with a pronunciation rule, so words like 不客气 get the tone change the syllabus prints. Words without a clip fall back to the browser's speech synthesis.

## Generating the voice clips

You need a MiniMax pay-as-you-go API key (platform.minimax.io, Account Management, API Keys) with a small balance. All of HSK 1–2 at both speeds is about 3,000 characters, well under a dollar at the `speech-2.8-hd` rate. The key stays on your machine: put it in `.env.local` (ignored by git) or set it in the shell.

```powershell
$env:MINIMAX_API_KEY = "your key"
npm run audio:sample      # renders 8 words in 6 voices; open audio-samples/index.html and pick one
npm run audio -- --voice "Chinese (Mandarin)_News_Anchor"
npm run audio:status -- --voice "Chinese (Mandarin)_News_Anchor"   # what's still missing, no API calls
```

Sentences are recorded the same way, spoken naturally in one take. MiniMax also returns word-level timestamps, which highlight each word as the sentence plays. Tapping a word in a sentence plays that word's own clip. In sentences, only words with multi-reading characters are pinned; 一 and 不 are left to the voice because their tone depends on the next syllable.

The script only renders clips that are missing or whose request changed (new word, new reading, other voice or speed), saves progress as it goes, and writes `data/audio-review.md`: a checklist of words containing characters with more than one reading, to listen to once. Commit `public/audio/`, `src/content/generated/audio.json` and the review list. Mainland China accounts: also set `MINIMAX_API_HOST=https://api.minimaxi.com`.
- **Progress** is stored on the device in IndexedDB. Older progress (earlier versions of this app, or the original single-file version in localStorage) is migrated automatically.
