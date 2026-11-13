/* RELAY ground operations model.
   Turns server snapshots (work orders, capacity, weather) into a position for every
   moving thing in the ground scene. Nothing here moves unless the simulation does:
   - a truck and a new container appear for each admitted work order,
   - a queued container keeps its yard slot until the policy dispatches it,
   - a tug, a crew member and a stand position are occupied for each active order,
   - an aircraft leaves once the orders loaded at its stand fill it.
   The airfield geometry and aircraft turnarounds are illustrative, not surveyed or certified. */
(() => {
'use strict';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const turnToward = (from, to, amount) => {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
};

const STAND_Z = [-12, 12, -36, 36, -60, 60];   // filled from the centre outward

/* Scale: one unit is about 3.2 m. The freighter is 22 units long, a crew member 0.55 tall. */
const layout = {
  // Area painted into the ground texture; beyond it the renderer continues analytically.
  site: {x: -42, z: -104, width: 134, depth: 196},
  seaX: 92,
  runway: {x: 70, width: 14, start: -100, threshold: -92, entry: -97, aim: -70, exit: 76},
  taxiway: {x: 45, width: 6},
  apron: {x0: 9.1, x1: 41.6, half: 74},
  road: {x: 7.6, width: 2.6, half: 78},
  walkway: 9.5,
  standCount: 6,
  stand: index => ({x: 22, z: STAND_Z[index]}),
  aircraftScale: 2.2,
  doorX: 15.6,          // forward main-deck cargo door of a parked aircraft
  sill: 1.06,           // door sill height
  yard: {x: 4.4, z: -4.9, colPitch: 1.2, rowPitch: 1.9, cols: 16, rows: 6},
  cold: {x: 4.4, z: -8.3, colPitch: 1.2, cols: 16, aisle: -6.6},
  hold: {x: -13.6, z: 8.7, colPitch: 1.2, cols: 8, aisle: 7.3},
  westLane: -15.3,
  terminal: {x: -23.2, z: -.4, width: 13, depth: 15},
  coldStore: {x: -4.6, z: -12.9, width: 19.2, depth: 4.6},
  crew: {x: 1.2, z: 17.75},
  shelter: {x: 2.5, z: 19.5, width: 4.4, depth: 2},
  carts: {x: 5.5, z: 16.6, pitch: 1, lane: 14.9},
  // Drive-through tug bays: in from the north lane, out onto the south lane.
  depot: {x: -1, pitch: 1.25, bays: 8, z: 11.7, south: 10.4, north: 14.9},
  // Landside road: trucks travel in the west lane and pull into the kerbside lane to unload.
  truckRoad: {x: -31.9, width: 5.2},
  truckLane: -33.2,
  ordersPerFlight: 12,
};

const HITCH = 1.5;      // tug-to-dolly distance along the path
const DECK = .29;       // dolly deck height

// Loader position beside the forward cargo door; side is -1 (north) or 1 (south).
const servicePoint = (stand, side) => ({x: layout.doorX, z: stand.z + side * 2.25, side});
// Where the tug halts so its dolly sits at the outer end of the loader.
const tugStop = (stand, side) => ({x: layout.doorX + HITCH, z: stand.z + side * 3.95});
const depotBay = index => ({x: layout.depot.x - clamp(index, 0, layout.depot.bays - 1) * layout.depot.pitch, z: layout.depot.z});

function slotPosition(zone, index) {
  if (zone === 'yard') {
    const {x, z, colPitch, rowPitch, rows} = layout.yard;
    const row = index % rows;
    return {x: x - Math.floor(index / rows) * colPitch, z: z + row * rowPitch, aisle: z + row * rowPitch + .95};
  }
  const area = layout[zone];
  const x = zone === 'hold' ? area.x + index * area.colPitch : area.x - index * area.colPitch;
  return {x, z: area.z, aisle: area.aisle};
}

// Polyline with rounded corners; `at(distance)` gives a position and a travel heading.
function makePath(points, radius = 1.4) {
  const clean = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > .05) clean.push(point);
  }
  if (clean.length === 1) clean.push([clean[0][0] + .06, clean[0][1]]);
  const samples = [clean[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const [ax, az] = clean[i - 1], [bx, bz] = clean[i], [cx, cz] = clean[i + 1];
    const inLength = Math.hypot(bx - ax, bz - az), outLength = Math.hypot(cx - bx, cz - bz);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const start = [bx + (ax - bx) / inLength * r, bz + (az - bz) / inLength * r];
    const end = [bx + (cx - bx) / outLength * r, bz + (cz - bz) / outLength * r];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, u = 1 - t;
      samples.push([u * u * start[0] + 2 * u * t * bx + t * t * end[0],
        u * u * start[1] + 2 * u * t * bz + t * t * end[1]]);
    }
  }
  samples.push(clean[clean.length - 1]);
  const distance = [0];
  for (let i = 1; i < samples.length; i++) {
    distance.push(distance[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  }
  const length = distance[distance.length - 1];
  function point(s) {
    const d = clamp(s, 0, length);
    let low = 0, high = distance.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (distance[mid] <= d) low = mid; else high = mid;
    }
    const span = distance[high] - distance[low] || 1, t = (d - distance[low]) / span;
    return [samples[low][0] + (samples[high][0] - samples[low][0]) * t,
      samples[low][1] + (samples[high][1] - samples[low][1]) * t];
  }
  function at(s, window = .45) {
    const [x, z] = point(s);
    const before = point(s - window), after = point(s + window);
    return {x, z, heading: Math.atan2(after[1] - before[1], after[0] - before[0])};
  }
  return {length, at};
}

// A tractor at distance `s` along a path, with its dolly trailing on the same line.
function towPose(path, s) {
  const tug = path.at(s), dolly = path.at(Math.max(0, s - HITCH));
  const ahead = path.at(s + .7).heading;
  return {
    tug: {...tug, steer: clamp(Math.atan2(Math.sin(ahead - tug.heading), Math.cos(ahead - tug.heading)) * 1.6, -.6, .6), distance: s},
    dolly: {x: dolly.x, z: dolly.z, heading: Math.atan2(tug.z - dolly.z, tug.x - dolly.x), distance: s},
  };
}

// ---- aircraft movements ---------------------------------------------------------------
// Each returns a pose for a distance travelled and the speed to use there.
const TAXI = 7, PUSH = 2.1, ROTATE = 26, CLIMB = 44, APPROACH = 21, FLARE = 30, SLOPE = .06;

function departure(stand) {
  const {runway, taxiway} = layout;
  const join = stand.z + 17;
  const push = makePath([[stand.x, stand.z], [38, stand.z], [taxiway.x, stand.z + 7], [taxiway.x, join]], 6);
  const taxi = makePath([[taxiway.x, join], [taxiway.x, runway.entry], [runway.x, runway.entry], [runway.x, runway.entry + 900]], 7);
  return {
    kind: 'departure', stand, s: 0, speed: 0, y: 0, hold: 0, pushLength: push.length,
    clearAt: push.length + (join - runway.entry) + (runway.x - taxiway.x) + 2,
    length: push.length + taxi.length,
    get phase() {
      if (this.s < push.length || this.hold > 0) return 'push';
      if (this.s <= this.clearAt) return 'taxi';
      return this.y > .05 ? 'climb' : 'roll';
    },
    advance(dt) {
      if (this.hold > 0) { this.hold -= dt; return; }
      const rolling = this.s > this.clearAt;
      if (this.s < push.length) {
        // Ease to a stop on the taxiway, pause while the tractor disconnects.
        const target = Math.min(PUSH, Math.sqrt(2 * .9 * (push.length - this.s)) + .15);
        this.speed += clamp(target - this.speed, -3 * dt, 1.1 * dt);
        this.s += this.speed * dt;
        if (this.s >= push.length) { this.s = push.length; this.speed = 0; this.hold = 1.6; }
        return;
      }
      // Slow for the turn onto the runway, then full power.
      const lining = this.s > this.clearAt - 14 && !rolling;
      const target = rolling ? CLIMB : lining ? 3.2 : TAXI;
      this.speed += clamp(target - this.speed, -4 * dt, (rolling ? 5.2 : 2.2) * dt);
      this.s += this.speed * dt;
      if (rolling && this.speed > ROTATE) this.y += this.speed * .2 * smooth((this.speed - ROTATE) / 5) * dt;
    },
    pose() {
      if (this.s < push.length || this.hold > 0) {
        const p = push.at(Math.min(this.s, push.length - .01), 2);
        return {x: p.x, y: 0, z: p.z, heading: p.heading + Math.PI, pitch: 0, bank: 0, gear: 1};
      }
      const p = taxi.at(this.s - push.length, 2);
      const rotate = this.s > this.clearAt ? smooth((this.speed - ROTATE + 3) / 5) : 0;
      return {x: p.x, y: this.y, z: p.z, heading: p.heading, pitch: .14 * rotate + .05 * smooth(this.y / 4), bank: 0,
        gear: 1 - smooth((this.y - 4) / 6)};
    },
  };
}

function arrival(stand) {
  const {runway, taxiway} = layout;
  const start = -380;
  const path = makePath([[runway.x, start], [runway.x, runway.exit], [taxiway.x, runway.exit],
    [taxiway.x, stand.z], [stand.x, stand.z]], 7);
  const air = runway.aim - start;
  return {
    kind: 'arrival', stand, s: 0, speed: APPROACH + 3, clearAt: path.length - 3, length: path.length,
    touched: false, sinceTouch: 0,
    get phase() { return this.s < air ? 'approach' : this.speed > TAXI + 1.5 ? 'rollout' : 'taxi'; },
    advance(dt) {
      const left = this.length - this.s;
      const target = this.s < air ? APPROACH : left < 12 ? Math.max(.6, Math.sqrt(2 * .7 * left)) : TAXI;
      this.speed += clamp(target - this.speed, -3.4 * dt, 2.4 * dt);
      this.s = Math.min(this.length, this.s + this.speed * dt);
      if (this.s >= air) {
        this.justTouched = !this.touched;
        this.touched = true;
        this.sinceTouch += dt;
      }
    },
    height() {
      const d = Math.max(0, air - this.s);
      return d >= FLARE ? SLOPE * (d - FLARE / 2) : SLOPE * d * d / (2 * FLARE);
    },
    pose() {
      const p = path.at(this.s, 2);
      const height = this.height();
      const flare = this.touched ? .1 * (1 - smooth(this.sinceTouch / 1.8)) : .04 + .06 * smooth(1 - height / 2.5);
      return {x: p.x, y: height, z: p.z, heading: p.heading, pitch: flare, bank: 0, gear: 1 - smooth((height - 10) / 6)};
    },
  };
}

function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

// ---- crew ------------------------------------------------------------------------------
// Crew wait by the shelter, ride a personnel cart along the service road, then walk the
// last few metres to the loader. Walking keeps a natural pace even when the clock is sped up.
const WALK = .6, CART_SPEED = 5;
const musterSpot = index => ({
  x: layout.crew.x + (index % 5) * .6, z: layout.crew.z + Math.floor(index / 5) * .55,
  facing: -Math.PI / 2 + (hash('crew' + index) - .5) * 1.6, cart: {key: 'home'},
});
const cartHome = index => ({x: layout.carts.x - index * layout.carts.pitch, z: layout.carts.z, heading: Math.PI / 2, key: 'home'});
const cartAtStand = (stand, side) => ({x: 11.8, z: stand.z + side * 5.15, heading: Math.PI, side, key: `s${stand.index}:${side}`});
// Where a crew member gets in and out: beside the driver's seat.
const cartDoor = cart => ({x: cart.x + Math.sin(cart.heading) * .5, z: cart.z - Math.cos(cart.heading) * .5});
// By the loader controls; standby is next to the cart.
const workSpot = (stand, side) => ({x: layout.doorX - .7, z: stand.z + side * 3.3, facing: -side * Math.PI / 2, cart: cartAtStand(stand, side)});
const standbySpot = (stand, side) => ({x: 12.9, z: stand.z + side * 4.55, facing: -side * Math.PI / 2 + .6, cart: cartAtStand(stand, side)});

function walkLeg(from, to) {
  if (Math.hypot(to.x - from.x, to.z - from.z) < .04) return null;
  return {mode: 'walk', path: makePath([[from.x, from.z], [to.x, to.z]], .3)};
}

function driveLegs(from, to, index) {
  const legs = [];
  const lane = layout.road.x + .65, laneBack = layout.road.x - .65;
  let start = [from.x, from.z];
  if (from.key === 'home') {
    // Reverse out of the bay so the cart faces the road.
    const out = [from.x - .9, from.z - 1.5];
    legs.push({mode: 'drive', reverse: true, path: makePath([start, [from.x, from.z - .9], out], .6)});
    start = out;
  }
  const points = [start];
  if (to.key === 'home') {
    const home = cartHome(index), north = layout.carts.lane;
    if (from.key !== 'home') points.push([laneBack, from.z], [laneBack, north]);
    points.push([home.x, north], [home.x, home.z]);
  } else {
    const side = to.side || 1;
    const loop = to.z + side * 1.4;
    if (from.key === 'home') points.push([lane, start[1]]);
    else points.push([lane, from.z]);
    points.push([lane, loop], [12.9, loop], [12.9, to.z], [to.x, to.z]);
  }
  legs.push({mode: 'drive', reverse: false, path: makePath(points, .8), key: to.key, end: to});
  return legs;
}

class GroundOps {
  constructor() { this.reset(); }

  reset() {
    this.jobs = new Map();
    this.slots = {
      yard: new Array(layout.yard.cols * layout.yard.rows).fill(null),
      cold: new Array(layout.cold.cols).fill(null),
      hold: new Array(layout.hold.cols).fill(null),
    };
    this.stands = Array.from({length: layout.standCount}, (_, index) => ({
      index, ...layout.stand(index), aircraft: 'absent', loads: 0, pending: false,
      configured: false, open: false, staffed: false, sides: {'-1': null, '1': null},
    }));
    this.movements = [];
    this.movementQueue = [];
    this.trucks = [];
    this.returns = [];
    this.forklifts = [];
    this.tractors = new Map();
    this.pops = [];
    this.effects = [];
    this.workers = [];
    this.departedFlights = 0;
    this.departedOrders = 0;
    this.completedOnTime = 0;
    this.completedLate = 0;
    this.tick = -1;
    this.sinceSync = 0;
    this.primed = false;
    this.capacity = {handlers: 3, stands: 3, coldBays: 1, cfgHandlers: 3, cfgStands: 3, cfgColdBays: 1};
    this.stats = {queue: 0, hidden: 0, overdue: 0, atRisk: 0, coldWaiting: 0, coldBusy: 0, active: 0, blocked: 0};
  }

  // ---- snapshot intake -------------------------------------------------------------
  sync(state, context) {
    const tick = context.tick ?? 0;
    if (tick < this.tick) this.reset();
    const first = !this.primed;
    const previousTick = this.tick;
    this.tick = tick;
    if (tick !== previousTick) this.sinceSync = 0;
    this.capacity = {
      handlers: context.handlers ?? 3, stands: context.stands ?? 3, coldBays: context.coldBays ?? 1,
      cfgHandlers: context.cfgHandlers ?? context.handlers ?? 3,
      cfgStands: context.cfgStands ?? context.stands ?? 3,
      cfgColdBays: context.cfgColdBays ?? context.coldBays ?? 1,
    };
    this.updateStands(first);

    const seen = new Set();
    let fresh = 0;
    for (const item of state?.objects || []) {
      seen.add(item.id);
      let job = this.jobs.get(item.id);
      if (!job) {
        const justArrived = !first && (item.admit_tick == null || item.admit_tick > previousTick);
        job = this.admit(item, justArrived && item.status === 'WAIT');
        if (justArrived) fresh++;
      }
      job.deadline = item.deadline_tick ?? job.deadline;
      job.duration = item.duration || job.duration;
      job.seenTick = tick;
      if (item.status === 'MOVING') {
        if (job.status !== 'MOVING') this.dispatch(job, first);
        job.progress = item.progress ?? 0;
        if (first) job.shown = job.progress;
      }
    }
    for (const job of [...this.jobs.values()]) if (!seen.has(job.id)) this.finish(job);
    if (fresh) this.spawnTrucks(fresh);
    if (first) this.placeCrew = true;
    this.seatOverflow();
    this.measure(state);
    this.primed = true;
  }

  admit(item, animate) {
    const job = {
      id: item.id, cold: Boolean(item.cold), priority: item.priority || 1, blocked: Boolean(item.blocked),
      deadline: item.deadline_tick ?? null, duration: item.duration || 3, status: 'WAIT',
      zone: item.blocked ? 'hold' : item.cold ? 'cold' : 'yard', slot: -1,
      x: 0, z: 0, heading: 0, route: null, routeS: 0, delay: 0, visible: false,
      progress: 0, shown: 0, stand: null, side: 0, path: null, approach: null, pickup: null,
    };
    this.jobs.set(job.id, job);
    if (item.status === 'WAIT') this.seat(job, animate);
    return job;
  }

  seat(job, animate) {
    const index = this.slots[job.zone].indexOf(null);
    if (index < 0) return false;
    this.slots[job.zone][index] = job.id;
    job.slot = index;
    job.visible = true;
    const target = slotPosition(job.zone, index);
    if (animate) {
      // A forklift brings the container out of the terminal and sets it down in its slot.
      const {terminal} = layout;
      const door = [terminal.x + terminal.width / 2 + .5, clamp(target.aisle, terminal.z - 6, terminal.z + 6)];
      job.route = makePath([door, [door[0] + 1.6, target.aisle], [target.x, target.aisle], [target.x, target.z]], .8);
      job.door = door;
      job.routeS = 0;
      job.delay = .9;
      job.x = door[0]; job.z = door[1]; job.heading = 0;
    } else {
      job.x = target.x; job.z = target.z;
    }
    return true;
  }

  seatOverflow() {
    for (const job of this.jobs.values()) {
      if (job.status === 'WAIT' && job.slot < 0) this.seat(job, this.primed);
    }
  }

  release(job) {
    if (job.slot >= 0) this.slots[job.zone][job.slot] = null;
    job.slot = -1;
  }

  // Free service position, preferring stands whose aircraft is ready to load.
  choosePosition() {
    const open = this.stands.filter(stand => stand.open);
    const pool = open.length ? open : this.stands.slice(0, 1);
    const ready = stand => stand.aircraft === 'parked' ? 0 : 1;
    for (const side of [-1, 1]) {
      const free = pool.filter(stand => !stand.sides[side] && (side === -1 || stand.sides[-1]));
      if (free.length) return {stand: free.sort((a, b) => ready(a) - ready(b) || a.index - b.index)[0], side};
    }
    return {stand: pool[0], side: 1};
  }

  // Tugs neither towing nor on their way home are parked in the depot.
  parkedTugs() {
    let out = this.returns.length;
    for (const job of this.jobs.values()) if (job.status === 'MOVING') out++;
    return Math.max(0, layout.depot.bays - out);
  }

  dispatch(job, first) {
    const from = job.slot >= 0 ? slotPosition(job.zone, job.slot) : null;
    const start = job.visible && !job.route ? [job.x, job.z] : null;
    const bay = depotBay(this.parkedTugs() - 1);
    this.release(job);
    job.status = 'MOVING';
    job.route = null;
    job.visible = true;
    const {stand, side} = this.choosePosition();
    job.stand = stand;
    job.side = side;
    stand.sides[side] = job.id;
    const stop = tugStop(stand, side);
    const road = layout.road.x, {depot, westLane} = layout;
    if (start && from) {
      // Out of the depot, round the west lane, along the aisle to stop with the dolly beside the slot.
      job.pickup = {x: start[0], z: start[1], aisle: from.aisle};
      job.approach = makePath([[bay.x, bay.z + HITCH], [bay.x, depot.south], [westLane, depot.south],
        [westLane, from.aisle], [start[0] + HITCH, from.aisle]], 1.1);
      job.path = makePath([[start[0], from.aisle], [road, from.aisle], [road, stop.z], [stop.x, stop.z]], 1.2);
    } else {
      job.pickup = null;
      job.approach = null;
      job.path = makePath([[5.4 - HITCH, 6.05], [road, 6.05], [road, stop.z], [stop.x, stop.z]], 1.2);
    }
    job.shown = first ? job.progress : 0;
  }

  finish(job) {
    const tick = this.tick;
    this.release(job);
    this.jobs.delete(job.id);
    let stand = job.stand;
    let doneTick = tick;
    if (job.status === 'MOVING') {
      stand.sides[job.side] = null;
      doneTick = Math.min(tick, job.seenTick + Math.round((1 - job.progress) * job.duration));
      // The empty dolly goes home: a U-turn clear of the wing, the service road, the north lane.
      const {tug, dolly} = this.jobPose(job);
      const stop = tugStop(stand, job.side), {depot, road} = layout;
      const bay = depotBay(this.parkedTugs() - 1);
      const atStop = Math.hypot(tug.x - stop.x, tug.z - stop.z) < 1;
      const turn = atStop
        ? [[stop.x + .9, stop.z + job.side * 1.2], [stop.x, stop.z + job.side * 2.4], [road.x, stop.z + job.side * 2.4]]
        : [[road.x, tug.z]];
      this.returns.push({path: makePath([[dolly.x, dolly.z], [tug.x, tug.z], ...turn,
        [road.x, depot.north], [bay.x, depot.north], [bay.x, bay.z]], 1.1), s: HITCH, speed: 0});
      if (this.returns.length > 14) this.returns.shift();
    } else {
      // Dispatched and completed between two snapshots: credit the least-loaded open stand.
      stand = this.stands.filter(s => s.open).sort((a, b) => a.loads - b.loads)[0] || this.stands[0];
    }
    stand.loads++;
    const late = job.deadline == null ? null : Math.max(0, doneTick - job.deadline);
    if (late) this.completedLate++; else this.completedOnTime++;
    this.pops.push({x: layout.doorX, z: stand.z, age: 0, late});
    if (this.pops.length > 10) this.pops.shift();
  }

  spawnTrucks(orders) {
    const count = Math.min(3, Math.ceil(orders / 3), 6 - this.trucks.length);
    const {terminal, truckLane} = layout;
    for (let i = 0; i < count; i++) {
      const bay = terminal.z - 5 + ((this.trucks.length * 2 + i * 3) % 5) * 2.5;
      const from = 96 + i * 9;
      this.trucks.push({
        path: makePath([[truckLane, from], [truckLane, bay + 5], [truckLane + 2.6, bay + 1.6],
          [truckLane + 2.6, bay - 1.6], [truckLane, bay - 5], [truckLane, -120]], 1.6),
        s: 0, speed: 13, stopAt: from - bay + .4, dwell: 1.4, loaded: true, braking: false,
      });
    }
  }

  updateStands(first) {
    const {stands, cfgStands, handlers} = this.capacity;
    const crewed = Math.min(handlers, stands);
    for (const stand of this.stands) {
      stand.configured = stand.index < cfgStands;
      stand.open = stand.index < stands;
      stand.staffed = stand.index < crewed;
      if (first && stand.configured) {
        stand.aircraft = 'parked';
        stand.loads = Math.floor(hash('stand' + stand.index) * 5);
      }
    }
  }

  measure(state) {
    const stats = {queue: 0, hidden: 0, overdue: 0, atRisk: 0, coldWaiting: 0, coldBusy: 0, active: 0, blocked: 0};
    let shown = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'MOVING') {
        stats.active++;
        if (job.cold) stats.coldBusy++;
        continue;
      }
      stats.queue++;
      if (job.slot >= 0) shown++;
      if (job.blocked) stats.blocked++;
      if (job.cold) stats.coldWaiting++;
      const level = this.urgency(job);
      if (level === 3) stats.overdue++;
      else if (level > 0) stats.atRisk++;
    }
    stats.queue = Math.max(stats.queue, Number(state?.waiting) || 0);
    stats.hidden = stats.queue - shown;
    this.stats = stats;
  }

  // 0 on track · 1 tight · 2 cannot finish in time even if started now · 3 already overdue
  urgency(job) {
    if (job.deadline == null) return 0;
    const remaining = job.status === 'MOVING' ? Math.ceil((1 - job.progress) * job.duration) : job.duration;
    if (this.tick > job.deadline) return 3;
    if (this.tick + remaining > job.deadline) return 2;
    return this.tick + remaining + 2 > job.deadline ? 1 : 0;
  }

  // ---- frame advance ---------------------------------------------------------------
  // `seconds` is wall time, `tempo` the visual time scale (0 while paused).
  step(seconds, tempo, ticksPerSecond) {
    const dt = seconds * tempo;
    this.sinceSync += tempo > 0 ? seconds : 0;
    for (const pop of this.pops) pop.age += seconds;
    this.pops = this.pops.filter(pop => pop.age < 2.6);
    if (dt <= 0) return;

    for (const job of this.jobs.values()) {
      if (job.status === 'WAIT') {
        if (!job.route) continue;
        if (job.delay > 0) { job.delay -= dt; continue; }
        job.routeS += dt * 6.5;
        const p = job.route.at(job.routeS);
        job.x = p.x; job.z = p.z; job.heading = p.heading;
        if (job.routeS >= job.route.length) {
          // Set down; the forklift backs off and returns to the terminal door.
          const body = {x: p.x - Math.cos(p.heading) * 1.1, z: p.z - Math.sin(p.heading) * 1.1};
          const aisle = slotPosition(job.zone, job.slot).aisle;
          this.forklifts.push({heading: p.heading, s: 0,
            path: makePath([[body.x, body.z], [body.x - 1.2, aisle], [job.door[0] + 1.6, aisle], job.door], .9)});
          job.route = null;
          job.heading = 0;
        }
        continue;
      }
      const step = 1 / Math.max(1, job.duration);
      let target = Math.min(job.progress + this.sinceSync * ticksPerSecond * step, job.progress + step, .995);
      if (job.stand.aircraft !== 'parked') target = Math.min(target, .58);
      job.shown += (Math.max(job.shown, target) - job.shown) * (1 - Math.exp(-seconds * 9));
    }

    for (const truck of this.trucks) {
      const toStop = truck.stopAt - truck.s;
      if (truck.dwell > 0 && toStop <= .05) {
        truck.dwell -= dt; truck.loaded = truck.dwell > .6; truck.speed = 0; truck.braking = true;
        continue;
      }
      const target = truck.dwell > 0 ? Math.min(13, Math.sqrt(2 * 5 * Math.max(toStop, 0)) + .5) : 13;
      truck.braking = target < truck.speed - .01;
      truck.speed += clamp(target - truck.speed, -9 * dt, 4.5 * dt);
      truck.s += truck.speed * dt;
    }
    this.trucks = this.trucks.filter(truck => truck.s < truck.path.length);
    for (const tug of this.returns) {
      const target = Math.min(9, Math.sqrt(2 * 4 * Math.max(tug.path.length - tug.s, 0)) + .4);
      tug.speed += clamp(target - tug.speed, -8 * dt, 4 * dt);
      tug.s += tug.speed * dt;
    }
    this.returns = this.returns.filter(tug => tug.s < tug.path.length - .05);
    for (const fork of this.forklifts) fork.s += dt * 6.5;
    for (const tractor of this.tractors.values()) {
      const left = tractor.path.length - tractor.s;
      tractor.speed += clamp(Math.min(4, Math.sqrt(2 * 2 * Math.max(left, 0))) - tractor.speed, -6 * dt, 2.5 * dt);
      tractor.s = Math.min(tractor.path.length, tractor.s + tractor.speed * dt);
    }
    this.forklifts = this.forklifts.filter(fork => fork.s < fork.path.length);
    for (const effect of this.effects) effect.age += dt;
    this.effects = this.effects.filter(effect => effect.age < effect.life);

    this.stepAircraft(dt);
    this.stepWorkers(dt, seconds * Math.min(tempo, 1.5));
  }

  stepAircraft(dt) {
    const queued = stand => stand.pending;
    for (const stand of this.stands) {
      if (queued(stand)) continue;
      // A container already being lifted aboard finishes first; one still on its way waits
      // at the loader for the replacement aircraft.
      const idle = [-1, 1].every(side => !(this.jobs.get(stand.sides[side])?.shown > .5));
      const full = stand.loads >= layout.ordersPerFlight && this.movementQueue.length < 2;
      if (stand.aircraft === 'parked' && idle && (full || !stand.configured)) {
        stand.pending = true;
        this.movementQueue.push({kind: 'departure', stand});
      } else if (stand.aircraft === 'absent' && stand.configured) {
        stand.pending = true;
        this.movementQueue.push({kind: 'arrival', stand});
      }
    }
    // One aircraft at a time on the taxiway and runway until the previous one is clear.
    if (this.movementQueue.length && this.movements.every(move => move.s > move.clearAt)) {
      const next = this.movementQueue.shift();
      this.movements.push(next.kind === 'departure' ? departure(next.stand) : arrival(next.stand));
      next.stand.aircraft = next.kind === 'departure' ? 'outbound' : 'inbound';
    }
    const hurry = 1 + .45 * this.movementQueue.length;
    for (const move of this.movements) {
      move.advance(dt * hurry);
      if (move.justTouched) {
        move.justTouched = false;
        const pose = move.pose();
        this.effects.push({kind: 'touchdown', x: pose.x, z: pose.z - 1.6, age: 0, life: 2.6, speed: move.speed});
      }
      // The pushback tractor parks beside the stand until the next departure.
      if (move.kind === 'departure') {
        if (move.s < 1) this.tractors.delete(move.stand.index);
        else if (move.phase !== 'push' && !this.tractors.has(move.stand.index)) {
          const pose = move.pose(), start = this.tractorPose(pose, 0);
          const park = {x: 30, z: move.stand.z + 8.5};
          this.tractors.set(move.stand.index, {s: 0, speed: 0,
            path: makePath([[start.x, start.z], [start.x - Math.cos(pose.heading) * 2.5, start.z - Math.sin(pose.heading) * 2.5 + 2],
              [park.x + 3, park.z], [park.x, park.z]], 2)});
        }
      }
    }
    this.movements = this.movements.filter(move => {
      if (move.s < move.length) return true;
      const stand = move.stand;
      stand.pending = false;
      if (move.kind === 'departure') {
        this.departedFlights++;
        this.departedOrders += stand.loads;
        stand.loads = 0;
        stand.aircraft = 'absent';
      } else {
        stand.aircraft = 'parked';
      }
      return false;
    });
  }

  // Each crew member keeps one order until it is aboard, rides a cart between stands,
  // and returns to the shelter when a stand has gone quiet.
  stepWorkers(dt, walkDt) {
    const total = clamp(this.capacity.handlers, 0, 12);
    while (this.workers.length < total) {
      const index = this.workers.length, spot = musterSpot(index);
      this.workers.push({index, x: spot.x, z: spot.z, heading: spot.facing, speed: 0, stride: hash('gait' + index) * 3,
        job: null, post: null, goal: spot, legs: [], leg: null, s: 0, idle: 99, busy: false, walking: false,
        mode: 'stand', act: 'idle', cart: cartHome(index), build: .56 + hash('build' + index) * .09});
    }
    this.workers.length = total;
    const claimed = new Set();
    for (const worker of this.workers) {
      if (worker.job && this.jobs.get(worker.job.id) !== worker.job) worker.job = null;
      if (worker.job) claimed.add(worker.job.id);
    }
    for (const job of this.jobs.values()) {
      if (job.status !== 'MOVING' || claimed.has(job.id)) continue;
      const spot = workSpot(job.stand, job.side);
      let nearest = null, best = Infinity;
      for (const worker of this.workers) {
        if (worker.job) continue;
        const gap = Math.hypot(worker.x - spot.x, worker.z - spot.z) + (worker.cart.key === spot.cart.key ? 0 : 20);
        if (gap < best) { best = gap; nearest = worker; }
      }
      if (!nearest) break;
      nearest.job = job;
      claimed.add(job.id);
      if (this.placeCrew) {
        // Opening a running simulation: crew already on duty start at their posts.
        nearest.cart = {...spot.cart, distance: 0};
        nearest.x = spot.x; nearest.z = spot.z; nearest.heading = spot.facing;
        nearest.goal = spot; nearest.legs = []; nearest.leg = null; nearest.replan = false;
      }
    }
    this.placeCrew = false;
    for (const worker of this.workers) this.stepWorker(worker, dt, walkDt);
  }

  plan(worker, goal) {
    const legs = [];
    const standOf = key => key.split(':')[0];
    if (worker.cart.key === goal.cart.key || (goal.cart.key !== 'home' && standOf(worker.cart.key) === standOf(goal.cart.key)
      && Math.hypot(worker.x - goal.x, worker.z - goal.z) < 9)) {
      // Same stand: walk, ducking under the forward fuselage to reach the other side.
      legs.push(walkLeg(worker, goal));
    } else {
      const target = goal.cart.key === 'home' ? cartHome(worker.index) : goal.cart;
      legs.push(walkLeg(worker, cartDoor(worker.cart)));
      legs.push(...driveLegs(worker.cart, target, worker.index));
      legs.push(walkLeg(cartDoor(target), goal));
    }
    return legs.filter(Boolean);
  }

  stepWorker(worker, dt, walkDt) {
    const job = worker.job;
    let goal;
    if (job) {
      goal = workSpot(job.stand, job.side);
      worker.post = standbySpot(job.stand, job.side);
      worker.idle = 0;
    } else {
      worker.idle += walkDt;
      goal = worker.post && worker.idle < 45 ? worker.post : musterSpot(worker.index);
      if (worker.idle >= 45) worker.post = null;
    }
    if (Math.hypot(goal.x - worker.goal.x, goal.z - worker.goal.z) > .05) { worker.goal = goal; worker.replan = true; }
    // A walk can be re-routed at once; a drive finishes first.
    if (worker.replan && (!worker.leg || worker.leg.mode === 'walk')) {
      worker.replan = false;
      worker.legs = this.plan(worker, worker.goal);
      worker.leg = worker.legs.shift() || null;
      worker.s = 0;
    }
    const leg = worker.leg;
    if (leg && leg.mode === 'walk') {
      const remaining = leg.path.length - worker.s;
      const target = Math.min(WALK, Math.sqrt(2 * 1.2 * Math.max(remaining, 0)) + .1);
      worker.speed += clamp(target - worker.speed, -3 * walkDt, 1.6 * walkDt);
      const moved = worker.speed * walkDt;
      worker.s += moved;
      worker.stride += moved;
      const p = leg.path.at(worker.s, .2);
      worker.x = p.x; worker.z = p.z;
      worker.heading = turnToward(worker.heading, p.heading, 1 - Math.exp(-walkDt * 10));
      worker.mode = 'walk';
    } else if (leg) {
      const cart = worker.cart, remaining = leg.path.length - worker.s;
      const cruise = leg.reverse ? .8 : CART_SPEED;
      const target = Math.min(cruise, Math.sqrt(2 * 2.2 * Math.max(remaining, 0)) + .12);
      worker.speed += clamp(target - worker.speed, -5 * dt, 2.4 * dt);
      worker.s += worker.speed * dt;
      const p = leg.path.at(worker.s, .5);
      cart.x = p.x; cart.z = p.z;
      cart.heading = leg.reverse ? p.heading + Math.PI : p.heading;
      cart.distance = (cart.distance || 0) + worker.speed * dt * (leg.reverse ? -1 : 1);
      cart.moving = true;
      worker.x = cart.x; worker.z = cart.z; worker.heading = cart.heading;
      worker.mode = 'drive';
    }
    if (leg && worker.s >= leg.path.length - .02) {
      if (leg.mode === 'drive') {
        worker.cart = {...leg.end || worker.cart, x: worker.cart.x, z: worker.cart.z, heading: worker.cart.heading,
          key: leg.key ?? worker.cart.key, distance: worker.cart.distance};
        worker.cart.moving = false;
        if (leg.key && leg.key !== 'home' && worker.legs[0]?.mode === 'walk') {
          worker.x = cartDoor(worker.cart).x; worker.z = cartDoor(worker.cart).z;
        }
        if (leg.key === 'home') { const door = cartDoor(worker.cart); worker.x = door.x; worker.z = door.z; }
      }
      worker.leg = worker.legs.shift() || null;
      worker.s = 0;
      worker.speed = worker.leg?.mode === leg.mode ? worker.speed : 0;
    }
    if (!worker.leg) {
      worker.speed = 0;
      worker.mode = 'stand';
    }
    worker.busy = Boolean(job);
    worker.walking = worker.mode === 'walk' && worker.speed > .05;
    worker.act = 'idle';
    let facing = worker.goal.facing;
    if (job && !worker.leg) {
      const pose = this.jobPose(job);
      const stop = tugStop(job.stand, job.side);
      const gap = Math.hypot(pose.tug.x - stop.x, pose.tug.z - stop.z);
      worker.act = pose.phase === 'load' || pose.phase === 'lift' ? 'operate' : gap < 10 && gap > .3 ? 'marshal' : 'wait';
      if (worker.act === 'marshal') facing = Math.atan2(pose.tug.z - worker.z, pose.tug.x - worker.x);
      if (worker.act === 'operate') facing = Math.atan2(pose.container.z - worker.z, pose.container.x - worker.x);
    }
    if (!worker.leg && facing != null) worker.heading = turnToward(worker.heading, facing, 1 - Math.exp(-walkDt * 4));
  }

  // Pushback tractor in front of the nose gear, facing the aircraft.
  tractorPose(pose, distance) {
    const reach = 3.75 * layout.aircraftScale + 2.4;
    return {x: pose.x + Math.cos(pose.heading) * reach, z: pose.z + Math.sin(pose.heading) * reach,
      heading: pose.heading + Math.PI, distance};
  }

  // ---- derived poses for the renderer -------------------------------------------
  // Where an active order's tug, dolly and container are, given how far its work has progressed.
  jobPose(job) {
    const stop = servicePoint(job.stand, job.side);
    const travel = clamp(job.shown / .45, 0, 1);
    const deck = DECK;
    let rig, carried = 1;
    if (job.approach) {
      // 0-30 % drive to the slot · 30-38 % take the container onto the dolly · then tow.
      const arrive = smooth(travel / .3);
      carried = smooth((travel - .3) / .08);
      const tow = smooth((travel - .38) / .62);
      rig = travel < .3
        ? towPose(job.approach, HITCH + (job.approach.length - HITCH) * arrive)
        : towPose(job.path, HITCH + (job.path.length - HITCH) * tow);
    } else {
      rig = towPose(job.path, HITCH + (job.path.length - HITCH) * smooth(travel));
    }
    const {tug, dolly} = rig;
    const transfer = smooth((job.shown - .46) / .1);
    const lift = smooth((job.shown - .56) / .1);
    const load = smooth((job.shown - .66) / .32);
    // On the dolly, then across to the outer end of the loader, up to the sill, in through the door.
    let x = dolly.x, z = dolly.z, y = deck, heading = dolly.heading;
    if (job.pickup && carried < 1) {
      x = job.pickup.x + (dolly.x - job.pickup.x) * carried;
      z = job.pickup.z + (dolly.z - job.pickup.z) * carried;
      y = deck * carried + .22 * Math.sin(carried * Math.PI);
      heading = dolly.heading * carried;
    }
    const outer = stop.z + job.side * .55, inner = job.stand.z + job.side * .1;
    x += (stop.x - x) * transfer;
    z += (outer - z) * transfer;
    z += (inner - outer) * load;
    y += (layout.sill - deck) * lift;
    const container = {x, y, z, heading: heading * (1 - transfer), scale: load < .985 ? 1 : 0};
    return {tug, dolly, container, stop, lift: lift * (1 - smooth((load - .82) / .18)), loaded: transfer >= .5,
      onDolly: carried >= 1 && transfer < .5,
      phase: travel < 1 ? 'tow' : load > 0 ? 'load' : 'lift'};
  }

  aircraftPoses() {
    const poses = [];
    for (const stand of this.stands) {
      if (stand.aircraft === 'parked' || (stand.aircraft === 'outbound' && !this.movements.some(m => m.stand === stand))) {
        poses.push({stand, phase: 'parked', speed: 0,
          pose: {x: stand.x, y: 0, z: stand.z, heading: Math.PI, pitch: 0, bank: 0, gear: 1}});
      }
    }
    for (const move of this.movements) {
      poses.push({stand: move.stand, pose: move.pose(), moving: true, kind: move.kind, phase: move.phase, speed: move.speed, distance: move.s});
    }
    return poses;
  }
}

window.RelayGroundOps = {GroundOps, layout, makePath, slotPosition, servicePoint, tugStop, depotBay, towPose, cartHome, HITCH, DECK};
})();
