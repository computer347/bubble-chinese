import { gsap } from 'gsap';
import { QUIZ_WORDS } from '../content/words';
import { DETAILS } from '../engine/softbody';
import { Sound } from '../audio/sound';
import { Speech } from '../audio/speech';
import { Voice } from '../audio/voice';
import { Stage } from '../stage/stage';
import { Bubble, type BubbleState, type Edge } from '../bubble/bubble';
import { Chips } from '../ui/chips';
import { Hud } from '../ui/hud';
import { Slip } from '../ui/slip';
import { Dictation } from '../ui/dictation';
import { Drawer } from '../ui/drawer';
import { Shell, type Tab, type StartArg } from '../ui/shell';
import { Settings } from '../ui/menu';
import { LESSONS } from '../content/path';
import { todayLeft, TodayMode } from '../modes/today';
import { PathMode, type PathStatus } from '../modes/path';
import { MODES, type ModeId } from '../modes';
import type { Mode, ModeContext } from '../modes/mode';
import { LayeredMode } from '../modes/layered';
import type { Progress } from './progress';
import { $, fmt } from '../ui/dom';
import { fitBubble, type Rect } from '../ui/fit';
import { THEMES, type StyleId } from '../theme/themes';

export type GameState = 'home' | 'note' | Exclude<BubbleState, 'hidden'>;

export interface GameOptions {
  canvas: HTMLCanvasElement;
  progress: Progress;
  reduceMotion: boolean;
  /** End-to-end test mode: larger simulation steps so animations finish on slow software rendering. */
  e2e?: boolean;
}

/** A read-only view of the game, used by the end-to-end tests. */
export interface GameHandle {
  /** Leaves the shell and starts a mode (a lesson: mode 'path' with its start argument). */
  enter(mode: ModeId, arg?: StartArg): void;
  /** Abandons the current bubble (ungraded) and shows the home screen. */
  home(): void;
  snapshot(): {
    mode: ModeId | null;
    /** The shell's open tab. */
    tab: Tab;
    state: GameState; word: string | null; layers: number; totalLayers: number;
    correctEdge: Edge; score: number; streak: number; detail: number; asleep: boolean;
    /** Wrong answers on the current layer. */
    wrong: number;
    queue: string[];
    /** Words available at the chosen level, and how many are due. */
    pool: number; due: number; maxLevel: number;
    /** The last spoken prompt: how long it took to start (ms; null if it fell back), and whether the current word's clip is decoded. */
    voice: { latency: number | null; primed: boolean };
    /** The bubble's outer layer on screen, in CSS pixels. */
    ball: { x: number; y: number; r: number };
    /** Where the path is: map, a lesson card, a drill or the checkpoint. */
    path: PathStatus | null;
    /** The last fit: where the bubble was sent, when, and what it avoided. */
    lastFit: { y: number; r: number; at: number; obstacles: Array<{ l: number; t: number; r: number; b: number }> } | null;
  };
}

