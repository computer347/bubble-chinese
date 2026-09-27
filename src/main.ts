import './styles.css';
import './theme/glass.css';
import './theme/ink.css';
import { startGame, type GameHandle } from './game/game';
import { Progress, IndexedDbStore, MemoryStore } from './game/progress';
import { WORDS } from './content/words';

declare global {
  interface Window { __squish?: GameHandle }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const e2e = params.has('e2e');
  // tests start from a clean slate; players keep their progress in IndexedDB
  const progress = new Progress(e2e || typeof indexedDB === 'undefined' ? new MemoryStore() : new IndexedDbStore(), WORDS);
  await progress.init(e2e ? null : undefined);
  const game = startGame({
    canvas: document.getElementById('stage') as HTMLCanvasElement,
    progress,
    reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    e2e
  });
  if (e2e) window.__squish = game;
}

/** ?fps shows a small frame-rate meter, for checking the performance budget on real devices. */
function fpsMeter(): void {
  const el = Object.assign(document.createElement('div'), { id: 'fps' });
  el.style.cssText = 'position:fixed;z-index:9;left:50%;bottom:6px;transform:translateX(-50%);font:12px ui-monospace,monospace;color:var(--ui);opacity:.8;pointer-events:none';
  document.body.appendChild(el);
  let frames = 0, t0 = performance.now(), worst = 0, last = t0;
  const tick = (now: number) => {
    frames++; worst = Math.max(worst, now - last); last = now;
    if (now - t0 >= 1000) {
      el.textContent = `${Math.round(frames * 1000 / (now - t0))} fps, worst frame ${worst.toFixed(0)} ms`;
      frames = 0; worst = 0; t0 = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (new URLSearchParams(location.search).has('fps')) fpsMeter();
void boot();
