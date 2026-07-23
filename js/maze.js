// Top-down 2D maze: the whole grid is drawn at once, and the player is a
// small rotated triangle token that slides cell-to-cell. No THREE, no DOM —
// render(ctx, width, height) just draws onto a plain 2D canvas context.
import { bus } from "./eventBus.js";
import {
  generateMaze,
  startingHeading,
  junctionOptions,
  step,
  normalizeHeading,
  HEADING_DIR,
  OPPOSITE,
} from "./mazeGraph.js";

const MAZE_SIZE = 15;
const STEP_BASE_DURATION = 0.32; // seconds for a straight cell-to-cell step
const STEP_TURN_DURATION = 0.22; // extra seconds added per 180° of turning

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Faster exits are worth more: a smooth curve from 10000 (an instant exit)
// down toward 0 the longer it takes, rather than a hard time cap.
export function computeScore(elapsedSeconds) {
  return Math.max(0, Math.round(10000 / (elapsedSeconds + 1)));
}

// Shortest signed angular distance from a to b, in degrees, in (-180, 180].
function angleDelta(a, b) {
  return (((b - a + 540) % 360) + 360) % 360 - 180;
}

export class Maze {
  constructor() {
    this.running = false;
    this._newMaze();

    bus.on("sign:sustainstart", ({ id }) => { if (id === "run") this.running = true; });
    bus.on("sign:sustainend", ({ id }) => { if (id === "run") this.running = false; });
  }

  _newMaze() {
    this.mazeData = generateMaze(MAZE_SIZE);
    this.pos = { ...this.mazeData.start };
    this.heading = startingHeading(this.mazeData.cells[this.pos.row][this.pos.col]);
    this.options = junctionOptions(this.mazeData.cells[this.pos.row][this.pos.col], this.heading);
    this.distance = 0;
    this.elapsed = 0;
    this.atExit = false;
    this.anim = null; // { fromRow, fromCol, toRow, toCol, fromHeading, toHeading, t, duration }
  }

  reset() {
    this.running = false;
    this._newMaze();
  }

  requestTurn(rel) {
    // rel: 'left' | 'right'. Executes immediately — same as requestTurnAround
    // — since run/left/right are all single-hand poses and can't be shown at
    // once: waiting for a later "run" pulse to consume an armed choice meant
    // a left/right sign by itself never actually moved you anywhere.
    if (this.atExit) return false;
    const chosen = this.options.find((o) => o.rel === rel);
    if (!chosen) {
      bus.emit("maze:blocked", { rel });
      return false;
    }
    this._startStep(chosen);
    return true;
  }

  // Voluntary about-face: reverses heading and steps back into the cell you
  // just came from, wherever you currently are (mid-slide or standing).
  requestTurnAround() {
    if (this.atExit) return false;
    const cameFromDir = OPPOSITE[HEADING_DIR[normalizeHeading(this.heading)]];
    this._startStep({ rel: "back", dir: cameFromDir });
    return true;
  }

  update(dt, gameState) {
    if (gameState !== "playing" || this.atExit) return { atExit: this.atExit };
    this.elapsed += dt;

    if (this.anim) {
      this.anim.t += dt;
      if (this.anim.t >= this.anim.duration) {
        this.anim = null;
        if (this.running && !this.atExit) this._advance();
      }
      return { atExit: this.atExit };
    }

    if (this.running) this._advance();
    return { atExit: this.atExit };
  }

  // Auto-advance (driven by holding "run") only ever takes the "straight"
  // option — zero heading change, ever. Anything that would turn the piece
  // at all — a bend, a dead end, a real fork — is never taken automatically,
  // no matter how long run is held: it always requires an explicit
  // left/right/back sign. This is absolute; there is no combination of
  // holding/releasing run that can rotate the piece.
  _advance() {
    const chosen = this.options.find((o) => o.rel === "straight");
    if (!chosen) return; // any direction change requires an explicit sign
    this._startStep(chosen);
  }

