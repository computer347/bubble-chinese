import manifest from '../content/generated/audio.json';
import type { Word } from '../content/words';
import type { Speech } from './speech';

interface Clip { file: string; hash: string }
/** Written by scripts/generate-audio.mjs: which clips exist for each word, and the pinyin they were made for. */
export interface AudioEntry { p: string; normal?: Clip; slow?: Clip }
export type AudioManifest = Record<string, AudioEntry>;

const CLIPS = manifest as AudioManifest;

/**
 * Plays a word: the recorded MiniMax clip when there is one (normal or slow speed),
 * otherwise the browser's speech synthesis as a fallback.
 */
export class Voice {
  enabled = true;
  private cache = new Map<string, HTMLAudioElement>();
  private playing: HTMLAudioElement | null = null;

  constructor(private readonly speech: Speech, private readonly clips: AudioManifest = CLIPS, private readonly base = import.meta.env.BASE_URL) {}

  private clip(word: Word, slow: boolean): Clip | undefined {
    const e = this.clips[word.id];
    if (!e || e.p !== word.p) return undefined;       // missing, or made for an older reading
    return slow ? e.slow : e.normal;
  }

  hasClip(word: Word): boolean { return !!this.clip(word, false); }

  private element(file: string): HTMLAudioElement {
    let el = this.cache.get(file);
    if (!el) {
      el = new Audio(`${this.base}audio/${file}`);
      el.preload = 'auto';
      this.cache.set(file, el);
    }
    return el;
  }

  /** Starts fetching a word's clips so they play instantly when the slip appears. */
  preload(word: Word): void {
    for (const slow of [false, true]) { const c = this.clip(word, slow); if (c) this.element(c.file); }
  }

  say(word: Word, slow = false): void {
    if (!this.enabled) return;
    const c = this.clip(word, slow);
    if (!c) { this.speech.speak(word.h, slow); return; }
    this.stop();
    const el = this.element(c.file);
    el.currentTime = 0;
    this.playing = el;
    el.play().catch(() => this.speech.speak(word.h, slow));
  }

  stop(): void {
    this.playing?.pause();
    this.playing = null;
    this.speech.cancel();
  }
}
