// Procedural meshes for everything in the catalog. Each spawned body gets one
// shared uniform set, so all of its parts stretch, lens and redden together.
import * as THREE from 'three';
import { lensChunk } from './lensing.js';

const vertex = /* glsl */ `
uniform vec3 uCenter;
uniform float uStretch;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vObj;
varying vec2 vUv;
${lensChunk}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // Spaghettification: stretch along the radial direction, squeeze across it
  // (volume-preserving), as the tidal tensor of a point mass does.
  vec3 n = normalize(uCenter);
  vec3 d = wp.xyz - uCenter;
  float along = dot(d, n);
  vec3 perp = d - along * n;
  wp.xyz = uCenter + n * along * uStretch + perp / sqrt(uStretch);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  wp.xyz = lensPoint(wp.xyz);
  vWorld = wp.xyz;
  vObj = position;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uFade;
uniform float uDiskLight;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vObj;
varying vec2 vUv;
${lensChunk}

float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }

void main() {
  float vis = shadowVisibility(vWorld);
  if (vis < 0.01) discard;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float g = redshiftFactor(uCenter);
  float alpha = vis * (1.0 - diskCover(vWorld)) * uFade;
  vec3 c;

#if defined(MODE_STAR)
  float gran = h31(floor(vObj * 18.0 + uTime * 0.01)) * 0.25;
  vec3 limb = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.93, 0.8), pow(ndv, 0.6));
  c = limb * (2.2 + gran) * (0.35 + 0.65 * pow(ndv, 0.4));
#elif defined(MODE_GLOW)
  c = uColor * pow(ndv, 2.5) * 1.3;
  alpha *= pow(ndv, 1.5);
#else
  vec3 base = uHasMap > 0.5 ? pow(texture2D(uMap, vUv).rgb, vec3(2.2)) : uColor;
  #if defined(MODE_RING)
    float rr = length(vObj.xy);
    float t = clamp((rr - 1.35) / (2.3 - 1.35), 0.0, 1.0);
    float bands = 0.55 + 0.45 * sin(t * 60.0) * sin(t * 13.0 + 1.0);
    alpha *= smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t) * bands * (t > 0.62 && t < 0.68 ? 0.1 : 0.85);
    N = N * sign(dot(N, V));
  #endif
  // The accretion disk is the only light source out here.
  vec3 L = normalize(-uCenter);
  float r = length(uCenter);
  float li = clamp(260.0 * uM * uM / (r * r), 0.3, 1.8) * uDiskLight;
  float dif = max(dot(N, L), 0.0);
  vec3 diskCol = vec3(1.0, 0.7, 0.42);
  float rim = pow(1.0 - ndv, 3.0);
  // The disk is broad, so it also lights faces turned above or below it.
  float fill = 0.3 * abs(N.y) + 0.12;
  c = base * (dif * diskCol * li + fill * diskCol * min(li, 1.0) * 0.6 + vec3(0.1, 0.1, 0.14)) + rim * diskCol * 0.3 * li;
#endif

  c = applyRedshift(c, g);
  gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), alpha);
}
`;

export function makeShared() {
  return {
    uCenter: { value: new THREE.Vector3() },
    uStretch: { value: 1 },
    uFade: { value: 1 },
    uM: { value: 1 },
    uDiskOuter: { value: 20 },
    uDiskLight: { value: 1 },
    uTime: { value: 0 },
  };
}

function material(shared, { color = [1, 1, 1], map = null, mode = null, additive = false, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(...color) },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
    },
    defines: mode ? { [mode]: '' } : {},
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side,
  });
}

// ---------- Procedural textures ----------

function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, oct = 5) {
  let a = 0.5, s = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); x *= 2.02; y *= 2.02; z *= 2.02; a *= 0.5; }
  return s;
}

// Paint an equirectangular texture by sampling a function on the unit sphere,
// so noise has no seam at the date line.
function sphereTexture(w, h, fn) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const [r, g, b] = fn(x, y, z, lat);
      const k = (j * w + i) * 4;
      img.data[k] = r * 255; img.data[k + 1] = g * 255; img.data[k + 2] = b * 255; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

const texCache = {};
const tex = (key, make) => (texCache[key] ??= make());

const earthTex = () => tex('earth', () => sphereTexture(512, 256, (x, y, z, lat) => {
  const land = fbm3(x * 2.2 + 5, y * 2.2, z * 2.2);
  const cloud = fbm3(x * 4 + 20, y * 7, z * 4);
  const ice = Math.abs(lat) > 1.2;
  let col;
  if (ice) col = [0.92, 0.95, 0.98];
  else if (land > 0.53) {
    const dry = fbm3(x * 6, y * 6, z * 6);
    col = dry > 0.55 ? [0.62, 0.52, 0.34] : [0.2, 0.42, 0.18];
  } else {
    const d = Math.min((0.53 - land) * 6, 1);
    col = [0.04 + 0.08 * (1 - d), 0.18 + 0.15 * (1 - d), 0.45 + 0.1 * (1 - d)];
  }
  const cl = Math.max(0, (cloud - 0.55) * 3.2);
  return col.map((c) => Math.min(1, c * (1 - cl) + cl * 0.97));
}));

const gasTex = () => tex('gas', () => sphereTexture(512, 256, (x, y, z) => {
  const wob = fbm3(x * 3, y * 12, z * 3) * 0.6;
  const b = Math.sin((y + wob * 0.25) * 22) * 0.5 + 0.5;
  const b2 = Math.sin((y + wob * 0.1) * 7 + 1) * 0.5 + 0.5;
  return [0.72 + 0.2 * b, 0.58 + 0.18 * b * b2, 0.4 + 0.18 * b2];
}));

