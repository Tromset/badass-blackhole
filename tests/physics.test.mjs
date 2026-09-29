// Run with: node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  stepBody, radius, circularSpeed, predictTrajectory, tidalDisruptionRadius,
  gravRadiusMeters, clockRate,
} from '../js/physics.js';
import { CATALOG } from '../js/catalog.js';

const M = 1;

function circular(r) {
  return new Float64Array([r, 0, 0, 0, 0, circularSpeed(r, M)]);
}

function run(s, total, dt = 0.5) {
  let rMin = Infinity, rMax = 0;
  for (let t = 0; t < total; t += dt) {
    stepBody(s, dt, M);
    const r = radius(s);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    if (r < 2 * M) return { captured: true, rMin, rMax };
  }
  return { captured: false, rMin, rMax };
}

test('circular orbit at 8M stays circular for several orbits', () => {
  const res = run(circular(8), 2000);
  assert.equal(res.captured, false);
  assert.ok(res.rMin > 7.9 && res.rMax < 8.1, `drifted to [${res.rMin}, ${res.rMax}]`);
});

test('a nudged orbit inside the ISCO (5M) falls in', () => {
  const s = circular(5);
  s[5] *= 0.99;
  assert.equal(run(s, 3000, 0.1).captured, true);
});

test('a slightly nudged orbit outside the ISCO (10M) survives', () => {
  const s = circular(10);
  s[5] *= 0.98;
  assert.equal(run(s, 3000).captured, false);
});

test('an object dropped from rest plunges', () => {
  const s = new Float64Array([30, 0, 0, 0, 0, 0]);
  assert.equal(run(s, 2000, 0.2).captured, true);
});

test('preview classifies fates', () => {
  assert.equal(predictTrajectory([30, 0, 0], [0, 0, 0], M).fate, 'plunge');
  assert.equal(predictTrajectory([30, 0, 0], [0, 0, circularSpeed(30, M)], M).fate, 'orbit');
  assert.equal(predictTrajectory([30, 0, 0], [0.2, 0, 0.35], M).fate, 'escape');
});

test('Sgr A* shreds the Sun but swallows a cow whole', () => {
  const rg = gravRadiusMeters(4.3e6);
  assert.ok(tidalDisruptionRadius(CATALOG.star, 4.3e6) / rg > 2, 'Sun should be disrupted outside the horizon');
  assert.ok(tidalDisruptionRadius(CATALOG.cow, 4.3e6) / rg < 2, 'cow should cross the horizon intact');
});

test('M87* swallows the Sun whole', () => {
  const rg = gravRadiusMeters(6.5e9);
  assert.ok(tidalDisruptionRadius(CATALOG.star, 6.5e9) / rg < 2);
});

test('clocks stop at the horizon', () => {
  assert.equal(clockRate(2, 0, M), 0);
  assert.ok(Math.abs(clockRate(1e9, 0, M) - 1) < 1e-6);
});
