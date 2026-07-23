import * as THREE from "three";

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = new THREE.FogExp2(0x070a0d, 0.032);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
    this.cameraRigOffset = new THREE.Vector3(0, 2.3, 4.6);
    this.cameraLookAhead = new THREE.Vector3(0, 1.3, -6);

    const ambient = new THREE.AmbientLight(0x4a5850, 2.4);
    this.scene.add(ambient);

    const rim = new THREE.PointLight(0x6fd8c8, 2.2, 14, 2);
    rim.position.set(0, 3, 2);
    this.rimLight = rim;
    this.scene.add(rim);

    const moon = new THREE.DirectionalLight(0x8899aa, 0.9);
    moon.position.set(-4, 8, -6);
    this.scene.add(moon);

    window.addEventListener("resize", () => this._onResize());
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateCamera(mageObject, dt) {
    const targetPos = mageObject.localToWorld(this.cameraRigOffset.clone());
    this.camera.position.lerp(targetPos, 1 - Math.pow(0.001, dt));
    const lookTarget = mageObject.localToWorld(this.cameraLookAhead.clone());
    this.camera.lookAt(lookTarget);
    this.rimLight.position.set(mageObject.position.x, 3, mageObject.position.z + 2);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
