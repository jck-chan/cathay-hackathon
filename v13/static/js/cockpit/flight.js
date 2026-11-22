// A rigid-body attitude approximation coupled to a three-axis point-mass airframe.
// World axes are east, up, south. SI units throughout, with angles in radians.
import { Vector3 } from '../../vendor/three/three.module.min.js';

export const RAD = Math.PI / 180;
export const KNOTS = 1.943844;
export const FEET = 3.28084;
export const STEP = 1 / 120;
export const FIELD = {
  runwayWidth: 60,
  runwayLength: 3600,
  taxiX: 132,
  apronX: 410,
  apronZ: -890,
  islandBounds: [-715, 1005, -3815, 215],
  connectors: [-160, -880, -1720, -2640, -3440],
};
export const WATER_LEVEL = -4.4;
export const RIDGES = [
  [-2640, -1470, 2900, 4700, 520],
  [-2180, -5060, 3200, 1750, 690],
  [620, -7120, 4300, 2200, 660],
  [3570, -6140, 2700, 3100, 910],
  [4340, -2640, 2900, 2400, 610],
  [3510, 620, 2700, 2200, 420],
  [-1880, 2320, 2800, 2600, 640],
];
export const FLAPS = [
  { label: 'UP', lift: 0, drag: 0, limit: 340 },
  { label: '1', lift: 0.24, drag: 0.017, limit: 250 },
  { label: '2', lift: 0.47, drag: 0.039, limit: 218 },
  { label: '3', lift: 0.68, drag: 0.069, limit: 192 },
  { label: 'FULL', lift: 0.88, drag: 0.108, limit: 177 },
];

const G = 9.80665;
const MASS = 184000;
const WING = 360;
export const SPAN = 64;
const THRUST = 604000;
export const WHEEL_HEIGHT = 4.3;
const BELLY_HEIGHT = 2.25;
const FLOAT_HEIGHT = 1.42;
const TAU = 2 * Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toward = (value, target, change) => value + clamp(target - value, -change, change);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const STRUTS = [
  { name: 'left main', x: -4.8, along: -3.4, stiffness: 19.5, damping: 4.6 },
  { name: 'right main', x: 4.8, along: -3.4, stiffness: 19.5, damping: 4.6 },
  { name: 'nose', x: 0, along: 15, stiffness: 9, damping: 2.5 },
];

// Smooth spatial variation from a fixed surface, sampled separately under each gear.
function groundProfile(x, z, kind) {
  const scale = kind === 'grass' ? 0.035 : 0.006;
  return scale * (0.60 * Math.sin(z * 1.74 + Math.sin(x * 0.93 + z * 0.29) * 1.8)
    + 0.27 * Math.sin(x * 1.26 - z * 0.48) + 0.13 * Math.sin(x * 2.1 + z * 3.04));
}

function newStrut({ along, stiffness, ...strut }) {
  const staticLoad = (along > 0 ? 3.4 : 15 / 2) / 18.4;
  return { ...strut, along, stiffness, reach: WHEEL_HEIGHT + G * staticLoad / stiffness,
    load: G * staticLoad, compression: 0, speed: 0, slip: 0, contacts: 0, impact: 0,
    offTime: 0, road: null };
}

export function ridgeHeight(x, z, index) {
  const [centerX, centerZ, width, depth, height] = RIDGES[index];
  const u = (x - centerX) / width * 2;
  const v = (z - centerZ) / depth * 2;
  const theta = Math.atan2(v, u);
  const boundary = 0.88 + 0.077 * Math.cos(3 * theta + index) + 0.045 * Math.sin(5 * theta - index);
  const envelope = 1 - (u * u + v * v) / boundary ** 2;
  if (envelope <= 0) return -5;
  const relief = 0.34 + 0.31 * Math.sin(9 * u + 5 * v + index) ** 2
    + 0.22 * Math.sin(6 * u - 12 * v + index * 2) ** 2
    + 0.063 * Math.sin(21 * u - 16 * v + Math.sin(v * 8) * 1.9) ** 2
    + 0.024 * Math.sin(61 * u + 46 * v) ** 2;
  return height * envelope ** 1.35 * relief - 5;
}