/** Wires the stage, the bubble, the panels and the modes together. */
export function startGame(opts: GameOptions): GameHandle {
  const { canvas, progress, reduceMotion } = opts;
  const sound = new Sound();
  const speech = new Speech();
  const voice = new Voice(speech);
  const pool = () => QUIZ_WORDS.filter(w => w.level <= progress.data.settings.maxLevel);

  const stage = new Stage({ canvas, reduceMotion, e2e: opts.e2e });
  const chips = new Chips(reduceMotion, edge => bubble.autoPull(edge));
  const bubble = new Bubble(stage, sound, {
    thresholds: chips.thresholds,
    onTension: (edge, hot) => chips.setHot(edge, hot),
    onDetail: (idx, points) => {
      $('detailOut').textContent = fmt(points);
      $('detail').setAttribute('aria-valuetext', `${fmt(points)} points`);
      ($('detail') as HTMLInputElement).value = String(idx);
    }
  });
  stage.onResize(() => chips.measure());
  stage.idle = () => bubble.asleep || bubble.state === 'hidden';
  stage.perf = {
    busy: () => bubble.state === 'popping' || bubble.dragging,
    lowerDetail: () => { if (bubble.detailIndex === 0) return false; bubble.setDetail(bubble.detailIndex - 1); return true; }
  };

  const hud = new Hud();
  const drawer = new Drawer({ progress, voice, pool });
  const slip = new Slip({ sound, speech, voice, reduceMotion, slow: () => drawer.slow });
  const dictation = new Dictation(reduceMotion, text => { if (current instanceof LayeredMode) current.typed(text); });
  const session = { score: 0, streak: 0 };
  const updateHud = () => hud.stats({ ...session, learned: progress.learnedCount('words', pool()), total: pool().length });

  /* ---------- fit the bubble into the space the answers and panels leave ---------- */
  const shown = (el: Element): Rect | null => {
    if (!el.getClientRects().length || (el as HTMLElement).hidden) return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };
  let lastFit: { y: number; r: number; at: number; obstacles: Rect[] } | null = null;
  function fit(instant = false): void {
    const W = window.innerWidth, H = window.innerHeight, d = bubble.designed();
    const answers = dictation.shown ? [shown($('dictation'))] : chips.layoutRects();
    const panels = [...document.querySelectorAll('.corner, .topbar')].map(shown);
    const obstacles = [...answers, ...panels].filter((q): q is Rect => !!q);
    // the resting bubble bobs 0.05 world units each way (none with reduced motion); a little more for spring lag
    const bob = reduceMotion ? 0 : 0.05 * 1.3 * H / stage.visH;
    const f = fitBubble({ W, H, x: W / 2, obstacles, maxR: d.r, prefY: d.y, tail: THEMES[progress.data.settings.style].tail, bob });
    lastFit = { ...f, at: performance.now(), obstacles };
    bubble.place(f.y, f.r, instant);
  }
  stage.onResize(() => { if (playing) fit(true); });
  // re-fit whenever an answer or panel changes size after it was measured: a font arriving late
  // (Chinese characters load on demand), text wrapping, a longer question
  let refit = 0;
  const watch = new ResizeObserver(() => {
    if (!playing || refit) return;
    refit = requestAnimationFrame(() => { refit = 0; if (bubble.state !== 'popping' && bubble.state !== 'hidden') fit(); });
  });
  document.querySelectorAll('.ans, .corner, .topbar, #dictation').forEach(el => watch.observe(el));

  const ctx: ModeContext = { stage, bubble, chips, hud, slip, dictation, sound, speech, voice, progress, session, pool, updateHud, fit, home: () => showHome() };
  const modes = new Map<ModeId, Mode>(MODES.filter(m => m.make).map(m => [m.id, m.make!(ctx)]));
  let current: Mode | null = null;
  let currentId: ModeId | null = null;
  /** True once the chosen mode has started (after the home screen has faded). */
  let playing = false;

  /* ---------- the shell: four tabs, and the settings in You ---------- */
  const today = modes.get('today') as TodayMode;
  const home = new Shell({
    progress, voice, reduceMotion, modes: MODES, pool,
    today: () => todayLeft(ctx, today.heardPool()),
    onEnter: (id, from, arg) => enter(id, arg, from),
    onTab: tab => { if (tab === 'you') { updateHud(); drawer.render(); } }
  });
  new Settings({
    progress,
    onStudy: () => { updateHud(); if (home.shown) home.render(); },
    onStyle: style => applyStyle(style)
  });

  /* ---------- style: soap bubbles, or ink and lanterns ---------- */
  function applyStyle(style: StyleId, instant = false): void {
    const theme = THEMES[style];
    document.body.classList.toggle('style-ink', style === 'ink');
    stage.palettes = theme.palettes;
    stage.backdrop.setStyle(theme.wallFonts, theme.paper);
    stage.commitPalette(0, instant);
    bubble.setTheme(theme);
    // the page's fonts changed, so the answers' sizes did too
    chips.measure();
    if (playing) fit();
  }
  /** Back to the shell, on the tab you left from. */
  function showHome(): void {
    if (bubble.state === 'popping') return;
    current?.stop();
    current = null; currentId = null; playing = false;
    chips.out();
    stage.backdrop.setWord('', false);
    home.show();
    updateHud();
  }
  /** Leaves the shell for a mode; `from` is the tapped button, whose orb zooms into the task. */
  function enter(id: ModeId, arg?: StartArg, from?: HTMLElement | null): void {
    // the Write tile opens stroke practice for the latest finished lesson
    if (id === 'write') {
      const done = LESSONS.filter(x => progress.data.path.done[x.lesson.id]);
      if (!done.length) return;
      id = 'path'; arg = { kind: 'write', index: done[done.length - 1].index };
    }
    const mode = modes.get(id);
    if (!home.shown || current || !mode) return;
    sound.unlock();
    sound.pop(false);
    current = mode; currentId = id;
    mode.prepare?.();
    const target = from ?? document.querySelector<HTMLElement>(`[data-mode="${id}"]`);
    home.leave(target, () => { playing = true; mode.start(arg); });
  }
  $('homeBtn').addEventListener('click', () => showHome());

  /* ---------- controls ---------- */
  document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
  document.addEventListener('keydown', () => sound.unlock(), { capture: true });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (slip.open) slip.close(); else if (playing) showHome();
  });
  canvas.addEventListener('keydown', e => current?.key?.(e));
  const soundBtn = $('sound');
  soundBtn.addEventListener('click', () => {
    sound.unlock();
    const on = !sound.enabled;
    sound.setEnabled(on);
    speech.enabled = on;
    voice.enabled = on;
    if (!on) voice.stop();
    soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    soundBtn.setAttribute('aria-pressed', String(on));
  });
  $('wobble').addEventListener('input', e => bubble.setWobble(+(e.target as HTMLInputElement).value / 100));
  $('detail').addEventListener('input', e => {
    const input = e.target as HTMLInputElement, idx = +input.value;
    if (bubble.state === 'popping' || bubble.dragging) { input.value = String(bubble.detailIndex); return; }
    if (idx !== bubble.detailIndex) { bubble.setDetail(idx); bubble.poke(20, 0.03); }
  });

  /* ---------- boot ---------- */
  bubble.setDetail(1);
  stage.resize();
  applyStyle(progress.data.settings.style, true);
  showHome();
  hud.modeLabel(null);
  if (!reduceMotion) gsap.from('.topbar', { opacity: 0, y: -10, duration: 0.8, delay: 0.3, ease: 'power2.out' });
  stage.run(dt => bubble.update(dt));
  document.fonts?.ready.then(() => { stage.backdrop.layout(); chips.measure(); }).catch(() => {});

  // the bubble is hidden while playing only between a burst core and the next bubble, while the slip is up
  const state = (): GameState => !playing ? 'home' : bubble.state === 'hidden' ? 'note' : bubble.state;
  // the layered mode being played, or Words while at home
  const layered = () => (current instanceof LayeredMode ? current : current instanceof PathMode ? current.layered() ?? modes.get('words') as LayeredMode : modes.get('words') as LayeredMode);
  return {
    enter,
    home: showHome,
    snapshot: () => { const words = layered(); return {
      mode: currentId, tab: home.tab, state: state(), word: words.word?.h ?? null, layers: bubble.layers, totalLayers: bubble.totalLayers, correctEdge: words.correctEdge,
      score: session.score, streak: session.streak, detail: DETAILS[bubble.detailIndex].level, asleep: bubble.asleep, wrong: words.wrongThisLayer,
      queue: words.queue(),
      pool: pool().length, due: progress.dueCount('words', pool()), maxLevel: progress.data.settings.maxLevel,
      voice: { latency: voice.lastLatency, primed: !!words.word && voice.primed(words.word) },
      ball: bubble.screenCircle(),
      path: current instanceof PathMode ? current.snapshot() : null,
      lastFit: lastFit && { ...lastFit, now: bubble.fitState() }
    }; }
  };
}
