/**
 * All game sounds are synthesised live with the Web Audio API, so there are no audio files.
 * Pronunciation uses the browser's speech synthesis (see speech.ts) until Phase 1 adds recorded clips.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private squeakNodes: { o: OscillatorNode; bp: BiquadFilterNode; g: GainNode } | null = null;
  private _enabled = true;

  get enabled(): boolean { return this._enabled; }

  /** Must be called from a user gesture before anything can play. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._enabled ? 0.7 : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05);
  }

  private get ready(): boolean { return !!this.ctx && this.ctx.state === 'running' && this._enabled; }
  private get c(): AudioContext { return this.ctx!; }
  private get out(): GainNode { return this.master!; }

  private noise(): AudioBufferSourceNode {
    const s = this.c.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    return s;
  }
  private env(g: GainNode, t: number, a: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  private filter(type: BiquadFilterType, f: number, q = 1): BiquadFilterNode {
    const b = this.c.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }
  private osc(type: OscillatorType): OscillatorNode { const o = this.c.createOscillator(); o.type = type; return o; }
  private gain(): GainNode { return this.c.createGain(); }

  /** A burst. Soft pops are the lighter sound used for soap films. */
  pop(soft = false): void {
    if (!this.ready) return;
    const t = this.c.currentTime, k = soft ? 0.55 : 1;
    const n = this.noise(), g = this.gain(); this.env(g, t, 0.002, k, soft ? 0.09 : 0.14);
    n.connect(this.filter('highpass', soft ? 1400 : 650)).connect(g).connect(this.out); n.start(t, Math.random()); n.stop(t + 0.16);
    const n2 = this.noise(), g2 = this.gain(); this.env(g2, t, 0.001, 0.9 * k, 0.04);
    n2.connect(this.filter('bandpass', soft ? 5200 : 3400, 0.7)).connect(g2).connect(this.out); n2.start(t); n2.stop(t + 0.05);
    const o = this.osc('sine'), g3 = this.gain();
    o.frequency.setValueAtTime(soft ? 320 : 170, t); o.frequency.exponentialRampToValueAtTime(soft ? 90 : 38, t + 0.14);
    this.env(g3, t, 0.003, 0.8 * k, 0.18); o.connect(g3).connect(this.out); o.start(t); o.stop(t + 0.2);
  }

  /** The rising balloon squeal while the core empties. */
  deflate(dur: number): void {
    if (!this.ready) return;
    const t = this.c.currentTime + 0.04;
    const trem = this.gain(); trem.gain.value = 0.55;
    const lfo = this.osc('sine'), lg = this.gain(); lg.gain.value = 0.45;
    lfo.frequency.setValueAtTime(19, t); lfo.frequency.linearRampToValueAtTime(41, t + dur);
    lfo.connect(lg).connect(trem.gain);
    const out = this.gain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.4, t + 0.05);
    out.gain.setValueAtTime(0.4, t + dur * 0.55); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    trem.connect(out).connect(this.out);
    const o = this.osc('sawtooth');
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(620, t + dur);
    const bp = this.filter('bandpass', 900, 2.2); bp.frequency.linearRampToValueAtTime(2400, t + dur);
    o.connect(bp).connect(trem);
    const n = this.noise(), ng = this.gain(); ng.gain.value = 0.5;
    n.connect(this.filter('bandpass', 1700, 0.9)).connect(ng).connect(trem);
    [o, n, lfo].forEach(s => { s.start(t); s.stop(t + dur + 0.05); });
  }

  inflate(): void {
    if (!this.ready) return;
    const t = this.c.currentTime;
    const n = this.noise(), lp = this.filter('lowpass', 250, 0.7), g = this.gain();
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.8);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    n.connect(lp).connect(g).connect(this.out); n.start(t, Math.random()); n.stop(t + 1);
    const o = this.osc('sine'), og = this.gain();
    o.frequency.setValueAtTime(70, t + 0.55); o.frequency.exponentialRampToValueAtTime(190, t + 0.8);
    this.env(og, t + 0.55, 0.02, 0.22, 0.45); o.connect(og).connect(this.out); o.start(t + 0.55); o.stop(t + 1.05);
  }

  /** Wrong answer. */
  thunk(): void {
    if (!this.ready) return;
    const t = this.c.currentTime;
    const o = this.osc('square'), g = this.gain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(62, t + 0.2);
    this.env(g, t, 0.004, 0.16, 0.24); o.connect(this.filter('lowpass', 700)).connect(g).connect(this.out); o.start(t); o.stop(t + 0.26);
    const o2 = this.osc('sine'), g2 = this.gain();
    o2.frequency.setValueAtTime(260, t + 0.02); o2.frequency.exponentialRampToValueAtTime(110, t + 0.35);
    const vib = this.osc('sine'), vg = this.gain(); vib.frequency.value = 14; vg.gain.value = 20; vib.connect(vg).connect(o2.frequency);
    this.env(g2, t + 0.02, 0.01, 0.14, 0.36); o2.connect(g2).connect(this.out);
    [o2, vib].forEach(s => { s.start(t + 0.02); s.stop(t + 0.4); });
  }

  /** Right answer. Pitch climbs with the streak. */
  chime(streak: number): void {
    if (!this.ready) return;
    const t = this.c.currentTime, f = 587.33 * Math.pow(2, Math.min(streak, 12) / 12);
    ([[f, 0.16], [f * 2, 0.06], [f * 1.5, 0.05]] as const).forEach(([fr, a], i) => {
      const o = this.osc('sine'), g = this.gain(); o.frequency.value = fr;
      this.env(g, t + i * 0.03, 0.005, a, 0.7); o.connect(g).connect(this.out); o.start(t + i * 0.03); o.stop(t + 0.8);
    });
  }

  paper(): void {
    if (!this.ready) return;
    const t0 = this.c.currentTime;
    for (let i = 0; i < 7; i++) {
      const t = t0 + i * 0.045 + Math.random() * 0.025;
      const n = this.noise(), g = this.gain(); this.env(g, t, 0.002, 0.15 + Math.random() * 0.1, 0.035);
      n.connect(this.filter('highpass', 2200 + Math.random() * 2500)).connect(g).connect(this.out);
      n.start(t, Math.random()); n.stop(t + 0.05);
    }
  }

  /** Rubber creak while the skin is under tension (0–1). */
  squeak(tension: number): void {
    if (!this.ready) return;
    if (!this.squeakNodes) {
      const o = this.osc('triangle'), bp = this.filter('bandpass', 900, 3), g = this.gain();
      g.gain.value = 0; o.connect(bp).connect(g).connect(this.out); o.start();
      this.squeakNodes = { o, bp, g };
    }
    const { o, bp, g } = this.squeakNodes;
    const t = this.c.currentTime, f = 240 + tension * 950 + (Math.random() - 0.5) * 90 * tension;
    o.frequency.setTargetAtTime(f, t, 0.02);
    bp.frequency.setTargetAtTime(f * 1.6, t, 0.03);
    g.gain.setTargetAtTime(tension > 0.04 ? 0.012 + tension * 0.11 * (0.75 + Math.random() * 0.5) : 0, t, 0.03);
  }

  hush(): void {
    if (this.squeakNodes && this.ctx) this.squeakNodes.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }
}
