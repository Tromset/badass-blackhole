// Procedural Web Audio: no sound files. Starts on the first user gesture,
// because browsers block audio until then.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Drone: two low sines a fifth apart and rumbling filtered noise.
    const drone = ctx.createGain();
    drone.gain.value = 0;
    drone.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 4);
    drone.connect(this.master);
    for (const [f, g] of [[36.7, 0.55], [55, 0.3], [73.4, 0.12]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(drone);
      o.start();
    }
    const rumble = this.noise(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const rg = ctx.createGain();
    rg.gain.value = 0.5;
    rumble.connect(lp).connect(rg).connect(drone);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    this.droneGain = drone;

    // Tracker tone: its pitch follows the redshift of the tracked object.
    this.tracker = ctx.createOscillator();
    this.tracker.type = 'triangle';
    this.tracker.frequency.value = 330;
    this.trackerGain = ctx.createGain();
    this.trackerGain.gain.value = 0;
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 900;
    this.tracker.connect(tf).connect(this.trackerGain).connect(this.master);
    this.tracker.start();
  }

  noise(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = loop;
    if (loop) src.start();
    return src;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // g: redshift factor of the tracked object (1 far away, 0 at the horizon).
  setTracker(active, g) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tracker.frequency.setTargetAtTime(70 + 300 * g * g, t, 0.08);
    this.trackerGain.gain.setTargetAtTime(active ? 0.035 * Math.max(g, 0.15) : 0, t, 0.15);
  }

  launch() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.75);
  }

  swallow(weight = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 2.2);
    const g = ctx.createGain();
    const peak = Math.min(0.6, 0.25 + 0.2 * weight);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2.5);
    const n = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 1.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2 * peak, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 1.7);
  }

  shred() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(28, t);
    lfo.frequency.linearRampToValueAtTime(6, t + 1.2);
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.4, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(hp).connect(am).connect(env).connect(this.master);
    n.start(t); lfo.start(t);
    n.stop(t + 1.5); lfo.stop(t + 1.5);
  }
}
