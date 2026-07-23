import { bus } from "./eventBus.js";
import { initHandTracking, startDetectionLoop } from "./handTracking.js";
import { SignPipeline } from "./signPipeline.js";
import { TeachMode } from "./teachMode.js";
import { SignLabPanel } from "./signLabPanel.js";
import { Maze } from "./maze.js";
import { GameAudio } from "./audio.js";
import { requestVerdict } from "./gemini.js";

const video = document.getElementById("webcam-video");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const winOverlay = document.getElementById("gameover-overlay");
const restartBtn = document.getElementById("restart-btn");
const hudState = document.getElementById("hud-state");
const hudDistance = document.getElementById("hud-distance");
const finalDistance = document.getElementById("final-distance");
const canvas = document.getElementById("scene-canvas");
const ctx = canvas.getContext("2d");

let gameState = "menu"; // menu | playing | won
let distance = 0;

let pipeline, teachMode, panel, maze, audio;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function reachExit() {
  gameState = "won";
  hudState.textContent = "FOUND THE WAY OUT";
  finalDistance.textContent = distance;
  winOverlay.classList.remove("hidden");
  const verdict = await requestVerdict({ distance });
  if (gameState === "won") {
    finalDistance.parentElement.insertAdjacentHTML(
      "afterend",
      `<p class="fineprint" id="verdict-line">${verdict}</p>`
    );
  }
}

function resetRun() {
  distance = 0;
  hudDistance.textContent = "0";
  hudState.textContent = "RESTING";
  document.getElementById("verdict-line")?.remove();
  maze.reset();
  winOverlay.classList.add("hidden");
  gameState = "playing";
  hudState.textContent = "WANDERING";
}

function wireGameplayEvents() {
  bus.on("sign:fire", ({ id }) => {
    if (gameState !== "playing") return;
    if (id === "left") maze.requestTurn("left");
    else if (id === "right") maze.requestTurn("right");
    else if (id === "back") maze.requestTurnAround();
  });
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

  maze = new Maze();

  wireGameplayEvents();

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  startOverlay.classList.add("hidden");
  gameState = "playing";
  hudState.textContent = "WANDERING";

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    pipeline.update(dt * 1000);

    if (gameState === "playing") {
      maze.update(dt, gameState);
      distance = maze.distance;
      hudDistance.textContent = distance;
    }

    maze.render(ctx, window.innerWidth, window.innerHeight);
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
