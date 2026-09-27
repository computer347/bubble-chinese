import type { Word } from '../content/words';
import type { Sound } from '../audio/sound';
import type { Speech } from '../audio/speech';
import type { Voice } from '../audio/voice';
import type { Bubble } from '../bubble/bubble';
import type { Stage } from '../stage/stage';
import type { Progress } from '../game/progress';
import type { Chips } from '../ui/chips';
import type { Hud } from '../ui/hud';
import type { Slip } from '../ui/slip';
import type { Dictation } from '../ui/dictation';

/** Score and streak for this visit, shared by every mode. */
export interface Session { score: number; streak: number }

/** What a mode gets to play with. */
export interface ModeContext {
  stage: Stage;
  bubble: Bubble;
  chips: Chips;
  hud: Hud;
  slip: Slip;
  /** The typed-answer field, for layers answered by typing. */
  dictation: Dictation;
  sound: Sound;
  speech: Speech;
  voice: Voice;
  progress: Progress;
  session: Session;
  /** Quiz words up to the chosen HSK level. */
  pool(): readonly Word[];
  /** Redraws score, streak and the learned count. */
  updateHud(): void;
  /** Sizes and places the bubble in the space the answers and panels leave free. */
  fit(instant?: boolean): void;
}

/** A way to play, entered by popping its bubble on the home screen. */
export interface Mode {
  /** The mode was chosen: a moment to get ready (fetch sounds) while the home screen fades. */
  prepare?(): void;
  /** Starts playing, once the home screen has gone. */
  start(): void;
  /** Leaves without grading what is on screen. */
  stop(): void;
  /** A key pressed on the stage that the bubble does not use itself. */
  key?(e: KeyboardEvent): void;
}
