// Schwarzschild dynamics in geometric units (G = c = 1).
// Lengths and times are expressed in simulation units where the black hole
// has mass M; the horizon sits at r = 2M, the photon sphere at 3M, the ISCO at 6M.
// Pure module: no rendering dependencies, so it runs in Node for tests.

export const G = 6.674e-11;
export const C = 299792458;
export const SOLAR_MASS = 1.98847e30;

export const horizonRadius = (M) => 2 * M;
export const photonSphereRadius = (M) => 3 * M;
export const iscoRadius = (M) => 6 * M;
export const shadowRadius = (M) => 3 * Math.sqrt(3) * M;

// Metres represented by one gravitational radius GM/c^2 for a real mass.
export const gravRadiusMeters = (massSolar) => (G * massSolar * SOLAR_MASS) / (C * C);
// Seconds represented by one GM/c^3.
export const gravTimeSeconds = (massSolar) => gravRadiusMeters(massSolar) / C;

// Speed of a circular orbit at radius r. The extra 3M·L²/r⁴ term makes this
// diverge at the photon sphere, exactly like the Schwarzschild effective potential.
export function circularSpeed(r, M) {
  if (r <= 3 * M) return Infinity;
  return Math.sqrt(M / (r - 3 * M));
}

export function escapeSpeed(r, M) {
  return Math.sqrt((2 * M) / r);
}

// Acceleration: Newtonian pull plus the general-relativistic 3M·L²/r⁴ term,
// which reproduces orbital precession, the ISCO and capture below the photon sphere.
export function acceleration(s, M, out) {
  const px = s[0], py = s[1], pz = s[2];
  const vx = s[3], vy = s[4], vz = s[5];
  const r2 = px * px + py * py + pz * pz;
  const r = Math.sqrt(r2);
  const lx = py * vz - pz * vy;
  const ly = pz * vx - px * vz;
  const lz = px * vy - py * vx;
  const L2 = lx * lx + ly * ly + lz * lz;
  const k = (-M / (r2 * r)) * (1 + (3 * L2) / r2);
  out[0] = k * px;
  out[1] = k * py;
  out[2] = k * pz;
  return out;
}

const acc = new Float64Array(3);

// Velocity-Verlet with sub-steps sized to the local orbital period, so bodies
// stay accurate both far away and while skimming the horizon.
// state: [px, py, pz, vx, vy, vz]. Returns the number of sub-steps taken.
export function stepBody(s, dt, M, maxSub = 400) {
  let remaining = dt;
  let n = 0;
  while (remaining > 1e-12 && n < maxSub) {
    const r = Math.hypot(s[0], s[1], s[2]);
    if (r < 2 * M) break;
    const h = Math.min(remaining, (0.004 * r * Math.sqrt(r / M)));
    acceleration(s, M, acc);
    s[3] += 0.5 * h * acc[0];
    s[4] += 0.5 * h * acc[1];
    s[5] += 0.5 * h * acc[2];
    s[0] += h * s[3];
    s[1] += h * s[4];
    s[2] += h * s[5];
    acceleration(s, M, acc);
    s[3] += 0.5 * h * acc[0];
    s[4] += 0.5 * h * acc[1];
    s[5] += 0.5 * h * acc[2];
    remaining -= h;
    n++;
  }
  return n;
}

export const radius = (s) => Math.hypot(s[0], s[1], s[2]);
export const speed = (s) => Math.hypot(s[3], s[4], s[5]);

// Rate of the body's clock relative to a distant observer: gravitational
// part sqrt(1 - 2M/r) times the special-relativistic Lorentz factor.
export function clockRate(r, v, M) {
  if (r <= 2 * M) return 0;
  const grav = Math.sqrt(1 - (2 * M) / r);
  const beta = Math.min(v, 0.999);
  return grav * Math.sqrt(1 - beta * beta);
}

// Redshift factor of light leaving radius r (1 far away, 0 at the horizon).
export function gravitationalRedshift(r, M) {
  return r <= 2 * M ? 0 : Math.sqrt(1 - (2 * M) / r);
}

// Tidal stretching acceleration across a body of length L (SI units).
export function tidalAcceleration(rMeters, massKg, lengthMeters) {
  return (2 * G * massKg * lengthMeters) / (rMeters ** 3);
}

// Radius (m) where tides tear an object apart. Gravity-bound bodies (stars,
// planets) follow r_t = R (M / m)^(1/3); solid objects fail when the tidal
// acceleration exceeds what their structure can take.
export function tidalDisruptionRadius(obj, massSolar) {
  const Mkg = massSolar * SOLAR_MASS;
  if (obj.bound === 'gravity') {
    return obj.radiusM * Math.cbrt(Mkg / obj.massKg);
  }
  return Math.cbrt((2 * G * Mkg * obj.radiusM * 2) / obj.maxTidalAccel);
}

// Integrate a trial trajectory for the aiming preview.
// Returns sampled points and the fate: 'plunge', 'orbit' or 'escape'.
export function predictTrajectory(p, v, M, { maxPoints = 600, maxTime = 4000, escapeRadius = 260 } = {}) {
  const s = new Float64Array([p[0], p[1], p[2], v[0], v[1], v[2]]);
  const pts = [s[0], s[1], s[2]];
  let t = 0;
  let fate = 'orbit';
  for (let i = 0; i < maxPoints && t < maxTime; i++) {
    const r = radius(s);
    const dt = Math.max(0.15, 0.03 * r * Math.sqrt(r / M));
    stepBody(s, dt, M);
    t += dt;
    const rn = radius(s);
    if (rn <= 2 * M * 1.001) {
      // Finish the line on the horizon.
      const k = (2 * M) / rn;
      pts.push(s[0] * k, s[1] * k, s[2] * k);
      fate = 'plunge';
      break;
    }
    pts.push(s[0], s[1], s[2]);
    const radial = (s[0] * s[3] + s[1] * s[4] + s[2] * s[5]) / rn;
    if (rn > escapeRadius && radial > 0 && speed(s) >= escapeSpeed(rn, M)) {
      fate = 'escape';
      break;
    }
  }
  return { points: new Float32Array(pts), fate };
}