const cowTex = () => tex('cow', () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f1efe9';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1b1715';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    const cx = hash3(i, 1, 2) * 128, cy = hash3(i, 3, 4) * 128;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const rr = 12 + 14 * hash3(i, a, 7);
      ctx[a ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    }
    ctx.fill();
  }
  return new THREE.CanvasTexture(cv);
});

// ---------- Models ----------

function box(shared, w, h, d, color, x = 0, y = 0, z = 0, map = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(shared, { color, map }));
  m.position.set(x, y, z);
  return m;
}

function buildStar(shared, g) {
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material(shared, { mode: 'MODE_STAR' })));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 24),
    material(shared, { mode: 'MODE_GLOW', color: [1.0, 0.7, 0.35], additive: true })));
}

function buildPlanet(shared, g) {
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material(shared, { map: gasTex() })));
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 2.3, 96, 1),
    material(shared, { mode: 'MODE_RING', color: [0.85, 0.78, 0.66], side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2 + 0.35;
  g.add(ring);
}

function buildEarth(shared, g) {
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material(shared, { map: earthTex() })));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 32, 24),
    material(shared, { mode: 'MODE_GLOW', color: [0.3, 0.55, 1.0], additive: true })));
}

function buildAsteroid(shared, g, seed) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.65 + 0.7 * fbm3(x * 1.6 + seed, y * 1.6, z * 1.6, 4);
    p.setXYZ(i, x * k * 1.25, y * k * 0.85, z * k);
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, material(shared, { color: [0.42, 0.39, 0.36] })));
}

function buildComet(shared, g, seed) {
  buildAsteroid(shared, g, seed);
  g.children[0].material.uniforms.uColor.value.setRGB(0.55, 0.6, 0.66);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(2.4, 32, 24),
    material(shared, { mode: 'MODE_GLOW', color: [0.45, 0.7, 1.0], additive: true })));
}

function buildCar(shared, g) {
  const red = [0.8, 0.08, 0.06], glass = [0.08, 0.1, 0.14], tyre = [0.05, 0.05, 0.05];
  g.add(box(shared, 2.0, 0.45, 0.9, red, 0, 0.1, 0));
  g.add(box(shared, 1.1, 0.4, 0.82, glass, -0.15, 0.52, 0));
  g.add(box(shared, 1.05, 0.06, 0.86, red, -0.15, 0.74, 0));
  g.add(box(shared, 0.05, 0.12, 0.2, [1, 0.95, 0.7], 1.0, 0.18, 0.3));
  g.add(box(shared, 0.05, 0.12, 0.2, [1, 0.95, 0.7], 1.0, 0.18, -0.3));
  g.add(box(shared, 0.05, 0.1, 0.18, [0.9, 0.05, 0.05], -1.0, 0.2, 0.3));
  g.add(box(shared, 0.05, 0.1, 0.18, [0.9, 0.05, 0.05], -1.0, 0.2, -0.3));
  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.16, 20);
  for (const [x, z] of [[0.65, 0.46], [0.65, -0.46], [-0.65, 0.46], [-0.65, -0.46]]) {
    const w = new THREE.Mesh(wheelGeo, material(shared, { color: tyre }));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, -0.12, z);
    g.add(w);
  }
  g.scale.setScalar(0.5);
}

function buildCow(shared, g) {
  const hide = cowTex();
  const white = [0.94, 0.93, 0.9], dark = [0.12, 0.1, 0.1], pink = [0.93, 0.62, 0.62], horn = [0.9, 0.85, 0.7];
  g.add(box(shared, 1.5, 0.75, 0.7, white, 0, 0.2, 0, hide));
  g.add(box(shared, 0.45, 0.45, 0.42, white, 0.9, 0.45, 0, hide));
  g.add(box(shared, 0.12, 0.22, 0.34, pink, 1.16, 0.36, 0));
  g.add(box(shared, 0.08, 0.15, 0.06, horn, 0.88, 0.75, 0.16));
  g.add(box(shared, 0.08, 0.15, 0.06, horn, 0.88, 0.75, -0.16));
  g.add(box(shared, 0.1, 0.06, 0.2, dark, 0.82, 0.62, 0.3));
  g.add(box(shared, 0.1, 0.06, 0.2, dark, 0.82, 0.62, -0.3));
  for (const [x, z] of [[0.55, 0.25], [0.55, -0.25], [-0.55, 0.25], [-0.55, -0.25]]) {
    g.add(box(shared, 0.16, 0.6, 0.16, white, x, -0.45, z));
    g.add(box(shared, 0.17, 0.1, 0.17, dark, x, -0.76, z));
  }
  g.add(box(shared, 0.3, 0.14, 0.26, pink, -0.35, -0.22, 0));
  g.add(box(shared, 0.05, 0.5, 0.05, dark, -0.78, 0.0, 0));
  g.scale.setScalar(0.55);
}

const BUILDERS = {
  star: buildStar, planet: buildPlanet, earth: buildEarth, asteroid: buildAsteroid,
  comet: buildComet, car: buildCar, cow: buildCow,
};

// Returns { group, shared } or null for types drawn only as particles.
export function createObjectMesh(type, size) {
  const build = BUILDERS[type];
  if (!build) return null;
  const shared = makeShared();
  const inner = new THREE.Group();
  build(shared, inner, Math.random() * 100);
  const group = new THREE.Group();
  group.add(inner);
  group.scale.setScalar(size);
  return { group, inner, shared };
}

export function disposeObject(obj) {
  obj.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
}
