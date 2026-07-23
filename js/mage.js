import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "assets/models/mage.glb"; // placeholder rig (see README) — drop in a
// real mage GLTF+Mixamo export here later; the animation names below
// ("Idle"/"Run") are the only thing that needs to match.

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class Mage {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    this.group.rotation.y = 0;
    scene.scene.add(this.group);

    this.spinTween = null; // { from, delta, duration, t, onComplete }
    this.mixer = null;
    this.actions = {};
    this.currentLoop = null;
    this.runWeight = 0;

    this.revealBurst = this._buildRevealParticles();
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);
    const model = gltf.scene;
    model.scale.setScalar(1.55); // "medium-large" mage presence
    // Soldier.glb's default forward is already -z, matching the maze's
    // travel direction — no rotation needed (was Math.PI, which turned the
    // mage to face the camera instead of down the corridor).
    this.group.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    if (this.actions.Idle) {
      this.actions.Idle.play();
      this.currentLoop = "Idle";
    }
    // Subtle spooky glow ring under the mage's feet.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0x6fd8c8, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.group.add(ring);
    this.glowRing = ring;
  }

  setRunning(active) {
    this._crossfadeTo(active ? "Run" : "Idle", 0.35);
  }

  _crossfadeTo(name, duration) {
    if (!this.actions[name] || this.currentLoop === name) return;
    const next = this.actions[name];
    const prev = this.currentLoop ? this.actions[this.currentLoop] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(next, duration, false);
    this.currentLoop = name;
  }

  // Rotates the mage by deltaRad (signed: negative = left, positive = right,
  // ±PI = about-face). Used both for maze-junction turns (silent) and the
  // three-fingers-up hint-reveal flourish (a full 2*PI spin back to facing
  // forward). Whoever calls this should hold off on moving the mage forward
  // until the onComplete callback fires — the maze already does this via
  // its `turning` flag, so a turn always finishes before you're walked into
  // the new path.
  turnBy(deltaRad, onComplete) {
    if (this.spinTween) return false;
    const duration = 0.4 + (Math.abs(deltaRad) / Math.PI) * 0.35;
    this.spinTween = { from: this.group.rotation.y, delta: deltaRad, t: 0, duration, onComplete };
    return true;
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);

    if (this.spinTween) {
      this.spinTween.t += dt;
      const p = Math.min(1, this.spinTween.t / this.spinTween.duration);
      const e = easeInOutCubic(p);
      this.group.rotation.y = this.spinTween.from + e * this.spinTween.delta;
      if (p >= 1) {
        this.group.rotation.y = (this.spinTween.from + this.spinTween.delta) % (Math.PI * 2);
        const cb = this.spinTween.onComplete;
        this.spinTween = null;
        if (cb) cb();
      }
    }

    if (this.glowRing) {
      this.glowRing.rotation.z += dt * 0.6;
      this.glowRing.material.opacity = 0.4 + Math.sin(performance.now() * 0.002) * 0.15;
    }

    this._updateRevealParticles(dt);
  }

  _buildRevealParticles() {
    const count = 400;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xd9a548, size: 0.06, transparent: true, opacity: 0 });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, geo, positions, velocities, count, life: 0, active: false };
  }

  setParticleCount(count) {
    // Sign Lab "particles" slider — rebuild the buffer at a new density.
    const b = this.revealBurst;
    if (count === b.count) return;
    b.count = count;
    b.positions = new Float32Array(count * 3);
    b.velocities = new Float32Array(count * 3);
    b.geo.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
  }

  triggerRevealBurst() {
    const b = this.revealBurst;
    for (let i = 0; i < b.count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 1.5 + Math.random() * 2.5;
      b.positions[i * 3] = 0;
      b.positions[i * 3 + 1] = 1.2;
      b.positions[i * 3 + 2] = 0;
      b.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      b.velocities[i * 3 + 1] = Math.cos(phi) * speed * 0.6 + 1.5;
      b.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    b.geo.attributes.position.needsUpdate = true;
    b.life = 1.0;
    b.active = true;
    b.points.material.opacity = 1;
  }

  _updateRevealParticles(dt) {
    const b = this.revealBurst;
    if (!b.active) return;
    b.life -= dt * 0.9;
    if (b.life <= 0) {
      b.active = false;
      b.points.material.opacity = 0;
      return;
    }
    b.points.material.opacity = Math.max(0, b.life);
    for (let i = 0; i < b.count; i++) {
      b.positions[i * 3] += b.velocities[i * 3] * dt;
      b.positions[i * 3 + 1] += (b.velocities[i * 3 + 1] - 3.0 * (1 - b.life)) * dt;
      b.positions[i * 3 + 2] += b.velocities[i * 3 + 2] * dt;
    }
    b.geo.attributes.position.needsUpdate = true;
  }
}
