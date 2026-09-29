import * as THREE from 'three';
import { blackholeVertex, blackholeFragment, compositeFragment } from './blackholeShader.js';
import {
  stepBody, radius, speed, circularSpeed, clockRate, gravitationalRedshift,
  gravRadiusMeters, tidalAcceleration, tidalDisruptionRadius, SOLAR_MASS,
} from './physics.js';
import { CATALOG, ORDER } from './catalog.js';
import { createObjectMesh, disposeObject } from './objects.js';
import { ParticleSystem } from './particles.js';
import { CameraRig } from './camera.js';
import { Launcher } from './launcher.js';
import { SoundEngine } from './audio.js';
import { createUI, fmtLength, TIME_STEPS } from './ui.js';

// Simulation time units (GM/c³ of the on-screen hole) per real second at 1×.
const SIM_SPEED = 55;
// Tidal disruption is drawn no farther out than this many M, so a stellar-mass
// hole shreds things on screen instead of the moment they spawn.
const DISRUPT_CAP = 14;
const QUALITY = [
  { name: 'Ultra', scale: 1.0, steps: 300 },
  { name: 'High', scale: 0.8, steps: 240 },
  { name: 'Medium', scale: 0.6, steps: 190 },
  { name: 'Low', scale: 0.45, steps: 150 },
  { name: 'Potato', scale: 0.33, steps: 110 },
];

const canvas = document.getElementById('scene');
const gl2 = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
if (!gl2) {
  document.getElementById('fallback').hidden = false;
  throw new Error('WebGL 2 not available');
}

const renderer = new THREE.WebGLRenderer({ canvas, context: gl2, antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
const dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
const rig = new CameraRig(camera);
const scene = new THREE.Scene();
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.PlaneGeometry(2, 2);

// ---------- Black hole pass ----------
const bhUniforms = {
  uCamPos: { value: new THREE.Vector3() },
  uInvProj: { value: new THREE.Matrix4() },
  uCamWorld: { value: new THREE.Matrix4() },
  uTime: { value: 0 },
  uM: { value: 1 },
  uDiskOuter: { value: 18 },
  uDiskBoost: { value: 0 },
  uSteps: { value: QUALITY[1].steps },
};
const bhScene = new THREE.Scene();
bhScene.add(new THREE.Mesh(quad, new THREE.ShaderMaterial({
  uniforms: bhUniforms,
  vertexShader: blackholeVertex,
  fragmentShader: blackholeFragment,
  depthTest: false,
  depthWrite: false,
})));
const rt = new THREE.WebGLRenderTarget(4, 4, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
});
const compUniforms = {
  tSrc: { value: rt.texture },
  uTexel: { value: new THREE.Vector2() },
  uExposure: { value: 1.0 },
};
const compScene = new THREE.Scene();
compScene.add(new THREE.Mesh(quad, new THREE.ShaderMaterial({
  uniforms: compUniforms,
  vertexShader: blackholeVertex,
  fragmentShader: compositeFragment,
  depthTest: false,
  depthWrite: false,
})));

// ---------- State ----------
const state = {
  massSolar: 4.3e6,
  M: 1,
  timeScale: 1,
  paused: false,
  selected: 'star',
  swallowed: 0,
  simTime: 0,
  diskBoost: 0,
  quality: 1,
  tracked: null,
};
const bodies = [];
const particles = new ParticleSystem(24000);
scene.add(particles.points);
const sound = new SoundEngine();

// Map 9 decades of real mass onto a hole that stays readable on screen.
function massToSim(ms) {
  const t = (Math.log10(ms) - Math.log10(5)) / (10 - Math.log10(5));
  return 0.8 + 1.1 * Math.max(0, Math.min(1, t));
}
const diskOuter = () => 18 * state.M;
const metersPerUnit = () => gravRadiusMeters(state.massSolar) / state.M;

function setMass(ms) {
  state.massSolar = ms;
  state.M = massToSim(ms);
  rig.minDist = 6 * state.M;
  if (rig.tDist < rig.minDist) rig.tDist = rig.minDist;
  for (const b of bodies) b.rt = null;
  ui.setMass(ms);
}

// ---------- Bodies ----------
let nextId = 1;
function spawn(type, p, v, { quiet = false } = {}) {
  const cat = CATALOG[type];
  const body = {
    id: nextId++, type, cat,
    s: new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z]),
    obj: null, alive: true, shredded: false, state: 'orbit', statusLabel: 'Orbiting',
    spinAxis: new THREE.Vector3().randomDirection(), spinRate: 0.2 + Math.random() * 0.6,
    rt: null, stretch: 1, emit: 0,
  };
  if (type === 'cloud') {
    body.shredded = true;
    emitCloud(p, v, cat);
  } else {
    body.obj = createObjectMesh(type, cat.size);
    scene.add(body.obj.group);
  }
  bodies.push(body);
  state.tracked = body;
  if (!quiet) sound.launch();
  return body;
}

