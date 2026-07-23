import { bus } from "./eventBus.js";
import { initHandTracking, startDetectionLoop } from "./handTracking.js";
import { SignPipeline } from "./signPipeline.js";
import { TeachMode } from "./teachMode.js";
import { SignLabPanel } from "./signLabPanel.js";
import { Scene } from "./scene.js";
import { Mage } from "./mage.js";
import { Corridor } from "./corridor.js";
import { GameAudio } from "./audio.js";
import { requestIncantation, requestVerdict } from "./gemini.js";

const video = document.getElementById("webcam-video");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const gameoverOverlay = document.getElementById("gameover-overlay");
const restartBtn = document.getElementById("restart-btn");
const hudState = document.getElementById("hud-state");
const hudDistance = document.getElementById("hud-distance");
const hudBanishes = document.getElementById("hud-banishes");
const hudFocus = document.getElementById("hud-focus");
const finalDistance = document.getElementById("final-distance");
const finalBanishes = document.getElementById("final-banishes");
const stalkerWarningEl = document.getElementById("stalker-warning");
const incantationEl = document.getElementById("incantation");
const canvas = document.getElementById("scene-canvas");

let gameState = "menu"; // menu | playing | gameover
let distance = 0;
let banishes = 0;
let focus = 3;

let pipeline, teachMode, panel, scene, mage, corridor, audio;

function setFocusPips() {
  [...hudFocus.children].forEach((el, i) => {
    el.classList.toggle("lost", i >= focus);
  });
}

function showIncantation(text) {
  if (!text) return;
  incantationEl.textContent = text;
  incantationEl.classList.add("visible");
  clearTimeout(showIncantation._t);
  showIncantation._t = setTimeout(() => incantationEl.classList.remove("visible"), 3200);
}

function loseFocus() {
  if (gameState !== "playing") return;
  focus -= 1;
  setFocusPips();
  if (focus <= 0) gameOver();
}

async function gameOver() {
  gameState = "gameover";
  hudState.textContent = "BANISHED";
  mage.setRunning(false);
  finalDistance.textContent = Math.round(distance);
  finalBanishes.textContent = banishes;
  gameoverOverlay.classList.remove("hidden");
  const verdict = await requestVerdict({ distance, banishes });
  if (gameState === "gameover") {
    finalDistance.parentElement.insertAdjacentHTML(
      "afterend",
      `<p class="fineprint" id="verdict-line">${verdict}</p>`
    );
  }
}

function resetRun() {
  distance = 0;
  banishes = 0;
  focus = 3;
  setFocusPips();
  hudDistance.textContent = "0";
  hudBanishes.textContent = "0";
  hudState.textContent = "RESTING";
  document.getElementById("verdict-line")?.remove();
  corridor.reset();
  mage.group.position.set(0, 0, 0);
  mage.group.rotation.y = 0;
  mage.laneIndex = 1;
  gameoverOverlay.classList.add("hidden");
  stalkerWarningEl.classList.add("hidden");
  gameState = "playing";
  hudState.textContent = "RUNNING";
}

async function handleTurnFire() {
  mage.turnAround(() => {
    mage.triggerBanishBurst();
    const banished = corridor.banishStalker();
    if (banished) {
      banishes += 1;
      hudBanishes.textContent = banishes;
      requestIncantation({ banishes }).then(showIncantation);
    }
  });
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
    if (id === "left") mage.strafe(-1);
    else if (id === "right") mage.strafe(1);
    else if (id === "turn") handleTurnFire();
  });
  bus.on("tuning:update", (patch) => {
    if (patch.particlesK != null) mage.setBanishParticleCount(patch.particlesK * 1000);
  });
  bus.on("stalker:warn", () => stalkerWarningEl.classList.remove("hidden"));
  bus.on("stalker:banished", () => stalkerWarningEl.classList.add("hidden"));
  bus.on("stalker:caught", () => {
    stalkerWarningEl.classList.add("hidden");
    loseFocus();
  });
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
  corridor = new Corridor(scene);

  wireGameplayEvents();

  startOverlay.classList.add("hidden");
  gameState = "playing";
  hudState.textContent = "RUNNING";

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    pipeline.update(dt * 1000);
    mage.update(dt);

    if (gameState === "playing") {
      const { hit } = corridor.update(dt, mage, gameState);
      if (hit) loseFocus();
      distance = corridor.distance;
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
  startBtn.textContent = "waking the corridor…";
  boot().catch((err) => {
    console.error(err);
    startBtn.disabled = false;
    startBtn.textContent = "enter the corridor";
    alert("Couldn't start: " + err.message + "\n(Camera access is required.)");
  });
});

restartBtn.addEventListener("click", () => resetRun());
