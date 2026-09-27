import { $, fmt } from './dom';

/** The corners: score and streak, the layer pips, the question and the "I forgot" button. */
export class Hud {
  readonly forgot = $('forgot') as HTMLButtonElement;
  private readonly score = $('score');
  private readonly streak = $('streak');
  private readonly learned = $('learned');
  private readonly total = $('total');
  private readonly askEl = $('ask');
  private readonly tipEl = $('tip');
  private readonly pips = $('pips');
  private readonly layerTxt = $('layerTxt');

  stats(s: { score: number; streak: number; learned: number; total: number }): void {
    this.score.textContent = fmt(s.score);
    this.streak.textContent = String(s.streak);
    this.learned.textContent = String(s.learned);
    this.total.textContent = String(s.total);
  }

  ask(text: string): void { this.askEl.textContent = text; }

  /** The mode's name at the top centre, in English and characters ("Listen 听"), or none. */
  modeLabel(label: { en: string; zh: string; py: string } | null): void {
    const el = $('modeLabel');
    el.hidden = !label;
    document.body.classList.toggle('labelled', !!label);
    if (!label) return;
    const zh = Object.assign(document.createElement('span'), { className: 'zh', textContent: label.zh, title: label.py });
    zh.lang = 'zh-Hans';
    el.replaceChildren(label.en, zh);
  }

  tip(show: boolean): void { this.tipEl.style.display = show ? '' : 'none'; }

  /** One pip per layer, lit while the layer is still on; `left` layers remain of `total`. */
  layers(left: number, total: number, canForget: boolean): void {
    const popped = total - left;
    this.pips.querySelectorAll('span').forEach(p => p.remove());
    for (let j = 0; j < total; j++) {
      const sp = document.createElement('span');
      if (j >= popped) sp.className = 'on';
      this.pips.insertBefore(sp, this.layerTxt);
    }
    this.layerTxt.textContent = left ? `Layer ${Math.min(popped + 1, total)} of ${total}` : `${total} layers popped`;
    this.forgot.disabled = !canForget;
  }
}
