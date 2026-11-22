// Procedural flight-deck audio. Sources start together after the browser allows playback.
export class DeckAudio {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.supported = Boolean(window.AudioContext || window.webkitAudioContext);
    this.contact = 0;
    this.gearContacts = [];
    this.nextAlert = 0;
  }

  async unlock() {
    if (!this.supported || !this.enabled) return;
    try {
      if (!this.context) this.start();
      if (this.context.state !== 'running') await this.context.resume();
    } catch (error) {
      console.warn('Flight deck audio could not start', error);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) void this.unlock();
    else if (this.context) this.smooth(this.master.gain, 0, 0.04);
  }

  smooth(parameter, value, time = 0.12) {
    parameter.setTargetAtTime(value, this.context.currentTime, time);
  }

  start() {
    const Context = window.AudioContext || window.webkitAudioContext;
    const ctx = this.context = new Context();
    const length = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -17;
    this.master.connect(compressor).connect(ctx.destination);

    this.fan = [this.tone('triangle', 46), this.tone('sine', 51), this.tone('sine', 141)];
    this.jet = this.noiseLoop('bandpass', 290, 0.52);
    this.wind = this.noiseLoop('lowpass', 540, 0.45);
    this.roll = this.noiseLoop('lowpass', 118, 0.72);
    this.tread = this.noiseLoop('bandpass', 410, 0.72);
    this.scrub = this.noiseLoop('bandpass', 1550, 0.92);
    this.system = this.noiseLoop('bandpass', 590, 2.6);
  }

  tone(type, frequency) {
    const source = this.context.createOscillator();
    const gain = this.context.createGain();
    source.type = type;
    source.frequency.value = frequency;
    gain.gain.value = 0;
    source.connect(gain).connect(this.master);
    source.start();
    return { source, gain };
  }

  noiseLoop(type, frequency, q) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(0, Math.random() * 2);
    return { filter, gain };
  }

  pulse(frequency, level, length, noise = false) {
    const ctx = this.context;
    if (!this.enabled || ctx?.state !== 'running') return;
    const source = noise ? ctx.createBufferSource() : ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    if (noise) {
      source.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = frequency;
      source.connect(filter).connect(gain);
    } else {
      source.type = 'triangle';
      source.frequency.setValueAtTime(frequency, now);
      source.frequency.exponentialRampToValueAtTime(frequency * 0.64, now + length);
      source.connect(gain);
    }
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.016);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + length);
  }

  click() { this.pulse(760, 0.075, 0.082, true); }

  gearStrike(impact, nose, grass) {
    const strength = Math.min(1, impact / 3.2);
    this.pulse(nose ? 150 : 103, (nose ? 0.21 : 0.49) * strength, nose ? 0.19 : 0.29, true);
    this.pulse(grass ? 460 : 1080, (nose ? 0.14 : 0.29) * strength, 0.095, true);
  }

  update(flight, paused) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const active = this.enabled && !paused && !document.hidden;
    this.smooth(this.master.gain, active ? 0.75 : 0, 0.10);
    if (!active && !flight.crash) return;

    const throttle = Math.max(flight.power, flight.reversePower * 0.8);
    const rush = Math.min(1.3, flight.ias / 240);
    const speed = flight.groundSpeed;
    const wheels = Math.min(1, speed / 66) ** 0.68;
    const grass = flight.surface === 'grass';
    const water = flight.surface === 'water';
    const transit = Math.abs(flight.gear - Number(flight.gearDown)) > 0.02
      || Math.abs(flight.flapLift - flight.flapTargetLift) > 0.01;
    this.fan.forEach(({ source, gain }, index) => {
      this.smooth(source.frequency, (44 + throttle * 55) * [1, 1.044, 2.86][index]);
      this.smooth(gain.gain, [0.10, 0.072, 0.021][index] * (0.41 + throttle * 0.63));
    });
    this.smooth(this.jet.filter.frequency, 160 + throttle * 450);
    this.smooth(this.jet.gain.gain, 0.07 + throttle * 0.24 + flight.reversePower * 0.12);
    this.smooth(this.wind.filter.frequency, 340 + rush * 1500);
    this.smooth(this.wind.gain.gain, 0.23 * rush ** 1.45);
    const wheelWeight = Math.min(1.45, flight.wheelLoad);
    const loaded = flight.onGround ? wheels * Math.sqrt(wheelWeight) : 0;
    this.smooth(this.roll.filter.frequency, water ? 550 : (grass ? 105 : 80) + Math.min(speed, 80) * 0.85);
    this.smooth(this.roll.gain.gain, water ? wheels * 0.41
      : flight.bellyLanding ? wheels * 0.29 : loaded * (grass ? 0.49 : 0.36), 0.065);
    this.smooth(this.tread.filter.frequency, (grass ? 235 : 355) + Math.min(speed, 80) * 3.2);
    this.smooth(this.tread.gain.gain, loaded * (grass ? 0.15 : 0.27), 0.058);
    this.smooth(this.scrub.gain.gain, Math.min(0.44, flight.tireSlip * wheelWeight * 0.012)
      * (grass ? 0.50 : 1), 0.033);
    this.smooth(this.system.gain.gain, transit && !flight.crash ? 0.11 : 0);

    if (flight.contactCount !== this.contact) {
      if (flight.contactCount > this.contact && (water || flight.bellyLanding || flight.crash)) {
        const impact = Math.min(0.5, 0.08 + flight.contactForce * 0.052);
        this.pulse(water ? 600 : 175, impact, water ? 1.1 : 0.42, true);
        this.pulse(69, impact * 0.43, 0.27);
      }
      this.contact = flight.contactCount;
    }
    if (this.aircraft !== flight) {
      this.gearContacts = [];
      this.aircraft = flight;
    }
    let mainImpact = 0, noseImpact = 0;
    flight.struts.forEach((wheel, index) => {
      if (wheel.contacts > (this.gearContacts[index] ?? 0)) {
        if (wheel.name === 'nose') noseImpact = wheel.impact;
        else mainImpact = Math.max(mainImpact, wheel.impact);
      }
      this.gearContacts[index] = wheel.contacts;
    });
    if (mainImpact > 0) this.gearStrike(mainImpact, false, grass);
    if (noseImpact > 0) this.gearStrike(noseImpact, true, grass);
    if (active && flight.stalled && ctx.currentTime >= this.nextAlert) {
      this.nextAlert = ctx.currentTime + 0.54;
      this.pulse(318, 0.075, 0.16);
    }
  }
}
