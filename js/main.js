import { bus } from "./eventBus.js";
import { initHandTracking, startDetectionLoop } from "./handTracking.js";
import { SignPipeline } from "./signPipeline.js";
import { TeachMode } from "./teachMode.js";
import { SignLabPanel } from "./signLabPanel.js";
import { Scene } from "./scene.js";
import { Mage } from "./mage.js";
import { Maze } from "./maze.js";
import { GameAudio } from "./audio.js";
import { requestIncantation, requestVerdict } from "./gemini.js";

const video = document.getElementById("webcam-video");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const winOverlay = document.getElementById("gameover-overlay");
const restartBtn = document.getElementById("restart-btn");
const hudState = document.getElementById("hud-state");
const hudDistance = document.getElementById("hud-distance");
const hudHints = document.getElementById("hud-banishes");
const finalDistance = document.getElementById("final-distance");
const finalHints = document.getElementById("final-banishes");
const hintWindowEl = document.getElementById("stalker-warning");
const incantationEl = document.getElementById("incantation");
const canvas = document.getElementById("scene-canvas");

let gameState = "menu"; // menu | playing | won
let distance = 0;
let hintsUsed = 0;

let pipeline, teachMode, panel, scene, mage, maze, audio;

function showIncantation(text) {
  if (!text) return;
  incantationEl.textContent = text;
  incantationEl.classList.add("visible");
  clearTimeout(showIncantation._t);
  showIncantation._t = setTimeout(() => incantationEl.classList.remove("visible"), 3200);
}

async function reachExit() {
  gameState = "won";
  hudState.textContent = "FOUND THE WAY OUT";
  mage.setRunning(false);
  finalDistance.textContent = Math.round(distance);
  finalHints.textContent = hintsUsed;
  winOverlay.classList.remove("hidden");
  const verdict = await requestVerdict({ distance, hints: hintsUsed });
  if (gameState === "won") {
    finalDistance.parentElement.insertAdjacentHTML(
      "afterend",
      `<p class="fineprint" id="verdict-line">${verdict}</p>`
    );
  }
}

function resetRun() {
  distance = 0;
  hintsUsed = 0;
  hudDistance.textContent = "0";
  hudHints.textContent = "0";
  hudState.textContent = "RESTING";
  document.getElementById("verdict-line")?.remove();
  maze.reset();
  mage.group.rotation.y = 0;
  winOverlay.classList.add("hidden");
  hintWindowEl.classList.add("hidden");
  gameState = "playing";
  hudState.textContent = "WANDERING";
}

async function handleHintReveal() {
  if (!maze.consumeHintWindow()) return;
  const hint = maze.currentHint();
  mage.turnBy(Math.PI * 2, () => {}); // full flourish spin, lands back facing forward
  mage.triggerRevealBurst();
  hintsUsed += 1;
  hudHints.textContent = hintsUsed;
  const line = await requestIncantation({ hintDirection: hint?.rel ?? "onward", hintsUsed });
  showIncantation(line);
}

function wireGameplayEvents() {
  bus.on("sign:sustainstart", ({ id }) => {
    if (id === "run" && gameState === "playing") mage.setRunning(true);
  });
  bus.on("sign:sustainend", ({ id }) => {
    if (id === "run") mage.setRunning(false);
  });
  bus.on("sign:fire", ({ id }) => {
    if (gameState !== "playing") return;
    if (id === "left") maze.requestTurn("left");
    else if (id === "right") maze.requestTurn("right");
    else if (id === "turn") maze.requestTurnAround();
    else if (id === "hint") handleHintReveal();
  });
  bus.on("tuning:update", (patch) => {
    if (patch.particlesK != null) mage.setParticleCount(patch.particlesK * 1000);
  });
  bus.on("maze:hintwindow", ({ open }) => hintWindowEl.classList.toggle("hidden", !open));
  bus.on("maze:exit", () => reachExit());
}

async function boot() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 2) resolve();
    else video.onloadedmetadata = () => resolve();
  });

  audio = new GameAudio();
  await audio.init();
  await audio.resume();

  await initHandTracking(video);
  startDetectionLoop();

  pipeline = new SignPipeline();
  teachMode = new TeachMode(pipeline);
  panel = new SignLabPanel({ pipeline, teachMode, video });

  scene = new Scene(canvas);
  mage = new Mage(scene);
  await mage.load();
  maze = new Maze(mage);

  wireGameplayEvents();

  startOverlay.classList.add("hidden");
  gameState = "playing";
  hudState.textContent = "WANDERING";

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    pipeline.update(dt * 1000);
    mage.update(dt);

    if (gameState === "playing") {
      maze.update(dt, gameState);
      distance = maze.distance;
      hudDistance.textContent = Math.round(distance);
    }

    scene.updateCamera(mage.group, dt);
    scene.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

startBtn.addEventListener("click", () => {
  startBtn.disabled = true;
  startBtn.textContent = "waking the maze…";
  boot().catch((err) => {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "enter the maze";
    alert("Couldn't start: " + err.message + "\n(Camera access is required.)");
  });
});

restartBtn.addEventListener("click", () => resetRun());
