export type ActiveAmbientTexture =
  | "rain"
  | "brown"
  | "hearth"
  | "jungle"
  | "vinyl"
  | "ocean";

export type AmbientTexture = "off" | ActiveAmbientTexture;

export interface AmbientSoundscapeDef {
  id: ActiveAmbientTexture;
  label: string;
  shortLabel: string;
  detail: string;
}

export const AMBIENT_SOUNDSCAPES: AmbientSoundscapeDef[] = [
  { id: "rain", label: "Rain on Glass", shortLabel: "Rain", detail: "Soft storm bed" },
  { id: "brown", label: "Brown Noise", shortLabel: "Brown", detail: "Deep low-pass hum" },
  { id: "hearth", label: "Hearth Crackle", shortLabel: "Hearth", detail: "Warm embers" },
  { id: "jungle", label: "Jungle Night", shortLabel: "Jungle", detail: "Crickets & canopy breeze" },
  { id: "vinyl", label: "Vinyl Crackle", shortLabel: "Vinyl", detail: "Warm analog dust" },
  { id: "ocean", label: "Ocean Surf", shortLabel: "Ocean", detail: "Slow rhythmic wave swells" },
];

class AmbientSoundscapeEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: AudioNode[] = [];
  private activeTimers: number[] = [];
  private texture: AmbientTexture = "off";
  private volume = 0.38;
  private lastChimeAt: string | null = null;
  private listeners = new Set<() => void>();

  public getTexture(): AmbientTexture {
    return this.texture;
  }

  public getVolume(): number {
    return this.volume;
  }

  public getLastChimeAt(): string | null {
    return this.lastChimeAt;
  }

  /**
   * Synthesizes a warm, resonant 3-harmonic completion chime via Web Audio API
   * (zero external audio files required).
   */
  public playCompletionChime(): void {
    this.lastChimeAt = new Date().toISOString();
    const ctx = this.ensureContext();
    if (!ctx) {
      this.notify();
      return;
    }

    try {
      const now = ctx.currentTime + 0.02;
      const chimeBus = ctx.createGain();
      chimeBus.gain.setValueAtTime(0.0001, now);
      chimeBus.gain.exponentialRampToValueAtTime(0.32, now + 0.04);
      chimeBus.gain.exponentialRampToValueAtTime(0.0001, now + 2.85);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(680, now + 2.6);

      chimeBus.connect(filter);
      filter.connect(ctx.destination);

      // Warm D-major resonant singing-bowl triad + gentle fifth shimmer
      const voices: {
        freq: number;
        delay: number;
        gain: number;
        type: OscillatorType;
        dur: number;
      }[] = [
        { freq: 293.66, delay: 0.0, gain: 0.42, type: "sine", dur: 2.7 },
        { freq: 440.0, delay: 0.12, gain: 0.3, type: "triangle", dur: 2.5 },
        { freq: 587.33, delay: 0.24, gain: 0.24, type: "sine", dur: 2.4 },
        { freq: 739.99, delay: 0.36, gain: 0.16, type: "sine", dur: 2.2 },
      ];

      for (const v of voices) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = v.type;
        osc.frequency.setValueAtTime(v.freq, now + v.delay);

        env.gain.setValueAtTime(0.0001, now + v.delay);
        env.gain.exponentialRampToValueAtTime(v.gain, now + v.delay + 0.035);
        env.gain.exponentialRampToValueAtTime(0.0001, now + v.delay + v.dur);

        osc.connect(env);
        env.connect(chimeBus);
        osc.start(now + v.delay);
        osc.stop(now + v.delay + v.dur + 0.05);
      }
    } catch {
      // Ignore autoplay-blocked AudioContext errors
    }

    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.0001;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private clearNodes(): void {
    for (const id of this.activeTimers) {
      window.clearInterval(id);
    }
    this.activeTimers = [];
    for (const node of this.activeNodes) {
      try {
        if ("stop" in node && typeof (node as AudioBufferSourceNode).stop === "function") {
          (node as AudioBufferSourceNode).stop();
        }
        node.disconnect();
      } catch {
        // Ignore already stopped audio nodes
      }
    }
    this.activeNodes = [];
  }

  private createNoiseBuffer(
    ctx: AudioContext,
    kind: "white" | "pink" | "brown",
    seconds = 4
  ): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lastOut = 0;
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === "brown") {
          lastOut = (lastOut + 0.02 * white) / 1.02;
          data[i] = lastOut * 3.2;
        } else if (kind === "pink") {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
          b6 = white * 0.115926;
        } else {
          data[i] = white * 0.45;
        }
      }
    }
    return buffer;
  }

  /**
   * Direct mutually exclusive toggle: clicking the active soundscape turns it off;
   * clicking any inactive soundscape starts it immediately and stops the prior one.
   */
  public toggleTexture(target: ActiveAmbientTexture): AmbientTexture {
    const next: AmbientTexture = this.texture === target ? "off" : target;
    this.setTexture(next);
    return next;
  }

  public setTexture(next: AmbientTexture): void {
    this.texture = next;
    this.clearNodes();

    if (next === "off") {
      if (this.ctx && this.masterGain) {
        this.masterGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.12);
      }
      this.notify();
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) {
      this.notify();
      return;
    }

    if (next === "brown") {
      const src = ctx.createBufferSource();
      src.buffer = this.createNoiseBuffer(ctx, "brown", 6);
      src.loop = true;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 340;
      lowpass.Q.value = 0.6;

      src.connect(lowpass);
      lowpass.connect(this.masterGain);
      src.start();
      this.activeNodes.push(src, lowpass);
    } else if (next === "rain") {
      const bedSrc = ctx.createBufferSource();
      bedSrc.buffer = this.createNoiseBuffer(ctx, "white", 5);
      bedSrc.loop = true;

      const bedFilter = ctx.createBiquadFilter();
      bedFilter.type = "lowpass";
      bedFilter.frequency.value = 720;

      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.45;

      bedSrc.connect(bedFilter);
      bedFilter.connect(bedGain);
      bedGain.connect(this.masterGain);
      bedSrc.start();

      const patterSrc = ctx.createBufferSource();
      patterSrc.buffer = this.createNoiseBuffer(ctx, "white", 4);
      patterSrc.loop = true;

      const patterFilter = ctx.createBiquadFilter();
      patterFilter.type = "bandpass";
      patterFilter.frequency.value = 2100;
      patterFilter.Q.value = 1.4;

      const patterGain = ctx.createGain();
      patterGain.gain.value = 0.22;

      patterSrc.connect(patterFilter);
      patterFilter.connect(patterGain);
      patterGain.connect(this.masterGain);
      patterSrc.start();

      this.activeNodes.push(bedSrc, bedFilter, bedGain, patterSrc, patterFilter, patterGain);
    } else if (next === "hearth") {
      const rumbleSrc = ctx.createBufferSource();
      rumbleSrc.buffer = this.createNoiseBuffer(ctx, "brown", 5);
      rumbleSrc.loop = true;

      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = "lowpass";
      rumbleFilter.frequency.value = 165;

      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.72;

      rumbleSrc.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(this.masterGain);
      rumbleSrc.start();
      this.activeNodes.push(rumbleSrc, rumbleFilter, rumbleGain);

      const timer = window.setInterval(() => {
        if (!this.ctx || !this.masterGain || this.texture !== "hearth") return;
        if (Math.random() > 0.42) return;
        try {
          const popLen = Math.floor(this.ctx.sampleRate * 0.014);
          const popBuf = this.ctx.createBuffer(1, popLen, this.ctx.sampleRate);
          const ch = popBuf.getChannelData(0);
          for (let i = 0; i < popLen; i++) {
            const env = Math.exp(-i / (popLen * 0.22));
            ch[i] = (Math.random() * 2 - 1) * env;
          }
          const pop = this.ctx.createBufferSource();
          pop.buffer = popBuf;

          const hp = this.ctx.createBiquadFilter();
          hp.type = "bandpass";
          hp.frequency.value = 2600 + Math.random() * 2600;
          hp.Q.value = 2.2;

          const popGain = this.ctx.createGain();
          popGain.gain.value = 0.14 + Math.random() * 0.24;

          pop.connect(hp);
          hp.connect(popGain);
          popGain.connect(this.masterGain);
          pop.start();
        } catch {
          // Ignore transient crackle error
        }
      }, 170);
      this.activeTimers.push(timer);
    } else if (next === "jungle") {
      // Canopy breeze bed with gentle slow filter sway
      const breezeSrc = ctx.createBufferSource();
      breezeSrc.buffer = this.createNoiseBuffer(ctx, "pink", 6);
      breezeSrc.loop = true;

      const breezeFilter = ctx.createBiquadFilter();
      breezeFilter.type = "bandpass";
      breezeFilter.frequency.value = 460;
      breezeFilter.Q.value = 0.7;

      const breezeLfo = ctx.createOscillator();
      breezeLfo.type = "sine";
      breezeLfo.frequency.value = 0.14;
      const breezeLfoGain = ctx.createGain();
      breezeLfoGain.gain.value = 180;
      breezeLfo.connect(breezeLfoGain);
      breezeLfoGain.connect(breezeFilter.frequency);

      const breezeGain = ctx.createGain();
      breezeGain.gain.value = 0.42;

      breezeSrc.connect(breezeFilter);
      breezeFilter.connect(breezeGain);
      breezeGain.connect(this.masterGain);
      breezeSrc.start();
      breezeLfo.start();
      this.activeNodes.push(breezeSrc, breezeFilter, breezeLfo, breezeLfoGain, breezeGain);

      // Night cricket rhythmic harmonic chirps
      const cricketTimer = window.setInterval(() => {
        if (!this.ctx || !this.masterGain || this.texture !== "jungle") return;
        if (Math.random() > 0.52) return;
        try {
          const now = this.ctx.currentTime + 0.01;
          const baseFreq = 4050 + Math.random() * 520;
          const pulses = 3 + Math.floor(Math.random() * 2);
          for (let p = 0; p < pulses; p++) {
            const start = now + p * 0.055;
            const osc = this.ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(baseFreq, start);

            const env = this.ctx.createGain();
            env.gain.setValueAtTime(0.0001, start);
            env.gain.exponentialRampToValueAtTime(0.022 + Math.random() * 0.018, start + 0.012);
            env.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);

            osc.connect(env);
            env.connect(this.masterGain);
            osc.start(start);
            osc.stop(start + 0.05);
          }
        } catch {
          // Ignore transient cricket error
        }
      }, 620);
      this.activeTimers.push(cricketTimer);
    } else if (next === "vinyl") {
      // Warm analog surface hiss + subtle micro dust crackles
      const floorSrc = ctx.createBufferSource();
      floorSrc.buffer = this.createNoiseBuffer(ctx, "pink", 5);
      floorSrc.loop = true;

      const floorFilter = ctx.createBiquadFilter();
      floorFilter.type = "bandpass";
      floorFilter.frequency.value = 1050;
      floorFilter.Q.value = 0.55;

      const floorGain = ctx.createGain();
      floorGain.gain.value = 0.24;

      floorSrc.connect(floorFilter);
      floorFilter.connect(floorGain);
      floorGain.connect(this.masterGain);
      floorSrc.start();
      this.activeNodes.push(floorSrc, floorFilter, floorGain);

      const dustTimer = window.setInterval(() => {
        if (!this.ctx || !this.masterGain || this.texture !== "vinyl") return;
        if (Math.random() > 0.62) return;
        try {
          const len = Math.floor(this.ctx.sampleRate * (0.002 + Math.random() * 0.004));
          const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const ch = buf.getChannelData(0);
          for (let i = 0; i < len; i++) {
            const env = Math.exp(-i / (len * 0.28));
            ch[i] = (Math.random() * 2 - 1) * env;
          }
          const src = this.ctx.createBufferSource();
          src.buffer = buf;

          const hp = this.ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.value = 3200 + Math.random() * 2400;

          const g = this.ctx.createGain();
          g.gain.value = 0.08 + Math.random() * 0.16;

          src.connect(hp);
          hp.connect(g);
          g.connect(this.masterGain);
          src.start();
        } catch {
          // Ignore transient vinyl dust error
        }
      }, 115);
      this.activeTimers.push(dustTimer);
    } else if (next === "ocean") {
      // Slow rhythmic ocean surf swells (0.11 Hz wave period ~ 9s)
      const surfSrc = ctx.createBufferSource();
      surfSrc.buffer = this.createNoiseBuffer(ctx, "brown", 6);
      surfSrc.loop = true;

      const surfFilter = ctx.createBiquadFilter();
      surfFilter.type = "lowpass";
      surfFilter.frequency.value = 460;
      surfFilter.Q.value = 0.7;

      const surfGain = ctx.createGain();
      surfGain.gain.value = 0.48;

      // Wave LFO modulating both filter cutoff and swell amplitude
      const waveLfo = ctx.createOscillator();
      waveLfo.type = "sine";
      waveLfo.frequency.value = 0.11;

      const filterLfoDepth = ctx.createGain();
      filterLfoDepth.gain.value = 320;
      waveLfo.connect(filterLfoDepth);
      filterLfoDepth.connect(surfFilter.frequency);

      const gainLfoDepth = ctx.createGain();
      gainLfoDepth.gain.value = 0.28;
      waveLfo.connect(gainLfoDepth);
      gainLfoDepth.connect(surfGain.gain);

      surfSrc.connect(surfFilter);
      surfFilter.connect(surfGain);
      surfGain.connect(this.masterGain);
      surfSrc.start();
      waveLfo.start();

      // Subtle foam crest shimmer
      const foamSrc = ctx.createBufferSource();
      foamSrc.buffer = this.createNoiseBuffer(ctx, "white", 5);
      foamSrc.loop = true;

      const foamFilter = ctx.createBiquadFilter();
      foamFilter.type = "bandpass";
      foamFilter.frequency.value = 1800;
      foamFilter.Q.value = 1.1;

      const foamGain = ctx.createGain();
      foamGain.gain.value = 0.08;

      const foamLfoDepth = ctx.createGain();
      foamLfoDepth.gain.value = 0.07;
      waveLfo.connect(foamLfoDepth);
      foamLfoDepth.connect(foamGain.gain);

      foamSrc.connect(foamFilter);
      foamFilter.connect(foamGain);
      foamGain.connect(this.masterGain);
      foamSrc.start();

      this.activeNodes.push(
        surfSrc,
        surfFilter,
        surfGain,
        waveLfo,
        filterLfoDepth,
        gainLfoDepth,
        foamSrc,
        foamFilter,
        foamGain,
        foamLfoDepth
      );
    }

    this.applyVolume();
    this.notify();
  }

  public setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    this.notify();
  }

  private applyVolume(): void {
    if (!this.ctx || !this.masterGain) return;
    const target = this.texture === "off" ? 0.0001 : Math.max(0.0001, this.volume * 0.45);
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  public dispose(): void {
    this.clearNodes();
    try {
      void this.ctx?.close();
    } catch {
      // Ignore
    }
    this.ctx = null;
    this.masterGain = null;
  }
}

export const ambientAudio = new AmbientSoundscapeEngine();
