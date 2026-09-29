// GPU point cloud for gas clouds, tidal debris and comet tails. Every particle
// follows the same Schwarzschild acceleration as the solid bodies.
import * as THREE from 'three';
import { lensChunk } from './lensing.js';

const vertex = /* glsl */ `
attribute vec3 aColor;
attribute float aAlive;
attribute float aSize;
uniform float uPixelScale;
varying vec3 vColor;
varying float vAlpha;
${lensChunk}
void main() {
  vec3 p = lensPoint(position);
  float g = redshiftFactor(position);
  vColor = applyRedshift(aColor, g);
  vAlpha = aAlive * shadowVisibility(p) * (1.0 - diskCover(p));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = aAlive > 0.0 ? clamp(aSize * uPixelScale / -mv.z, 1.0, 24.0) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 14.0) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(pow(vColor, vec3(1.0 / 2.2)) * a * 0.32, a);
}
`;

export class ParticleSystem {
  constructor(capacity = 24000) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alive = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.cursor = 0;
    this.count = 0;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aliveAttr = new THREE.BufferAttribute(this.alive, 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlive', this.aliveAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uM: { value: 1 },
      uDiskOuter: { value: 20 },
      uPixelScale: { value: 400 },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
  }

  // Add one particle; recycles the oldest slot when full.
  emit(px, py, pz, vx, vy, vz, r, g, b, size = 0.35, life = Infinity) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!this.alive[i]) this.count++;
    const k = i * 3;
    this.pos[k] = px; this.pos[k + 1] = py; this.pos[k + 2] = pz;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.alive[i] = 1;
    this.size[i] = size;
    this.life[i] = life;
    this.dirtyStatic = true;
  }

  // Returns the number of particles swallowed during this step.
  update(dt, M) {
    const { pos, vel, alive, life, capacity } = this;
    const rs = 2 * M;
    let swallowed = 0;
    if (dt <= 0) return 0;
    for (let i = 0; i < capacity; i++) {
      if (!alive[i]) continue;
      const k = i * 3;
      let px = pos[k], py = pos[k + 1], pz = pos[k + 2];
      let vx = vel[k], vy = vel[k + 1], vz = vel[k + 2];
      let r = Math.sqrt(px * px + py * py + pz * pz);
      const n = Math.min(24, Math.ceil(dt / (0.012 * r * Math.sqrt(r / M))));
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        const r2 = px * px + py * py + pz * pz;
        r = Math.sqrt(r2);
        if (r < rs) break;
        const lx = py * vz - pz * vy, ly = pz * vx - px * vz, lz = px * vy - py * vx;
        const f = (-M / (r2 * r)) * (1 + (3 * (lx * lx + ly * ly + lz * lz)) / r2) * h;
        vx += f * px; vy += f * py; vz += f * pz;
        px += vx * h; py += vy * h; pz += vz * h;
      }
      pos[k] = px; pos[k + 1] = py; pos[k + 2] = pz;
      vel[k] = vx; vel[k + 1] = vy; vel[k + 2] = vz;
      life[i] -= dt;
      if (r < rs * 1.01) {
        alive[i] = 0; this.count--; swallowed++;
      } else if (r > 900 || life[i] <= 0) {
        alive[i] = 0; this.count--;
      }
    }
    this.posAttr.needsUpdate = true;
    this.aliveAttr.needsUpdate = true;
    if (this.dirtyStatic) {
      this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.dirtyStatic = false;
    }
    return swallowed;
  }

  clear() {
    this.alive.fill(0);
    this.count = 0;
    this.aliveAttr.needsUpdate = true;
  }
}
