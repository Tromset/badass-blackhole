// DOM side: glass toggle, panel tabs, controls, object dock and telemetry.
import { CATALOG, ORDER, PRESETS, MASS_MIN, MASS_MAX } from './catalog.js';

export const TIME_STEPS = [0.1, 0.25, 0.5, 1, 2, 4, 8];

const ICONS = {
  star: '<circle cx="12" cy="12" r="4.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  planet: '<circle cx="12" cy="12" r="5.2"/><ellipse cx="12" cy="12" rx="10" ry="3.2" transform="rotate(-20 12 12)"/>',
  earth: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-3 3.2-3 13.8 0 17M12 3.5c3 3.2 3 13.8 0 17"/>',
  asteroid: '<path d="M6 7.5 10.5 4l5 1.5 3.5 5-1 5.5-4.5 3.5-5.5-1L4.5 14z"/><circle cx="10" cy="10" r="1.2"/><circle cx="14.5" cy="14" r="1.6"/>',
  comet: '<circle cx="16.5" cy="7.5" r="3"/><path d="M14.3 9.7 4 20M13 8 6 12.5M16 10.5 11.5 17.5"/>',
  car: '<path d="M3.5 15.5v-3l2-1 2.5-4h7l3 4 2.5 1v3z"/><circle cx="7.5" cy="16" r="1.9"/><circle cx="16.5" cy="16" r="1.9"/><path d="M9 7.5v4M5.5 11.5h13"/>',
  cow: '<path d="M7 8.5h10v7.5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z"/><path d="M7 9.5 3.5 8M17 9.5 20.5 8M8.5 8.5 7.5 4.5M15.5 8.5l1-4"/><circle cx="10" cy="17" r=".8"/><circle cx="14" cy="17" r=".8"/><circle cx="9.8" cy="11.8" r=".7"/><circle cx="14.2" cy="11.8" r=".7"/>',
  cloud: '<circle cx="7" cy="9" r="1.3"/><circle cx="12" cy="6.5" r="1"/><circle cx="16.5" cy="10" r="1.5"/><circle cx="10" cy="13" r="1.8"/><circle cx="15" cy="16" r="1.1"/><circle cx="6.5" cy="16.5" r=".9"/><circle cx="19" cy="15" r=".7"/><circle cx="12" cy="19" r=".8"/>',
};

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function sci(x, digits = 2) {
  if (!isFinite(x)) return '∞';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 5) return x.toLocaleString('en-US', { maximumSignificantDigits: digits + 1 });
  const m = x / 10 ** e;
  return `${m.toFixed(digits - 1)} × 10${String(e).split('').map((c) => SUP[c]).join('')}`;
}

export function fmtLength(m) {
  const AU = 1.495978707e11, LY = 9.4607e15;
  if (m < 1e3) return `${sci(m)} m`;
  if (m < 0.05 * AU) return `${sci(m / 1e3)} km`;
  if (m < 0.2 * LY) return `${sci(m / AU)} AU`;
  return `${sci(m / LY)} ly`;
}

export function fmtMass(ms) {
  if (ms < 1e4) return `${sci(ms)} M☉`;
  if (ms < 1e9) return `${(ms / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 3 })} million M☉`;
  return `${(ms / 1e9).toLocaleString('en-US', { maximumSignificantDigits: 3 })} billion M☉`;
}

const $ = (id) => document.getElementById(id);

export function massToSlider(ms) {
  const a = Math.log10(MASS_MIN), b = Math.log10(MASS_MAX);
  return Math.round(((Math.log10(ms) - a) / (b - a)) * 1000);
}
export function sliderToMass(v) {
  const a = Math.log10(MASS_MIN), b = Math.log10(MASS_MAX);
  return 10 ** (a + (v / 1000) * (b - a));
}

