import * as THREE from 'three';
import { gsap } from 'gsap';
import { QUIZ_WORDS, WORDS, LEVELS, type Word } from '../content/words';
import { examplesFor, ROLE_NAMES, tatoebaUrl, type Sentence } from '../content/sentences';
import { FORTUNES } from '../content/fortunes';
import { PALETTES, PHYS, type Physics } from '../content/palettes';
import { SoftBody, DETAILS } from '../engine/softbody';
import { Sound } from '../audio/sound';
import { Speech } from '../audio/speech';
import { Voice } from '../audio/voice';
import { filmMaterial, coreMaterial, applyCore, type FilmMaterial } from '../render/materials';
import { Environment } from '../render/environment';
import { Backdrop, type BallView } from '../render/backdrop';
import { makeQuestions, applyForgot, type Question } from './questions';
import { WordScheduler, Bag } from './scheduler';
import { Progress } from './progress';
import { gradeBubble, masteryDots, dueLabel } from './memory';
import { rand, shuffle } from './random';
import { $, fmt, smooth } from '../ui/dom';

export type GameState = 'home' | 'intro' | 'live' | 'between' | 'popping' | 'note';
type Edge = 'top' | 'right' | 'bottom' | 'left';
const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];
const EDGE_DIR: Record<Edge, [number, number]> = { top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0] };

export interface GameOptions {
  canvas: HTMLCanvasElement;
  progress: Progress;
  reduceMotion: boolean;
  /** End-to-end test mode: larger simulation steps so animations finish on slow software rendering. */
  e2e?: boolean;
}

/** A read-only view of the game, used by the end-to-end tests. */
export interface GameHandle {
  /** Leaves the home screen and starts a mode. Only "words" exists so far. */
  enter(mode: 'words'): void;
  /** Abandons the current bubble (ungraded) and shows the home screen. */
  home(): void;
  snapshot(): {
    state: GameState; word: string | null; layers: number; totalLayers: number;
    correctEdge: Edge; score: number; streak: number; detail: number; asleep: boolean;
    /** Wrong answers on the current layer. */
    wrong: number;
    queue: string[];
    /** Words available at the chosen level, and how many are due. */
    pool: number; due: number; maxLevel: number;
  };
}

interface Layer { mesh: THREE.Mesh; mat: THREE.Material; film: boolean; sc: { v: number } }

const R = 1.1;
const MAX_LAYERS = 6;
const TAN = Math.tan(THREE.MathUtils.degToRad(17.5));

