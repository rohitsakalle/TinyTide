// Short, synthesized notes keep the whole sound palette available offline.
export class TideSound {
  constructor({ muted = false, createContext = () => {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) throw new Error("Web Audio is not supported in this browser");
    return new Audio();
  }, onError = console.warn } = {}) {
    this.muted = muted;
    this.createContext = createContext;
    this.onError = onError;
    this.context = null;
    this.voices = new Set();
    this.failed = false;
  }

  async unlock() {
    if (this.muted || this.failed) return;
    try {
      if (!this.context) this.context = this.createContext();
      if (this.context.state !== "running") await this.context.resume();
    } catch (error) {
      this.failed = true;
      this.stop();
      this.onError(error);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.stop();
  }

  stop() {
    for (const voice of this.voices) {
      voice.oscillator.stop();
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
  }

  play(name) {
    if (this.muted || this.failed || this.context?.state !== "running") return;
    const notes = {
      start: [[523, 0, .13], [659, .09, .14], [784, .18, .22]],
      coin: [[988, 0, .1], [1319, .07, .18]],
      rise: [[392, 0, .12], [523, .06, .16]],
      fall: [[523, 0, .1], [392, .06, .16]],
      finish: [[392, 0, .17], [330, .13, .17], [262, .26, .28]],
    }[name];
    if (!notes) throw new RangeError(`Unknown sound: ${name}`);
    for (const [frequency, delay, duration] of notes) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const at = this.context.currentTime + delay;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(.065, at + .012);
      gain.gain.exponentialRampToValueAtTime(.001, at + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      const voice = { oscillator, gain };
      this.voices.add(voice);
      oscillator.onended = () => {
        this.voices.delete(voice);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + duration + .02);
    }
  }
}
