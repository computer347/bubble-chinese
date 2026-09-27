import { gsap } from 'gsap';
import { WORDS, type Word } from '../content/words';
import { examplesFor, ROLE_NAMES, tatoebaUrl, type Sentence } from '../content/sentences';
import { FORTUNES } from '../content/fortunes';
import type { Sound } from '../audio/sound';
import type { Speech } from '../audio/speech';
import type { Voice } from '../audio/voice';
import { Bag } from '../game/scheduler';
import { rand } from '../game/random';
import { $ } from './dom';

export interface SlipDeps {
  sound: Sound;
  speech: Speech;
  voice: Voice;
  reduceMotion: boolean;
  /** Whether taps play the slow voice. */
  slow(): boolean;
}

/**
 * The fortune slip that follows a popped core: a fortune, the word to learn with its sound,
 * and an example sentence where tapping a word plays it cut from the spoken sentence.
 */
export class Slip {
  open = false;
  private word: Word | null = null;
  private example: Sentence | null = null;
  private next: (() => void) | null = null;
  private readonly fortunes = new Bag(FORTUNES);
  private readonly wordsById = new Map(WORDS.map(w => [w.id, w]));
  private readonly noteEl = $('note');
  private readonly slipEl = $('slip');
  private readonly nextBtn = $('next') as HTMLButtonElement;

  constructor(private readonly d: SlipDeps) {
    this.nextBtn.addEventListener('click', () => this.close());
    $('hear').addEventListener('click', () => { if (this.word) d.voice.say(this.word); });
    $('hearSlow').addEventListener('click', () => { if (this.word) d.voice.say(this.word, true); });
    $('exPlay').addEventListener('click', () => { if (this.example) void d.voice.saySentence(this.example, false, i => this.highlight(i)); });
    $('exSlow').addEventListener('click', () => { if (this.example) void d.voice.saySentence(this.example, true, i => this.highlight(i)); });
  }

  /** Shows the slip for a word. `next` runs shortly after it is closed. */
  show(word: Word, result: string, maxLevel: number, next: () => void): void {
    const { voice, speech, sound, reduceMotion } = this.d;
    this.word = word;
    this.next = next;
    this.open = true;
    $('result').textContent = result;
    $('fortuneText').textContent = this.fortunes.next();
    $('zhBig').textContent = word.h;
    $('zhPy').textContent = word.p;
    $('zhEn').textContent = word.e;
    $('lucky').textContent = luckyNumbers();
    $('novoice').hidden = voice.hasClip(word) || (speech.available && speech.hasChineseVoice());
    this.renderExample(word, maxLevel);
    this.noteEl.hidden = false;
    gsap.killTweensOf([this.slipEl, this.nextBtn]);
    gsap.fromTo(this.slipEl, { scaleX: 0.04, scaleY: 0.5, rotation: -10, y: 40, opacity: 0 }, { scaleX: 1, scaleY: 1, rotation: rand(-2, 2), y: 0, opacity: 1, duration: reduceMotion ? 0.2 : 1.15, ease: 'elastic.out(1,.5)' });
    gsap.fromTo(this.nextBtn, { opacity: 0, y: 14 }, { opacity: 1, y: 0, delay: reduceMotion ? 0 : 0.5, duration: 0.45, ease: 'power2.out' });
    sound.paper();
    setTimeout(() => voice.say(word), 650);
    setTimeout(() => this.nextBtn.focus({ preventScroll: true }), 80);
  }

  /** Folds the slip away and, a moment later, runs what comes next. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.d.voice.stop();
    this.highlight(null);
    this.d.sound.paper();
    gsap.to(this.slipEl, { y: -50, rotation: rand(-16, 16), scale: 0.9, opacity: 0, duration: 0.42, ease: 'power2.in' });
    gsap.to(this.nextBtn, { opacity: 0, duration: 0.25, onComplete: () => { this.noteEl.hidden = true; gsap.set(this.slipEl, { scale: 1 }); } });
    const next = this.next;
    this.next = null;
    if (next) setTimeout(next, 250);
    ($('stage') as HTMLCanvasElement).focus({ preventScroll: true });
  }

  /** Hides the slip at once, without running what comes next. */
  dismiss(): void {
    this.open = false;
    this.next = null;
    this.noteEl.hidden = true;
  }

  /* ---------- example sentence: tap a word to hear it cut from the spoken sentence ---------- */
  private renderExample(w: Word, maxLevel: number): void {
    const box = $('example'), zh = $('exZh');
    const list = examplesFor(w.id, maxLevel);
    this.example = list[Math.floor(Math.random() * Math.min(3, list.length))] ?? null;
    box.hidden = !this.example;
    if (!this.example) return;
    const s = this.example;
    zh.replaceChildren();
    let i = 0;
    s.chunks.forEach((c, ci) => {
      for (const p of s.punct.filter(x => x.at === ci)) zh.append(Object.assign(document.createElement('span'), { className: 'pu', textContent: p.p }));
      for (const id of c.words) {
        const word = this.wordsById.get(id)!, index = i++;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `tok${c.role ? ` r-${c.role}` : ''}${id === w.id ? ' me' : ''}`;
        b.dataset.i = String(index);
        const py = s.py[index] ?? word.p;
        b.setAttribute('aria-label', `${word.h}, ${py}, ${word.e}${c.role ? ` (${ROLE_NAMES[c.role]})` : ''}`);
        b.append(Object.assign(document.createElement('span'), { className: 'py', textContent: py }), Object.assign(document.createElement('span'), { className: 'hz', textContent: word.h }));
        b.addEventListener('click', () => { void this.d.voice.sayWordIn(s, index, word, this.d.slow()); });
        zh.append(b);
      }
    });
    for (const p of s.punct.filter(x => x.at >= s.chunks.length)) zh.append(Object.assign(document.createElement('span'), { className: 'pu', textContent: p.p }));
    $('exEn').textContent = s.en;
    const src = $('exSrc');
    src.replaceChildren();
    if (s.source.name === 'Tatoeba') {
      const a = Object.assign(document.createElement('a'), { href: tatoebaUrl(s.source.id), textContent: `Tatoeba #${s.source.id}`, target: '_blank', rel: 'noopener' });
      src.append('Sentence from ', a, s.source.author ? ` by ${s.source.author}` : '', ', CC BY 2.0 FR');
    }
  }

  private highlight(i: number | null): void {
    $('exZh').querySelectorAll<HTMLElement>('.tok').forEach(t => t.classList.toggle('on', t.dataset.i === String(i)));
  }
}

function luckyNumbers(): string {
  const s = new Set<number>();
  while (s.size < 6) s.add(1 + Math.floor(Math.random() * 49));
  return [...s].sort((a, b) => a - b).join('  ');
}