export function startGame(opts: GameOptions): GameHandle {
  const { canvas, progress, reduceMotion } = opts;
  const rm = reduceMotion ? 0.45 : 1;
  const maxFrameDt = opts.e2e ? 1 / 4 : 1 / 30;
  // in tests, animations follow the wall clock even when software rendering drops to a few frames a second
  if (opts.e2e) gsap.ticker.lagSmoothing(0);
  const sound = new Sound();
  const speech = new Speech();
  const voice = new Voice(speech);
  const scheduler = new WordScheduler();
  const pool = () => QUIZ_WORDS.filter(w => w.level <= progress.data.settings.maxLevel);
  const fortunes = new Bag(FORTUNES);

  /* ---------- renderer and scene ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.e2e });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const env = new Environment(renderer, scene);
  const backdrop = new Backdrop(reduceMotion);
  scene.add(backdrop.mesh);

  /* ---------- the layered body: soap films around a coloured core, sharing one soft-body mesh ---------- */
  let soft = new SoftBody(1, R);
  const geo = new THREE.BufferGeometry();
  let posAttr!: THREE.BufferAttribute, nrmAttr!: THREE.BufferAttribute;
  const coreMat = coreMaterial(PALETTES[0].mat);
  let baseEmissive = PALETTES[0].mat.emissive;
  const body = new THREE.Group();
  scene.add(body);
  const makeLayer = (mat: THREE.Material, film: boolean): Layer => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.visible = false;
    body.add(mesh);
    return { mesh, mat, film, sc: { v: 1 } };
  };
  const films = Array.from({ length: MAX_LAYERS - 1 }, (_, j) => makeLayer(filmMaterial(0.34 + (j % 2) * 0.07), true));
  const core = makeLayer(coreMat, false);
  const allLayers = [...films, core];
  const fade = (L: Layer) => (L.mat as FilmMaterial).userData.fade;
  let stack: Layer[] = [];
  const bs = { s: 1 };

  function bindGeometry(): void {
    posAttr = new THREE.BufferAttribute(soft.positions, 3).setUsage(THREE.DynamicDrawUsage);
    nrmAttr = new THREE.BufferAttribute(soft.normals, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('normal', nrmAttr);
    geo.setIndex(new THREE.BufferAttribute(soft.index, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 4);
  }
  function setDetail(idx: number): void {
    soft = new SoftBody(idx, R);
    bindGeometry();
    endDrag();
    wake();
    $('detailOut').textContent = fmt(soft.n);
    $('detail').setAttribute('aria-valuetext', `${fmt(soft.n)} points`);
    (($('detail')) as HTMLInputElement).value = String(idx);
  }
  const layerTarget = (p: number, m: number) => (m <= 1 ? 1 : 1 - p * Math.min(0.21, 0.42 / (m - 1)));
  function relayout(animate: boolean): void {
    const m = stack.length;
    stack.forEach((L, p) => {
      L.mesh.renderOrder = L.film ? 20 - p : 0;
      gsap.killTweensOf(L.sc);
      const t = layerTarget(p, m);
      if (animate) gsap.to(L.sc, { v: t, duration: reduceMotion ? 0.2 : 0.8, ease: 'elastic.out(1,.5)' });
      else L.sc.v = t;
    });
  }

  /* ---------- sizing ---------- */
  let visW = 1, visH = 1, camZ = 8, homeY = 0;
  function resize(): void {
    const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    visH = aspect >= 1 ? (2 * R) / 0.4 : (2 * R) / (0.6 * aspect);
    visW = visH * aspect;
    camZ = visH / (2 * TAN);
    homeY = -visH * 0.09;
    camera.position.set(0, 0, camZ);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const hp = 2 * (camZ - backdrop.mesh.position.z) * TAN;
    backdrop.mesh.scale.set(hp * aspect, hp, 1);
    backdrop.resize(w, h);
    measureChips();
    wake();
  }

  /* ---------- centre of the body + surface simulation ---------- */
  const P: Physics = { ...PHYS.jelly };
  let kMul = 1, cMul = 1;
  const setWobble = (v: number) => { kMul = THREE.MathUtils.lerp(2.3, 0.42, v); cMul = THREE.MathUtils.lerp(1.9, 0.55, v); };
  setWobble(0.55);
  const C = new THREE.Vector3(), Vc = new THREE.Vector3(), Pw = new THREE.Vector3(), thrust = new THREE.Vector3();
  let simTime = 0, dragging = false, autoDrag = false, grabVi = 0, state: GameState = 'home';
  let sleepFrames = 0, asleep = false;
  const wake = () => { sleepFrames = 0; asleep = false; };
  const outerScale = () => (stack[0] ? stack[0].sc.v : 1) * bs.s;
  const grabTarget = { x: 0, y: 0, z: 0 };

  function step(dt: number): number {
    simTime += dt;
    let ax: number, ay: number, az: number;
    const hy = homeY + (reduceMotion ? 0 : Math.sin(simTime * 1.15) * 0.05);
    const R_ = soft.rest;
    if (state === 'popping') {
      ax = thrust.x - Vc.x * 1.25; ay = thrust.y - Vc.y * 1.25; az = -C.z * 8 - Vc.z * 3;
    } else if (dragging) {
      // pinned to the middle: a strong spring home, and only a slight lean toward the hand
      const g = grabVi * 3, s = outerScale();
      ax = 170 * (0 - C.x) + 14 * (Pw.x - C.x - R_[g] * s) - 18 * Vc.x;
      ay = 170 * (hy - C.y) + 14 * (Pw.y - C.y - R_[g + 1] * s) - 18 * Vc.y;
      az = 170 * (0 - C.z) - 18 * Vc.z;
    } else {
      const kC = state === 'intro' ? 60 : 150, cC = state === 'intro' ? 9 : 11;
      ax = kC * (0 - C.x) - cC * Vc.x; ay = kC * (hy - C.y) - cC * Vc.y; az = kC * (0 - C.z) - cC * Vc.z;
    }
    Vc.x += ax * dt; Vc.y += ay * dt; Vc.z += az * dt;
    C.x += Vc.x * dt; C.y += Vc.y * dt; C.z += Vc.z * dt;
    let grab = null;
    if (dragging) {
      const g = grabVi * 3, s = outerScale();
      grabTarget.x = (Pw.x - C.x) / s - R_[g]; grabTarget.y = (Pw.y - C.y) / s - R_[g + 1]; grabTarget.z = (Pw.z - C.z) / s - R_[g + 2];
      grab = { vertex: grabVi, target: grabTarget, strength: 1600 };
    }
    return soft.step(dt, { k: P.k * kMul, c: P.c * cMul, kc: P.kc, inertia: P.inertia }, ax, ay, az, grab, R * (dragging ? 3.2 : 0.95));
  }
  const impulse = (vi: number, strength: number, s2: number) => { wake(); soft.impulse(vi, strength, s2); };
  const frontVertex = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * 0.7; return soft.nearestDir(Math.cos(a) * r, Math.sin(a) * r, 1); };

  function placeBody(): void {
    body.position.copy(C);
    body.scale.setScalar(bs.s);
    for (const L of allLayers) if (L.mesh.visible) L.mesh.scale.setScalar(L.sc.v);
    body.updateMatrixWorld(true);
  }
  function walls(): void {
    if (state !== 'popping' || !body.visible) return;
    const rr = R * core.sc.v * bs.s * 0.9, mx = visW / 2 - rr, my = visH / 2 - rr;
    if (C.x > mx && Vc.x > 0) { C.x = mx; Vc.x *= -0.62; }
    if (C.x < -mx && Vc.x < 0) { C.x = -mx; Vc.x *= -0.62; }
    if (C.y > my && Vc.y > 0) { C.y = my; Vc.y *= -0.62; }
    if (C.y < -my && Vc.y < 0) { C.y = -my; Vc.y *= -0.62; }
  }

  /* ---------- the quiz ---------- */
  let word: Word | null = null, questions: Question[] = [], correctEdge: Edge = 'top';
  let wrongThisLayer = 0, cleanRun = true, bubblePts = 0, score = 0, streak = 0, cooldown = 0, tension = 0;
  let bubbleWrong = 0, forgotUsed = false;
  let palIdx = 0, layersTotal = 3, firstBubble = true;

  const chips = Object.fromEntries(EDGES.map(edge => {
    const el = document.querySelector<HTMLButtonElement>(`.ans[data-edge="${edge}"]`)!;
    let hot = -1;
    const chip = {
      el,
      setHot(h: number) {
        if (Math.abs(h - hot) < 0.008) return;
        hot = h;
        el.style.setProperty('--hot', h.toFixed(3));
        el.classList.toggle('lit', h > 0.55);
      },
      flash(cls: string, ms: number) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
    };
    el.addEventListener('click', () => autoPull(edge));
    return [edge, chip];
  })) as Record<Edge, { el: HTMLButtonElement; setHot(h: number): void; flash(cls: string, ms: number): void }>;

  // the answer pops when the stretched skin reaches the chip, so measure where each chip starts
  const thr: Record<Edge, number> = { top: 0.85, bottom: 0.85, left: 0.85, right: 0.85 };
  const clampN = (v: number) => Math.max(0.4, Math.min(0.95, v));
  function measureChips(): void {
    const W = window.innerWidth, H = window.innerHeight;
    const t = chips.top.el, b = chips.bottom.el, l = chips.left.el, r = chips.right.el;
    thr.top = clampN(1 - 2 * (t.offsetTop + t.offsetHeight) / H);
    thr.bottom = clampN(2 * b.offsetTop / H - 1);
    thr.left = clampN(1 - 2 * (l.offsetLeft + l.offsetWidth) / W);
    thr.right = clampN(2 * r.offsetLeft / W - 1);
  }
  const chipEls = () => EDGES.map(e => chips[e].el);
  function chipsIn(): void {
    chipEls().forEach(el => el.classList.remove('off', 'hint', 'nope', 'yes', 'reveal'));
    gsap.fromTo(chipEls(), { opacity: 0, '--in': 0.4 }, { opacity: 1, '--in': 1, duration: reduceMotion ? 0.15 : 0.55, stagger: 0.05, ease: 'back.out(2.2)' });
  }
  function chipsOut(): void {
    chipEls().forEach(el => el.classList.add('off'));
    gsap.to(chipEls(), { opacity: 0, '--in': 0.6, duration: 0.25, ease: 'power2.in' });
  }

  const askEl = $('ask'), tipEl = $('tip'), layerTxt = $('layerTxt'), forgotBtn = $('forgot') as HTMLButtonElement;
  function renderPips(): void {
    const pips = $('pips');
    const popped = layersTotal - stack.length;
    pips.querySelectorAll('span').forEach(p => p.remove());
    for (let j = 0; j < layersTotal; j++) {
      const sp = document.createElement('span');
      if (j >= popped) sp.className = 'on';
      pips.insertBefore(sp, layerTxt);
    }
    layerTxt.textContent = stack.length ? `Layer ${Math.min(popped + 1, layersTotal)} of ${layersTotal}` : `${layersTotal} layers popped`;
    forgotBtn.disabled = !(stack.length && stack.length < MAX_LAYERS && questions[0] && !questions[0].revealed);
  }
  function setQuestion(newPrompt: boolean): void {
    const q = questions[0];
    const opts = shuffle(q.choices.slice());
    EDGES.forEach((edge, k) => {
      const el = chips[edge].el;
      el.textContent = opts[k];
      el.classList.toggle('zh', q.chipZh);
      if (q.chipZh) el.setAttribute('lang', 'zh-Hans'); else el.removeAttribute('lang');
      el.setAttribute('aria-label', `Answer: ${opts[k]}`);
      if (opts[k] === q.answer) correctEdge = edge;
      chips[edge].setHot(0);
    });
    measureChips();
    askEl.textContent = q.retest ? `Once more: ${q.ask.charAt(0).toLowerCase()}${q.ask.slice(1)}` : q.ask;
    renderPips();
    if (newPrompt) backdrop.setWord(q.prompt, q.zh); else backdrop.kick();
    chipsIn();
    wrongThisLayer = 0;
  }
  const hud = { score: $('score'), streak: $('streak'), learned: $('learned'), total: $('total') };
  function updateHud(): void {
    hud.score.textContent = fmt(score);
    hud.streak.textContent = String(streak);
    hud.learned.textContent = String(progress.learnedCount(pool()));
    hud.total.textContent = String(pool().length);
  }

  /* ---------- pulling to an edge ---------- */
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3();
  function vertexWorld(v: number, layer: Layer, out: THREE.Vector3): THREE.Vector3 {
    const s = layer.sc.v, p = soft.positions;
    return out.set(p[v * 3] * s, p[v * 3 + 1] * s, p[v * 3 + 2] * s).applyMatrix4(body.matrixWorld);
  }
  function toCanvas(v: THREE.Vector3): { x: number; y: number } {
    const p = _v2.copy(v).project(camera);
    return { x: (p.x * 0.5 + 0.5) * backdrop.cw, y: (1 - (p.y * 0.5 + 0.5)) * backdrop.ch };
  }

  function autoPull(edge: Edge): void {
    if (state !== 'live' || dragging || cooldown > 0) return;
    sound.unlock();
    const [dx, dy] = EDGE_DIR[edge];
    const vi = soft.nearestDir(dx * 0.85, dy * 0.85, 0.55);
    soft.setGrab(vi); grabVi = vi; wake();
    vertexWorld(vi, stack[0], Pw);
    plane.constant = -Pw.z;
    dragging = true; autoDrag = true;
    const f = (camZ - Pw.z) / camZ, reach = Math.min(0.98, thr[edge] * 1.08);
    gsap.to(Pw, { x: dx * visW / 2 * reach * f, y: dy * visH / 2 * reach * f, duration: reduceMotion ? 0.25 : 0.6, ease: 'power2.in' });
  }

  function checkEdge(dt: number): void {
    cooldown = Math.max(0, cooldown - dt);
    let hotEdge: Edge | null = null, hot = 0;
    if (dragging && state === 'live') {
      _q.copy(Pw).project(camera);
      const rx = _q.x, ry = _q.y;
      const px = rx > 0 ? rx / thr.right : -rx / thr.left, py = ry > 0 ? ry / thr.top : -ry / thr.bottom;
      hotEdge = px > py ? (rx > 0 ? 'right' : 'left') : (ry > 0 ? 'top' : 'bottom');
      const pull = Math.max(px, py);
      hot = smooth(0.35, 1, pull);
      tension = hot;
      sound.squeak(hot);
      if (pull >= 1) { judge(hotEdge); hotEdge = null; hot = 0; }
    } else if (tension > 0) {
      tension = Math.max(0, tension - dt * 3);
      if (tension === 0) sound.hush(); else sound.squeak(tension);
    }
    for (const e of EDGES) chips[e].setHot(e === hotEdge ? hot : 0);
    if (state !== 'popping') coreMat.emissiveIntensity = baseEmissive + tension * 0.6;
  }

  function endDrag(): void {
    gsap.killTweensOf(Pw);
    dragging = false; autoDrag = false; soft.clearGrab();
    tension = 0; sound.hush();
  }

  function judge(edge: Edge): void {
    const vi = grabVi;
    endDrag();
    const chip = chips[edge];
    if (edge !== correctEdge) {
      wrongThisLayer++; cleanRun = false; streak = 0; cooldown = 0.4;
      sound.thunk();
      chip.flash('nope', 700);
      gsap.fromTo(chip.el, { '--dx': '0px' }, { keyframes: { '--dx': ['-12px', '12px', '-8px', '8px', '-3px', '0px'] }, duration: 0.45, ease: 'none' });
      impulse(vi, -25 * rm, 0.04);
      impulse(frontVertex(), 18 * rm, 0.05);
      if (wrongThisLayer >= 2) chips[correctEdge].el.classList.add('hint');
      bubbleWrong++;
      updateHud();
      return;
    }
    const first = wrongThisLayer === 0;
    if (first) { streak++; progress.recordStreak(streak); }
    const pts = first ? 10 + Math.min(streak, 10) * 4 : 3;
    score += pts; bubblePts += pts;
    sound.chime(first ? streak : 0);
    chip.flash('yes', 450);
    chips[correctEdge].el.classList.remove('hint');
    updateHud();
    if (stack.length > 1) popLayer(vi); else popCore(vi);
  }

  /* ---------- popping a soap film ---------- */
  let shake = 0;
  const ballPx = () => ballView.r;
  function popLayer(vi: number): void {
    state = 'between';
    body.updateMatrixWorld(true);
    const outer = stack[0];
    const p = toCanvas(vertexWorld(vi, outer, _v));
    backdrop.burst(p.x, p.y, ballPx(), ['#ffffff', '#ffd6f5', '#c9f3ff', '#fff4c2'], 10, false);
    sound.pop(true);
    stack.shift();
    const prev = questions.shift()!;
    gsap.killTweensOf(outer.sc);
    gsap.to(fade(outer), { value: 0, duration: 0.18, ease: 'power2.out', onComplete: () => { outer.mesh.visible = false; } });
    gsap.to(outer.sc, { v: outer.sc.v * 1.25, duration: 0.18, ease: 'power2.out' });
    relayout(true);
    impulse(vi, 30 * rm, 0.04);
    shake = reduceMotion ? 0 : 0.35;
    chipsOut();
    renderPips();
    setTimeout(() => { setQuestion(questions[0].prompt !== prev.prompt); state = 'live'; }, reduceMotion ? 150 : 420);
  }

  /* ---------- forgot: show the answer, add a layer so it is asked again before the core ---------- */
  function forgot(): void {
    if (state !== 'live' || dragging || stack.length >= MAX_LAYERS || !questions[0] || questions[0].revealed || !word) return;
    sound.unlock();
    const q = questions[0];
    questions = applyForgot(questions, word, pool());
    const film = films.find(f => !stack.includes(f))!;
    fade(film).value = 0;
    film.mesh.visible = true;
    film.sc.v = 1.3;
    stack.unshift(film);
    layersTotal++;
    relayout(true);
    gsap.to(fade(film), { value: 1, duration: 0.35, ease: 'power2.out' });
    sound.inflate();
    impulse(frontVertex(), 22 * rm, 0.06);
    streak = 0; cleanRun = false; wrongThisLayer = 1; forgotUsed = true;
    updateHud();
    chips[correctEdge].el.classList.add('hint', 'reveal');
    askEl.textContent = q.type === 2 ? `It’s ${q.answer}. Pull it there.` : `It’s “${q.answer}”. Pull it there.`;
    if (q.type !== 0) voice.say(word);
    renderPips();
  }
  forgotBtn.addEventListener('click', forgot);

  /* ---------- popping the core: deflate, fly away, spew the next palette, show the slip ---------- */
  const POP_DUR = reduceMotion ? 0.8 : 1.45;
  let popT = 0, holeV = 0, pendingPal = 0, lastDue = new Date();
  const spin = new THREE.Vector3(), _dq = new THREE.Quaternion(), _axis = new THREE.Vector3();
  function popCore(vi: number): void {
    state = 'popping'; popT = 0; holeV = vi;
    canvas.style.cursor = 'default';
    gsap.killTweensOf(bs);
    spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(5);
    impulse(vi, 50 * rm, 0.012);
    do { pendingPal = Math.floor(Math.random() * PALETTES.length); } while (pendingPal === palIdx);
    backdrop.floodColor = PALETTES[pendingPal].bg;
    coreMat.emissiveIntensity = baseEmissive;
    body.updateMatrixWorld(true);
    const p = toCanvas(vertexWorld(vi, core, _v));
    backdrop.burst(p.x, p.y, ballPx(), [PALETTES[palIdx].mat.color], 9, true);
    backdrop.blast(p.x, p.y);
    shake = reduceMotion ? 0 : 1;
    sound.pop(false); sound.deflate(POP_DUR);
    chipsOut();
    askEl.textContent = 'Popped!';
    stack = [];
    renderPips();
    if (word) lastDue = progress.review(word.id, gradeBubble({ wrong: bubbleWrong, forgot: forgotUsed })).due;
    updateHud();
  }
  function holeScreen(): { x: number; y: number; nx: number; ny: number } {
    vertexWorld(holeV, core, _v);
    const nr = soft.normals;
    _n.set(nr[holeV * 3], nr[holeV * 3 + 1], nr[holeV * 3 + 2]).applyQuaternion(body.quaternion).normalize();
    const a = toCanvas(_v);
    const b = toCanvas(_v2.copy(_v).addScaledVector(_n, 0.5));
    const nx = b.x - a.x, ny = b.y - a.y, l = Math.hypot(nx, ny) || 1;
    return { x: a.x, y: a.y, nx: nx / l, ny: ny / l };
  }
  function updatePop(dt: number): void {
    popT += dt;
    const u = Math.min(popT / POP_DUR, 1);
    bs.s = Math.max(0.03, 1 - u * u * 0.97);
    body.updateMatrixWorld(true);
    const hp = holeScreen();
    thrust.copy(_n).multiplyScalar(-(reduceMotion ? 28 : 80) * (1 - u * 0.55) * (0.7 + 0.3 * Math.sin(popT * 31)));
    // the balloon tumbles as it empties
    spin.x += rand(-1, 1) * dt * 40; spin.y += rand(-1, 1) * dt * 40; spin.z += rand(-1, 1) * dt * 40;
    if (spin.length() > 10) spin.setLength(10);
    const ang = spin.length() * dt;
    if (ang > 0) { _axis.copy(spin).normalize(); _dq.setFromAxisAngle(_axis, ang); body.quaternion.premultiply(_dq); }
    if (Math.random() < 0.6) impulse(Math.floor(Math.random() * soft.n), rand(4, 14) * rm, 0.02);
    if (u < 0.98 && body.visible) backdrop.spew(hp.x, hp.y, hp.nx, hp.ny, reduceMotion ? 1 : Math.round(5 * (1 - u * 0.5)), Vc.x, Vc.y);
    if (!backdrop.flooding && popT >= POP_DUR * 0.7) backdrop.startFlood(hp.x, hp.y);
    if (popT >= POP_DUR) body.visible = false;
    if (backdrop.floodDone && popT >= POP_DUR) {
      commitPalette(pendingPal, false);
      state = 'note';
      showNote();
    }
  }

  /* ---------- palettes and new bubbles ---------- */
  function commitPalette(i: number, instant: boolean): void {
    palIdx = i;
    const p = PALETTES[i];
    backdrop.setColors(p.bg, p.ui, p.shadow);
    gsap.to(document.documentElement, { '--bg': p.bg, '--ui': p.ui, '--ui-dim': p.dim, '--line': p.line, duration: instant ? 0 : 0.45, ease: 'power2.out' });
    renderer.setClearColor(p.bg);
    env.build(p.bg);
  }
  function spawnBubble(): void {
    word = scheduler.next(pool(), progress.data);
    questions = makeQuestions(word, pool());
    voice.preload(word);
    cleanRun = true; bubblePts = 0; bubbleWrong = 0; forgotUsed = false;
    const pal = PALETTES[palIdx];
    applyCore(coreMat, pal.mat);
    baseEmissive = pal.mat.emissive;
    Object.assign(P, PHYS[pal.kind]);
    soft.reset();
    allLayers.forEach(L => {
      L.mesh.visible = false;
      gsap.killTweensOf(L.sc);
      if (L.film) { gsap.killTweensOf(fade(L)); fade(L).value = 1; }
    });
    stack = [films[0], films[1], core];
    stack.forEach(L => { L.mesh.visible = true; });
    layersTotal = stack.length;
    relayout(false);
    body.quaternion.identity(); body.visible = true;
    C.set(0, homeY - visH * 0.25, 0); Vc.set(0, 3.5, 0);
    bs.s = 0.02; state = 'intro';
    gsap.to(bs, { s: 1, duration: reduceMotion ? 0.3 : 1.2, ease: 'elastic.out(1,.42)', onComplete: () => { state = 'live'; } });
    sound.inflate();
    setQuestion(true);
    tipEl.style.display = firstBubble ? '' : 'none';
    firstBubble = false;
    wake();
    $('title').textContent = `Squish: ${word.e}`;
  }

  /* ---------- the fortune slip ---------- */
  const noteEl = $('note'), slipEl = $('slip'), nextBtn = $('next') as HTMLButtonElement;
  let noteOpen = false;
  const luckyNumbers = () => { const s = new Set<number>(); while (s.size < 6) s.add(1 + Math.floor(Math.random() * 49)); return [...s].sort((a, b) => a - b).join('  '); };
  function showNote(): void {
    if (!word) return;
    noteOpen = true;
    const next = dueLabel({ due: lastDue }, new Date()).replace('due now', 'right away');
    $('result').textContent = cleanRun
      ? `Clean pop, ${bubblePts} points. Streak ${streak}. Next review ${next}.`
      : `${bubblePts} points. This word comes back ${next}.`;
    $('fortuneText').textContent = fortunes.next();
    $('zhBig').textContent = word.h;
    $('zhPy').textContent = word.p;
    $('zhEn').textContent = word.e;
    $('lucky').textContent = luckyNumbers();
    $('novoice').hidden = voice.hasClip(word) || (speech.available && speech.hasChineseVoice());
    renderExample(word);
    noteEl.hidden = false;
    gsap.killTweensOf([slipEl, nextBtn]);
    gsap.fromTo(slipEl, { scaleX: 0.04, scaleY: 0.5, rotation: -10, y: 40, opacity: 0 }, { scaleX: 1, scaleY: 1, rotation: rand(-2, 2), y: 0, opacity: 1, duration: reduceMotion ? 0.2 : 1.15, ease: 'elastic.out(1,.5)' });
    gsap.fromTo(nextBtn, { opacity: 0, y: 14 }, { opacity: 1, y: 0, delay: reduceMotion ? 0 : 0.5, duration: 0.45, ease: 'power2.out' });
    sound.paper();
    const w = word;
    setTimeout(() => voice.say(w), 650);
    setTimeout(() => nextBtn.focus({ preventScroll: true }), 80);
  }
  /* ---------- example sentence: tap a word to hear it cut from the spoken sentence ---------- */
  const wordsById = new Map(WORDS.map(w => [w.id, w]));
  let example: Sentence | null = null;
  function renderExample(w: Word): void {
    const box = $('example'), zh = $('exZh');
    const list = examplesFor(w.id, progress.data.settings.maxLevel);
    example = list[Math.floor(Math.random() * Math.min(3, list.length))] ?? null;
    box.hidden = !example;
    if (!example) return;
    const s = example;
    zh.replaceChildren();
    let i = 0;
    s.chunks.forEach((c, ci) => {
      for (const p of s.punct.filter(x => x.at === ci)) zh.append(Object.assign(document.createElement('span'), { className: 'pu', textContent: p.p }));
      for (const id of c.words) {
        const word = wordsById.get(id)!, index = i++;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `tok${c.role ? ` r-${c.role}` : ''}${id === w.id ? ' me' : ''}`;
        b.dataset.i = String(index);
        const py = s.py[index] ?? word.p;
        b.setAttribute('aria-label', `${word.h}, ${py}, ${word.e}${c.role ? ` (${ROLE_NAMES[c.role]})` : ''}`);
        b.append(Object.assign(document.createElement('span'), { className: 'py', textContent: py }), Object.assign(document.createElement('span'), { className: 'hz', textContent: word.h }));
        b.addEventListener('click', () => { void voice.sayWordIn(s, index, word, slowVoice); });
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
  const highlight = (i: number | null) => $('exZh').querySelectorAll<HTMLElement>('.tok').forEach(t => t.classList.toggle('on', t.dataset.i === String(i)));
  $('exPlay').addEventListener('click', () => { if (example) void voice.saySentence(example, false, highlight); });
  $('exSlow').addEventListener('click', () => { if (example) void voice.saySentence(example, true, highlight); });

  function closeNote(): void {
    if (!noteOpen) return;
    noteOpen = false;
    voice.stop();
    highlight(null);
    sound.paper();
    gsap.to(slipEl, { y: -50, rotation: rand(-16, 16), scale: 0.9, opacity: 0, duration: 0.42, ease: 'power2.in' });
    gsap.to(nextBtn, { opacity: 0, duration: 0.25, onComplete: () => { noteEl.hidden = true; gsap.set(slipEl, { scale: 1 }); } });
    setTimeout(spawnBubble, 250);
    canvas.focus({ preventScroll: true });
  }
  nextBtn.addEventListener('click', closeNote);
  $('hear').addEventListener('click', () => { if (word) voice.say(word); });
  $('hearSlow').addEventListener('click', () => { if (word) voice.say(word, true); });

  /* ---------- your words ---------- */
  const drawer = $('drawer'), wordsList = $('wordsList'), slowToggle = $('slowToggle');
  let slowVoice = false;
  slowToggle.addEventListener('click', () => {
    slowVoice = !slowVoice;
    slowToggle.setAttribute('aria-pressed', String(slowVoice));
    slowToggle.textContent = slowVoice ? 'Slow voice on' : 'Slow voice';
  });
  function openDrawer(): void {
    const now = new Date();
    const met = pool().filter(w => progress.card(w.id))
      .sort((x, y) => (progress.card(y.id)!.last_review?.getTime() ?? 0) - (progress.card(x.id)!.last_review?.getTime() ?? 0));
    $('drawerSub').textContent = `${progress.learnedCount(pool())} learned, ${met.length} met, ${progress.dueCount(pool())} due. ${pool().length} words up to HSK ${progress.data.settings.maxLevel}. Best streak ${progress.data.best}.`;
    wordsList.replaceChildren();
    if (!met.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Pop your first bubble and its word will land here. Tap a word to hear it.';
      wordsList.appendChild(li);
    }
    for (const w of met) {
      const li = document.createElement('li'), b = document.createElement('button'), card = progress.card(w.id)!, lv = masteryDots(card);
      b.type = 'button';
      const h = Object.assign(document.createElement('span'), { className: 'h', textContent: w.h });
      h.lang = 'zh-Hans';
      const pEl = Object.assign(document.createElement('span'), { className: 'p', textContent: w.p });
      const e = Object.assign(document.createElement('span'), { className: 'e', textContent: w.e });
      const dots = Object.assign(document.createElement('span'), { className: 'lv' });
      dots.setAttribute('aria-label', `Mastery ${lv} of 3`);
      for (let i = 0; i < 3; i++) dots.appendChild(Object.assign(document.createElement('i'), { className: lv > i ? 'on' : '' }));
      const due = Object.assign(document.createElement('span'), { className: 'due', textContent: dueLabel(card, now) });
      b.append(h, pEl, e, dots, due);
      b.addEventListener('click', () => voice.say(w, slowVoice));
      li.appendChild(b); wordsList.appendChild(li);
    }
    drawer.hidden = false;
    gsap.fromTo(drawer, { xPercent: 100 }, { xPercent: 0, duration: reduceMotion ? 0.01 : 0.45, ease: 'power3.out', overwrite: true });
    $('drawerClose').focus({ preventScroll: true });
  }
  function closeDrawer(): void {
    gsap.to(drawer, { xPercent: 100, duration: reduceMotion ? 0.01 : 0.3, ease: 'power2.in', overwrite: true, onComplete: () => { drawer.hidden = true; } });
    $('wordsBtn').focus({ preventScroll: true });
  }
  $('wordsBtn').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!drawer.hidden) closeDrawer(); else if (noteOpen) closeNote();
  });

  /* ---------- pointer and keyboard ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitP = new THREE.Vector3();
  let downAt = 0, downX = 0, downY = 0, moved = 0, lastHover: THREE.Vector3 | null = null, lastHoverT = 0;
  function castFrom(e: PointerEvent): void {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function hitBody(): THREE.Intersection | null {
    if (!body.visible || !stack[0]) return null;
    return ray.intersectObject(stack[0].mesh, false)[0] ?? null;
  }
  function clampToView(v: THREE.Vector3): void {
    const f = (camZ - v.z) / camZ, mx = visW / 2 * f, my = visH / 2 * f;
    v.x = Math.max(-mx, Math.min(mx, v.x)); v.y = Math.max(-my, Math.min(my, v.y));
  }
  function closestCorner(h: THREE.Intersection): number {
    const f = h.face!;
    let best = Infinity, bi = f.a;
    for (const v of [f.a, f.b, f.c]) { const d = vertexWorld(v, stack[0], _v).distanceToSquared(h.point); if (d < best) { best = d; bi = v; } }
    return bi;
  }
  document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
  document.addEventListener('keydown', () => sound.unlock(), { capture: true });
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'live' || cooldown > 0 || dragging) return;
    castFrom(e);
    const h = hitBody();
    if (!h) return;
    grabVi = closestCorner(h);
    soft.setGrab(grabVi); wake();
    plane.constant = -h.point.z;
    Pw.copy(h.point);
    dragging = true; autoDrag = false; moved = 0; downAt = performance.now(); downX = e.clientX; downY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    castFrom(e);
    if (dragging && !autoDrag) {
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      if (ray.ray.intersectPlane(plane, hitP)) { Pw.copy(hitP); clampToView(Pw); }
      return;
    }
    if (state !== 'live' && state !== 'intro') { canvas.style.cursor = 'default'; return; }
    const now = performance.now(), h = hitBody();
    if (h) {
      canvas.style.cursor = 'grab';
      const p = h.point.clone();
      if (lastHover && now - lastHoverT < 120) {
        const sp = p.distanceTo(lastHover) / Math.max((now - lastHoverT) / 1000, 0.004);
        if (sp > 0.3) impulse(closestCorner(h), Math.min(sp * 2.2, 13) * P.hover * rm, 0.012);
      }
      lastHover = p; lastHoverT = now;
    } else { canvas.style.cursor = 'default'; lastHover = null; }
  });
  function release(e: PointerEvent): void {
    if (!dragging || autoDrag) return;
    const vi = grabVi;
    endDrag();
    if (moved < 6 && performance.now() - downAt < 260) impulse(vi, 30 * rm, 0.01);
    canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { lastHover = null; });
  canvas.addEventListener('keydown', e => {
    const map: Record<string, Edge> = { ArrowUp: 'top', ArrowDown: 'bottom', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) { e.preventDefault(); autoPull(map[e.key]); }
    else if (e.key === ' ') { e.preventDefault(); if (state === 'live') impulse(frontVertex(), 30 * rm, 0.01); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); forgot(); }
  });

  /* ---------- controls ---------- */
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
  $('wobble').addEventListener('input', e => { setWobble(+(e.target as HTMLInputElement).value / 100); wake(); });
  $('detail').addEventListener('input', e => {
    const input = e.target as HTMLInputElement, idx = +input.value;
    if (state === 'popping' || dragging) { input.value = String(soft.detailIndex); return; }
    if (idx !== soft.detailIndex) { setDetail(idx); impulse(frontVertex(), 20 * rm, 0.03); }
  });
  window.addEventListener('resize', resize);

  /* ---------- performance guard: drop detail, then resolution, if frames stay slow ---------- */
  let ema = 16, slowT = 0;
  function perfGuard(rawMs: number, dt: number): void {
    if (opts.e2e || document.hidden || rawMs > 250) return;
    ema = ema * 0.94 + rawMs * 0.06;
    if (ema > 26) slowT += dt; else slowT = Math.max(0, slowT - dt * 0.5);
    if (slowT > 2.5 && state !== 'popping' && !dragging) {
      slowT = 0; ema = 16;
      if (soft.detailIndex > 0) setDetail(soft.detailIndex - 1);
      else if (pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
    }
  }

  /* ---------- loop ---------- */
  const ballView: BallView = { x: 0, y: 0, r: 100, vx: 0, vy: 0, visible: true, pushing: true };
  const _p = new THREE.Vector3();
  function projectBall(): void {
    _p.copy(C).project(camera);
    if (!isFinite(_p.x) || !isFinite(_p.y)) return;
    const ppu = backdrop.ch / (2 * (camZ - C.z) * TAN);
    ballView.x = (_p.x * 0.5 + 0.5) * backdrop.cw;
    ballView.y = (1 - (_p.y * 0.5 + 0.5)) * backdrop.ch;
    ballView.r = R * (stack[0] ? stack[0].sc.v : core.sc.v) * bs.s * ppu;
    ballView.vx = Vc.x * ppu; ballView.vy = -Vc.y * ppu;
    ballView.visible = body.visible;
    ballView.pushing = body.visible && state !== 'popping';
  }
  let last = performance.now(), acc = 0;
  function frame(now: number): void {
    const rawMs = now - last;
    const dt = Math.min(rawMs / 1000, maxFrameDt);
    last = now;
    perfGuard(rawMs, dt);
    if (state === 'popping') updatePop(dt);
    if (!asleep) {
      // fixed sub-steps; the body falls asleep when it is still and skips the physics entirely
      acc += dt;
      let n = 0, vmax = 0;
      const maxSteps = Math.ceil(maxFrameDt / soft.dt) + 1;
      while (acc >= soft.dt && n < maxSteps) { vmax = Math.max(vmax, step(soft.dt)); acc -= soft.dt; n++; }
      if (n >= maxSteps) acc = 0;
      soft.updateGeometry();
      posAttr.needsUpdate = true; nrmAttr.needsUpdate = true;
      const calm = state === 'live' && !dragging && vmax < 0.004 && Vc.lengthSq() < 0.0004 && tension === 0;
      sleepFrames = calm ? sleepFrames + 1 : 0;
      if (sleepFrames > 45) { asleep = true; acc = 0; }
    } else {
      simTime += dt;
      C.y = homeY + (reduceMotion ? 0 : Math.sin(simTime * 1.15) * 0.05);
      if (state !== 'live' || dragging) wake();
    }
    walls();
    placeBody();
    checkEdge(dt);
    projectBall();
    backdrop.update(dt, ballView);
    backdrop.render(ballView);
    if (shake > 0) { shake = Math.max(0, shake - dt * 4); camera.position.set(rand(-1, 1) * 0.09 * shake, rand(-1, 1) * 0.09 * shake, camZ); }
    else camera.position.set(0, 0, camZ);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  /* ---------- home screen: each mode is a bubble you pop to enter ---------- */
  const homeEl = $('home');
  const levelBtns = [...homeEl.querySelectorAll<HTMLButtonElement>('[data-level]')];
  function renderHome(): void {
    const max = progress.data.settings.maxLevel;
    levelBtns.forEach(b => {
      const lv = Number(b.dataset.level);
      b.hidden = !LEVELS.includes(lv);
      b.setAttribute('aria-checked', String(lv === max));
    });
    const p = pool(), due = progress.dueCount(p), fresh = progress.newCount(p);
    $('homeStats').textContent = due
      ? `${due} ${due === 1 ? 'word is' : 'words are'} due for review, and ${fresh} new ${fresh === 1 ? 'word waits' : 'words wait'}.`
      : fresh ? `Nothing due right now. ${fresh} new ${fresh === 1 ? 'word' : 'words'} to meet up to HSK ${progress.data.settings.maxLevel}.`
      : `You have met every word up to HSK ${progress.data.settings.maxLevel}. Reviews will come as they fall due.`;
    updateHud();
  }
  levelBtns.forEach(b => b.addEventListener('click', () => { progress.setMaxLevel(Number(b.dataset.level)); renderHome(); }));
  function showHome(): void {
    if (state === 'popping') return;
    endDrag();
    gsap.killTweensOf(bs);
    state = 'home';
    body.visible = false;
    noteOpen = false; noteEl.hidden = true;
    chipsOut();
    backdrop.setWord('', false);
    document.body.classList.add('at-home');
    homeEl.hidden = false;
    renderHome();
    gsap.fromTo(homeEl.querySelectorAll('.mode'), { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: reduceMotion ? 0.1 : 0.9, stagger: 0.07, ease: 'elastic.out(1,.45)' });
    homeEl.querySelector<HTMLButtonElement>('[data-mode="words"]')?.focus({ preventScroll: true });
    $('title').textContent = 'Squish: pop bubbles to learn Chinese';
  }
  function enter(mode: 'words'): void {
    if (state !== 'home') return;
    sound.unlock();
    sound.pop(false);
    const btn = homeEl.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
    gsap.to(btn, { scale: 1.35, opacity: 0, duration: 0.22, ease: 'power2.out' });
    gsap.to(homeEl, { opacity: 0, duration: 0.3, delay: 0.1, onComplete: () => {
      homeEl.hidden = true;
      gsap.set(homeEl, { opacity: 1 });
      document.body.classList.remove('at-home');
      spawnBubble();
    } });
  }
  homeEl.querySelector('[data-mode="words"]')!.addEventListener('click', () => enter('words'));
  $('homeBtn').addEventListener('click', () => showHome());

  /* ---------- boot ---------- */
  setDetail(1);
  resize();
  commitPalette(0, true);
  showHome();
  if (!reduceMotion) gsap.from('.corner', { opacity: 0, y: 10, duration: 0.8, delay: 0.6, stagger: 0.08, ease: 'power2.out' });
  requestAnimationFrame(t => { last = t; frame(t); });
  document.fonts?.ready.then(() => { backdrop.layout(); measureChips(); }).catch(() => {});

  return {
    enter,
    home: showHome,
    snapshot: () => ({
      state, word: word?.h ?? null, layers: stack.length, totalLayers: layersTotal, correctEdge,
      score, streak, detail: DETAILS[soft.detailIndex].level, asleep, wrong: wrongThisLayer,
      queue: questions.map(q => `${q.type}${q.revealed ? 'r' : ''}${q.retest ? 't' : ''}`),
      pool: pool().length, due: progress.dueCount(pool()), maxLevel: progress.data.settings.maxLevel
    })
  };
}
