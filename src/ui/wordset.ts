import { gsap } from 'gsap';
import type { Word } from '../content/words';
import { TOPICS, kindGroups, setLabel, type WordGroup } from '../content/wordsets';
import type { Progress } from '../game/progress';
import { $ } from './dom';

export interface WordSetDeps {
  progress: Progress;
  reduceMotion: boolean;
  /** Quiz words up to the chosen HSK level. */
  pool(): readonly Word[];
  /** The set changed (so the Practice tiles can be redrawn). */
  onChange(): void;
}

/** A set needs a few words, or the same bubble would keep coming back. */
export const MIN_SET = 4;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });

/**
 * The word set picker: a full-screen sheet of groups, the path's topics and the kinds of word,
 * each opening onto its words. Tap a group's circle to take all its words, or open it and pick
 * single words. The set is what Words and Listen practise; Today and the path always use the full course.
 */
export class WordSetSheet {
  private readonly root = $('setSheet');
  private readonly panel = $('setPanel');
  private readonly body = $('setBody');
  private readonly apply = $('setApply') as HTMLButtonElement;
  /** The choice being made, applied only on "Use these words". */
  private draft = new Set<string>();
  private groups: WordGroup[] = [];

  constructor(private readonly d: WordSetDeps) {
    $('setChip').addEventListener('click', () => this.open());
    $('setClose').addEventListener('click', () => this.close());
    $('setAll').addEventListener('click', () => { this.draft.clear(); this.refresh(); });
    this.apply.addEventListener('click', () => {
      d.progress.setPractice(this.draft.size ? [...this.draft] : null);
      d.onChange();
      this.close();
    });
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); });
  }

  get shown(): boolean { return !this.root.hidden; }

  /** The chip's text: what is being practised. */
  label(): string {
    const ids = this.d.progress.data.settings.practice;
    if (!ids) return `All of HSK ${this.d.progress.data.settings.maxLevel === 1 ? '1' : `1–${this.d.progress.data.settings.maxLevel}`}`;
    return setLabel(ids, [...TOPICS, ...kindGroups(this.d.pool())]);
  }

  open(): void {
    this.draft = new Set(this.d.progress.data.settings.practice ?? []);
    const kinds = kindGroups(this.d.pool());
    this.groups = [...TOPICS, ...kinds];
    this.body.replaceChildren(
      el('h3', 'sheet-h', 'Topics'),
      el('p', 'sheet-sub', 'The path’s topics. Tap the circle to take a whole topic, or open it to pick single words.'),
      ...TOPICS.map(g => this.groupEl(g)),
      el('h3', 'sheet-h', 'Kinds of word'),
      el('p', 'sheet-sub', `From the words up to HSK ${this.d.progress.data.settings.maxLevel}.`),
      ...kinds.map(g => this.groupEl(g))
    );
    this.refresh();
    // a close still sliding away must not hide the sheet once it has opened again
    gsap.killTweensOf([this.panel, this.root]);
    this.root.hidden = false;
    this.body.scrollTop = 0;
    gsap.fromTo(this.panel, { yPercent: 100 }, { yPercent: 0, duration: this.d.reduceMotion ? 0.05 : 0.5, ease: 'power3.out' });
    gsap.fromTo(this.root, { backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,.35)', duration: 0.3 });
    ($('setClose') as HTMLButtonElement).focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    gsap.to(this.panel, { yPercent: 100, duration: this.d.reduceMotion ? 0.05 : 0.35, ease: 'power2.in', onComplete: () => { this.root.hidden = true; } });
    gsap.to(this.root, { backgroundColor: 'rgba(0,0,0,0)', duration: 0.3 });
    $('setChip').focus({ preventScroll: true });
  }

  private groupEl(g: WordGroup): HTMLElement {
    const box = el('details', 'wgroup');
    box.dataset.group = g.id;
    const sum = el('summary', 'wgroup-sum');
    const toggle = el('button', 'wgroup-all');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', `All of ${g.title}`);
    // the circle takes or drops the whole group, without opening it
    toggle.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const all = g.words.every(w => this.draft.has(w.id));
      for (const w of g.words) { if (all) this.draft.delete(w.id); else this.draft.add(w.id); }
      this.refresh();
    });
    const zh = el('span', 'wgroup-zh', g.zh);
    zh.lang = 'zh-Hans';
    sum.append(toggle, el('span', 'wgroup-title', g.title), zh, el('span', 'wgroup-count'), el('span', 'wgroup-caret'));
    const words = el('div', 'wgroup-words');
    for (const w of g.words) {
      const b = el('button', 'wpick');
      b.type = 'button';
      b.dataset.id = w.id;
      const h = el('span', 'wpick-h', w.h);
      h.lang = 'zh-Hans';
      b.append(h, el('span', 'wpick-p', w.p));
      b.title = w.e;
      b.addEventListener('click', () => { if (this.draft.has(w.id)) this.draft.delete(w.id); else this.draft.add(w.id); this.refresh(); });
      words.append(b);
    }
    box.append(sum, words);
    return box;
  }

  /** Redraws the ticks, the counts and the button to match the draft. */
  private refresh(): void {
    for (const box of this.body.querySelectorAll<HTMLElement>('.wgroup')) {
      const g = this.groups.find(x => x.id === box.dataset.group);
      if (!g) continue;
      const n = g.words.filter(w => this.draft.has(w.id)).length;
      const toggle = box.querySelector<HTMLElement>('.wgroup-all')!;
      toggle.setAttribute('aria-pressed', n === 0 ? 'false' : n === g.words.length ? 'true' : 'mixed');
      box.querySelector('.wgroup-count')!.textContent = n ? `${n} of ${g.words.length}` : `${g.words.length}`;
      box.classList.toggle('some', n > 0);
      for (const b of box.querySelectorAll<HTMLElement>('.wpick')) b.setAttribute('aria-pressed', String(this.draft.has(b.dataset.id!)));
    }
    const n = this.draft.size;
    this.apply.disabled = n > 0 && n < MIN_SET;
    this.apply.textContent = n === 0 ? 'Use all words' : n < MIN_SET ? `Pick at least ${MIN_SET} words` : `Use these ${n} words`;
    $('setSum').textContent = n === 0 ? 'Nothing picked: every word of your level.' : setLabel([...this.draft], this.groups);
  }
}
