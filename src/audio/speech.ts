/**
 * Pronunciation through the browser's speech synthesis (Web Speech API). The voice comes from
 * whatever Chinese voice the operating system or browser provides, so quality varies by device
 * and some devices have none. Phase 1 replaces this with pre-generated clips.
 */
export class Speech {
  private voice: SpeechSynthesisVoice | null = null;
  enabled = true;

  constructor(private readonly synth: SpeechSynthesis | undefined = typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined) {
    if (!this.synth) return;
    this.pick();
    this.synth.addEventListener?.('voiceschanged', () => this.pick());
  }

  private pick(): void {
    const vs = this.synth?.getVoices() ?? [];
    this.voice = vs.find(v => /^zh[-_](CN|Hans)/i.test(v.lang)) ?? vs.find(v => /^zh/i.test(v.lang)) ?? null;
  }

  get available(): boolean { return !!this.synth; }
  hasChineseVoice(): boolean { if (!this.voice) this.pick(); return !!this.voice; }

  speak(text: string, slow = false): void {
    if (!this.enabled || !this.synth) return;
    try {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (this.voice) u.voice = this.voice;
      u.rate = slow ? 0.42 : 0.8;
      this.synth.speak(u);
    } catch {
      // Some browsers throw if speech is unavailable; the game carries on silently.
    }
  }

  cancel(): void { this.synth?.cancel(); }
}
