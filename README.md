# Badass Black Hole

A real-time, ray-traced Schwarzschild black hole in the browser. You can throw stars, planets, Earth, asteroids, comets, cars, cows and gas clouds into it.

## Run it

ES modules do not load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

There is no build step. Three.js loads from jsDelivr through an import map.

## Controls

| Input | Action |
|---|---|
| Drag (mouse or one finger) | Throw the selected object. Drag direction and length set the velocity. |
| Right-drag, Shift-drag or two fingers | Orbit the camera |
| Scroll or pinch | Zoom |
| `1`–`8` | Pick an object |
| `Space` / `M` / `C` / `I` | Pause / mute / clear / toggle the data panel |

While you aim, a dotted line predicts the path. Its colour gives the fate: orange for a plunge, blue for an orbit, green for an escape.

The glass button in the top-left opens live telemetry, short explainers, and the mass and time controls.

## What is simulated

- **Light bending.** Every pixel's photon is integrated backwards along a Schwarzschild null geodesic (`x'' = -3M h² x / r⁵`) in a fragment shader (`js/blackholeShader.js`). The shadow, photon ring, lensed star field and the disk wrapping over the hole all come from that integration.
- **Accretion disk.** A thin disk from the ISCO (6M) outward has a Shakura–Sunyaev temperature profile, Keplerian differential rotation, relativistic Doppler beaming and gravitational redshift.
- **Motion.** Newtonian gravity plus the `3M L² / r⁴` term gives the exact Schwarzschild orbit equation, including orbital precession, the ISCO and capture below the photon sphere (`js/physics.js`).
- **Tides.** Objects stretch along the radial direction. Gravity-bound bodies disrupt at `r_t = R (M/m)^(1/3)`, and solid ones disrupt when the tidal acceleration exceeds their strength. Real masses and sizes are used, so Sgr A* shreds a star but swallows a cow whole, and M87* swallows stars whole.
- **Foreground objects** are lensed with the point-mass thin-lens solution. They are hidden by the shadow, and they redden and fade near the horizon (`js/lensing.js`).
- **Sound** is synthesised with Web Audio. It starts on your first click.

Quality adapts automatically: the ray-marching resolution and step count drop when frames run long.

## Tests

```sh
node --test tests/
```

The tests check stable and unstable orbits around the ISCO, plunges, escape classification, and the tidal-disruption verdicts for real black holes.
