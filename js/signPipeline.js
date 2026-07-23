import { bus } from "./eventBus.js";
import { defaultProfile, GLOBAL_DEFAULTS } from "./signDefinitions.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// One reusable state machine for "noisy signal -> threshold -> cooldown ->
// feedback." mode:'sustain' (run: fires while held, decays back to idle on
// release) or mode:'trigger' (left/right/turn: fires once per confirmed
// hold, then a cooldown that ignores input so it can't be machine-gunned).
export class SignalChannel {
  constructor(id, cfg) {
    this.id = id;
    this.cfg = cfg;
    this.smoothed = 0;
    this.state = "idle"; // idle | holding | active/confirmed | cooldown
    this.holdFrames = 0;
    this.releaseFrames = 0;
    this.cooldownRemaining = 0;
    this.holdProgress = 0;
  }

  reconfigure(cfg) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  // rawScore: 0..1 continuous "how much does this frame look like my pose."
  // isArgmax: whether this channel is currently the best-matching pose,
  // decided once by the orchestrator so two channels never both progress
  // off one ambiguous frame.
  update(rawScore, dtMs, isArgmax, alpha) {
    const score = isArgmax ? rawScore : 0;
    this.smoothed = this.smoothed + alpha * (score - this.smoothed);

    if (this.state === "cooldown") {
      this.cooldownRemaining -= dtMs;
      if (this.cooldownRemaining <= 0) {
        this.state = "idle";
        this.cooldownRemaining = 0;
      }
      return;
    }

    if (this.cfg.mode === "sustain") {
      this._updateSustain();
    } else {
      this._updateTrigger();
    }
  }

  _updateSustain() {
    const { enterThreshold, exitThreshold, confirmFrames, exitConfirmFrames } = this.cfg;
    if (this.state === "idle" || this.state === "holding") {
      if (this.smoothed > enterThreshold) {
        this.holdFrames++;
        this.holdProgress = clamp(this.holdFrames / confirmFrames, 0, 1);
        if (this.state === "idle") {
          this.state = "holding";
          bus.emit("sign:hold", { id: this.id, progress: this.holdProgress });
        }
        if (this.holdFrames >= confirmFrames && this.state !== "active") {
          this.state = "active";
          this.releaseFrames = 0;
          bus.emit("sign:sustainstart", { id: this.id });
        } else if (this.state === "holding") {
          bus.emit("sign:hold", { id: this.id, progress: this.holdProgress });
        }
      } else {
        this._backToIdleFromHolding();
      }
    } else if (this.state === "active") {
      if (this.smoothed < exitThreshold) {
        this.releaseFrames++;
        if (this.releaseFrames >= exitConfirmFrames) {
          this.state = "idle";
          this.holdFrames = 0;
          this.holdProgress = 0;
          bus.emit("sign:sustainend", { id: this.id });
          bus.emit("sign:idle", { id: this.id });
        }
      } else {
        this.releaseFrames = 0;
      }
    }
  }

  _backToIdleFromHolding() {
    if (this.state === "holding") {
      this.state = "idle";
      this.holdFrames = 0;
      this.holdProgress = 0;
      bus.emit("sign:idle", { id: this.id });
    }
  }

  _updateTrigger() {
    const { enterThreshold, confirmFrames, cooldownMs } = this.cfg;
    if (this.smoothed > enterThreshold) {
      this.holdFrames++;
      this.holdProgress = clamp(this.holdFrames / confirmFrames, 0, 1);
      if (this.state === "idle") this.state = "holding";
      bus.emit("sign:hold", { id: this.id, progress: this.holdProgress });
      if (this.holdFrames >= confirmFrames) {
        this.state = "cooldown";
        this.cooldownRemaining = cooldownMs;
        this.holdFrames = 0;
        this.holdProgress = 0;
        bus.emit("sign:fire", { id: this.id });
        bus.emit("sign:idle", { id: this.id });
      }
    } else {
      this._backToIdleFromHolding();
    }
  }
}

// --- Pose scoring -----------------------------------------------------
// Turns raw hand features into a 0..1 continuous score per pose. These are
// intentionally simple, transparent heuristics (not ML classifiers) so the
// Sign Lab sliders map directly onto them.

function pointFeatures(features) {
  // Prefer a single hand showing exactly one extended finger (index).
  let best = null;
  for (const h of features.hands || []) {
    if (h.extended <= 2) {
      if (!best || h.extended < best.extended) best = h;
    }
  }
  return best;
}

function openPalmScore(features) {
  const h = (features.hands || [])[0];
  if (!h) return 0;
  const avgRatio =
    (h.fingerRatio.index + h.fingerRatio.middle + h.fingerRatio.ring + h.fingerRatio.pinky) / 4;
  const ratioScore = clamp((avgRatio - 1.0) / 0.45, 0, 1);
  const facingScore = clamp((h.palmFacing + 1) / 2, 0, 1);
  return clamp(ratioScore * 0.75 + facingScore * 0.25, 0, 1);
}

