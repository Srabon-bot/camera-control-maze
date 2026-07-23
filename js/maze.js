import * as THREE from "three";
import { bus } from "./eventBus.js";
import {
  generateMaze,
  startingHeading,
  junctionOptions,
  hintDirection,
  step,
  normalizeHeading,
  HEADING_DIR,
  OPPOSITE,
} from "./mazeGraph.js";

const MAZE_SIZE = 7;
const SEGMENT_LENGTH = 8;
const GAP_LEN = 3; // how much of a side wall opens up for a branch
const WALK_SPEED = 3.2; // world units/sec — a deliberate walk, not a sprint

function floorMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x262f24, roughness: 1 });
}
function wallMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x2c3428, roughness: 1 });
}
function capMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1c2420, roughness: 0.9, metalness: 0.05 });
}

// direction -> local sign: left wall sits at x=-3.2, right wall at x=+3.2.
const SIDE_X = { left: -3.2, right: 3.2 };

export class Maze {
  constructor(mage) {
    this.mage = mage;
    this.group = new THREE.Group();
    // Parented to the mage so every wall/floor/light inherits the mage's
    // heading automatically — turning the mage IS turning the maze around
    // you, with zero extra coordinate math.
    mage.group.add(this.group);

    this.legObjects = [];
    this.running = false;
    this.speedFactor = 0;
    this.distance = 0;
    this.turning = false;
    this.atExit = false;

    this.hintWindowActive = false;
    this.hintWindowRemaining = 0;
    this.hintTimer = 5 + Math.random() * 4;

    this._newMaze();

    bus.on("sign:sustainstart", ({ id }) => { if (id === "run") this.running = true; });
    bus.on("sign:sustainend", ({ id }) => { if (id === "run") this.running = false; });
  }

  _newMaze() {
    this.mazeData = generateMaze(MAZE_SIZE);
    this.pos = { ...this.mazeData.start };
    this.heading = startingHeading(this.mazeData.cells[this.pos.row][this.pos.col]);
    this.pendingChoice = null;
    this.options = junctionOptions(this.mazeData.cells[this.pos.row][this.pos.col], this.heading);
    this._clearLeg();
    this.group.position.z = 0;
    this._buildLeg();
  }

  reset() {
    this.running = false;
    this.speedFactor = 0;
    this.distance = 0;
    this.turning = false;
    this.atExit = false;
    this.hintWindowActive = false;
    this.hintWindowRemaining = 0;
    this.hintTimer = 5 + Math.random() * 4;
    this._newMaze();
  }

  requestTurn(rel) {
    // rel: 'left' | 'right'. Arms the choice for whenever this leg resolves;
    // ignored if that direction isn't actually open here.
    if (this.turning || this.atExit) return false;
    if (!this.options.some((o) => o.rel === rel)) {
      bus.emit("maze:blocked", { rel });
      return false;
    }
    this.pendingChoice = rel;
    return true;
  }

  // Voluntary about-face: reverses heading and steps back into the cell you
  // just came from, wherever you currently are in the leg (no need to reach
  // a dead end first). Since the maze layout is fixed, retracing your steps
  // always shows the exact same corridor you already walked.
  requestTurnAround() {
    if (this.turning || this.atExit) return false;
    const cameFromDir = OPPOSITE[HEADING_DIR[normalizeHeading(this.heading)]];
    this._takeChoice({ rel: "back", dir: cameFromDir });
    return true;
  }

  // Hands-up hint: which way (relative to current heading) leads toward the
  // exit from here, and how many legs remain. Null once you're at the exit.
  currentHint() {
    return hintDirection(this.mazeData, this.pos, this.heading);
  }

  update(dt, gameState) {
    if (gameState !== "playing" || this.atExit) return { atExit: this.atExit };
    if (this.turning) return { atExit: false };

    const target = this.running ? 1 : 0;
    this.speedFactor += (target - this.speedFactor) * Math.min(1, dt * 3);
    const effectiveSpeed = WALK_SPEED * this.speedFactor;
    this.group.position.z += effectiveSpeed * dt;
    this.distance += effectiveSpeed * dt;

    if (this.group.position.z >= SEGMENT_LENGTH) {
      this._resolveJunction();
    }

    this._updateHintWindow(dt);

    return { atExit: this.atExit };
  }

