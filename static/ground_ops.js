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

const layout = {
  ground: {x: 1, width: 74, depth: 48},
  runway: {x: 30, width: 8, half: 22},
  taxiway: {x: 22.6, width: 3},
  apron: {x: 13.25, width: 15.5, depth: 41},
  road: {x: 7.6, width: 2.2},
  standCount: 6,
  stand: index => ({x: 15.2, z: -15 + index * 6}),
  aircraftScale: .82,
  yard: {x: 4.4, z: -4.9, colPitch: 1.2, rowPitch: 1.9, cols: 16, rows: 6},
  cold: {x: 4.4, z: -8.3, colPitch: 1.2, cols: 16, aisle: -6.6},
  hold: {x: -13.6, z: 8.7, colPitch: 1.2, cols: 8, aisle: 7.3},
  terminal: {x: -23.2, z: -.4, width: 13, depth: 15},
  coldStore: {x: -4.6, z: -12.9, width: 19.2, depth: 4.6},
  crew: {x: 1.2, z: 9.6},
  depot: {x: -3.4, z: 9.9},
  truckLane: -32.4,
  ordersPerFlight: 12,
};

// Service position beside the forward cargo door; side is -1 (north) or 1 (south).
const servicePoint = (stand, side) => ({x: 13.7, z: stand.z + side * 1.25, side});
// Where the tug halts so its dolly sits alongside the loader.
const tugStop = (stand, side) => ({x: 15, z: stand.z + side * 2.4});

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
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
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
  function at(s) {
    const [x, z] = point(s);
    const before = point(s - .45), after = point(s + .45);
    return {x, z, heading: Math.atan2(after[1] - before[1], after[0] - before[0])};
  }
  return {length, at};
}

// Aircraft movements. Each returns a pose for a distance travelled and the speed to use there.
const TAXI = 6.5, PUSH = 2.6, ROTATE = 15, APPROACH = 17;

function departure(stand) {
  const {runway, taxiway} = layout;
  const push = makePath([[stand.x, stand.z], [19.4, stand.z], [taxiway.x, stand.z + 3.4]], 2.6);
  const taxi = makePath([[taxiway.x, stand.z + 3.4], [taxiway.x, -20.2], [runway.x, -20.2], [runway.x, 150]], 2.7);
  const lineUp = stand.z + 3.4 + 20.2 + (runway.x - taxiway.x) - 1.4;
  return {
    kind: 'departure', stand, s: 0, speed: 0, y: 0, clearAt: push.length + lineUp,
    length: push.length + taxi.length,
    advance(dt) {
      const rolling = this.s > this.clearAt;
      const target = this.s < push.length ? PUSH : rolling ? 30 : TAXI;
      this.speed += clamp(target - this.speed, -5 * dt, (rolling ? 4.6 : 3.2) * dt);
      this.s += this.speed * dt;
      if (rolling && this.speed > ROTATE) this.y += this.speed * .27 * dt;
    },
    pose() {
      if (this.s < push.length) {
        const p = push.at(this.s);
        return {x: p.x, y: 0, z: p.z, heading: p.heading + Math.PI, pitch: 0, bank: 0, gear: 1};
      }
      const p = taxi.at(this.s - push.length);
      const lift = this.s > this.clearAt ? smooth((this.speed - ROTATE + 3) / 6) : 0;
      return {x: p.x, y: this.y, z: p.z, heading: p.heading, pitch: .24 * lift, bank: 0,
        gear: 1 - smooth((this.y - 1.2) / 3)};
    },
  };
}

function arrival(stand) {
  const {runway, taxiway} = layout;
  const start = -92, touchdown = -15;
  const path = makePath([[runway.x, start], [runway.x, 20.4], [taxiway.x, 20.4],
    [taxiway.x, stand.z + 3.4], [19.4, stand.z], [stand.x, stand.z]], 2.6);
  const air = touchdown - start;
  return {
    kind: 'arrival', stand, s: 0, speed: APPROACH, clearAt: path.length - 3, length: path.length,
    advance(dt) {
      const target = this.s < air ? APPROACH : this.s > this.length - 5 ? 2.2 : TAXI;
      this.speed += clamp(target - this.speed, -4.6 * dt, 3 * dt);
      this.s += this.speed * dt;
    },
    pose() {
      const p = path.at(this.s);
      const height = Math.max(0, air - this.s) * .1;
      return {x: p.x, y: height, z: p.z, heading: p.heading, pitch: .07 * smooth(height / 1.5), bank: 0,
        gear: 1 - smooth((height - 5) / 3)};
    },
  };
}

