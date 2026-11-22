import assert from 'node:assert/strict';
import test from 'node:test';
import { Flight, FIELD, FLAPS, RAD, STEP, WATER_LEVEL } from '../static/js/cockpit/flight.js';

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };

function advance(flight, seconds, input = {}) {
  const controls = { ...neutral, ...input };
  for (let i = 0; i < Math.round(seconds / STEP); i++) flight.step(STEP, controls);
}

function approach() {
  const flight = new Flight();
  flight.onGround = false;
  flight.position.set(0, 16, 40);
  flight.pitch = 4.4 * RAD;
  flight.velocity.set(0, -2.8, -72);
  flight.flap = 4;
  flight.flapLift = FLAPS[4].lift;
  flight.flapDrag = FLAPS[4].drag;
  return flight;
}

test('aircraft rotates at the indicated takeoff speed, climbs, retracts gear, and banks into a turn', () => {
  const flight = new Flight();
  assert.match(flight.toggleGear(), /locked/);
  advance(flight, 1, { throttle: 1 });
  assert.ok(flight.power < flight.throttle);
  while (flight.ias < 145 && flight.position.z > -2000 && !flight.crash) {
    advance(flight, STEP, { throttle: 1 });
  }
  assert.ok(flight.ias >= 145);
  assert.ok(flight.onGround);
  advance(flight, 1.4, { pitch: 1 });
  assert.equal(flight.onGround, false);
  advance(flight, 8);
  assert.ok(flight.altitude > 50);
  assert.equal(flight.toggleGear(), '');
  assert.match(flight.toggleReverse(), /requires touchdown/);
  advance(flight, 4.5);
  assert.equal(flight.gear, 0);
  advance(flight, 1, { roll: 1 });
  advance(flight, 5);
  assert.ok(flight.bank > 15 * RAD);
  assert.ok(flight.velocity.x > 6);
  assert.ok(flight.course > 5 && flight.course < 90);
  assert.equal(flight.crash, '');
});

test('a shallow approach can touch down and stop with spoilers, reverse, and wheel brakes', () => {
  const flight = approach();
  for (let i = 0; i < 7 / STEP && !flight.onGround && !flight.crash; i++) {
    advance(flight, STEP, { pitch: flight.altitude < 13 ? 0.14 : 0 });
  }
  assert.ok(flight.onGround, flight.crash || 'missed touchdown');
  assert.ok(flight.ias > 120 && flight.ias < 145);
  assert.ok(flight.velocity.y < -0.1, 'touchdown should retain downward motion while the struts compress');
  assert.ok(flight.struts.slice(0, 2).some(wheel => wheel.load > 0));
  assert.equal(flight.struts[2].load, 0);
  const spinUpSlip = flight.tireSlip;
  assert.ok(spinUpSlip > 15);
  const touchdown = flight.position.z;
  flight.spoilers = true;
  assert.equal(flight.toggleReverse(), '');
  advance(flight, 2, { brake: true });
  assert.equal(flight.reversePower, 1);
  advance(flight, 20, { brake: true });
  assert.equal(flight.groundSpeed, 0);
  assert.equal(flight.tireSlip, 0);
  assert.ok(flight.struts[2].contacts > 0, 'the nose gear should make its own contact after the mains');
  assert.ok(touchdown - flight.position.z < 700);
  assert.equal(flight.crash, '');
});

test('ground effect reduces drag and increases lift without forcing contact', () => {
  const atHeight = height => {
    const flight = approach();
    Object.defineProperty(flight, 'airDensity', { value: 1.225 });
    flight.position.set(0, height, -500);
    flight.velocity.set(0, 0, -76);
    flight.pitch = 0.12;
    advance(flight, STEP);
    assert.equal(flight.onGround, false);
    assert.equal(flight.wheelLoad, 0);
    return flight.acceleration;
  };
  const near = atHeight(7), away = atHeight(320);
  assert.ok(near.y > away.y);
  assert.ok(near.z < away.z);
});