  _updateHintWindow(dt) {
    if (!this.hintWindowActive) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.hintWindowActive = true;
        this.hintWindowRemaining = 4;
        bus.emit("maze:hintwindow", { open: true });
      }
    } else {
      this.hintWindowRemaining -= dt;
      if (this.hintWindowRemaining <= 0) {
        this.hintWindowActive = false;
        this.hintTimer = 6 + Math.random() * 5;
        bus.emit("maze:hintwindow", { open: false });
      }
    }
  }

  // Called when the three-fingers-up sign fires during an open hint window.
  consumeHintWindow() {
    if (!this.hintWindowActive) return false;
    this.hintWindowActive = false;
    this.hintTimer = 6 + Math.random() * 5;
    bus.emit("maze:hintwindow", { open: false });
    return true;
  }

  _resolveJunction() {
    const opts = this.options;
    let chosen = null;
    if (opts.length === 1) chosen = opts[0];
    else if (this.pendingChoice) chosen = opts.find((o) => o.rel === this.pendingChoice) || null;
    if (!chosen) chosen = opts.find((o) => o.rel === "straight") || null;

    if (!chosen) {
      this.group.position.z = SEGMENT_LENGTH; // hold at the junction, waiting on a turn sign
      return;
    }

    this._takeChoice(chosen);
  }

  // Shared by normal junction resolution and a voluntary turn-around — both
  // are just "step to a neighboring cell and re-point the heading."
  _takeChoice(chosen) {
    this.pendingChoice = null;
    const deltaDeg = chosen.rel === "left" ? -90 : chosen.rel === "right" ? 90 : chosen.rel === "back" ? 180 : 0;
    this.pos = step(this.pos.row, this.pos.col, chosen.dir);
    this.heading = normalizeHeading(this.heading + deltaDeg);
    this.group.position.z = 0;

    this._clearLeg();

    if (this.pos.row === this.mazeData.exit.row && this.pos.col === this.mazeData.exit.col) {
      this.atExit = true;
      this._buildExitPortal();
      bus.emit("maze:exit", {});
    } else {
      this.options = junctionOptions(this.mazeData.cells[this.pos.row][this.pos.col], this.heading);
      this._buildLeg();
    }

    if (deltaDeg !== 0) {
      this.turning = true;
      this.mage.turnBy(THREE.MathUtils.degToRad(deltaDeg), () => {
        this.turning = false;
      });
    }
  }

  _clearLeg() {
    for (const obj of this.legObjects) this.group.remove(obj);
    this.legObjects = [];
  }

  _track(obj) {
    this.group.add(obj);
    this.legObjects.push(obj);
    return obj;
  }

  _buildLeg() {
    const hasLeft = this.options.some((o) => o.rel === "left");
    const hasRight = this.options.some((o) => o.rel === "right");
    const hasStraight = this.options.some((o) => o.rel === "straight");

    this._buildBlock(0, SEGMENT_LENGTH, hasLeft, hasRight, hasStraight);

    // Peek at least one block further wherever the path continues, so the
    // maze doesn't pop into existence right at your feet — you can see
    // (roughly) two blocks ahead at all times.
    if (hasStraight) {
      const aheadPos = step(this.pos.row, this.pos.col, HEADING_DIR[normalizeHeading(this.heading)]);
      const aheadCell = this.mazeData.cells[aheadPos.row]?.[aheadPos.col];
      if (aheadCell) {
        const aheadOptions = junctionOptions(aheadCell, this.heading);
        this._buildBlock(
          -SEGMENT_LENGTH,
          SEGMENT_LENGTH,
          aheadOptions.some((o) => o.rel === "left"),
          aheadOptions.some((o) => o.rel === "right"),
          aheadOptions.some((o) => o.rel === "straight")
        );
      }
    }
    if (hasLeft) this._buildLateralPeek("left");
    if (hasRight) this._buildLateralPeek("right");

    // Ambient torch, purely atmospheric.
    const torchSide = Math.random() > 0.5 ? -3 : 3;
    const torch = new THREE.PointLight(0xd9a548, 2.5, 9, 2);
    torch.position.set(torchSide, 2.2, -SEGMENT_LENGTH * 0.35);
    this._track(torch);
    const torchMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xf0c070 }));
    torchMesh.position.copy(torch.position);
    this._track(torchMesh);
  }

  // Floor + side walls (+ far cap if dead-ended) for one block, starting at
  // local z=originZ and running `length` further in -z.
  _buildBlock(originZ, length, hasLeft, hasRight, hasStraight) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, length), floorMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, originZ - length / 2);
    this._track(floor);

    this._buildSideWall("left", hasLeft, originZ, length);
    this._buildSideWall("right", hasRight, originZ, length);

    if (!hasStraight) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(6.4, 4, 0.4), capMaterial());
      cap.position.set(0, 2, originZ - length);
      this._track(cap);
      const warnGlow = new THREE.PointLight(0xc25a4a, 2, 6, 2);
      warnGlow.position.set(0, 2.2, originZ - length + 0.6);
      this._track(warnGlow);
    }
  }

  _buildSideWall(side, open, originZ, length) {
    const x = SIDE_X[side];
    if (!open) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, length), wallMaterial());
      wall.position.set(x, 2, originZ - length / 2);
      this._track(wall);
      return;
    }
    const nearLen = length - GAP_LEN;
    const nearWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, nearLen), wallMaterial());
    nearWall.position.set(x, 2, originZ - nearLen / 2);
    this._track(nearWall);

    // A path-opening glow marking the branch (distinct color from the
    // ambient amber torches and the red "blocked" glow, so it reads as an
    // invitation, not a hazard).
    const glow = new THREE.PointLight(0x8fd6ff, 2.2, 6, 2);
    glow.position.set(x * 0.8, 2.2, originZ - (nearLen + GAP_LEN / 2));
    this._track(glow);
  }

  // A shallow bay extending sideways out of a branch gap, so an open
  // left/right path reads as real depth rather than just a glow — using
  // axis-swapped box/plane dimensions instead of an actual rotation, since
  // everything here is already axis-aligned.
  _buildLateralPeek(side) {
    const sign = side === "left" ? -1 : 1;
    const gapCenterZ = -(SEGMENT_LENGTH - GAP_LEN / 2);
    const bayWidth = GAP_LEN + 0.6;
    const bayDepth = SEGMENT_LENGTH;
    const nearX = SIDE_X[side];
    const farX = nearX + sign * bayDepth;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(bayDepth, bayWidth), floorMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(nearX + (sign * bayDepth) / 2, 0, gapCenterZ);
    this._track(floor);

    const farWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, bayWidth), wallMaterial());
    farWall.position.set(farX, 2, gapCenterZ);
    this._track(farWall);

    for (const edgeSign of [-1, 1]) {
      const edgeWall = new THREE.Mesh(new THREE.BoxGeometry(bayDepth, 4, 0.4), wallMaterial());
      edgeWall.position.set(nearX + (sign * bayDepth) / 2, 2, gapCenterZ + (edgeSign * bayWidth) / 2);
      this._track(edgeWall);
    }

    const glow = new THREE.PointLight(0x8fd6ff, 1.6, 7, 2);
    glow.position.set(nearX + sign * (bayDepth * 0.6), 2.2, gapCenterZ);
    this._track(glow);
  }

  _buildExitPortal() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), floorMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -2.5);
    this._track(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.12, 12, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
    );
    ring.position.set(0, 1.8, -4.5);
    this._track(ring);

    const portalLight = new THREE.PointLight(0xfff2c8, 4, 14, 2);
    portalLight.position.set(0, 1.8, -4.5);
    this._track(portalLight);
  }
}
