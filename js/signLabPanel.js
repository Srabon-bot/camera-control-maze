import { bus } from "./eventBus.js";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export class SignLabPanel {
  constructor({ pipeline, teachMode, video }) {
    this.pipeline = pipeline;
    this.teachMode = teachMode;
    this.video = video;

    this.graphCanvas = document.getElementById("signal-graph");
    this.graphCtx = this.graphCanvas.getContext("2d");
    this.graphHistory = [];

    this.camCanvas = document.getElementById("cam-overlay");
    this.camCtx = this.camCanvas.getContext("2d");

    this.fingerReadout = document.getElementById("finger-readout");
    this.pinchReadout = document.getElementById("pinch-readout");
    this.poseReadout = document.getElementById("pose-readout");
    this.dominantChannelLabel = document.getElementById("dominant-channel");
    this.teachSamplesLabel = document.getElementById("teach-samples");

    this._wireSliders();
    this._wireTeachButtons();
    this._wireManualPoseButtons();

    bus.on("hand:features", (f) => this._onFeatures(f));
    bus.on("teach:start", ({ poseId }) => this._onTeachStart(poseId));
    bus.on("teach:sample", ({ counts }) => this._onTeachSample(counts));

    this._raf();
  }

  _wireSliders() {
    const bind = (id, valueId, key, transform = (v) => v, format = (v) => v) => {
      const el = document.getElementById(id);
      const label = document.getElementById(valueId);
      el.addEventListener("input", () => {
        const raw = Number(el.value);
        label.textContent = format(raw);
        bus.emit("tuning:update", { [key]: transform(raw) });
      });
    };
    bind("s-sensitivity", "v-sensitivity", "sensitivity", (v) => v, (v) => v.toFixed(2));
    bind("s-confirm", "v-confirm", "confirmFrames", (v) => Math.round(v), (v) => Math.round(v));
    bind("s-cooldown", "v-cooldown", "cooldownMs", (v) => Math.round(v), (v) => Math.round(v));
    bind("s-smoothing", "v-smoothing", "smoothingAlpha", (v) => v, (v) => v.toFixed(2));
    bind("s-particles", "v-particles", "particlesK", (v) => v, (v) => Math.round(v));
  }

  _wireTeachButtons() {
    document.querySelectorAll("[data-teach]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const poseId = btn.dataset.teach;
        document.querySelectorAll("[data-teach]").forEach((b) => b.classList.remove("sampling"));
        btn.classList.add("sampling");
        this.teachMode.start(poseId);
      });
    });
    document.getElementById("teach-save").addEventListener("click", () => {
      this.teachMode.save();
      const btn = document.getElementById("teach-save");
      const original = btn.textContent;
      btn.textContent = "✔ saved — Sign Lab knows your hand now";
      setTimeout(() => (btn.textContent = original), 1800);
    });
  }

  _wireManualPoseButtons() {
    document.querySelectorAll("#cam-thumb [data-pose]").forEach((btn) => {
      const pose = btn.dataset.pose;
      const press = () => {
        this.pipeline.setManualPose(pose, true);
        btn.classList.add("active");
      };
      const release = () => {
        this.pipeline.setManualPose(pose, false);
        btn.classList.remove("active");
      };
      btn.addEventListener("mousedown", press);
      btn.addEventListener("touchstart", (e) => { e.preventDefault(); press(); });
      window.addEventListener("mouseup", release);
      btn.addEventListener("touchend", release);
    });
  }

  _onTeachStart(poseId) {}

  _onTeachSample(counts) {
    this.teachSamplesLabel.textContent = `run:${counts.run||0} · left:${counts.left||0} · right:${counts.right||0} · turn:${counts.turn||0} · hint:${counts.hint||0}`;
    document.querySelectorAll("[data-teach]").forEach((b) => b.classList.remove("sampling"));
  }

  _onFeatures(features) {
    const h = (features.hands || [])[0];
    if (h) {
      const r = h.fingerRatio;
      this.fingerReadout.textContent =
        `T${h.thumbRatio.toFixed(2)}  I${r.index.toFixed(2)}${r.index>1.2?"✓":"✗"}  ` +
        `M${r.middle.toFixed(2)}${r.middle>1.2?"✓":"✗"}  R${r.ring.toFixed(2)}${r.ring>1.2?"✓":"✗"}  ` +
        `P${r.pinky.toFixed(2)}${r.pinky>1.2?"✓":"✗"}`;
      this.pinchReadout.textContent =
        `pinch ${h.pinch.toFixed(2)} · angle ${h.pointAngle.toFixed(0)}° · hands ${features.hands.length}`;
    } else {
      this.fingerReadout.textContent = "T·  I·  M·  R·  P·  (no hand)";
      this.pinchReadout.textContent = `pinch — · angle — · hands ${features.hands?.length || 0}`;
    }

    this._drawCamOverlay(features);
  }

  _drawCamOverlay(features) {
    const ctx = this.camCtx;
    const w = this.camCanvas.width;
    const h = this.camCanvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this.video.readyState >= 2) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, w, h);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    for (const hand of features.hands || []) {
      ctx.strokeStyle = "rgba(111,216,200,0.85)";
      ctx.lineWidth = 1.5;
      for (const [a, b] of HAND_CONNECTIONS) {
        const p1 = hand.landmarks[a];
        const p2 = hand.landmarks[b];
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }
      ctx.fillStyle = "#d9a548";
      for (const p of hand.landmarks) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawGraph() {
    const { scores, dominant } = this.pipeline.lastClassification;
    const value = scores[dominant] ?? 0;
    this.graphHistory.push(value);
    if (this.graphHistory.length > 150) this.graphHistory.shift();

    const ctx = this.graphCtx;
    const w = this.graphCanvas.width;
    const h = this.graphCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const channel = this.pipeline.channels[dominant];
    const threshold = channel ? channel.cfg.enterThreshold : 0.6;
    const ty = h - threshold * h;
    ctx.strokeStyle = "rgba(194,90,74,0.7)";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, ty);
    ctx.lineTo(w, ty);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#6fd8c8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.graphHistory.forEach((v, i) => {
      const x = (i / 149) * w;
      const y = h - v * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    this.dominantChannelLabel.textContent = dominant;
    this.poseReadout.textContent = dominant;
    document.querySelectorAll(".pose-emojis [data-pose]").forEach((el) => {
      el.classList.toggle("active", el.dataset.pose === dominant);
    });
  }

  _raf() {
    this._drawGraph();
    requestAnimationFrame(() => this._raf());
  }
}
