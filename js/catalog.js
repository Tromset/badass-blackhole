// Everything you can throw. Real physical properties drive the telemetry and
// the tidal disruption radius; `size` is the on-screen radius in simulation units.
export const CATALOG = {
  star: {
    label: 'Star', name: 'Sun-like star',
    radiusM: 6.957e8, massKg: 1.989e30, bound: 'gravity',
    size: 1.25, debris: 3200,
    palette: [[1.0, 0.95, 0.8], [1.0, 0.75, 0.4], [1.0, 0.55, 0.25]],
    blurb: 'A main-sequence star held together only by its own gravity.',
  },
  planet: {
    label: 'Planet', name: 'Ringed gas giant',
    radiusM: 5.823e7, massKg: 5.683e26, bound: 'gravity',
    size: 0.85, debris: 1600,
    palette: [[0.9, 0.8, 0.6], [0.75, 0.6, 0.42], [0.95, 0.88, 0.72]],
    blurb: 'A Saturn-class planet of hydrogen and helium.',
  },
  earth: {
    label: 'Earth', name: 'Earth',
    radiusM: 6.371e6, massKg: 5.972e24, bound: 'gravity',
    size: 0.6, debris: 1300,
    palette: [[0.2, 0.45, 0.9], [0.25, 0.6, 0.3], [0.95, 0.95, 0.95], [0.6, 0.45, 0.3]],
    blurb: 'Home. 8 billion people, briefly.',
  },
  asteroid: {
    label: 'Asteroid', name: 'Rubble-pile asteroid',
    radiusM: 2.5e2, massKg: 7.3e10, bound: 'gravity',
    size: 0.4, debris: 500,
    palette: [[0.5, 0.47, 0.44], [0.35, 0.33, 0.31], [0.62, 0.58, 0.52]],
    blurb: 'A 500 m pile of loosely bound rock.',
  },
  comet: {
    label: 'Comet', name: 'Comet',
    radiusM: 5.5e3, massKg: 2.2e14, bound: 'gravity',
    size: 0.32, debris: 600,
    palette: [[0.7, 0.85, 1.0], [0.9, 0.95, 1.0], [0.5, 0.65, 0.85]],
    blurb: 'A dirty snowball that sheds a tail as it heats up.',
  },
  car: {
    label: 'Car', name: 'Hatchback',
    radiusM: 2.0, massKg: 1.3e3, bound: 'strength', maxTidalAccel: 2e4,
    size: 0.55, debris: 350,
    palette: [[0.85, 0.12, 0.1], [0.2, 0.2, 0.22], [0.7, 0.75, 0.8]],
    blurb: 'A 4 m steel hatchback. Its welds give up near 2,000 g.',
  },
  cow: {
    label: 'Cow', name: 'Cow',
    radiusM: 1.2, massKg: 7.0e2, bound: 'strength', maxTidalAccel: 3e3,
    size: 0.5, debris: 350,
    palette: [[0.95, 0.95, 0.93], [0.12, 0.1, 0.1], [0.95, 0.65, 0.65]],
    blurb: 'A 700 kg Holstein. Bones fail near 300 g.',
  },
  cloud: {
    label: 'Gas cloud', name: 'Gas cloud',
    radiusM: 1.5e11, massKg: 2e25, bound: 'none',
    size: 2.2, debris: 4000,
    palette: [[0.55, 0.7, 1.0], [0.8, 0.6, 1.0], [1.0, 0.8, 0.6]],
    blurb: '4,000 particles of cold gas. Watch the disk form.',
  },
};

export const ORDER = ['star', 'planet', 'earth', 'asteroid', 'comet', 'car', 'cow', 'cloud'];

// Real black holes for the mass presets (solar masses).
export const PRESETS = [
  { id: 'stellar', label: 'Stellar', mass: 10, note: 'Cygnus X-1 class' },
  { id: 'sgra', label: 'Sgr A*', mass: 4.3e6, note: 'Milky Way centre' },
  { id: 'm87', label: 'M87*', mass: 6.5e9, note: 'First imaged black hole' },
];
export const MASS_MIN = 5;
export const MASS_MAX = 1e10;