function surfaceAt(x, z) {
  const [west, east, north, south] = FIELD.islandBounds;
  if (x >= west && x <= east && z >= north && z <= south) {
    return pavement(x, z) ? PAVED : GRASS;
  }
  let highest = WATER_LEVEL;
  for (let i = 0; i < RIDGES.length; i++) {
    highest = Math.max(highest, ridgeHeight(x, z, i));
  }
  return highest > WATER_LEVEL + 0.05 ? { kind: 'terrain', elevation: highest } : WATER;
}

const PAVED = { kind: 'pavement', elevation: 0 };
const GRASS = { kind: 'grass', elevation: 0 };
const WATER = { kind: 'water', elevation: WATER_LEVEL };

function pavement(x, z) {
  const { runwayWidth, runwayLength, taxiX, apronX, apronZ } = FIELD;
  const onRunway = Math.abs(x) < runwayWidth / 2 + 4 && z <= 0 && z >= -runwayLength;
  const onTaxiway = Math.abs(x - taxiX) < 12 && z < -60 && z > -3540;
  const onConnector = FIELD.connectors.some(center =>
    Math.abs(z - center) < 12 && x >= 0 && x <= taxiX + 12);
  const onApron = Math.abs(apronZ - z) < 375 && x >= taxiX && x <= apronX + 280;
  return onRunway || onTaxiway || onConnector || onApron;
}

function liftCoefficient(alpha, baseline, spoiler) {
  const critical = 15 * RAD;
  const attached = baseline + 5.2 * clamp(alpha, -critical, critical);
  const separated = 1 / (1 + 4.4 * Math.max(0, Math.abs(alpha) - critical));
  return attached * separated * (1 - 0.44 * spoiler);
}

export class Flight {
  constructor() {
    this.position = new Vector3(0, WHEEL_HEIGHT, -106);
    this.velocity = new Vector3();
    this.forward = new Vector3();
    this.right = new Vector3();
    this.up = new Vector3();
    this.dragAxis = new Vector3();
    this.liftAxis = new Vector3();
    this.acceleration = new Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.bank = 0;
    this.rollRate = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.alpha = 0;
    this.onGround = true;
    this.surface = 'pavement';
    this.waterborne = false;
    this.bellyLanding = false;
    this.contactCount = 0;
    this.contactForce = 0;
    this.struts = STRUTS.map(newStrut);
    this.wheelLoad = 1;
    this.tireSlip = 0;
    this.offWheelsTime = 0;
    this.incursion = '';
    this.throttle = 0;
    this.power = 0;
    this.reverse = false;
    this.reversePower = 0;
    this.flap = 1;
    this.flapLift = FLAPS[1].lift;
    this.flapDrag = FLAPS[1].drag;
    this.spoilers = false;
    this.spoiler = 0;
    this.gearDown = true;
    this.gear = 1;
    this.landingLights = true;
    this.panelLights = true;
    this.stalled = false;
    this.overspeed = false;
    this.braking = false;
    this.crash = '';
    this.updateAxes();
  }

  get speed() { return this.velocity.length(); }
  get groundSpeed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  get airDensity() { return 1.225 * Math.exp(-Math.max(0, this.position.y) / 9300); }
  get ias() { return this.speed * Math.sqrt(this.airDensity / 1.225) * KNOTS; }
  get altitude() { return Math.max(0, (this.position.y - WHEEL_HEIGHT) * FEET); }
  get course() { return Math.round(((this.heading + TAU) % TAU) / RAD) % 360; }
  get flapTargetLift() { return FLAPS[this.flap].lift; }