function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random());
}

function pickColor(palette) {
  const c = palette[(Math.random() * palette.length) | 0];
  const j = 0.85 + Math.random() * 0.3;
  return [c[0] * j, c[1] * j, c[2] * j];
}

function emitCloud(p, v, cat) {
  const n = cat.debris;
  const spread = 0.012;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = pickColor(cat.palette);
    particles.emit(
      p.x + gauss() * cat.size, p.y + gauss() * cat.size * 0.6, p.z + gauss() * cat.size,
      v.x + gauss() * spread, v.y + gauss() * spread, v.z + gauss() * spread,
      r * 0.8, g * 0.8, b * 0.8, 0.5 + Math.random() * 0.5,
    );
  }
}

// Tidal disruption: the body becomes a stream of debris. Pieces nearer the
// hole orbit faster, so the stream stretches along the orbit.
function shred(body) {
  const { s, cat } = body;
  const r = radius(s);
  const n = new THREE.Vector3(s[0], s[1], s[2]).divideScalar(r);
  const omega = Math.sqrt(state.M / (r * r * r));
  const size = cat.size;
  for (let i = 0; i < cat.debris; i++) {
    const d = new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * size);
    const along = d.dot(n);
    d.addScaledVector(n, along * (body.stretch - 1));
    const [cr, cg, cb] = pickColor(cat.palette);
    const kick = -along * omega * 1.6;
    particles.emit(
      s[0] + d.x, s[1] + d.y, s[2] + d.z,
      s[3] + n.x * kick + gauss() * 0.004, s[4] + n.y * kick + gauss() * 0.004, s[5] + n.z * kick + gauss() * 0.004,
      cr * 1.2, cg * 1.2, cb * 1.2, 0.3 + Math.random() * 0.35,
    );
  }
  removeMesh(body);
  body.shredded = true;
  state.diskBoost += body.type === 'star' ? 0.9 : 0.35;
  sound.shred();
  if (body === state.tracked) ui.toast(`${cat.name} torn apart by tides`, 'shredded');
}

function swallow(body) {
  removeMesh(body);
  body.alive = false;
  body.state = 'gone';
  body.statusLabel = 'Swallowed';
  state.swallowed++;
  state.diskBoost += body.type === 'star' ? 0.6 : 0.2;
  sound.swallow(body.type === 'star' ? 2 : 1);
  if (body === state.tracked || !body.shredded) ui.toast(`${body.cat.name} crossed the event horizon`, 'plunge');
}

function removeMesh(body) {
  if (!body.obj) return;
  scene.remove(body.obj.group);
  disposeObject(body.obj);
  body.obj = null;
}

function disruptionRadiusUnits(body) {
  if (body.rt == null) {
    const rtM = body.cat.bound === 'none' ? 0 : tidalDisruptionRadius(body.cat, state.massSolar);
    body.rtMeters = rtM;
    body.rt = rtM / metersPerUnit();
  }
  return body.rt;
}

