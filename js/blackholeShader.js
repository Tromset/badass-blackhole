// Full-screen pass that ray-marches light along Schwarzschild null geodesics.
// Each pixel's photon is traced backwards from the camera with the classic
// x'' = -3M h² x / r⁵ equation (h = |x × v| is conserved), picking up
// accretion disk emission every time it crosses the equatorial plane, until
// it falls through the horizon or escapes to the lensed star field.

export const MAX_STEPS = 320;

export const blackholeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const blackholeFragment = /* glsl */ `
precision highp float;

uniform vec3 uCamPos;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uTime;
uniform float uM;
uniform float uDiskOuter;
uniform float uDiskBoost;
uniform int uSteps;

varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

// Planckian locus approximation (Tanner Helland), T in kelvin.
vec3 blackbody(float T) {
  T = clamp(T, 1000.0, 40000.0) / 100.0;
  float r = T <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(T - 60.0, -0.1332047592), 0.0, 1.0);
  float g = T <= 66.0
    ? clamp(0.39008157876 * log(T) - 0.63184144378, 0.0, 1.0)
    : clamp(1.12989086089 * pow(T - 60.0, -0.0755148492), 0.0, 1.0);
  float b = T >= 66.0 ? 1.0 : (T <= 19.0 ? 0.0 : clamp(0.54320678911 * log(T - 10.0) - 1.19625408914, 0.0, 1.0));
  return vec3(r, g, b);
}

vec3 starfield(vec3 d) {
  vec3 col = vec3(0.0015, 0.0018, 0.003);

  // A faint galactic band so the lensing has structure to bend.
  vec3 bandN = normalize(vec3(0.35, 1.0, -0.25));
  float lat = dot(d, bandN);
  float band = exp(-lat * lat * 14.0);
  float dust = fbm(d * 5.0);
  float glow = fbm(d * 2.5 + 7.0);
  col += band * (vec3(0.035, 0.03, 0.05) * glow + vec3(0.02, 0.014, 0.01) * dust) * smoothstep(0.3, 0.8, dust + 0.15);
  col += band * band * vec3(0.012, 0.01, 0.009);

  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float sc = 70.0 + fl * 95.0;
    vec3 p = d * sc;
    vec3 c = floor(p);
    float h = hash(c + fl * 17.13);
    float thresh = 0.94 - band * 0.05;
    if (h > thresh) {
      vec3 sp = c + 0.5 + (vec3(hash(c + 1.3), hash(c + 2.7), hash(c + 4.1)) - 0.5) * 0.7;
      float dist = length(p - sp);
      float br = pow((h - thresh) / (1.0 - thresh), 3.0) * (1.6 - fl * 0.45);
      float twinkle = 0.85 + 0.15 * sin(uTime * 0.02 + h * 91.0);
      col += blackbody(2800.0 + hash(c + 9.0) * 11000.0) * br * twinkle * exp(-dist * dist * 22.0);
    }
  }
  return col;
}

float diskNoise(float ang, float R, float seed) {
  vec2 q = vec2(cos(ang), sin(ang)) * (R / uM);
  float n = fbm(vec3(q * 0.45, R / uM * 0.35 + seed));
  float streak = fbm(vec3(q * 0.12, R / uM * 1.6 + seed));
  return n * streak;
}

// Emission of the thin disk at hit point p (on the y = 0 plane).
vec4 diskSample(vec3 p, float R, vec3 rayDir) {
  float rin = 6.0 * uM;
  float x = R / rin;

  // Shakura–Sunyaev temperature profile, normalised to peak at 1.
  float Tn = pow(x, -0.75) * pow(max(1.0 - sqrt(1.0 / x), 0.0), 0.25) / 0.488;

  // Differential (Keplerian) rotation turns the turbulence into spiral streaks.
  // Two copies half a cycle apart cross-fade, so the shear never winds the
  // pattern into sub-pixel stripes.
  float phi = atan(p.z, p.x);
  float omega = sqrt(uM / (R * R * R));
  const float CYCLE = 900.0;
  float t1 = mod(uTime, CYCLE);
  float t2 = mod(uTime + 0.5 * CYCLE, CYCLE);
  float w1 = 1.0 - abs(2.0 * t1 / CYCLE - 1.0);
  float n = w1 * diskNoise(phi - omega * t1, R, 0.0) + (1.0 - w1) * diskNoise(phi - omega * t2, R, 31.0);
  float dens = smoothstep(rin * 0.98, rin * 1.12, R) * smoothstep(uDiskOuter, uDiskOuter * 0.55, R);
  dens *= 0.25 + 1.75 * n;

  // Relativistic Doppler shift of the orbiting gas plus gravitational redshift.
  float v = min(sqrt(uM / max(R - 2.0 * uM, 0.001)), 0.99);
  vec3 vdir = normalize(vec3(-p.z, 0.0, p.x));
  float gamma = 1.0 / sqrt(1.0 - v * v);
  vec3 toObs = -normalize(rayDir);
  float dop = 1.0 / (gamma * (1.0 - v * dot(vdir, toObs)));
  float grav = sqrt(max(1.0 - 2.0 * uM / R, 0.0));
  float g = dop * grav;

  float T = 4600.0 * Tn * g;
  float intensity = pow(g, 3.0) * pow(Tn, 1.4) * 0.75 * (1.0 + uDiskBoost);
  vec3 c = blackbody(T) * intensity;
  float a = clamp(dens * 1.1, 0.0, 0.98);
  return vec4(c * (0.6 + 0.8 * n), a);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);

  vec3 pos = uCamPos;
  vec3 vel = dir;
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);

  float rs = 2.0 * uM;
  float rin = 6.0 * uM;
  float camR = length(uCamPos);
  float farR = max(camR * 1.3, uDiskOuter * 1.5) + 10.0 * uM;

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  bool captured = false;

  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= uSteps) break;
    float r = length(pos);
    // Step length shrinks near the hole, and more still around the photon sphere.
    float ds = clamp(0.055 * r, 0.02 * uM, 3.0 * uM);
    ds *= mix(0.45, 1.0, smoothstep(0.0, 1.5 * uM, abs(r - 3.0 * uM)));
    float dt = ds / length(vel);

    vec3 acc = -3.0 * uM * h2 * pos / pow(r, 5.0);
    vec3 nvel = vel + acc * dt;
    vec3 npos = pos + nvel * dt;

    if (pos.y * npos.y < 0.0) {
      float t = pos.y / (pos.y - npos.y);
      vec3 hp = mix(pos, npos, t);
      float R = length(hp.xz);
      if (R > rin * 0.97 && R < uDiskOuter) {
        vec4 d = diskSample(hp, R, nvel);
        col += (1.0 - alpha) * d.rgb * d.a;
        alpha += (1.0 - alpha) * d.a;
      }
    }

    pos = npos;
    vel = nvel;
    float nr = length(pos);
    if (nr < rs) { captured = true; break; }
    if (alpha > 0.995) break;
    if (nr > farR && dot(pos, vel) > 0.0) break;
  }

  if (!captured) {
    col += (1.0 - alpha) * starfield(normalize(vel));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// Upscales the (possibly reduced-resolution) black hole buffer, adds a cheap
// multi-ring bloom, then tone maps and gamma-encodes for display.
export const compositeFragment = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uExposure;
varying vec2 vUv;

vec3 bright(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return c * smoothstep(0.55, 1.6, l);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  vec3 b = vec3(0.0);
  float wsum = 0.0;
  for (int ring = 1; ring <= 4; ring++) {
    float rad = float(ring * ring) * 2.2;
    float w = 1.0 / float(ring);
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785398 + float(ring) * 0.39;
      b += bright(vUv + vec2(cos(a), sin(a)) * uTexel * rad) * w;
      wsum += w;
    }
  }
  b /= wsum;
  vec3 col = (c + b * 1.4) * uExposure;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;
