// Pointer handling: drag to aim and throw, right-drag or two fingers to orbit,
// wheel or pinch to zoom. Draws the aim arrow and the predicted trajectory.
import * as THREE from 'three';
import { lensChunk } from './lensing.js';
import { predictTrajectory } from './physics.js';

const MAX_POINTS = 700;
const FATE_COLORS = {
  plunge: new THREE.Color(1.0, 0.42, 0.25),
  orbit: new THREE.Color(0.5, 0.78, 1.0),
  escape: new THREE.Color(0.6, 0.95, 0.72),
};

const lineVertex = /* glsl */ `
attribute float aDist;
varying float vDist;
varying float vVis;
${lensChunk}
void main() {
  vec3 p = lensPoint(position);
  vVis = shadowVisibility(p);
  vDist = aDist;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const lineFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uDash;
uniform float uOpacity;
uniform float uPhase;
varying float vDist;
varying float vVis;
void main() {
  if (uDash > 0.0 && fract(vDist * uDash - uPhase) > 0.55) discard;
  float fade = uDash > 0.0 ? clamp(1.0 - vDist / 900.0, 0.25, 1.0) : 1.0;
  gl_FragColor = vec4(uColor, uOpacity * vVis * fade);
}
`;

function makeLine(shared, dash, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const dist = new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('aDist', dist);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(1, 1, 1) },
      uDash: { value: dash },
      uOpacity: { value: opacity },
      uPhase: { value: 0 },
    },
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    transparent: true,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

function setLine(line, pts, n) {
  const pos = line.geometry.attributes.position;
  const dist = line.geometry.attributes.aDist;
  let d = 0;
  n = Math.min(n, MAX_POINTS);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    if (i > 0) d += Math.hypot(x - pos.array[(i - 1) * 3], y - pos.array[(i - 1) * 3 + 1], z - pos.array[(i - 1) * 3 + 2]);
    pos.array[i * 3] = x; pos.array[i * 3 + 1] = y; pos.array[i * 3 + 2] = z;
    dist.array[i] = d;
  }
  pos.needsUpdate = true;
  dist.needsUpdate = true;
  line.geometry.setDrawRange(0, n);
}

export class Launcher {
  constructor({ canvas, camera, rig, getM, onLaunch, onFirstInteraction, onAimChange }) {
    this.canvas = canvas;
    this.camera = camera;
    this.rig = rig;
    this.getM = getM;
    this.onLaunch = onLaunch;
    this.onFirstInteraction = onFirstInteraction;
    this.onAimChange = onAimChange;
    this.pointers = new Map();
    this.mode = null; // 'aim' | 'orbit' | 'gesture'
    this.shared = { uM: { value: 1 }, uDiskOuter: { value: 20 } };
    this.preview = makeLine(this.shared, 0.9, 0.9);
    this.arrow = makeLine(this.shared, 0, 0.65);
    this.arrow.material.uniforms.uColor.value.setRGB(1, 1, 1);
    this.fate = null;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane();
    this.start = new THREE.Vector3();
    this.current = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.bind();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e, true));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.rig.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  // Point under the cursor on the plane through the hole facing the camera.
  pick(e, out) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const n = this.camera.position.clone().normalize();
    this.plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3());
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  down(e) {
    this.onFirstInteraction?.();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (this.pointers.size >= 2) {
      this.cancelAim();
      this.mode = 'gesture';
      this.pinch = this.gestureMetrics();
      return;
    }
    const orbit = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey || e.altKey);
    if (orbit) { this.mode = 'orbit'; return; }
    if (e.button !== 0) return;
    if (!this.pick(e, this.start)) return;
    const M = this.getM();
    const minR = 5 * M;
    if (this.start.length() < minR) this.start.setLength(minR);
    this.current.copy(this.start);
    this.mode = 'aim';
    this.updateAim();
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.mode === 'orbit') this.rig.rotate(dx, dy);
    else if (this.mode === 'gesture' && this.pointers.size >= 2) {
      const m = this.gestureMetrics();
      this.rig.rotate(m.cx - this.pinch.cx, m.cy - this.pinch.cy);
      if (this.pinch.d > 0 && m.d > 0) this.rig.zoom(this.pinch.d / m.d);
      this.pinch = m;
    } else if (this.mode === 'aim') {
      if (this.pick(e, this.current)) this.updateAim();
    }
  }

  up(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.mode === 'aim' && !cancelled && p) {
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < 6) this.velocity.set(0, 0, 0);
      this.onLaunch(this.start.clone(), this.velocity.clone());
      this.cancelAim();
    }
    if (this.pointers.size === 0) this.mode = null;
    else if (this.mode === 'gesture' && this.pointers.size === 1) this.mode = 'orbit';
  }

  gestureMetrics() {
    const pts = [...this.pointers.values()];
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  // Drag length maps smoothly onto speed, saturating below the speed of light.
  updateAim() {
    const drag = this.current.clone().sub(this.start);
    const len = drag.length();
    const v = 0.9 * Math.tanh(len / 42);
    this.velocity.copy(len > 1e-6 ? drag.setLength(v) : drag.set(0, 0, 0));
    const M = this.getM();
    const { points, fate } = predictTrajectory(this.start.toArray(), this.velocity.toArray(), M, { maxPoints: MAX_POINTS - 1 });
    setLine(this.preview, points, points.length / 3);
    this.preview.material.uniforms.uColor.value.copy(FATE_COLORS[fate]);
    this.preview.visible = true;
    const a = new Float32Array([...this.start.toArray(), ...this.current.toArray()]);
    setLine(this.arrow, a, 2);
    this.arrow.visible = len > 0.3;
    this.fate = fate;
    this.onAimChange?.({ fate, speed: v });
  }

  cancelAim() {
    this.mode = null;
    this.preview.visible = false;
    this.arrow.visible = false;
    this.onAimChange?.(null);
  }

  update(time, M, diskOuter) {
    this.shared.uM.value = M;
    this.shared.uDiskOuter.value = diskOuter;
    this.preview.material.uniforms.uPhase.value = time * 1.5;
  }
}
