import { bus } from "./eventBus.js";

const SAMPLE_MS = 3000;
const STORAGE_KEY = "ritual-corridor.signProfile.v1";

export class TeachMode {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.sampling = null; // { poseId, scores: [], endsAt }
    this.sampleCounts = { run: 0, left: 0, right: 0, turn: 0, hint: 0 };
    this._loadFromStorage();

    bus.on("hand:features", () => this._tick());
  }

  _tick() {
    if (!this.sampling) return;
    const now = performance.now();
    const { scores } = this.pipeline.lastClassification;
    this.sampling.scores.push(scores[this.sampling.poseId] || 0);
    if (now >= this.sampling.endsAt) {
      this._finishSampling();
    }
  }

  start(poseId) {
    this.sampling = { poseId, scores: [], endsAt: performance.now() + SAMPLE_MS };
    bus.emit("teach:start", { poseId });
  }

  _finishSampling() {
    const { poseId, scores } = this.sampling;
    this.sampling = null;
    if (scores.length === 0) return;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    this.pipeline.applyTaughtThreshold(poseId, mean);
    this.sampleCounts[poseId] = (this.sampleCounts[poseId] || 0) + 1;
    bus.emit("teach:sample", { poseId, mean, counts: { ...this.sampleCounts } });
  }

  save() {
    const payload = {
      profile: this.pipeline.profile,
      globals: this.pipeline.globals,
      counts: this.sampleCounts,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // storage unavailable (private mode etc.) - non-fatal
    }
    bus.emit("teach:saved", payload);
    return payload;
  }

  exportJSON() {
    return JSON.stringify(
      { profile: this.pipeline.profile, globals: this.pipeline.globals, counts: this.sampleCounts },
      null,
      2
    );
  }

  importJSON(text) {
    const data = JSON.parse(text);
    if (data.profile) {
      for (const id of Object.keys(this.pipeline.channels)) {
        if (data.profile[id]) {
          this.pipeline.profile[id] = { ...this.pipeline.profile[id], ...data.profile[id] };
          this.pipeline.channels[id].reconfigure(data.profile[id]);
        }
      }
    }
    if (data.globals) this.pipeline.globals = { ...this.pipeline.globals, ...data.globals };
    if (data.counts) this.sampleCounts = { ...this.sampleCounts, ...data.counts };
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      this.importJSON(raw);
    } catch (e) {
      // corrupt/missing - fall back to defaults silently
    }
  }
}
