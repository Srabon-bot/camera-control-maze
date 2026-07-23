import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const LANES = [-1.6, 0, 1.6];
const MODEL_URL = "assets/models/mage.glb"; // placeholder rig (see README) — drop in a
// real mage GLTF+Mixamo export here later; the animation names below
// ("Idle"/"Run") are the only thing that needs to match.

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class Mage {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    scene.scene.add(this.group);

    this.laneIndex = 1;
    this.laneTween = null; // { from, to, t, duration }
    this.spinTween = null; // { from, duration, t }
    this.mixer = null;
    this.actions = {};
    this.currentLoop = null;
    this.runWeight = 0;

    this.banishBurst = this._buildBanishParticles();
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);
    const model = gltf.scene;
    model.scale.setScalar(1.55); // "medium-large" mage presence
    // Soldier.glb's default forward is already -z, matching the corridor's
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

  strafe(direction) {
    // direction: -1 (left) or +1 (right)
    const target = Math.max(0, Math.min(LANES.length - 1, this.laneIndex + direction));
    if (target === this.laneIndex) return false;
    this.laneIndex = target;
    this.laneTween = { from: this.group.position.x, to: LANES[target], t: 0, duration: 0.28 };
    return true;
  }

  turnAround(onComplete) {
    if (this.spinTween) return false;
    this.spinTween = { from: this.group.rotation.y, t: 0, duration: 0.65, onComplete };
    return true;
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);

    if (this.laneTween) {
      this.laneTween.t += dt;
      const p = Math.min(1, this.laneTween.t / this.laneTween.duration);
      const e = easeOutCubic(p);
      this.group.position.x = THREE.MathUtils.lerp(this.laneTween.from, this.laneTween.to, e);
      this.group.rotation.z = Math.sin(p * Math.PI) * -0.18 * Math.sign(this.laneTween.to - this.laneTween.from || 1);
      if (p >= 1) {
        this.group.rotation.z = 0;
        this.laneTween = null;
      }
    }

    if (this.spinTween) {
      this.spinTween.t += dt;
      const p = Math.min(1, this.spinTween.t / this.spinTween.duration);
      const e = easeOutCubic(p);
      this.group.rotation.y = this.spinTween.from + e * Math.PI * 2;
      if (p >= 1) {
        // Land back exactly where we started (a full 360 whirl), normalized
        // so repeated spins don't accumulate unbounded radians.
        this.group.rotation.y = this.spinTween.from % (Math.PI * 2);
        const cb = this.spinTween.onComplete;
        this.spinTween = null;
        if (cb) cb();
      }
    }

    if (this.glowRing) {
      this.glowRing.rotation.z += dt * 0.6;
      this.glowRing.material.opacity = 0.4 + Math.sin(performance.now() * 0.002) * 0.15;
    }

    this._updateBanishParticles(dt);
  }

  _buildBanishParticles() {
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

  setBanishParticleCount(count) {
    // Sign Lab "particles" slider — rebuild the buffer at a new density.
    const b = this.banishBurst;
    if (count === b.count) return;
    b.count = count;
    b.positions = new Float32Array(count * 3);
    b.velocities = new Float32Array(count * 3);
    b.geo.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
  }

  triggerBanishBurst() {
    const b = this.banishBurst;
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

  _updateBanishParticles(dt) {
    const b = this.banishBurst;
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

export { LANES };
