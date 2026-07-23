// Data-only defaults for the sign pipeline. Teach Mode and the Sign Lab sliders
// both just rewrite copies of this at runtime — no pose-specific logic lives
// anywhere else.

export const POSE_META = {
  run: { emoji: "🖐️", label: "run" },
  left: { emoji: "☝️", label: "left" },
  right: { emoji: "✌️", label: "right" },
  back: { emoji: "3️⃣", label: "back" },
  neutral: { emoji: "✊", label: "neutral" },
};

export function defaultProfile() {
  return {
    run: {
      mode: "sustain",
      enterThreshold: 0.62,
      exitThreshold: 0.42,
      confirmFrames: 3,
      exitConfirmFrames: 5,
      cooldownMs: 0,
    },
    left: {
      mode: "trigger",
      enterThreshold: 0.6,
      confirmFrames: 4,
      cooldownMs: 450,
    },
    right: {
      mode: "trigger",
      enterThreshold: 0.6,
      confirmFrames: 4,
      cooldownMs: 450,
    },
    back: {
      mode: "trigger",
      enterThreshold: 0.6,
      confirmFrames: 6,
      cooldownMs: 1600,
    },
  };
}

export const GLOBAL_DEFAULTS = {
  smoothingAlpha: 0.35,
};