  toggleReverse() {
    if (this.reverse) {
      this.reverse = false;
      return '';
    }
    if (!this.onGround || this.bellyLanding || this.throttle > 0.01) return 'Reverse requires touchdown on wheels and idle thrust';
    this.reverse = true;
    return '';
  }

  toggleGear() {
    if (this.onGround || this.waterborne) return 'Gear is locked while on the ground or water';
    if (!this.gearDown && this.ias > 270) return 'Slow below 270 kt to extend gear';
    this.gearDown = !this.gearDown;
    return '';
  }

  updateAxes() {
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    const sinP = Math.sin(this.pitch), cosP = Math.cos(this.pitch);
    const sinB = Math.sin(this.bank), cosB = Math.cos(this.bank);
    this.forward.set(sinH * cosP, sinP, -cosH * cosP);
    this.right.set(cosH, 0, sinH);
    this.up.crossVectors(this.right, this.forward);
    this.right.multiplyScalar(cosB).addScaledVector(this.up, -sinB);
    this.up.crossVectors(this.right, this.forward);
  }

  step(dt, input) {
    if (this.crash) return;
    if (this.waterborne) {
      this.drift(dt);
      return;
    }
    const speed = this.speed;
    const temperature = Math.max(216.65, 288.15 - 0.0065 * this.position.y);
    const mach = speed / Math.sqrt(1.4 * 287.05 * temperature);
    const q = 0.5 * this.airDensity * speed ** 2;
    const surface = surfaceAt(this.position.x, this.position.z);
    const wingHeight = Math.max(0.2, this.position.y + 0.15 - surface.elevation);
    const groundEffect = 1 / (1 + (wingHeight / (0.15 * SPAN)) ** 2);
    const baseline = 0.23 + this.flapLift;
    const flightPath = Math.atan2(this.velocity.y, this.groundSpeed);
    const authority = clamp((this.ias - 30) / 90, 0.12, 1);
    const trimAlpha = clamp((MASS * G / Math.max(1, q * WING) - baseline) / 5.2, -0.06, 0.14);

    if (this.onGround) {
      const rotation = clamp((this.ias - 94) / 25, 0, 1);
      const targetRate = clamp((input.pitch * rotation * 0.20 - this.pitch) * 1.65, -0.19, 0.22);
      this.pitchRate = toward(this.pitchRate, targetRate, dt * 0.70);
      this.rollRate = toward(this.rollRate, -this.bank * 2.1, dt * 0.85);
      this.pitch = clamp(this.pitch + this.pitchRate * dt, -0.08, 0.21);
      this.bank = clamp(this.bank + this.rollRate * dt, -0.20, 0.20);
      const traction = this.surface === 'grass' ? 0.57 : this.bellyLanding ? 0.13 : 1;
      const steering = 0.30 / (1 + speed / 11) * traction;
      this.yawRate = input.yaw * steering * clamp(speed / 3, 0, 1);
    } else {
      const targetPitch = clamp(flightPath + trimAlpha + input.pitch * 0.19, -0.58, 0.54);
      const targetPitchRate = clamp((targetPitch - this.pitch) * 2.1, -0.34, 0.34);
      this.pitchRate = toward(this.pitchRate, targetPitchRate * authority, dt * 0.9);
      this.rollRate = toward(this.rollRate, input.roll * 0.52 * authority, dt * 1.25);
      this.pitch = clamp(this.pitch + this.pitchRate * dt, -0.61, 0.57);
      this.bank = clamp(this.bank + this.rollRate * dt, -1.41, 1.41);
      const track = Math.atan2(this.velocity.x, -this.velocity.z);
      const coordinated = G * Math.tan(clamp(this.bank, -0.95, 0.95)) / Math.max(40, speed);
      this.yawRate = coordinated + wrap(track - this.heading) * 0.95 + input.yaw * 0.15 * authority;
    }
    this.heading = wrap(this.heading + this.yawRate * dt);
    this.updateAxes();

    this.throttle = clamp(this.throttle + input.throttle * dt * 0.31, 0, 1);
    if (this.bellyLanding) this.throttle = 0;
    if (input.throttle > 0) this.reverse = false;
    if (!this.onGround) this.reverse = false;
    const commandedPower = this.reverse ? 0 : this.throttle;
    this.power += (commandedPower - this.power) * (1 - Math.exp(-dt / 1.35));
    this.reversePower = toward(this.reversePower, Number(this.reverse), dt * 0.73);
    this.flapLift = toward(this.flapLift, this.flapTargetLift, dt * 0.30);
    this.flapDrag = toward(this.flapDrag, FLAPS[this.flap].drag, dt * 0.036);
    this.spoiler = toward(this.spoiler, Number(this.spoilers), dt * 1.2);
    this.gear = toward(this.gear, Number(this.gearDown), dt / 4.2);
    this.braking = this.onGround && input.brake;

    const forwardSpeed = this.velocity.dot(this.forward);
    this.alpha = speed > 4 ? Math.atan2(-this.velocity.dot(this.up), forwardSpeed) : 0;
    const cl = liftCoefficient(this.alpha, baseline, this.spoiler) * (1 + 0.048 * groundEffect);
    const waveDrag = 0.09 * clamp((mach - 0.76) / 0.17, 0, 1) ** 2;
    const cd = 0.024 + 0.046 * cl ** 2 * (1 - 0.65 * groundEffect) + this.flapDrag + 0.024 * this.gear
      + 0.095 * this.spoiler + waveDrag + 0.7 * Math.max(0, Math.abs(this.alpha) - 15 * RAD);
    const thrust = THRUST * this.power * (this.airDensity / 1.225) ** 0.74
      * (1 - Math.min(0.31, speed / 790));
    const lift = q * WING * cl;
    this.stalled = !this.onGround && Math.abs(this.alpha) >= 15 * RAD;
    this.overspeed = mach > 0.86 || this.ias > Math.min(FLAPS[this.flap].limit, this.gear > 0.05 ? 280 : 340);
    this.dragAxis.copy(this.velocity).normalize();
    this.liftAxis.crossVectors(this.right, this.dragAxis).normalize();
    this.acceleration.set(0, -G, 0)
      .addScaledVector(this.forward, thrust / MASS)
      .addScaledVector(this.dragAxis, -q * WING * cd / MASS)
      .addScaledVector(this.liftAxis, lift / MASS)
      .addScaledVector(this.right, -q * WING * 0.73 * this.dragAxis.dot(this.right) / MASS);

    const solid = surface === PAVED || surface === GRASS;
    const normal = this.loadStruts(dt, solid && this.gear >= 0.97 && !this.bellyLanding ? surface : null);
    if (this.crash) return;
    if (solid && this.bellyLanding) {
      this.rollOnGround(dt, surface, Math.max(0, -this.acceleration.y), input.brake);
      this.velocity.y = 0;
    } else {
      if (normal > 0) this.rollOnGround(dt, surface, normal, input.brake);
      else {
        this.velocity.x += this.acceleration.x * dt;
        this.velocity.z += this.acceleration.z * dt;
      }
      this.velocity.y += (this.acceleration.y + normal) * dt;
    }
    const rollingContact = this.onGround && this.offWheelsTime < 0.30 && this.velocity.y < 0.6;
    this.onGround = solid && (normal > 0 || this.bellyLanding || rollingContact);
    this.braking = this.onGround && input.brake && !this.bellyLanding;
    if (this.onGround) {
      if (surface === GRASS && this.surface !== 'grass') this.incursion = 'Wheels on grass';
      this.surface = surface.kind;
      this.stalled = false;
    } else this.surface = 'air';
    this.position.addScaledVector(this.velocity, dt);
    const nextSurface = surfaceAt(this.position.x, this.position.z);
    if (nextSurface === WATER) {
      this.onGround = false;
      this.contactSurface(nextSurface);
    } else if (nextSurface.kind === 'terrain' || (this.gear < 0.97 && !this.bellyLanding)) {
      this.contactSurface(nextSurface);
    }
  }