  _startStep(chosen) {
    const deltaDeg = chosen.rel === "left" ? -90 : chosen.rel === "right" ? 90 : chosen.rel === "back" ? 180 : 0;
    const fromPos = this.pos;
    const toPos = step(fromPos.row, fromPos.col, chosen.dir);
    const fromHeading = this.heading;
    const toHeading = normalizeHeading(this.heading + deltaDeg);

    this.pos = toPos;
    this.heading = toHeading;
    this.distance += 1;
    this.anim = {
      fromRow: fromPos.row,
      fromCol: fromPos.col,
      toRow: toPos.row,
      toCol: toPos.col,
      fromHeading,
      toHeading,
      t: 0,
      duration: STEP_BASE_DURATION + (Math.abs(deltaDeg) / 180) * STEP_TURN_DURATION,
    };

    if (toPos.row === this.mazeData.exit.row && toPos.col === this.mazeData.exit.col) {
      this.atExit = true;
      this.options = [];
      bus.emit("maze:exit", {});
    } else {
      this.options = junctionOptions(this.mazeData.cells[toPos.row][toPos.col], toHeading);
    }
  }

  get score() {
    return computeScore(this.elapsed);
  }

  _displayState() {
    if (!this.anim) return { row: this.pos.row, col: this.pos.col, heading: this.heading };
    const p = easeInOutCubic(clamp(this.anim.t / this.anim.duration, 0, 1));
    const row = this.anim.fromRow + (this.anim.toRow - this.anim.fromRow) * p;
    const col = this.anim.fromCol + (this.anim.toCol - this.anim.fromCol) * p;
    const heading = this.anim.fromHeading + angleDelta(this.anim.fromHeading, this.anim.toHeading) * p;
    return { row, col, heading };
  }

  render(ctx, width, height) {
    const size = this.mazeData.size;
    const margin = Math.min(width, height) * 0.06;
    const cell = (Math.min(width, height) - margin * 2) / size;
    const originX = (width - cell * size) / 2;
    const originY = (height - cell * size) / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b0f0d";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(originX, originY);

    // Floor tint for every carved cell.
    ctx.fillStyle = "#161c18";
    ctx.fillRect(0, 0, cell * size, cell * size);

    // Exit marker glow.
    const exit = this.mazeData.exit;
    const exitCx = (exit.col + 0.5) * cell;
    const exitCy = (exit.row + 0.5) * cell;
    const glow = ctx.createRadialGradient(exitCx, exitCy, 0, exitCx, exitCy, cell * 1.1);
    glow.addColorStop(0, "rgba(255,242,200,0.55)");
    glow.addColorStop(1, "rgba(255,242,200,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(exitCx - cell * 1.2, exitCy - cell * 1.2, cell * 2.4, cell * 2.4);
    ctx.strokeStyle = "#fff2c8";
    ctx.lineWidth = Math.max(1.5, cell * 0.06);
    ctx.strokeRect(exit.col * cell + cell * 0.12, exit.row * cell + cell * 0.12, cell * 0.76, cell * 0.76);

    // Walls.
    ctx.strokeStyle = "#3a3226";
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cellData = this.mazeData.cells[r][c];
        const x0 = c * cell, y0 = r * cell, x1 = x0 + cell, y1 = y0 + cell;
        if (!cellData.N) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
        if (!cellData.S) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
        if (!cellData.W) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
        if (!cellData.E) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      }
    }
    ctx.stroke();

    // Player token: a triangle pointing in the current heading direction.
    const { row, col, heading } = this._displayState();
    const cx = (col + 0.5) * cell;
    const cy = (row + 0.5) * cell;
    const tokenR = cell * 0.34;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((heading * Math.PI) / 180);
    ctx.fillStyle = "#6fd8c8";
    ctx.beginPath();
    ctx.moveTo(0, -tokenR);
    ctx.lineTo(tokenR * 0.75, tokenR * 0.75);
    ctx.lineTo(-tokenR * 0.75, tokenR * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}