const tmpQ = new THREE.Quaternion();
function updateBodies(dt, realDt) {
  const M = state.M;
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (!b.alive) {
      if (b !== state.tracked) bodies.splice(i, 1);
      continue;
    }
    stepBody(b.s, dt, M);
    const r = radius(b.s);
    if (r < 2 * M * 1.02) { swallow(b); continue; }
    if (r > 900) {
      removeMesh(b);
      b.alive = false; b.state = 'escape'; b.statusLabel = 'Escaped';
      continue;
    }

    // Fate from energy and angular momentum (capture when L < 4M for unbound-ish orbits).
    const v = speed(b.s);
    const vr = (b.s[0] * b.s[3] + b.s[1] * b.s[4] + b.s[2] * b.s[5]) / r;
    const L = r * Math.sqrt(Math.max(v * v - vr * vr, 0));
    const E = 0.5 * v * v - M / r;
    const prev = b.state;
    if (E >= 0 && vr > 0) { b.state = 'escape'; b.statusLabel = 'Escaping'; }
    else if (L < 4 * M && vr < 0) { b.state = 'plunge'; b.statusLabel = 'Plunging'; }
    else { b.state = 'orbit'; b.statusLabel = 'Orbiting'; }
    if (b.shredded && b.type !== 'cloud') b.statusLabel = `Debris · ${b.statusLabel.toLowerCase()}`;
    if (b === state.tracked && prev !== b.state && b.state === 'plunge' && !b.warned) {
      b.warned = true;
      ui.toast('No escape: plunging orbit', 'plunge');
    }

    if (!b.obj) continue;
    const rt = Math.min(disruptionRadiusUnits(b), DISRUPT_CAP * M);
    const x = Math.min(rt / r, 1);
    b.stretch = 1 + 2.4 * x * x * x;
    if (rt > 2 * M && r < rt) { shred(b); continue; }

    const g = b.obj.group;
    g.position.set(b.s[0], b.s[1], b.s[2]);
    tmpQ.setFromAxisAngle(b.spinAxis, b.spinRate * realDt * (state.paused ? 0 : 1));
    b.obj.inner.quaternion.premultiply(tmpQ);
    const sh = b.obj.shared;
    sh.uCenter.value.copy(g.position);
    sh.uStretch.value = b.stretch;
    sh.uM.value = M;
    sh.uDiskOuter.value = diskOuter();
    sh.uTime.value = state.simTime;
    sh.uDiskLight.value = 1 + state.diskBoost * 0.6;

    // Comets outgas more the closer they get to the hot disk.
    if (b.type === 'comet' && dt > 0) {
      b.emit += dt * Math.min(6, 90 / (r * r / (M * M) * 0.2 + 1)) * 0.6;
      const out = new THREE.Vector3(b.s[0], b.s[1], b.s[2]).normalize();
      while (b.emit > 1) {
        b.emit -= 1;
        const push = 0.015 + Math.random() * 0.02;
        particles.emit(
          b.s[0] + gauss() * 0.15, b.s[1] + gauss() * 0.15, b.s[2] + gauss() * 0.15,
          b.s[3] + out.x * push, b.s[4] + out.y * push, b.s[5] + out.z * push,
          0.35, 0.6, 1.0, 0.35, 260,
        );
      }
    }
  }
}

// ---------- UI ----------
const ui = createUI({
  onSelect(type) { state.selected = type; ui.select(type); },
  onMass: setMass,
  onTime(scale) { state.timeScale = scale; state.paused = false; ui.setTime(scale, false); },
  onPause() { state.paused = !state.paused; ui.setTime(state.timeScale, state.paused); },
  onClear() {
    for (const b of bodies) removeMesh(b);
    bodies.length = 0;
    state.tracked = null;
    particles.clear();
  },
  onMute() { sound.setMuted(!sound.muted); ui.setMuted(sound.muted); },
});

const launcher = new Launcher({
  canvas, camera, rig,
  getM: () => state.M,
  onFirstInteraction: () => sound.start(),
  onLaunch(p, v) {
    spawn(state.selected, p, v);
    ui.hideHint();
  },
  onAimChange(aim) {
    if (!aim) return;
    const label = { plunge: 'Plunge', orbit: 'Orbit', escape: 'Escape' }[aim.fate];
    ui.toast(`${label} · ${aim.speed.toFixed(2)} c`, aim.fate);
  },
});
scene.add(launcher.preview, launcher.arrow);

// ---------- Telemetry ----------
function telemetry(fps) {
  const rg = gravRadiusMeters(state.massSolar);
  const mpu = metersPerUnit();
  const t = state.tracked;
  let tracked = null;
  if (t) {
    const r = radius(t.s);
    const v = speed(t.s);
    const alive = t.alive;
    const g = alive ? gravitationalRedshift(r, state.M) : 0;
    const rReal = r * mpu;
    disruptionRadiusUnits(t);
    let rtLabel;
    if (t.cat.bound === 'none') rtLabel = 'Never (gas)';
    else if (t.rtMeters < 2 * rg) rtLabel = 'Never · crosses intact';
    else rtLabel = `${fmtLength(t.rtMeters)} (${(t.rtMeters / (2 * rg)).toFixed(1)} r_s)`;
    tracked = {
      name: t.cat.name,
      state: t.state === 'gone' ? 'gone' : t.shredded && t.type !== 'cloud' ? 'shredded' : t.state,
      statusLabel: t.statusLabel,
      distM: Math.max(0, (r - 2 * state.M) * mpu),
      rOverRs: r / (2 * state.M),
      v: Math.min(v, 0.999),
      clock: alive ? clockRate(r, v, state.M) : 0,
      z: g > 0 ? 1 / g - 1 : Infinity,
      tidalG: t.cat.bound === 'none' ? null : tidalAcceleration(rReal, state.massSolar * SOLAR_MASS, 2 * t.cat.radiusM) / 9.81,
      rtLabel,
    };
  }
  return {
    massSolar: state.massSolar,
    rsM: 2 * rg,
    inFlight: bodies.filter((b) => b.alive).length,
    particles: particles.count,
    swallowed: state.swallowed,
    fps,
    quality: QUALITY[state.quality].name,
    tracked,
  };
}

