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

/** Clips kept ready at once. Older ones are let go, so a long session doesn't pile up decoded audio. */
export const KEEP_CLIPS = 24;

/** Moves a key to the most recent end of a Map (Maps keep insertion order). */
function touch<K, V>(m: Map<K, V>, k: K): V | undefined {
  const v = m.get(k);
  if (v !== undefined) { m.delete(k); m.set(k, v); }
  return v;
}

/**
 * Plays words and sentences: recorded MiniMax clips when they exist, otherwise the browser's
 * speech synthesis. Sentences play through Web Audio, with word timings to highlight each word
 * as it is spoken.
 */
export class Voice {
  enabled = true;
  private cache = new Map<string, HTMLAudioElement>();
  private playing: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private timers: number[] = [];
  private decoded = new Map<string, AudioBuffer>();
  /** How long the last play() took to start sounding, in ms, or null if it fell back to an audio element or speech. */
  lastLatency: number | null = null;
  private playToken = 0;

  constructor(
    private readonly speech: Speech,
    private readonly clips: AudioManifest = manifest as unknown as AudioManifest,
    private readonly base = import.meta.env.BASE_URL,
    // JSON imports type [0, 120] as number[]; the manifest's shape is checked by tests/unit/sentences.test.ts
    private readonly sentenceClips: SentenceManifest = sentenceManifest as unknown as SentenceManifest
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
    let el = touch(this.cache, file);
    if (!el) {
      el = new Audio(`${this.base}audio/${file}`);
      el.preload = 'auto';
      this.cache.set(file, el);
      this.trim();
    }
    return el;
  }

  /** Lets go of the least recently used clips beyond KEEP_CLIPS (never the one playing). */
  private trim(): void {
    for (const [file, el] of this.cache) {
      if (this.cache.size <= KEEP_CLIPS) break;
      if (el === this.playing) continue;
      el.removeAttribute('src'); el.load();          // releases the media resource
      this.cache.delete(file);
    }
    for (const file of this.buffers.keys()) {
      if (this.buffers.size <= KEEP_CLIPS) break;
      this.buffers.delete(file);
      this.decoded.delete(file);
    }
  }

  /** How many clips are held, for tests and the ?fps meter. */
  get held(): { elements: number; buffers: number } { return { elements: this.cache.size, buffers: this.buffers.size }; }

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
    let p = touch(this.buffers, file);
    if (p) touch(this.decoded, file);
    if (!p) {
      p = fetch(`${this.base}audio/${file}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then(b => this.audio()!.decodeAudioData(b));
      p.catch(() => this.buffers.delete(file));
      this.buffers.set(file, p);
      this.trim();
    }
    return p;
  }

  /** Starts fetching a word's clips so they play instantly when the slip appears. */
  preload(word: Word): void {
    for (const slow of [false, true]) { const c = this.clip(word, slow); if (c) this.element(c.file); }
  }

  /** Fetches and decodes a word's clips ahead of time, so play() can start them at once. */
  prime(word: Word): void {
    if (!this.audio()) return;
    for (const slow of [false, true]) {
      const c = this.clip(word, slow);
      if (c && !this.decoded.has(c.file)) this.buffer(c.file).then(b => { if (this.buffers.has(c.file)) this.decoded.set(c.file, b); }).catch(() => {});
    }
  }

  /** Whether a word's normal-speed clip is decoded and ready to start at once. */
  primed(word: Word): boolean { const c = this.clip(word, false); return !!c && this.decoded.has(c.file); }

  /**
   * Plays a word as a prompt through Web Audio. A primed clip starts at once; one still decoding is
   * waited for (up to 1.5 s) rather than played another way. lastLatency records how long it took
   * to start sounding; it is null when the word fell back to say().
   */
  play(word: Word, slow = false): void {
    if (!this.enabled) return;
    const t0 = performance.now(), token = ++this.playToken;
    const c = this.clip(word, slow), ctx = c && this.audio();
    if (!c || !ctx) { this.lastLatency = null; this.say(word, slow); return; }
    const start = (buf: AudioBuffer): void => {
      if (token !== this.playToken) return;       // something else started meanwhile
      this.stop();
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start();
      this.source = src;
      this.lastLatency = performance.now() - t0 + (ctx.baseLatency + (ctx.outputLatency || 0)) * 1000;
    };
    const ready = this.decoded.get(c.file);
    if (ready) { start(ready); return; }
    const late = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), 1500));
    Promise.race([this.buffer(c.file), late]).then(start, () => { if (token === this.playToken) { this.lastLatency = null; this.say(word, slow); } });
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

  stop(): void {
    this.playToken++;
    this.playing?.pause();
    this.playing = null;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = null;
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    this.speech.cancel();
  }
}
