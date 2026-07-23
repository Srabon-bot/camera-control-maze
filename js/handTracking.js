import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { bus } from "./eventBus.js";

const DETECT_HZ = 20;
const DETECT_INTERVAL_MS = 1000 / DETECT_HZ;

let handLandmarker = null;
let videoEl = null;
let running = false;
let lastVideoTime = -1;
let lastDetectTime = 0;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

// Per-hand landmark -> feature extraction. Landmark indices follow the
// standard MediaPipe 21-point hand model.
function handFeatures(landmarks, handednessLabel) {
  const wrist = landmarks[0];
  const palmWidth = dist(landmarks[5], landmarks[17]) || 1e-6; // index MCP -> pinky MCP

  const tips = { index: 8, middle: 12, ring: 16, pinky: 20 };
  const mcps = { index: 5, middle: 9, ring: 13, pinky: 17 };
  const fingerRatio = {};
  for (const f of Object.keys(tips)) {
    fingerRatio[f] = dist(landmarks[tips[f]], wrist) / (dist(landmarks[mcps[f]], wrist) || 1e-6);
  }

  const thumbTip = landmarks[4];
  const indexMcp = landmarks[5];
  const thumbRatio = dist(thumbTip, indexMcp) / palmWidth;
  const pinch = dist(thumbTip, landmarks[8]) / palmWidth;

  const extended = Object.values(fingerRatio).filter((r) => r > 1.2).length;

  // Direction the index finger points, in screen space. 0deg = straight up,
  // positive = toward screen-right (mirrored video, so this matches the
  // player's own left/right).
  const dx = landmarks[8].x - landmarks[5].x;
  const dy = landmarks[8].y - landmarks[5].y;
  const pointAngle = Math.atan2(dx, -dy) * (180 / Math.PI);

  // Rough "palm facing camera" signal via the cross product of two palm edges.
  const v1 = { x: landmarks[5].x - wrist.x, y: landmarks[5].y - wrist.y, z: (landmarks[5].z || 0) - (wrist.z || 0) };
  const v2 = { x: landmarks[17].x - wrist.x, y: landmarks[17].y - wrist.y, z: (landmarks[17].z || 0) - (wrist.z || 0) };
  const cross = {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x,
  };
  const palmFacing = -cross.z * 6; // scaled heuristic, roughly -1..1

  return {
    handedness: handednessLabel,
    wrist,
    palmWidth,
    fingerRatio,
    thumbRatio,
    pinch,
    extended,
    pointAngle,
    palmFacing,
    landmarks,
  };
}

function extractFeatures(result) {
  const hands = (result.landmarks || []).map((lm, i) =>
    handFeatures(lm, result.handedness?.[i]?.[0]?.categoryName)
  );

  return { hands, timestamp: performance.now() };
}

export async function initHandTracking(video) {
  videoEl = video;
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      // Self-hosted so the demo doesn't die if a third-party CDN is
      // unreachable on stage (see references: "stolen quota = your demo
      // dies on stage" — same principle, different failure mode).
      modelAssetPath: "assets/mediapipe/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export function startDetectionLoop() {
  running = true;
  requestAnimationFrame(detectFrame);
}

export function stopDetectionLoop() {
  running = false;
}

function detectFrame(nowMs) {
  if (!running) return;
  if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime && nowMs - lastDetectTime >= DETECT_INTERVAL_MS) {
    lastVideoTime = videoEl.currentTime;
    lastDetectTime = nowMs;
    const result = handLandmarker.detectForVideo(videoEl, nowMs);
    const features = extractFeatures(result);
    bus.emit("hand:features", features);
  }
  requestAnimationFrame(detectFrame);
}