function pointScore(features, sign, deadzone) {
  const h = pointFeatures(features);
  if (!h) return 0;
  const indexIsExtended = h.fingerRatio.index > 1.2;
  const othersCurled =
    h.fingerRatio.middle < 1.15 && h.fingerRatio.ring < 1.15 && h.fingerRatio.pinky < 1.15;
  if (!indexIsExtended || !othersCurled) return 0;

  const angle = h.pointAngle; // negative = left, positive = right
  if (sign === "left" && angle < -deadzone) {
    return clamp((-angle - deadzone) / 55, 0, 1);
  }
  if (sign === "right" && angle > deadzone) {
    return clamp((angle - deadzone) / 55, 0, 1);
  }
  return 0;
}

function claspScore(features) {
  if ((features.hands || []).length < 2 || features.handsDistance == null) return 0;
  // Clasped hands sit close together relative to palm size.
  return clamp((0.9 - features.handsDistance) / 0.7, 0, 1);
}

export function classifyPose(features, deadzone) {
  const scores = {
    run: openPalmScore(features),
    left: pointScore(features, "left", deadzone),
    right: pointScore(features, "right", deadzone),
    turn: claspScore(features),
  };
  let dominant = "neutral";
  let best = 0.15; // floor: below this, nothing is "the" dominant pose
  for (const [k, v] of Object.entries(scores)) {
    if (v > best) {
      best = v;
      dominant = k;
    }
  }
  return { scores, dominant };
}

// --- Orchestrator -------------------------------------------------------

export class SignPipeline {
  constructor() {
    this.profile = defaultProfile();
    this.globals = { ...GLOBAL_DEFAULTS };
    this.channels = {
      run: new SignalChannel("run", this.profile.run),
      left: new SignalChannel("left", this.profile.left),
      right: new SignalChannel("right", this.profile.right),
      turn: new SignalChannel("turn", this.profile.turn),
    };
    this.lastFeatures = { hands: [], handsDistance: null };
    this.lastClassification = { scores: { run: 0, left: 0, right: 0, turn: 0 }, dominant: "neutral" };
    this.manualPose = null; // QA override from pose-select buttons

    bus.on("hand:features", (f) => {
      this.lastFeatures = f;
    });
    bus.on("tuning:update", (patch) => this.applyTuning(patch));
  }

  applyTuning(patch) {
    if (patch.sensitivity != null) {
      // Sensitivity scales all enterThresholds inversely: >1 = easier to
      // trigger, <1 = stricter. Applied on top of the base defaults.
      const base = defaultProfile();
      for (const id of Object.keys(this.channels)) {
        const baseEnter = base[id].enterThreshold;
        this.profile[id].enterThreshold = clamp(baseEnter / patch.sensitivity, 0.15, 0.95);
        this.channels[id].reconfigure({ enterThreshold: this.profile[id].enterThreshold });
      }
    }
    if (patch.confirmFrames != null) {
      for (const id of ["left", "right", "turn"]) {
        this.profile[id].confirmFrames = patch.confirmFrames;
        this.channels[id].reconfigure({ confirmFrames: patch.confirmFrames });
      }
    }
    if (patch.cooldownMs != null) {
      for (const id of ["left", "right", "turn"]) {
        this.profile[id].cooldownMs = patch.cooldownMs;
        this.channels[id].reconfigure({ cooldownMs: patch.cooldownMs });
      }
    }
    if (patch.smoothingAlpha != null) {
      this.globals.smoothingAlpha = patch.smoothingAlpha;
    }
    if (patch.pointAngleDeadzone != null) {
      this.globals.pointAngleDeadzone = patch.pointAngleDeadzone;
    }
  }

  setManualPose(pose, active) {
    this.manualPose = active ? pose : null;
  }

  applyTaughtThreshold(poseId, sampledMean) {
    // Teach Mode calibrates enterThreshold a bit below the user's actual
    // sustained score, so their real hand/lighting always clears the bar.
    const t = clamp(sampledMean * 0.78, 0.2, 0.9);
    this.profile[poseId].enterThreshold = t;
    this.channels[poseId].reconfigure({ enterThreshold: t });
  }

  update(dtMs) {
    const classification = this.manualPose
      ? { scores: { run: 0, left: 0, right: 0, turn: 0, [this.manualPose]: 1 }, dominant: this.manualPose }
      : classifyPose(this.lastFeatures, this.globals.pointAngleDeadzone);
    this.lastClassification = classification;

    for (const [id, channel] of Object.entries(this.channels)) {
      const isArgmax = classification.dominant === id;
      channel.update(classification.scores[id] || 0, dtMs, isArgmax, this.globals.smoothingAlpha);
    }

    return classification;
  }

  get runActive() {
    return this.channels.run.state === "active";
  }
}