  loadStruts(dt, surface) {
    let normal = 0, spinSlip = 0, pitchMoment = 0, rollMoment = 0;
    for (const wheel of this.struts) {
      let compression = 0, closing = 0;
      if (surface && this.position.y < 9) {
        const x = this.position.x + this.forward.x * wheel.along + this.right.x * wheel.x;
        const z = this.position.z + this.forward.z * wheel.along + this.right.z * wheel.x;
        const road = groundProfile(x, z, surface.kind);
        const height = this.position.y + this.forward.y * wheel.along + this.right.y * wheel.x
          - this.up.y * wheel.reach;
        compression = Math.max(0, road - height);
        const roughness = surface === GRASS ? 0.72 : 0.38;
        const roadSpeed = wheel.road === null ? 0 : clamp((road - wheel.road) / dt, -roughness, roughness);
        closing = roadSpeed - this.velocity.y - wheel.along * this.pitchRate + wheel.x * this.rollRate;
        wheel.road = road;
      } else wheel.road = null;
      if (compression > 0 && wheel.compression === 0 && closing > 0.05
          && (wheel.offTime > 0.15 || !this.onGround)) {
        wheel.impact = Math.max(0, closing);
        wheel.contacts += 1;
      }
      wheel.offTime = compression > 0 ? 0 : wheel.offTime + dt;
      wheel.compression = compression;
      wheel.load = compression > 0 ? Math.max(0, wheel.stiffness * compression + wheel.damping * closing) : 0;
      if (compression > (wheel.name === 'nose' ? 0.86 : 0.93)) this.crash = 'Severe ground impact';
      if (wheel.load > 0) {
        wheel.speed = toward(wheel.speed, this.groundSpeed, wheel.load * 95 * dt);
        wheel.slip = Math.max(0, this.groundSpeed - wheel.speed);
        spinSlip += wheel.load * wheel.slip;
        pitchMoment += wheel.along * wheel.load;
        rollMoment -= wheel.x * wheel.load;
      } else {
        wheel.speed = toward(wheel.speed, 0, dt * 14);
        wheel.slip = 0;
      }
      normal += wheel.load;
    }
    this.pitchRate += pitchMoment * dt / 235;
    this.rollRate += rollMoment * dt / 94;
    if (!this.onGround && normal > 0) {
      const sinkLimit = surface === GRASS ? 4.7 : 5.6;
      if (-this.velocity.y > sinkLimit || Math.abs(this.bank) > 14 * RAD
          || this.pitch < -6 * RAD || this.pitch > 13 * RAD) this.crash = 'Severe ground impact';
      if (this.contactCount === 0 || this.offWheelsTime > 0.24) this.recordContact(Math.max(0, -this.velocity.y));
    }
    this.offWheelsTime = normal > 0 ? 0 : this.offWheelsTime + dt;
    this.wheelLoad = normal / G;
    this.tireSlip = normal > 0 ? spinSlip / normal : 0;
    return normal;
  }

