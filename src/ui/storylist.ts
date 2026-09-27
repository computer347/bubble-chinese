import { STORIES, storyState, unlockHint } from '../content/stories';
import { PATH } from '../content/path';
import { $ } from './dom';

export interface StoryListDeps {
  done(): Readonly<Record<string, number>>;
  read(): Readonly<Record<string, number>>;
  maxLevel(): number;
  /** A story was opened, from its card (whose orb zooms into the reader). */
  onStory(id: string, from: HTMLElement): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });

/**
 * The Read tab's shelf: a card per story, its orb carrying the title's first character. Open
 * stories can be read, finished ones are marked, and locked ones say which lesson opens them.
 */
export class StoryList {
  constructor(private readonly d: StoryListDeps) {}

  render(): void {
    const done = this.d.done(), read = this.d.read(), level = this.d.maxLevel();
    const states = STORIES.map(s => storyState(s, done, read, level));
    const open = states.filter(s => s !== 'locked').length;
    $('readIntro').textContent = open
      ? `${open} of ${STORIES.length} stories open. More open as you go along the path, each once you know all its words.`
      : `${STORIES.length} short stories, each opening once the path has taught all its words. The first ${STORIES.length ? unlockHint(STORIES[0]).replace(/^Opens/, 'opens') : 'comes soon'}.`;
    $('storyList').replaceChildren(...STORIES.map((s, i) => {
      const state = states[i];
      const li = el('li', `story ${state}`);
      const b = el('button', 'scard');
      b.type = 'button';
      b.dataset.story = s.id;
      b.disabled = state === 'locked';
      const orb = el('span', `mode mini m-read${state === 'read' ? ' m-done' : ''}`);
      orb.setAttribute('aria-hidden', 'true');
      const glyph = el('span', 'orb-glyph', [...s.zh][0] ?? '读');
      glyph.lang = 'zh-Hans';
      orb.append(glyph);
      const zh = el('span', 'scard-zh', s.zh);
      zh.lang = 'zh-Hans';
      const unit = s.unit ? PATH.units.find(u => u.id === s.unit)?.title : null;
      const meta = state === 'locked' ? unlockHint(s) : `HSK ${s.level} · ${s.chars} characters${unit ? ` · ${unit}` : ''}${state === 'read' ? ' · read ✓' : ''}`;
      const text = el('span', 'scard-text');
      text.append(zh, el('span', 'scard-en', s.title), el('span', 'scard-meta', meta));
      b.append(orb, text);
      b.setAttribute('aria-label', `${s.title}, ${s.zh}. ${meta}`);
      b.addEventListener('click', () => this.d.onStory(s.id, b));
      li.append(b);
      return li;
    }));
  }
}
