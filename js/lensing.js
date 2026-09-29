// GLSL shared by every mesh, particle and line drawn on top of the ray-traced
// background, so foreground objects bend, hide and redden like the sky does.
//
// Lensing uses the thin-lens point-mass solution: a source at angle β behind
// the hole appears at θ = (β + sqrt(β² + 4θ_E²)) / 2, with the Einstein angle
// θ_E² = 4M·D_ls / (D_l·D_s). Sources in front of the lens plane are untouched.
export const lensChunk = /* glsl */ `
uniform float uM;

vec3 lensPoint(vec3 P) {
  vec3 C = cameraPosition;
  float Dl = length(C);
  vec3 a = -C / Dl;
  vec3 rel = P - C;
  float Ds = dot(rel, a);
  if (Ds <= Dl) return P;
  vec3 q = rel - Ds * a;
  float ql = length(q);
  float beta = ql / Ds;
  float thE2 = 4.0 * uM * (Ds - Dl) / (Dl * Ds);
  float th = 0.5 * (beta + sqrt(beta * beta + 4.0 * thE2));
  vec3 qd = ql > 1e-5 ? q / ql : normalize(cross(a, vec3(0.0, 1.0, 0.001)));
  return C + a * Ds + qd * th * Ds;
}

// 1 when the (lensed) point is visible, 0 when the shadow of the hole covers it.
float shadowVisibility(vec3 P) {
  vec3 C = cameraPosition;
  float Dl = length(C);
  vec3 a = -C / Dl;
  vec3 rel = P - C;
  float Ds = dot(rel, a);
  if (Ds <= Dl) return 1.0;
  float b = length(rel - Ds * a) * Dl / Ds;
  return smoothstep(5.196 * uM, 5.6 * uM, b);
}

// Light from radius r reaches us stretched by sqrt(1 - 2M/r).
float redshiftFactor(vec3 P) {
  return sqrt(max(1.0 - 2.0 * uM / length(P), 0.0));
}

// How much of the accretion disk sits between the camera and P (0..1).
uniform float uDiskOuter;
float diskCover(vec3 P) {
  vec3 C = cameraPosition;
  if (C.y * P.y >= 0.0) return 0.0;
  vec3 h = mix(C, P, C.y / (C.y - P.y));
  float R = length(h.xz);
  return 0.7 * smoothstep(6.0 * uM, 7.5 * uM, R) * smoothstep(uDiskOuter, uDiskOuter * 0.6, R);
}

vec3 applyRedshift(vec3 c, float g) {
  vec3 shifted = vec3(c.r * 0.9 + c.g * 0.25, c.g * 0.35, c.b * 0.12);
  return mix(shifted, c, smoothstep(0.25, 0.85, g)) * smoothstep(0.02, 0.6, g);
}
`;