function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
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
    this.pops = [];
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
    this.sinceSync = 0;
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
      progress: 0, shown: 0, stand: null, side: 0, path: null,
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
      const {terminal} = layout;
      const door = [terminal.x + terminal.width / 2 + .5, clamp(target.aisle, terminal.z - 6, terminal.z + 6)];
      job.route = makePath([door, [door[0] + 1.6, target.aisle], [target.x, target.aisle], [target.x, target.z]], .8);
      job.routeS = 0;
      job.delay = .9;
      job.x = door[0]; job.z = door[1];
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

  dispatch(job, first) {
    const from = job.slot >= 0 ? slotPosition(job.zone, job.slot) : null;
    const start = job.visible && !job.route ? [job.x, job.z] : null;
    this.release(job);
    job.status = 'MOVING';
    job.route = null;
    job.visible = true;
    const {stand, side} = this.choosePosition();
    job.stand = stand;
    job.side = side;
    stand.sides[side] = job.id;
    const stop = tugStop(stand, side);
    const road = layout.road.x;
    const points = start && from
      ? [start, [start[0], from.aisle], [road, from.aisle], [road, stop.z], [stop.x, stop.z]]
      : [[5.4, 6.05], [road, 6.05], [road, stop.z], [stop.x, stop.z]];
    job.path = makePath(points, 1.1);
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
      const stop = tugStop(stand, job.side);
      this.returns.push({path: makePath([[stop.x - 1.4, stop.z], [layout.road.x, stop.z],
        [layout.road.x, 8.2], [layout.depot.x + 2, layout.depot.z]], 1.1), s: 0});
      if (this.returns.length > 14) this.returns.shift();
    } else {
      // Dispatched and completed between two snapshots: credit the least-loaded open stand.
      stand = this.stands.filter(s => s.open).sort((a, b) => a.loads - b.loads)[0] || this.stands[0];
    }
    stand.loads++;
    const late = job.deadline == null ? null : Math.max(0, doneTick - job.deadline);
    if (late) this.completedLate++; else this.completedOnTime++;
    this.pops.push({x: stand.x - 1.2, z: stand.z, age: 0, late});
    if (this.pops.length > 10) this.pops.shift();
  }

  spawnTrucks(orders) {
    const count = Math.min(3, Math.ceil(orders / 3), 6 - this.trucks.length);
    const {terminal, truckLane} = layout;
    for (let i = 0; i < count; i++) {
      const bay = terminal.z - 5 + ((this.trucks.length * 2 + i * 3) % 5) * 2.5;
      this.trucks.push({
        path: makePath([[truckLane, 27 + i * 4], [truckLane, bay + 4], [truckLane + 1.3, bay + 1.5],
          [truckLane + 1.3, bay - 1.5], [truckLane, bay - 4], [truckLane, -27]], 1.2),
        s: 0, stopAt: 27 + i * 4 - bay + .3, dwell: 1.1, loaded: true,
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
        job.routeS += dt * 11;
        const p = job.route.at(job.routeS);
        job.x = p.x; job.z = p.z;
        if (job.routeS >= job.route.length) job.route = null;
        continue;
      }
      const step = 1 / Math.max(1, job.duration);
      let target = Math.min(job.progress + this.sinceSync * ticksPerSecond * step, job.progress + step, .995);
      if (job.stand.aircraft !== 'parked') target = Math.min(target, .58);
      job.shown += (Math.max(job.shown, target) - job.shown) * (1 - Math.exp(-seconds * 9));
    }

    for (const truck of this.trucks) {
      if (truck.dwell > 0 && truck.s >= truck.stopAt) { truck.dwell -= dt; truck.loaded = truck.dwell > .5; continue; }
      truck.s += dt * 12;
    }
    this.trucks = this.trucks.filter(truck => truck.s < truck.path.length);
    for (const tug of this.returns) tug.s += dt * 10;
    this.returns = this.returns.filter(tug => tug.s < tug.path.length);

    this.stepAircraft(dt);
    this.stepWorkers(dt);
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
    for (const move of this.movements) move.advance(dt * hurry);
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

  stepWorkers(dt) {
    const total = clamp(this.capacity.handlers, 0, 12);
    while (this.workers.length < total) {
      const index = this.workers.length;
      this.workers.push({x: layout.crew.x + (index % 6) * .85, z: layout.crew.z + Math.floor(index / 6) * .9, busy: false});
    }
    this.workers.length = total;
    const active = [...this.jobs.values()].filter(job => job.status === 'MOVING');
    this.workers.forEach((worker, index) => {
      const job = active[index];
      let tx = layout.crew.x + (index % 6) * .85, tz = layout.crew.z + Math.floor(index / 6) * .9;
      if (job) {
        const stop = servicePoint(job.stand, job.side);
        tx = stop.x - 1.05; tz = stop.z + job.side * .2;
      }
      worker.busy = Boolean(job);
      const dx = tx - worker.x, dz = tz - worker.z, gap = Math.hypot(dx, dz);
      const move = Math.min(gap, dt * 8);
      if (gap > .01) { worker.x += dx / gap * move; worker.z += dz / gap * move; }
      worker.walking = gap > .05;
    });
  }

  // ---- derived poses for the renderer -------------------------------------------
  // Where an active order's container is, given how far its work has progressed.
  jobPose(job) {
    const stop = servicePoint(job.stand, job.side);
    const travel = clamp(job.shown / .45, 0, 1);
    const tug = job.path.at(job.path.length * smooth(travel));
    const transfer = smooth((job.shown - .45) / .13);
    const load = smooth((job.shown - .62) / .36);
    const cos = Math.cos(tug.heading), sin = Math.sin(tug.heading);
    const dolly = {x: tug.x - 1.3 * cos, z: tug.z - 1.3 * sin};
    const container = {
      x: dolly.x + (stop.x - dolly.x) * transfer,
      y: .5 + .78 * smooth((job.shown - .52) / .1),
      z: dolly.z + (stop.z - dolly.z) * transfer - job.side * .77 * load,
      heading: tug.heading * (1 - transfer),
      scale: 1 - .55 * smooth((load - .55) / .45),
    };
    return {tug, dolly, container, stop, lift: container.y - .5, phase: travel < 1 ? 'tow' : load > 0 ? 'load' : 'lift'};
  }

  aircraftPoses() {
    const poses = [];
    for (const stand of this.stands) {
      if (stand.aircraft === 'parked' || (stand.aircraft === 'outbound' && !this.movements.some(m => m.stand === stand))) {
        poses.push({stand, pose: {x: stand.x, y: 0, z: stand.z, heading: Math.PI, pitch: 0, bank: 0, gear: 1}});
      }
    }
    for (const move of this.movements) poses.push({stand: move.stand, pose: move.pose(), moving: true});
    return poses;
  }
}

window.RelayGroundOps = {GroundOps, layout, makePath, slotPosition, servicePoint, tugStop};
})();
