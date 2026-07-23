import { bus } from "./eventBus.js";

// Prefers real audio files if the user drops them in assets/audio/ (see
// README) — falls back to synthesized placeholders so the room works with
// zero assets. Everything is driven by pipeline state, not by polling hand
// data directly.
const CUSTOM_FILES = {
  drone: "assets/audio/drone.mp3",
  thrum: "assets/audio/thrum.mp3",
  whoosh: "assets/audio/whoosh.mp3",
  hit: "assets/audio/hit.mp3",
};

async function tryLoadBuffer(ctx, url) {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return await ctx.decodeAudioData(arr);
  } catch (e) {
    return null;
  }
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.holdingId = null;
    this.holdingGain = null;
    this.droneFilter = null;
    this.droneTargetFreq = 260;
  }

  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const [drone, thrum, whoosh, hit] = await Promise.all(
      Object.values(CUSTOM_FILES).map((url) => tryLoadBuffer(this.ctx, url))
    );
    this.buffers = { drone, thrum, whoosh, hit };

    this._startAmbientDrone();

    bus.on("sign:hold", ({ progress }) => this._onHold(progress));
    bus.on("sign:idle", () => this._onIdle());
    bus.on("sign:fire", ({ id }) => {
      if (id === "turn") this._playOneShot("whoosh", 880);
      else this._playOneShot("thrum", 520, 0.15);
    });
    bus.on("stalker:warn", () => this._setDroneTension(true));
    bus.on("stalker:banished", () => this._setDroneTension(false));
    bus.on("stalker:caught", () => {
      this._setDroneTension(false);
      this._playOneShot("hit", 140, 0.3);
    });
  }

  async resume() {
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  _startAmbientDrone() {
    const ctx = this.ctx;
    if (this.buffers.drone) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.drone;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 260;
      const gain = ctx.createGain();
      gain.gain.value = 0.35;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this.droneFilter = filter;
    } else {
      // Synthesized drone: two detuned low oscillators through a lowpass.
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 260;
      filter.connect(gain).connect(ctx.destination);
      [55, 55.6].forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.connect(filter);
        osc.start();
      });
      this.droneFilter = filter;
    }
  }

  _setDroneTension(tense) {
    if (!this.droneFilter) return;
    const target = tense ? 700 : 260;
    this.droneFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.3);
  }

  _onHold(progress) {
    const ctx = this.ctx;
    if (!this.holdingGain) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      if (this.buffers.thrum) {
        const src = ctx.createBufferSource();
        src.buffer = this.buffers.thrum;
        src.loop = true;
        src.connect(gain);
        src.start();
        this.holdingSrc = src;
      } else {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 180;
        osc.connect(gain);
        osc.start();
        this.holdingSrc = osc;
      }
      this.holdingGain = gain;
    }
    this.holdingGain.gain.setTargetAtTime(0.05 + progress * 0.22, ctx.currentTime, 0.05);
  }

  _onIdle() {
    if (this.holdingGain) {
      this.holdingGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      const src = this.holdingSrc;
      const gain = this.holdingGain;
      setTimeout(() => {
        try { src.stop(); } catch (e) {}
        gain.disconnect();
      }, 500);
      this.holdingGain = null;
      this.holdingSrc = null;
    }
  }

  _playOneShot(name, fallbackFreq, fallbackDuration = 0.5) {
    const ctx = this.ctx;
    const buf = this.buffers[name];
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 0.8;
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    }
    // Synthesized fallback: a short noise burst swept through a bandpass
    // filter reads as a "whoosh"; a plain decaying tone reads as a blip.
    const duration = fallbackDuration;
    const bufferSize = ctx.sampleRate * duration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(fallbackFreq * 0.4, ctx.currentTime);
    bandpass.frequency.linearRampToValueAtTime(fallbackFreq * 1.6, ctx.currentTime + duration);
    bandpass.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    noise.connect(bandpass).connect(gain).connect(ctx.destination);
    noise.start();
  }
}