// ---------- Sizing and quality ----------
let W = 1, H = 1;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  applyQuality();
}
function applyQuality() {
  const q = QUALITY[state.quality];
  const w = Math.max(2, Math.round(W * dpr * q.scale));
  const h = Math.max(2, Math.round(H * dpr * q.scale));
  rt.setSize(w, h);
  compUniforms.uTexel.value.set(1 / w, 1 / h);
  bhUniforms.uSteps.value = q.steps;
  particles.uniforms.uPixelScale.value = H * dpr * 0.9;
}
window.addEventListener('resize', resize);

// Adaptive quality: step down when frames run long, back up when there is headroom.
let frameAvg = 16, slowFor = 0, fastFor = 0;
function adaptQuality(ms, realDt) {
  frameAvg += (ms - frameAvg) * 0.05;
  if (frameAvg > 24) { slowFor += realDt; fastFor = 0; } else if (frameAvg < 12) { fastFor += realDt; slowFor = 0; } else { slowFor = fastFor = 0; }
  if (slowFor > 1.2 && state.quality < QUALITY.length - 1) { state.quality++; slowFor = 0; frameAvg = 16; applyQuality(); }
  if (fastFor > 4 && state.quality > 0) { state.quality--; fastFor = 0; frameAvg = 16; applyQuality(); }
}

// ---------- Loop ----------
let last = performance.now();
let uiTimer = 0;
let fps = 60;
function frame(now) {
  const realDt = Math.min((now - last) / 1000, 0.05);
  const frameMs = now - last;
  last = now;
  fps += (1000 / Math.max(frameMs, 1) - fps) * 0.05;

  const dt = state.paused ? 0 : realDt * SIM_SPEED * state.timeScale;
  state.simTime += dt;
  updateBodies(dt, realDt);
  const eaten = particles.update(dt, state.M);
  if (eaten) state.diskBoost += eaten * 0.0006;
  state.diskBoost = Math.min(state.diskBoost, 2.5) * Math.exp(-realDt * 0.6);

  rig.minDist = 6 * state.M;
  rig.update(realDt);
  launcher.update(now / 1000, state.M, diskOuter());
  particles.uniforms.uM.value = state.M;
  particles.uniforms.uDiskOuter.value = diskOuter();

  bhUniforms.uCamPos.value.copy(camera.position);
  bhUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
  bhUniforms.uCamWorld.value.copy(camera.matrixWorld);
  bhUniforms.uTime.value = state.simTime;
  bhUniforms.uM.value = state.M;
  bhUniforms.uDiskOuter.value = diskOuter();
  bhUniforms.uDiskBoost.value = state.diskBoost;

  renderer.setRenderTarget(rt);
  renderer.render(bhScene, orthoCam);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(compScene, orthoCam);
  renderer.clearDepth();
  renderer.render(scene, camera);

  const t = state.tracked;
  sound.setTracker(!!(t && t.alive), t && t.alive ? gravitationalRedshift(radius(t.s), state.M) : 0);

  uiTimer += realDt;
  if (uiTimer > 0.12 && ui.isOpen()) {
    uiTimer = 0;
    ui.update(telemetry(fps));
  }
  if (!document.hidden) adaptQuality(frameMs, realDt);
  requestAnimationFrame(frame);
}

// ---------- Boot ----------
resize();
setMass(state.massSolar);
ui.select(state.selected);
ui.setTime(state.timeScale, false);
ui.setMuted(false);

// Opening scene: a ringed planet already on a tilted, stable orbit.
{
  const r = 17 * state.M;
  const tilt = 0.28;
  const p = new THREE.Vector3(r, 0, 0);
  const v = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt)).multiplyScalar(circularSpeed(r, state.M) * 1.02);
  spawn('planet', p, v, { quiet: true });
}
ui.update(telemetry(60));

// Exposed for automated checks.
window.__bh = { state, bodies, particles, spawn, setMass, THREE, ORDER, TIME_STEPS, renderer };
requestAnimationFrame(frame);
