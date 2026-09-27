import manifest from '../content/generated/audio.json';
import sentenceManifest from '../content/generated/sentence-audio.json';
import type { Word } from '../content/words';
import type { Sentence } from '../content/sentences';
import type { Speech } from './speech';

interface Clip { file: string; hash: string }
/** Written by scripts/generate-audio.mjs: which clips exist for each word, and the pinyin they were made for. */
export interface AudioEntry { p: string; normal?: Clip; slow?: Clip }
export type AudioManifest = Record<string, AudioEntry>;
/** A sentence clip, with the start and end (ms) of each word in reading order when MiniMax provided them. */
export interface SentenceClip extends Clip { words: [number, number][] | null }
export interface SentenceEntry { text: string; normal?: SentenceClip; slow?: SentenceClip }
export type SentenceManifest = Record<string, SentenceEntry>;

/**
 * Plays words and sentences: recorded MiniMax clips when they exist, otherwise the browser's
 * speech synthesis. Sentences play through Web Audio, so a single word can be cut out of the
 * naturally spoken sentence with its in-context tones.
 */
export class Voice {
  enabled = true;
  private cache = new Map<string, HTMLAudioElement>();
  private playing: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private timers: number[] = [];

  constructor(
    private readonly speech: Speech,
    private readonly clips: AudioManifest = manifest as AudioManifest,
    private readonly base = import.meta.env.BASE_URL,
    private readonly sentenceClips: SentenceManifest = sentenceManifest as SentenceManifest
  ) {}

  private clip(word: Word, slow: boolean): Clip | undefined {
    const e = this.clips[word.id];
    if (!e || e.p !== word.p) return undefined;       // missing, or made for an older reading
    return slow ? e.slow : e.normal;
  }

  hasClip(word: Word): boolean { return !!this.clip(word, false); }

  sentenceClip(s: Sentence, slow: boolean): SentenceClip | undefined {
    const e = this.sentenceClips[s.id];
    if (!e || e.text !== s.text) return undefined;
    return slow ? e.slow : e.normal;
  }

  private element(file: string): HTMLAudioElement {
    let el = this.cache.get(file);
    if (!el) {
      el = new Audio(`${this.base}audio/${file}`);
      el.preload = 'auto';
      this.cache.set(file, el);
    }
    return el;
  }

  private audio(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private buffer(file: string): Promise<AudioBuffer> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(`${this.base}audio/${file}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then(b => this.audio()!.decodeAudioData(b));
      p.catch(() => this.buffers.delete(file));
      this.buffers.set(file, p);
    }
    return p;
  }

  /** Starts fetching a word's clips so they play instantly when the slip appears. */
  preload(word: Word): void {
    for (const slow of [false, true]) { const c = this.clip(word, slow); if (c) this.element(c.file); }
  }

  say(word: Word, slow = false): void {
    if (!this.enabled) return;
    const c = this.clip(word, slow);
    this.stop();
    if (!c) { this.speech.speak(word.h, slow); return; }
    const el = this.element(c.file);
    el.currentTime = 0;
    this.playing = el;
    el.play().catch(() => this.speech.speak(word.h, slow));
  }

  /** Plays a whole sentence; onWord(i) fires as each word starts, and onWord(null) at the end. */
  async saySentence(s: Sentence, slow = false, onWord?: (i: number | null) => void): Promise<void> {
    if (!this.enabled) return;
    this.stop();
    const c = this.sentenceClip(s, slow), ctx = c && this.audio();
    if (!c || !ctx) { this.speech.speak(s.text, slow); return; }
    try {
      const buf = await this.buffer(c.file);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start();
      this.source = src;
      if (onWord) {
        c.words?.forEach(([b], i) => this.timers.push(window.setTimeout(() => onWord(i), b)));
        this.timers.push(window.setTimeout(() => onWord(null), buf.duration * 1000));
      }
    } catch {
      this.speech.speak(s.text, slow);
    }
  }

  /**
   * Plays one word of a sentence. With word timings it is cut from the sentence recording, so it
   * keeps the tones it has in context; otherwise the single-word clip plays.
   */
  async sayWordIn(s: Sentence, index: number, word: Word, slow = false): Promise<void> {
    if (!this.enabled) return;
    this.stop();
    const c = this.sentenceClip(s, slow), t = c?.words?.[index], ctx = t && this.audio();
    if (!c || !t || !ctx) { this.say(word, slow); return; }
    try {
      const buf = await this.buffer(c.file);
      const start = Math.max(0, t[0] / 1000 - 0.03), dur = Math.min(buf.duration - start, (t[1] - t[0]) / 1000 + 0.09);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.connect(g).connect(ctx.destination);
      // short fades so the cut edges don't click
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 0.015);
      g.gain.setValueAtTime(1, now + dur - 0.03); g.gain.linearRampToValueAtTime(0, now + dur);
      src.start(now, start, dur);
      this.source = src;
    } catch {
      this.say(word, slow);
    }
  }

  stop(): void {
    this.playing?.pause();
    this.playing = null;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = null;
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    this.speech.cancel();
  }
}