  rollOnGround(dt, surface, normal, brakePedals) {
    const paved = surface === PAVED;
    const speed = this.groundSpeed;
    const rolling = this.bellyLanding ? 0.42 : paved ? 0.017 : 0.064 + Math.min(0.105, speed * 0.0015);
    const brake = brakePedals && !this.bellyLanding ? (paved ? 0.47 : 0.21) : 0;
    const spinDrag = Math.min(0.015, this.tireSlip * 0.00032);
    const reverse = 0.33 * THRUST * this.reversePower * clamp(speed / 15, 0, 1) / MASS;
    const x = Math.sin(this.heading), z = -Math.cos(this.heading);
    const along = (this.velocity.x + this.acceleration.x * dt) * x
      + (this.velocity.z + this.acceleration.z * dt) * z;
    const lateral = -(this.velocity.x + this.acceleration.x * dt) * z
      + (this.velocity.z + this.acceleration.z * dt) * x;
    const longitudinal = Math.max(0, along - (normal * (rolling + brake + spinDrag) + reverse) * dt);
    const side = longitudinal === 0 && Math.abs(lateral) < 0.015 ? 0
      : toward(lateral, 0, Math.min(Math.abs(lateral) * 5.4, normal * (paved ? 0.71 : 0.38)) * dt);
    this.velocity.x = longitudinal * x - side * z;
    this.velocity.z = longitudinal * z + side * x;
  }

