// Orbit camera around the hole with eased yaw, pitch and distance.
export class CameraRig {
  constructor(camera, { yaw = 0.9, pitch = 0.09, dist = 64 } = {}) {
    this.camera = camera;
    this.yaw = this.tYaw = yaw;
    this.pitch = this.tPitch = pitch;
    this.dist = this.tDist = dist;
    this.minDist = 8;
    this.maxDist = 240;
    this.drift = 0.004; // slow idle drift so the lensing is always alive
    this.idle = 0;
    this.baseDist = dist;
    this.userZoomed = false;
  }

  // Frame the scene by width: back off until halfWidth fits the horizontal
  // field of view (narrow portrait screens), never closer than the default.
  // A zoom the user chose is left alone.
  fit(halfWidth, camera, snap = false) {
    if (this.userZoomed) return;
    const halfV = (camera.fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const d = Math.max(this.baseDist, halfWidth / Math.tan(halfH));
    this.tDist = Math.max(this.minDist, Math.min(this.maxDist, d));
    if (snap) this.dist = this.tDist;
  }

  rotate(dx, dy) {
    this.tYaw -= dx * 0.005;
    this.tPitch = Math.max(-1.45, Math.min(1.45, this.tPitch + dy * 0.004));
    this.idle = 0;
  }

  zoom(factor) {
    this.tDist = Math.max(this.minDist, Math.min(this.maxDist, this.tDist * factor));
    this.idle = 0;
    this.userZoomed = true;
  }

  update(dt) {
    this.idle += dt;
    if (this.idle > 6) this.tYaw += this.drift * dt * 6;
    const k = 1 - Math.exp(-dt * 7);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.dist += (this.tDist - this.dist) * k;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.dist * cp * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.dist * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }
}