test('the parked aircraft settles without a recurring suspension oscillation', () => {
  const flight = new Flight();
  advance(flight, 4);
  assert.ok(flight.onGround);
  assert.ok(Math.abs(flight.velocity.y) < 0.001);
  assert.ok(Math.abs(flight.wheelLoad - 1) < 0.01);
  assert.equal(flight.groundSpeed, 0);
});

test('a gentle gear-up touchdown slides to a stop while a hard touchdown ends flight', () => {
  const belly = approach();
  belly.gear = 0;
  belly.gearDown = false;
  advance(belly, 8);
  assert.ok(belly.bellyLanding);
  assert.ok(belly.groundSpeed > 0);
  advance(belly, 22, { throttle: 1 });
  assert.equal(belly.groundSpeed, 0);
  assert.equal(belly.crash, '');

  const hard = approach();
  hard.position.y = 4.6;
  hard.velocity.y = -9;
  advance(hard, 0.2);
  assert.equal(hard.crash, 'Severe ground impact');
});

test('grass slows a high-speed excursion and supports a gentle touchdown', () => {
  const excursion = new Flight();
  excursion.position.set(30.8, 4.3, -290);
  excursion.heading = 90 * RAD;
  excursion.velocity.set(63, 0, 0);
  advance(excursion, 1);
  assert.equal(excursion.surface, 'grass');
  assert.ok(excursion.onGround);
  assert.ok(excursion.groundSpeed > 55);
  assert.equal(excursion.crash, '');
  advance(excursion, 32, { brake: true });
  assert.equal(excursion.groundSpeed, 0);
  assert.equal(excursion.crash, '');

  const landing = approach();
  landing.position.set(65, 9, 40);
  advance(landing, 5);
  assert.ok(landing.onGround);
  assert.equal(landing.surface, 'grass');
  assert.equal(landing.contactCount, 1);
  assert.equal(landing.crash, '');
});

test('a shallow ditching decelerates and settles afloat while a hard water impact ends flight', () => {
  const ditch = approach();
  ditch.position.set(1150, WATER_LEVEL + 3, -200);
  ditch.velocity.set(0, -2.4, -56);
  ditch.gear = 0;
  ditch.gearDown = false;
  advance(ditch, 1.5);
  assert.ok(ditch.waterborne);
  assert.ok(ditch.groundSpeed > 20 && ditch.groundSpeed < 56);
  assert.equal(ditch.contactCount, 1);
  advance(ditch, 35, { throttle: 1 });
  assert.equal(ditch.crash, '');
  assert.equal(ditch.groundSpeed, 0);
  assert.ok(ditch.position.y > WATER_LEVEL && ditch.position.y < WATER_LEVEL + 2);

  const hard = approach();
  hard.position.set(1150, WATER_LEVEL + 2, -200);
  hard.velocity.set(0, -12, -56);
  advance(hard, 1);
  assert.equal(hard.crash, 'Severe water impact');
});

test('a slow seawall overrun falls to the water before making contact', () => {
  const flight = new Flight();
  flight.position.set(FIELD.islandBounds[1] - 0.2, 4.3, -700);
  flight.heading = 90 * RAD;
  flight.velocity.set(4, 0, 0);
  advance(flight, 0.2);
  assert.equal(flight.onGround, false);
  assert.equal(flight.waterborne, false);
  assert.equal(flight.crash, '');
  advance(flight, 3);
  assert.ok(flight.waterborne);
  assert.equal(flight.crash, '');
});

test('excess angle of attack and excessive configured speed are reported', () => {
  const flight = approach();
  flight.position.y = 600;
  flight.pitch = 24 * RAD;
  advance(flight, STEP);
  assert.ok(flight.stalled);
  flight.pitch = 0;
  flight.velocity.set(0, 0, -130);
  advance(flight, STEP);
  assert.ok(flight.overspeed);
});