export function createUI(h) {
  const toggle = $('glass-toggle');
  const panel = $('panel');
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    h.onToggle?.(open);
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));

  // Tabs
  const tabs = [...panel.querySelectorAll('.tab')];
  const selectTab = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t)));

  // Dock
  const dock = $('dock');
  const dockButtons = {};
  ORDER.forEach((type, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dock-item';
    b.id = `pick-${type}`;
    b.setAttribute('aria-pressed', 'false');
    b.title = CATALOG[type].blurb;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[type]}</svg><span>${CATALOG[type].label}</span><kbd>${i + 1}</kbd>`;
    b.addEventListener('click', () => h.onSelect(type));
    dock.appendChild(b);
    dockButtons[type] = b;
  });

  // Mass
  const mass = $('mass');
  mass.addEventListener('input', () => h.onMass(sliderToMass(+mass.value)));
  const presets = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.innerHTML = `${p.label}<small>${p.note}</small>`;
    b.addEventListener('click', () => h.onMass(p.mass));
    presets.appendChild(b);
  }

  // Time
  const time = $('time');
  time.addEventListener('input', () => h.onTime(TIME_STEPS[+time.value]));
  $('pause').addEventListener('click', () => h.onPause());
  $('clear').addEventListener('click', () => h.onClear());
  $('mute').addEventListener('click', () => h.onMute());

  // Keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key >= '1' && e.key <= String(ORDER.length)) h.onSelect(ORDER[+e.key - 1]);
    else if (e.code === 'Space') { e.preventDefault(); h.onPause(); }
    else if (e.key === 'm' || e.key === 'M') h.onMute();
    else if (e.key === 'c' || e.key === 'C') h.onClear();
    else if (e.key === 'i' || e.key === 'I') setOpen(panel.hidden);
    else if (e.key === 'Escape') setOpen(false);
  });

  let toastTimer = 0;
  let hintGone = false;

  return {
    isOpen: () => !panel.hidden,
    select(type) {
      for (const [t, b] of Object.entries(dockButtons)) b.setAttribute('aria-pressed', String(t === type));
    },
    setMass(ms) {
      mass.value = massToSlider(ms);
      $('mass-out').textContent = fmtMass(ms);
    },
    setTime(scale, paused) {
      time.value = TIME_STEPS.indexOf(scale);
      $('time-out').textContent = paused ? 'Paused' : `${scale}×`;
      $('pause').textContent = paused ? 'Resume' : 'Pause';
      $('pause').setAttribute('aria-pressed', String(paused));
    },
    setMuted(m) {
      $('mute').textContent = m ? 'Sound off' : 'Sound on';
      $('mute').setAttribute('aria-pressed', String(m));
    },
    toast(msg, tone = '') {
      const t = $('toast');
      t.textContent = msg;
      t.dataset.tone = tone;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
    },
    hideHint() {
      if (hintGone) return;
      hintGone = true;
      $('hint').classList.add('gone');
    },
    update(d) {
      $('d-mass').textContent = fmtMass(d.massSolar);
      $('d-rs').textContent = fmtLength(d.rsM);
      $('d-photon').textContent = fmtLength(1.5 * d.rsM);
      $('d-isco').textContent = fmtLength(3 * d.rsM);
      $('d-shadow').textContent = fmtLength(2 * 2.598 * d.rsM);
      for (const el of panel.querySelectorAll('[data-live="rs"]')) el.textContent = fmtLength(d.rsM);
      $('d-flight').textContent = d.inFlight;
      $('d-particles').textContent = d.particles.toLocaleString('en-US');
      $('d-swallowed').textContent = d.swallowed;
      $('d-fps').textContent = `${Math.round(d.fps)} fps · ${d.quality}`;

      const t = d.tracked;
      const status = $('d-status');
      if (!t) {
        status.textContent = 'None';
        status.dataset.state = 'none';
        $('d-name').textContent = 'Throw something to track it.';
        for (const id of ['d-dist', 'd-speed', 'd-clock', 'd-z', 'd-tidal', 'd-rt']) $(id).textContent = '–';
        $('d-meter').style.left = '100%';
        return;
      }
      $('d-name').textContent = t.name;
      status.textContent = t.statusLabel;
      status.dataset.state = t.state;
      const gone = t.state === 'gone';
      $('d-dist').textContent = gone ? 'Inside' : fmtLength(t.distM);
      $('d-speed').textContent = gone ? '–' : `${t.v.toFixed(3)} c`;
      $('d-clock').textContent = gone ? '0' : t.clock > 0.999 ? '1.000' : t.clock.toFixed(3);
      $('d-z').textContent = gone ? '∞' : sci(t.z);
      $('d-tidal').textContent = t.tidalG == null ? '–' : `${sci(t.tidalG)} g`;
      $('d-rt').textContent = t.rtLabel;
      // Log position between the horizon (0) and 60 horizon radii (1).
      const x = gone ? 0 : Math.min(1, Math.log(Math.max(t.rOverRs, 1)) / Math.log(60));
      $('d-meter').style.left = `${(x * 100).toFixed(1)}%`;
    },
  };
}
