import * as THREE from "three";
import { LANES } from "./mage.js";
import { bus } from "./eventBus.js";

const SEGMENT_LENGTH = 8;
const SEGMENTS_AHEAD = 10;
const BASE_SPEED = 6.5; // world units / sec, scrolls toward the camera
const REACTION_TIME_S = 0.9; // player reaction budget
const CONFIRM_WINDOW_S = 0.35; // worst-case sign confirm time (see signDefinitions)

function pillarMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1c2420, roughness: 0.9, metalness: 0.05 });
}

export class Corridor {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.scene.add(this.group);

    this.speed = BASE_SPEED;
    this.distance = 0;
    this.elapsed = 0;
    this.running = false; // only true while the "run" sign is actively held
    this.speedFactor = 0; // eases 0->1 on run start, 1->0 on release

    this.segments = [];
    this.gates = [];
    this.nextSpawnZ = -SEGMENT_LENGTH;
    this.stalkerTimer = 6 + Math.random() * 4;
    this.stalkerWarningActive = false;
    this.stalkerWindowRemaining = 0;

    this._buildFloorAndWalls();
    for (let i = 0; i < SEGMENTS_AHEAD; i++) this._spawnSegment();

    bus.on("sign:sustainstart", ({ id }) => { if (id === "run") this.running = true; });
    bus.on("sign:sustainend", ({ id }) => { if (id === "run") this.running = false; });
  }

  _buildFloorAndWalls() {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x262f24, roughness: 1 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 400), floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.z = -180;
    this.group.add(this.floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c3428, roughness: 1 });
    const wallGeo = new THREE.BoxGeometry(0.4, 4, 400);
    this.wallL = new THREE.Mesh(wallGeo, wallMat);
    this.wallL.position.set(-3.2, 2, -180);
    this.wallR = this.wallL.clone();
    this.wallR.position.x = 3.2;
    this.group.add(this.wallL, this.wallR);
  }

  _spawnSegment() {
    const z = this.nextSpawnZ;
    this.nextSpawnZ -= SEGMENT_LENGTH;

    // Torch pillars for spooky ambience.
    const torch = new THREE.PointLight(0xd9a548, 3.5, 10, 2);
    torch.position.set(Math.random() > 0.5 ? -3 : 3, 2.2, z);
    this.group.add(torch);

    const torchMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xf0c070 })
    );
    torchMesh.position.copy(torch.position);
    this.group.add(torchMesh);
    this.segments.push({ z, torch, torchMesh });

    // Occasional obstacle gate: two of three lanes are blocked, telegraphed
    // by glowing warning posts well before the reaction window closes.
    if (Math.random() < 0.55 && Math.abs(z) > 24) {
      const openLane = Math.floor(Math.random() * LANES.length);
      const gateGroup = new THREE.Group();
      gateGroup.position.z = z - SEGMENT_LENGTH / 2;
      LANES.forEach((x, i) => {
        if (i === openLane) return;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.5), pillarMaterial());
        post.position.set(x, 1.3, 0);
        const glow = new THREE.PointLight(0xc25a4a, 0.6, 3);
        glow.position.set(x, 2.6, 0);
        gateGroup.add(post, glow);
      });
      this.group.add(gateGroup);
      this.gates.push({ group: gateGroup, openLane, resolved: false });
    }
  }

  _recycle() {
    this.segments = this.segments.filter((s) => {
      if (s.z - this.group.position.z > 8) {
        this.group.remove(s.torch);
        this.group.remove(s.torchMesh);
        return false;
      }
      return true;
    });
    this.gates = this.gates.filter((g) => {
      if (g.group.position.z - this.group.position.z > 8) {
        this.group.remove(g.group);
        return false;
      }
      return true;
    });
    while (this.nextSpawnZ - this.group.position.z > -(SEGMENTS_AHEAD * SEGMENT_LENGTH)) {
      this._spawnSegment();
    }
  }

  requiredTelegraphDistance() {
    return this.speed * (REACTION_TIME_S + CONFIRM_WINDOW_S);
  }

  update(dt, mage, state) {
    if (state !== "playing") return { hit: false, stalkerFired: false };

    this.elapsed += dt;
    this.speed = BASE_SPEED + Math.min(4, this.elapsed * 0.05);

    // Ease the effective speed toward full (running) or zero (idle) rather
    // than snapping, so releasing the run sign reads as decelerating, not
    // stopping dead.
    const target = this.running ? 1 : 0;
    this.speedFactor += (target - this.speedFactor) * Math.min(1, dt * 3);
    const effectiveSpeed = this.speed * this.speedFactor;

    this.distance += effectiveSpeed * dt;

    // World scrolls toward the camera; the mage stays near z=0.
    this.group.position.z += effectiveSpeed * dt;
    this._recycle();

    let hit = false;
    for (const gate of this.gates) {
      const worldZ = gate.group.position.z + this.group.position.z;
      if (!gate.resolved && worldZ > -0.4 && worldZ < 0.4) {
        gate.resolved = true;
        if (gate.openLane !== mage.laneIndex) hit = true;
      }
    }

    // Rear-stalker: a warning window during which turn-around banishes it.
    let stalkerFired = false;
    if (!this.stalkerWarningActive) {
      this.stalkerTimer -= dt;
      if (this.stalkerTimer <= 0) {
        this.stalkerWarningActive = true;
        this.stalkerWindowRemaining = 3.2;
        bus.emit("stalker:warn", {});
      }
    } else {
      this.stalkerWindowRemaining -= dt;
      if (this.stalkerWindowRemaining <= 0) {
        this.stalkerWarningActive = false;
        this.stalkerTimer = 7 + Math.random() * 5;
        stalkerFired = true; // ran out the clock without banishing -> counts against player
        bus.emit("stalker:caught", {});
      }
    }

    return { hit, stalkerFired };
  }

  banishStalker() {
    if (!this.stalkerWarningActive) return false;
    this.stalkerWarningActive = false;
    this.stalkerTimer = 7 + Math.random() * 5;
    bus.emit("stalker:banished", {});
    return true;
  }

  reset() {
    for (const s of this.segments) {
      this.group.remove(s.torch);
      this.group.remove(s.torchMesh);
    }
    for (const g of this.gates) this.group.remove(g.group);
    this.segments = [];
    this.gates = [];
    this.group.position.z = 0;
    this.nextSpawnZ = -SEGMENT_LENGTH;
    this.speed = BASE_SPEED;
    this.speedFactor = 0;
    this.running = false;
    this.distance = 0;
    this.elapsed = 0;
    this.stalkerWarningActive = false;
    this.stalkerTimer = 6 + Math.random() * 4;
    for (let i = 0; i < SEGMENTS_AHEAD; i++) this._spawnSegment();
  }
}