  contactSurface(surface) {
    const sink = -this.velocity.y;
    if (surface.kind === 'terrain') {
      if (this.position.y <= surface.elevation + BELLY_HEIGHT) this.crash = 'Terrain impact';
      return;
    }
    if (surface.kind === 'water') {
      if (this.position.y > WATER_LEVEL + FLOAT_HEIGHT || sink <= 0) return;
      const gearPenalty = this.gear > 0.8 ? 0.7 : 0;
      const sinkLimit = 8.5 + 4.8 * (1 - clamp(this.groundSpeed / 35, 0, 1));
      this.surface = 'water';
      this.recordContact(sink + gearPenalty);
      if (sink + gearPenalty > sinkLimit || Math.abs(this.bank) > 24 * RAD || this.pitch < -13 * RAD) {
        this.crash = 'Severe water impact';
        return;
      }
      this.waterborne = true;
      this.incursion = 'Water contact. The aircraft is decelerating.';
      this.velocity.y = -Math.min(sink, 3);
      this.reverse = false;
      this.stalled = false;
      this.overspeed = false;
      return;
    }
    if (this.position.y > BELLY_HEIGHT || sink <= 0) return;
    this.recordContact(sink);
    if (sink > 3.8 || Math.abs(this.bank) > 8 * RAD || this.pitch < -6 * RAD
        || this.pitch > 13 * RAD) {
      this.crash = 'Severe ground impact';
    } else {
      const speedAlong = Math.max(0, this.velocity.dot(this.forward));
      this.velocity.set(speedAlong * Math.sin(this.heading), 0, -speedAlong * Math.cos(this.heading));
      this.onGround = true;
      this.surface = surface.kind;
      this.bellyLanding = true;
      this.stalled = false;
      this.incursion = 'Belly landing. The aircraft is sliding to a stop.';
    }
    this.position.y = BELLY_HEIGHT;
  }

  recordContact(force) {
    this.contactCount += 1;
    this.contactForce = force;
  }

  drift(dt) {
    const speed = this.groundSpeed;
    const drag = 1.35 + 0.035 * speed + (0.0015 + this.gear * 0.0012) * speed ** 2;
    const next = Math.max(0, speed - drag * dt);
    if (speed > 0) {
      this.velocity.x *= next / speed;
      this.velocity.z *= next / speed;
    }
    const equilibrium = WATER_LEVEL + FLOAT_HEIGHT - Math.min(0.32, speed * 0.006);
    this.velocity.y = toward(this.velocity.y, clamp((equilibrium - this.position.y) * 2.6, -1.45, 1.25), dt * 5.5);
    this.position.addScaledVector(this.velocity, dt);
    this.pitch = toward(this.pitch, (2 + Math.min(speed * 0.075, 4)) * RAD, dt * 0.12);
    this.bank = toward(this.bank, 0, dt * 0.20);
    this.power = toward(this.power, 0, dt * 0.4);
    this.throttle = 0;
    this.reversePower = toward(this.reversePower, 0, dt);
    this.updateAxes();
    // Avoid sailing through the seawall or climbing the beach after ditching.
    if (surfaceAt(this.position.x, this.position.z).kind !== 'water') {
      this.position.addScaledVector(this.velocity, -dt);
      this.velocity.set(0, 0, 0);
    }
  }
}
