import { PATH, LESSONS, lessonStates, type Unit } from '../content/path';
import { $ } from './dom';

export interface PathViewDeps {
  reduceMotion: boolean;
  /** When each lesson was finished, by id. */
  done(): Readonly<Record<string, number>>;
  /** A lesson's bubble was popped (only open and finished lessons can be). */
  onLesson(index: number, from: HTMLElement): void;
  /** A unit's culture note was asked for. */
  onNote(unit: Unit, from: HTMLElement): void;
  /** The side lesson: writing a finished lesson's characters. */
  onWrite(index: number, from: HTMLElement): void;
}

/**
 * The path: each unit a header (title, topic, its culture note) and its lessons as bubbles along a
 * winding trail. Finished lessons are ticked, the next one glows, later ones wait, locked.
 * Units still to be written are listed, so the whole way ahead is visible. Drawn into the Path tab.
 */
export class PathView {
  constructor(private readonly d: PathViewDeps) {}

  render(): void {
    const done = this.d.done(), states = lessonStates(done);
    const finished = LESSONS.filter(x => done[x.lesson.id]).length;
    $('pathIntro').textContent = `${finished} of ${LESSONS.length} lessons done. Each teaches ten words, and they join your reviews in Today.`;
    let n = 0;
    $('pathUnits').replaceChildren(...PATH.units.map((u, ui) => {
      const box = document.createElement('section');
      box.className = `punit${u.lessons.length ? '' : ' punit-later'}`;
      const head = document.createElement('header');
      head.className = 'punit-head';
      const zh = Object.assign(document.createElement('span'), { className: 'punit-zh', textContent: u.zh });
      zh.lang = 'zh-Hans';
      head.append(Object.assign(document.createElement('p'), { className: 'punit-no', textContent: `Unit ${ui + 1}` }),
        Object.assign(document.createElement('h3'), { className: 'punit-title', textContent: u.title }), zh,
        Object.assign(document.createElement('p'), { className: 'punit-topic', textContent: u.topic }));
      if (u.notes.length) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'punit-note', textContent: 'Culture note' });
        b.addEventListener('click', () => this.d.onNote(u, b));
        head.append(b);
      }
      box.append(head);
      if (!u.lessons.length) {
        box.append(Object.assign(document.createElement('p'), { className: 'punit-soon', textContent: 'Coming soon' }));
        return box;
      }
      const trail = document.createElement('ol');
      trail.className = 'trail';
      for (const l of u.lessons) {
        const index = n++, state = states.get(l.id)!;
        const li = document.createElement('li');
        li.className = `stop ${state}`;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'stop-btn'; b.dataset.lesson = l.id;
        b.disabled = state === 'locked';
        b.setAttribute('aria-label', `Lesson ${index + 1}: ${l.title}, ${state === 'done' ? 'done' : state === 'open' ? 'next up' : 'locked'}`);
        const orb = Object.assign(document.createElement('span'), { className: `mode mini m-path${state === 'done' ? ' m-done' : ''}` });
        orb.append(Object.assign(document.createElement('span'), { className: 'stop-no', textContent: state === 'done' ? '✓' : String(index + 1) }));
        b.append(orb, Object.assign(document.createElement('span'), { className: 'stop-title', textContent: l.title }));
        b.addEventListener('click', () => this.d.onLesson(index, b));
        li.append(b);
        if (state === 'done') {
          const w = Object.assign(document.createElement('button'), { type: 'button', className: 'stop-write', textContent: 'Write' });
          w.dataset.write = l.id;
          w.setAttribute('aria-label', `Write the characters of lesson ${index + 1}`);
          w.addEventListener('click', () => this.d.onWrite(index, w));
          li.append(w);
        }
        trail.append(li);
      }
      box.append(trail);
      return box;
    }));
  }
}
