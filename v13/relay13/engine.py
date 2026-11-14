"""RELAY v13 synthetic event-sourced cargo decision engine.

Ported from the RELAY v17 research engine (Models I-III of the v13 papers) and
re-shaped for a live apron: flights rotate through a configurable number of stands,
each flight is flown by an aircraft type with its own cargo policy, the clock ticks in
1-minute steps and the priority ranking is recomputed every 5 simulated minutes.

Boundaries (unchanged from the papers): research simulator only. Not certified
aircraft loading, not Cathay inventory or SOP, not measured human performance.
All probabilities, cognitive parameters and economic units are hypothetical.
Standard library only.
"""
from __future__ import annotations

import hashlib
import math
import random
from dataclasses import asdict, dataclass, field

from .aircraft import AIRCRAFT_TYPES, CATEGORY_NAMES, CATS, REGIONAL, ROUTES, AirportConfig, type_refusal

DT = 1             # simulated minutes per engine tick
RANK_EVERY = 5     # ranking refresh period, simulated minutes
START_CLOCK = 7 * 60 + 30  # the world opens at 07:30 on day 1
LAND_TO_STAND = 24  # touchdown -> on stand (rollout + taxi-in), simulated minutes
CLEAR_AFTER_DEPARTURE = 32  # pushback -> airborne and out of view
# The world holds a demand pool POOL x the base booking rate. A live `demand` knob admits the
# fraction demand/POOL of it (by a fixed per-shipment draw), so cargo rate can change mid-run.
POOL = 3.0
DEMAND_RANGE = (0.2, 3.0)

ROLES = ('novice_manual', 'novice_assisted', 'expert_manual', 'expert_assisted')
ROLE_LABELS = {'novice_manual': 'New operator · Manual', 'novice_assisted': 'New operator · RELAY',
               'expert_manual': 'Senior operator · Manual', 'expert_assisted': 'Senior operator · RELAY'}
# MODEL ASSUMPTIONS ONLY. No measurements of actual human operators.
PARAM = {
    'novice_manual':   dict(error=.115, delay=12.0, noise=.55, foresight=.20, admit_buffer=-2.0, assist=False),
    'novice_assisted': dict(error=.026, delay=3.2, noise=.055, foresight=.86, admit_buffer=1.0, assist=True),
    'expert_manual':   dict(error=.022, delay=4.3, noise=.10, foresight=.72, admit_buffer=.6, assist=False),
    'expert_assisted': dict(error=.012, delay=2.1, noise=.025, foresight=.95, admit_buffer=1.4, assist=True),
}
TIERS = {'PR1': 155.0, 'PR2': 72.0, 'PR3': 27.0}
SPECIAL = ('PHARMA', 'AVI', 'DG')
SCENARIOS = {
    'normal': .28, 'peak_burst': .12, 'thunderstorm': .09, 'flight_cancel': .07,
    'crew_shortage': .075, 'equipment_breakdown': .075, 'documentation_hold': .075,
    'cold_chain_alarm': .05, 'dangerous_goods_hold': .04, 'animal_welfare_hold': .04,
    'system_outage': .045, 'compound_cascade': .10,
}
STATE_NAMES = ('not-admitted', 'pre-arrival', 'inbound-line', 'staged', 'handling', 'ready-uplift',
               'flown', 'exception', 'rejected', 'unserved')
ACTIONABLE = (2, 3)  # the user may drag from the inbound line or the accumulation area


def hhmm(t: int) -> str:
    m = int(t) % 1440
    return f'{m // 60:02d}:{m % 60:02d}'


@dataclass
class Flight:
    id: str; number: str; route: str; stand: int; type: str
    land: int; on_stand: int; scheduled: int; departure: int; cutoff: int
    slots: int; kg: int; categories: tuple; status: str = 'scheduled'


@dataclass
class Shipment:
    id: str; category: str; tier: str; route: str; kg: int; offer: int; arrival: int
    ready: int; handle: int; booked: int; quote: bool; price: float; cold_end: int


@dataclass
class Incident:
    occurs: int; received: int; type: str; flight: int = -1; delta: int = 0; category: str = ''; cause: str = ''


@dataclass
class World:
    seed: int; days: int; load: float; scenario: str
    flights: list; cargo: list; incidents: list
    config: AirportConfig = field(default_factory=AirportConfig)
    start: int = START_CLOCK

    @property
    def staging(self): return self.config.staging
    @property
    def outside_limit(self): return self.config.outside_limit
    @property
    def exception_limit(self): return self.config.exception_limit
    @property
    def workers(self): return self.config.workers
    @property
    def specialists(self): return self.config.specialists


def rand01(seed, ident, key):
    raw = hashlib.blake2s(f'{seed}:{ident}:{key}'.encode(), digest_size=8).digest()
    return (int.from_bytes(raw, 'big') + .5) / 2 ** 64


def weighted(rng, items):
    tot = sum(items.values()); u = rng.random() * tot
    for k, v in items.items():
        u -= v
        if u <= 0:
            return k
    return next(iter(items))


def generate(seed: int, days: int = 3, load: float = 1., scenario: str = 'mixed',
             config: AirportConfig | None = None) -> World:
    cfg = config or AirportConfig()
    if not 1 <= days <= 30 or not .2 <= load <= 3. or not 1 <= cfg.stands <= 12:
        raise ValueError('out of bounds')
    rng = random.Random(seed * 17041 + 1009)
    if scenario == 'random':
        scenario = weighted(rng, SCENARIOS)
    if scenario not in SCENARIOS and scenario != 'mixed':
        raise ValueError('unknown scenario')
    start = START_CLOCK; horizon = days * 1440
    types = {t.code: t.weight for t in cfg.types()}
    route_weights = {r: (1.6 if k < 6 else 1.) for k, r in enumerate(ROUTES)}

    # ---- stand rotations ------------------------------------------------------------
    raw = []
    for s in range(cfg.stands):
        dep = start + 40 + s * 37 + rng.randint(0, 25)
        on_stand = min(start - 15, dep - rng.randint(*cfg.turnaround_min))
        while dep < horizon + 720:
            code = weighted(rng, types); t = AIRCRAFT_TYPES[code]
            pool = {r: w for r, w in route_weights.items() if t.hold == 'ULD' or r in REGIONAL}
            route = weighted(rng, pool)
            slots = max(2, t.uld_positions - rng.choice((0, 0, 1, 2)))
            kg = int(t.payload_kg * rng.uniform(.82, 1.))
            raw.append(dict(route=route, stand=s, type=code, land=on_stand - LAND_TO_STAND, on_stand=on_stand,
                            scheduled=dep, departure=dep, cutoff=dep - cfg.cutoff_before_departure,
                            slots=slots, kg=kg, categories=t.categories))
            on_stand = dep + rng.randint(*cfg.stand_gap_min)
            dep = on_stand + rng.randint(*cfg.turnaround_min)
    raw.sort(key=lambda f: f['departure'])
    numbers = rng.sample(range(200, 999), len(raw)) if len(raw) < 799 else list(range(len(raw)))
    flights = [Flight(f'CX{n:03d}-{f["departure"] // 1440 + 1}', f'CX {n:03d}', **f)
               for n, f in zip(numbers, raw)]

    # ---- shipments, booked onto their flights ------------------------------------------
    cargo = []; used_ids = set()
    day_case = {d: (weighted(rng, SCENARIOS) if scenario == 'mixed' else scenario) for d in range(days + 1)}
    for j, f in enumerate(flights):
        if f.departure < start + 25 or f.departure > horizon + 600:
            continue
        case = day_case[min(days, f.departure // 1440)]
        t = AIRCRAFT_TYPES[f.type]
        mean = cfg.shipments_per_flight * POOL * (f.slots / 11) ** .5
        if case in ('peak_burst', 'compound_cascade'):
            mean *= 1.22
        n = max(1, round(rng.gauss(mean, 1.6)))
        for _ in range(n):
            cat = weighted(rng, {c: w for c, w in zip(CATS, (.53, .18, .11, .065, .055, .06)) if c in f.categories})
            tier = weighted(rng, {'PR1': .13, 'PR2': .34, 'PR3': .53})
            quote = rng.random() < .24
            if quote and tier == 'PR1':
                tier = 'PR2'
            doc = rng.randint(8, 34) + (rng.randint(10, 31) if cat in SPECIAL else 0)
            if case == 'documentation_hold' and rng.random() < .32:
                doc += rng.randint(60, 180)
            if case in ('dangerous_goods_hold', 'animal_welfare_hold', 'cold_chain_alarm') and cat in SPECIAL and rng.random() < .5:
                doc += rng.randint(60, 150)
            handle = rng.randint(19, 37) + (10 if cat in SPECIAL else 0)
            slack = rng.choice([rng.randint(12, 70), rng.randint(40, 160), rng.randint(120, 260)])
            arrival = f.cutoff - handle - doc - slack
            arrival = max(arrival, f.on_stand - 300)
            if case in ('thunderstorm', 'compound_cascade') and rng.random() < .2:
                arrival += rng.randint(25, 80)
            offer = max(start - 400, arrival - rng.randint(80, 240)) if quote else arrival
            price = round(14.0 + (18 if tier == 'PR2' else 7) + (13 if cat in SPECIAL else 0), 2) if quote else 0.
            ready = arrival + doc
            cold_end = (ready + rng.randint(210, 400)) if cat in ('PHARMA', 'FRESH', 'AVI') else 10 ** 10
            kg = rng.randint(50, min(500, t.max_piece_kg))
            while True:
                sid = f'160-{rng.randint(1000, 9999)}{rng.randint(1000, 9999)}'
                if sid not in used_ids:
                    used_ids.add(sid); break
            cargo.append(Shipment(sid, cat, tier, f.route, kg, offer, arrival, ready, handle, j, quote, price, cold_end))

    # ---- incidents per simulated day ----------------------------------------------------
    incidents = []

    def pick(after):
        for k, f in enumerate(flights):
            if f.departure >= after:
                return k
        return len(flights) - 1

    for d in range(days):
        case = day_case[d]; t0 = d * 1440

        def incident(m, kind, flight=-1, delta=0, category='', lag=12, cause=''):
            incidents.append(Incident(t0 + m, t0 + m + lag, kind, flight, delta, category, cause))
        if case in ('thunderstorm', 'compound_cascade'):
            incident(560, 'flight_delay', pick(t0 + 640), rng.randint(40, 110), lag=12, cause='thunderstorm cell over the field')
            incident(575, 'crew_down', delta=1, lag=5, cause='lightning alert stops ramp work')
            incident(700, 'crew_up', delta=1, lag=6)
        if case in ('flight_cancel', 'compound_cascade'):
            incident(610, 'cancel', pick(t0 + 760), lag=20, cause='aircraft technical fault')
            incident(690, 'recovery_authorized', pick(t0 + 760), lag=15)
        if case in ('crew_shortage', 'compound_cascade'):
            incident(545, 'crew_down', delta=1, lag=7, cause='team off sick')
            incident(835, 'crew_up', delta=1, lag=7)
        if case in ('equipment_breakdown', 'compound_cascade'):
            incident(520, 'specialist_down', delta=1, lag=10, cause='specialist loader breakdown')
            incident(760, 'specialist_up', delta=1, lag=8)
        if case in ('cold_chain_alarm', 'compound_cascade'):
            incident(590, 'category_hold', category='PHARMA', lag=10, cause='cold-room temperature alarm')
            incident(720, 'category_clear', category='PHARMA', lag=10)
        if case == 'animal_welfare_hold':
            incident(600, 'category_hold', category='AVI', lag=8, cause='animal welfare inspection')
            incident(735, 'category_clear', category='AVI', lag=6)
        if case == 'dangerous_goods_hold':
            incident(560, 'category_hold', category='DG', lag=8, cause='DG paperwork audit')
            incident(760, 'category_clear', category='DG', lag=8)
        if case == 'system_outage':
            incident(620, 'feed_down', lag=0, cause='booking feed outage')
            incident(760, 'feed_up', lag=0)
        if case in ('compound_cascade', 'equipment_breakdown'):
            incident(650, 'cap_cut', pick(t0 + 720), delta=2, lag=15, cause='extra passenger bags')
    incidents.sort(key=lambda e: (e.occurs, e.type))
    return World(seed, days, load, scenario, flights, cargo, incidents, cfg, start)


def snake_dp(deltas):
    """Exact independent-nonadjacent switch dynamic program; NOT general cargo Laurent proof."""
    n = len(deltas); dp = [0.] * (n + 1); take = [False] * (n + 1)
    for k, v in enumerate(deltas, 1):
        skip = dp[k - 1]; sel = v + (dp[k - 2] if k > 1 else 0.)
        if sel < skip:
            dp[k] = sel; take[k] = True
        else:
            dp[k] = skip
    choices = []; k = n
    while k:
        if take[k]:
            choices.append(k - 1); k -= 2
        else:
            k -= 1
    return dp[n], choices[::-1]


def exact_subset(values, max_count: int, special_cap: int, max_candidates=9):
    """Exact bounded additive value subset (up to 9 candidates), honoring worker/specialist limits."""
    values = values[:max_candidates]; best = (-float('inf'), [])
    for mask in range(1 << len(values)):
        if mask.bit_count() > max_count:
            continue
        if sum(bool(mask & (1 << j)) and values[j][2] for j in range(len(values))) > special_cap:
            continue
        score = sum(values[j][1] for j in range(len(values)) if mask & (1 << j))
        if score > best[0]:
            best = (score, [values[j][0] for j in range(len(values)) if mask & (1 << j)])
    return best


def intensity(tier: str, slack: int) -> str:
    if slack <= 20 or (tier == 'PR1' and slack <= 45):
        return 'critical'
    if slack <= 60 or tier == 'PR1':
        return 'high'
    if slack <= 150:
        return 'medium'
    return 'low'


LIVE = frozenset((1, 2, 3, 4, 5, 7))


class StateVec(list):
    """Shipment states with O(1) per-state counts and the live (non-terminal) index set."""

    def __init__(self, n):
        super().__init__([0] * n); self.ct = [0] * 10; self.ct[0] = n; self.live = set()

    def __setitem__(self, i, v):
        old = list.__getitem__(self, i)
        if old == v:
            return
        self.ct[old] -= 1; self.ct[v] += 1
        if v in LIVE: self.live.add(i)
        else: self.live.discard(i)
        list.__setitem__(self, i, v)

    def alive(self):
        return sorted(self.live)


class Simulation:
    """All UI manual actions and autopilot policies mutate this exact shared state machine."""

    def __init__(self, world: World, role: str = 'novice_assisted', trace: bool = True):
        if role not in ROLES:
            raise ValueError('unknown role')
        self.w = world; self.cfg = world.config; self.role = role; self.p = PARAM[role]
        self.t = world.start; self.trace = trace
        self.flights = [Flight(**asdict(f)) for f in world.flights]
        self.s = world.cargo; self.n = len(self.s)
        self.index = {s.id: i for i, s in enumerate(self.s)}
        self.findex = {f.id: j for j, f in enumerate(self.flights)}
        # 0 not admitted, 1 accepted pre-arrival, 2 inbound line, 3 staged, 4 handling,
        # 5 ready-uplift, 6 flown, 7 exception, 8 rejected, 9 unserved
        self.state = StateVec(self.n)
        self.cold = [s.cold_end for s in self.s]  # per-run copy: re-conditioning resets it
        self.target = [s.booked for s in self.s]; self.assigned = [-1] * self.n
        self.work_end = [10 ** 9] * self.n; self.exc_ready = [10 ** 9] * self.n; self.exc_started = [-1] * self.n
        self.reservations = [set() for _ in self.flights]
        self.flight_departed = set(); self.flight_landed = set(); self.flight_cancelled = set()
        self.crew_loss = 0; self.specialist_loss = 0; self.holds = set(); self.seen_holds = set(); self.obs_cancel = set()
        self.feed_down = False; self.obs_feed_down = False; self.obs_slots = [f.slots for f in self.flights]
        self.flights_obs_delay = {}; self.cert_recoveries = set()
        self.admitted = 0; self.rejected = 0; self.quote_offered = 0; self.quote_served = 0; self.errors = 0; self.blocked = 0
        self.decision_minutes = 0.; self.decision_count = 0; self.cognitive_sum = 0.; self.reworks = 0
        self.unserved = 0; self.net_quote_value = 0.; self.recoveries = 0; self.manual_loads = 0
        self.arrivals_order = sorted(range(self.n), key=lambda i: self.s[i].arrival)
        self.offers_order = sorted(range(self.n), key=lambda i: self.s[i].offer)
        self.actual_events = sorted(world.incidents, key=lambda e: e.occurs)
        self.received_events = sorted(world.incidents, key=lambda e: e.received)
        self.ai = self.oi = self.ea = self.er = 0
        self.backlog_area = self.stage_area = self.external_area = self.exception_area = 0.
        self.red_zone_time = 0; self.red_seq = 0; self.first_red = -1; self.peak_q = 0
        self.timeline = []; self.events = []; self.event_seq = 0; self.history = []
        self.safety_hold_until = {}; self.staging_full = False; self.in_red = False
        self.ranking = []; self.rank_of = {}; self.rank_t = -1
        self.horizon = world.days * 1440; self.wlo = 0
        self.demand = min(DEMAND_RANGE[1], max(DEMAND_RANGE[0], world.load)); self.skipped = set()
        for j, f in enumerate(self.flights):  # aircraft already parked at the start
            if f.land <= self.t:
                self.flight_landed.add(j)
        self._event_flow()  # admit cargo already on the line / in staging at opening
        self._refresh_ranking()

    # ---- helpers -------------------------------------------------------------------------
    def window(self):
        """Flights that can land, park or depart soon (list is sorted by scheduled departure)."""
        while self.wlo < len(self.flights) and self.wlo in self.flight_departed and self.flights[self.wlo].departure + 60 < self.t:
            self.wlo += 1
        return range(self.wlo, min(len(self.flights), self.wlo + 4 * self.cfg.stands + 6))

    def counts(self):
        ct = self.state.ct
        stage = ct[3] + ct[4] + ct[5]
        return {'prearrival': ct[1], 'outside': ct[2], 'staging': stage, 'exceptions': ct[7],
                'flown': ct[6], 'unserved': ct[9], 'rejected': ct[8], 'backlog': ct[2] + stage + ct[7],
                'waiting': ct[3], 'handling': ct[4], 'ready': ct[5]}

    def log(self, kind, title, detail='', actor='system', refs=None):
        if not self.trace:
            return
        self.event_seq += 1
        self.events.append({'id': self.event_seq, 't': self.t, 'clock': hhmm(self.t), 'kind': kind,
                            'title': title, 'detail': detail, 'actor': actor, 'refs': refs or []})
        if len(self.events) > 600:
            self.events = self.events[-400:]

    def fname(self, j):
        f = self.flights[j]; return f'{f.number}'

    def flight_free(self, j):
        f = self.flights[j]; ids = self.reservations[j]
        return f.slots - len(ids), f.kg - sum(self.s[i].kg for i in ids)

    def worker_free(self):
        running = [i for i in self.state.live if self.state[i] == 4]
        return (max(0, self.w.workers - self.crew_loss - len(running)),
                max(0, self.w.specialists - self.specialist_loss - sum(self.s[i].category in SPECIAL for i in running)))

    def _penalty(self):
        return self.p['delay'] * (1. + min(1.8, self.counts()['backlog'] / max(1, self.w.staging) * .25))

    # ---- Model I: certified feasible action ----------------------------------------------
    def check(self, i, j):
        """Return (ok, code, human message). Order puts the most informative reason first."""
        if i < 0 or i >= self.n or j < 0 or j >= len(self.flights):
            return False, 'UNKNOWN_OBJECT', 'Unknown shipment or aircraft'
        s = self.s[i]; f = self.flights[j]; t = AIRCRAFT_TYPES[f.type]
        if self.state[i] not in ACTIONABLE:
            return False, 'NOT_ACTIONABLE', f'{s.id} is {STATE_NAMES[self.state[i]]} and cannot be re-planned now'
        if j in self.flight_departed or f.departure <= self.t:
            return False, 'CANCELLED_OR_DEPARTED', f'{f.number} has already left the stand'
        if f.status == 'cancelled':
            return False, 'CANCELLED_OR_DEPARTED', f'{f.number} is cancelled'
        if f.on_stand > self.t:
            return False, 'AIRCRAFT_NOT_ON_STAND', f'{f.number} is not on stand yet'
        refusal = type_refusal(t, s.category, s.kg)
        if refusal:
            return False, refusal[0], refusal[1]
        if s.route != f.route:
            return False, 'ROUTE_MISMATCH', f'{s.id} is bound for {s.route} ({ROUTES[s.route]}); {f.number} flies to {f.route}'
        if j != self.target[i]:
            return False, 'FLIGHT_NOT_AUTHORIZED', (f'{s.id} is booked on {self.fname(self.target[i])}; '
                                                    f'moving a confirmed booking needs carrier authorisation')
        if self.t < s.ready:
            return False, 'DOCUMENT_OR_ACCEPTANCE_NOT_READY', f'Acceptance checks still running — documents ready at {hhmm(s.ready)}'
        if s.category in self.holds:
            return False, 'MANDATORY_CATEGORY_HOLD', f'All {CATEGORY_NAMES[s.category].lower()} are on a mandatory hold'
        free, kg = self.flight_free(j)
        if free <= 0:
            return False, 'FLIGHT_CAPACITY_LIMIT', f'{f.number} has no ULD positions left ({f.slots}/{f.slots} used)'
        if kg < s.kg:
            return False, 'FLIGHT_CAPACITY_LIMIT', f'{f.number} payload limit: needs {s.kg} kg, only {max(0, kg)} kg left'
        wf, sf = self.worker_free()
        if wf <= 0:
            return False, 'HANDLING_RESOURCE_UNAVAILABLE', 'Every handling team is busy — wait for one to free up'
        if s.category in SPECIAL and sf <= 0:
            return False, 'HANDLING_RESOURCE_UNAVAILABLE', f'No specialist handler free for {CATEGORY_NAMES[s.category].lower()}'
        need = DT * math.ceil((s.handle + self._penalty()) / DT)
        if self.t + need > f.cutoff:
            return False, 'CUTOFF_CANNOT_BE_MET', f'Handling takes {need} min but {f.number} closes at {hhmm(f.cutoff)}'
        if self.t > self.cold[i]:
            return False, 'MODELLED_SPECIAL_CARGO_TIME_LIMIT', 'Temperature/welfare time limit has expired'
        return True, 'OK', f'{s.id} can be loaded on {f.number}'

    def actually_feasible(self, i, j):
        ok, code, _ = self.check(i, j); return ok, code

    def request(self, cargo_id, flight_id, actor='operator'):
        i = self.index.get(cargo_id, -1); j = self.findex.get(flight_id, -1)
        ok, code, msg = self.check(i, j)
        if not ok:
            self.blocked += 1
            if actor != 'assist':
                self.log('rejected', f'Drop refused: {cargo_id} → {self.fname(j) if j >= 0 else flight_id}', msg, actor,
                         [cargo_id, flight_id])
            return {'ok': False, 'reason': code, 'message': msg}
        s = self.s[i]; f = self.flights[j]
        from_line = self.state[i] == 2
        self.state[i] = 4; self.assigned[i] = j
        penalty = self._penalty()
        self.work_end[i] = self.t + DT * math.ceil((s.handle + penalty) / DT)
        self.reservations[j].add(i)
        self.decision_minutes += penalty; self.decision_count += 1
        if actor != 'assist':
            self.manual_loads += 1
        via = ' straight from the inbound line' if from_line else ''
        self.log('assigned', f'{s.id} → {f.number} ({f.route})',
                 f'{CATEGORY_NAMES[s.category]} · {s.tier} · {s.kg} kg{via}; loaded by {hhmm(self.work_end[i])}',
                 actor, [s.id, f.id])
        return {'ok': True, 'reason': 'RESERVED_FOR_HANDLING', 'message': f'Loading onto {f.number}, done by {hhmm(self.work_end[i])}',
                'eta': self.work_end[i]}

    def revoke(self, cargo_id, actor='operator'):
        i = self.index.get(cargo_id, -1)
        if i < 0:
            return {'ok': False, 'reason': 'UNKNOWN_CARGO', 'message': 'Unknown shipment'}
        if self.state[i] not in (4, 5):
            return {'ok': False, 'reason': 'NOT_REVERSIBLE_FROM_CURRENT_STATE', 'message': 'Only assigned cargo can be offloaded'}
        j = self.assigned[i]
        if j in self.flight_departed or self.flights[j].status == 'cancelled':
            return {'ok': False, 'reason': 'EXECUTION_ALREADY_IRREVERSIBLE', 'message': 'Aircraft already gone'}
        self.reservations[j].discard(i); self.assigned[i] = -1; self.state[i] = 3; self.reworks += 1
        self.log('offload', f'{cargo_id} offloaded from {self.fname(j)}', 'Back in staging; rework cost recorded', actor, [cargo_id])
        return {'ok': True, 'reason': 'RELEASED_FOR_REPLANNING', 'message': 'Returned to staging'}

    # ---- events ----------------------------------------------------------------------------
    def _shift_stand(self, j):
        """A late departure holds the next arrival for the same stand."""
        f = self.flights[j]
        for k in range(j + 1, len(self.flights)):
            g = self.flights[k]
            if g.stand != f.stand or k in self.flight_landed:
                continue
            need = f.departure + 18
            if g.on_stand < need:
                shift = need - g.on_stand
                g.on_stand += shift; g.land += shift
                if g.departure < g.on_stand + 70:
                    g.departure = g.on_stand + 70; g.cutoff = g.departure - self.cfg.cutoff_before_departure
            break

    def _incident(self, e, observed):
        if not observed:
            if e.type == 'crew_down': self.crew_loss += e.delta
            elif e.type == 'crew_up': self.crew_loss = max(0, self.crew_loss - e.delta)
            elif e.type == 'specialist_down': self.specialist_loss += e.delta
            elif e.type == 'specialist_up': self.specialist_loss = max(0, self.specialist_loss - e.delta)
            elif e.type == 'category_hold': self.holds.add(e.category)
            elif e.type == 'category_clear': self.holds.discard(e.category)
            elif e.type == 'cancel':
                self.flights[e.flight].status = 'cancelled'; self.flight_cancelled.add(e.flight)
            elif e.type == 'flight_delay':
                f = self.flights[e.flight]; f.departure += e.delta; f.cutoff += e.delta; self._shift_stand(e.flight)
            elif e.type == 'cap_cut':
                old = self.flights[e.flight]; new = max(1, old.slots - e.delta)
                if len(self.reservations[e.flight]) > new:
                    excess = len(self.reservations[e.flight]) - new
                    for i in sorted(self.reservations[e.flight], reverse=True)[:excess]:
                        self._recover(i, f'{old.number} capacity cut')
                old.slots = new
            elif e.type == 'feed_down': self.feed_down = True
            elif e.type == 'feed_up': self.feed_down = False
            return
        cause = f' — {e.cause}' if e.cause else ''
        if e.type == 'category_hold':
            self.seen_holds.add(e.category)
            self.log('hold', f'Mandatory hold on {CATEGORY_NAMES[e.category].lower()}', f'No {e.category} may be released{cause}')
        elif e.type == 'category_clear':
            self.seen_holds.discard(e.category)
            self.log('clear', f'Hold lifted on {CATEGORY_NAMES[e.category].lower()}', f'{e.category} can move again')
        elif e.type == 'cancel':
            self.obs_cancel.add(e.flight); f = self.flights[e.flight]
            self.log('cancel', f'{f.number} to {ROUTES[f.route]} cancelled', f'Booked cargo goes to the exception desk{cause}', refs=[f.id])
        elif e.type == 'recovery_authorized':
            self.cert_recoveries.add(e.flight); f = self.flights[e.flight]
            self.log('recovery', f'Recovery authorised for {f.number}', f'Its cargo may use later CX flights to {f.route}', refs=[f.id])
        elif e.type == 'flight_delay':
            self.flights_obs_delay[e.flight] = self.flights_obs_delay.get(e.flight, 0) + e.delta; f = self.flights[e.flight]
            self.log('delay', f'{f.number} delayed {e.delta} min', f'New departure {hhmm(f.departure)}{cause}', refs=[f.id])
        elif e.type == 'cap_cut':
            self.obs_slots[e.flight] = self.flights[e.flight].slots; f = self.flights[e.flight]
            self.log('capacity', f'{f.number} lost {e.delta} ULD positions', f'Now {f.slots} positions{cause}', refs=[f.id])
        elif e.type == 'feed_down':
            self.obs_feed_down = True; self.log('outage', 'Booking feed down', f'New spot quotes paused{cause}')
        elif e.type == 'feed_up':
            self.obs_feed_down = False; self.log('clear', 'Booking feed restored', 'Spot quotes resume')
        elif e.type in ('crew_down', 'specialist_down'):
            who = 'handling team' if e.type == 'crew_down' else 'specialist handler'
            self.log('crew', f'One {who} unavailable', f'Throughput drops{cause}')
        elif e.type in ('crew_up', 'specialist_up'):
            who = 'Handling team' if e.type == 'crew_up' else 'Specialist handler'
            self.log('clear', f'{who} back on shift', 'Throughput restored')

    def _choose_quotes(self):
        accepted = []
        while self.oi < self.n and self.s[self.offers_order[self.oi]].offer <= self.t:
            i = self.offers_order[self.oi]; self.oi += 1; s = self.s[i]
            if rand01(self.w.seed, s.id, 'demand') >= self.demand / POOL:
                self.skipped.add(i); continue  # outside the current cargo rate: never booked
            if not s.quote:
                self.state[i] = 1; self.admitted += 1; continue
            self.quote_offered += 1; f = self.flights[s.booked]
            count = sum(self.target[k] == s.booked for k in self.state.live)
            headroom = self.obs_slots[s.booked] - count
            pressure = self.counts()['backlog'] / max(1, self.w.staging)
            buffer = self.p['admit_buffer'] + (1.4 if pressure > 1 else 0)
            feasible = s.ready + s.handle + 22 < f.cutoff
            accept = headroom >= buffer and (feasible or self.role == 'novice_manual') and (pressure < 1.5 or not self.p['assist'])
            if self.role == 'novice_manual' and headroom >= -3:
                accept = True
            if self.obs_feed_down and self.p['assist']:
                accept = False
            if accept:
                self.state[i] = 1; self.admitted += 1; accepted.append(s)
            else:
                self.state[i] = 8; self.rejected += 1
        if accepted and self.t > self.w.start:
            s = accepted[0]
            more = f' (+{len(accepted) - 1} more)' if len(accepted) > 1 else ''
            self.log('quote', f'Spot sale accepted: {s.id}{more}', f'{CATEGORY_NAMES[s.category]} · {s.tier} for {self.fname(s.booked)}',
                     refs=[x.id for x in accepted])

    def _recover(self, i, reason, quiet=False):
        if self.state[i] in (6, 8, 9):
            return
        j = self.assigned[i]
        if j >= 0:
            self.reservations[j].discard(i); self.assigned[i] = -1
        self.state[i] = 7; self.exc_started[i] = self.t if self.exc_started[i] < 0 else self.exc_started[i]
        self.exc_ready[i] = self.t + 45; self.recoveries += 1
        if not quiet:
            self.log('exception', f'{self.s[i].id} sent to exception desk', reason, refs=[self.s[i].id])

    def _event_flow(self):
        while self.ea < len(self.actual_events) and self.actual_events[self.ea].occurs <= self.t:
            self._incident(self.actual_events[self.ea], False); self.ea += 1
        while self.er < len(self.received_events) and self.received_events[self.er].received <= self.t:
            self._incident(self.received_events[self.er], True); self.er += 1
        self._choose_quotes()
        arrived = []
        while self.ai < self.n and self.s[self.arrivals_order[self.ai]].arrival <= self.t:
            i = self.arrivals_order[self.ai]; self.ai += 1
            if self.state[i] == 1:
                self.state[i] = 2; arrived.append(i)
        if arrived and self.t > self.w.start:
            ids = [self.s[i].id for i in arrived]
            urgent = [self.s[i] for i in arrived if self.s[i].tier == 'PR1']
            extra = f' · {len(urgent)} PR1' if urgent else ''
            self.log('arrival', f'{len(ids)} shipment{"s" if len(ids) > 1 else ""} on the inbound line',
                     ', '.join(ids[:3]) + ('…' if len(ids) > 3 else '') + extra, refs=ids)
        for j in self.window():
            f = self.flights[j]
            if j not in self.flight_landed and f.land <= self.t:
                self.flight_landed.add(j)
                tp = AIRCRAFT_TYPES[f.type]
                self.log('landing', f'{f.number} landed — taxiing to Stand {f.stand + 1}',
                         f'{tp.name}; next departure to {ROUTES[f.route]} at {hhmm(f.departure)}', refs=[f.id])
        for i in self.state.alive():
            if self.state[i] == 4 and self.work_end[i] <= self.t:
                self.state[i] = 5
            if self.state[i] in (2, 3, 4, 5) and (self.target[i] in self.flight_departed or self.target[i] in self.obs_cancel):
                self._recover(i, f'{self.fname(self.target[i])} is no longer available')
            elif self.state[i] in (2, 3) and self.t > self.cold[i]:
                # Synthetic proxy: re-conditioning (re-icing, vet/temperature check) before it may fly.
                self.cold[i] = self.t + 240
                self._recover(i, 'temperature/welfare time limit reached — re-conditioning required')
        for j in self.window():
            f = self.flights[j]
            if j in self.flight_departed or f.departure > self.t:
                continue
            self.flight_departed.add(j); f.status = 'departed' if f.status != 'cancelled' else 'cancelled'
            flown = []; missed = []
            for i in self.state.alive():
                if self.target[i] != j or self.state[i] in (0, 1, 6, 8, 9, 7):
                    continue
                if self.state[i] == 5 and self.assigned[i] == j and f.status == 'departed':
                    self.state[i] = 6; self.reservations[j].discard(i); flown.append(i)
                    if self.s[i].quote:
                        self.quote_served += 1; self.net_quote_value += self.s[i].price
                else:
                    self._recover(i, f'missed {f.number}', quiet=True); missed.append(i)
            if f.status == 'departed':
                kg = sum(self.s[i].kg for i in flown)
                self.log('departure', f'{f.number} departed for {ROUTES[f.route]}',
                         f'{len(flown)} shipment{"s" if len(flown) != 1 else ""} · {kg} kg uplifted', refs=[f.id])
            if missed:
                self.log('missed', f'{len(missed)} shipment{"s" if len(missed) > 1 else ""} missed {f.number}',
                         ', '.join(self.s[i].id for i in missed[:3]) + (' …' if len(missed) > 3 else '') + ' → exception desk',
                         refs=[self.s[i].id for i in missed])
        for i in self.state.alive():
            s = self.s[i]
            if self.state[i] != 7:
                continue
            if self.t - self.exc_started[i] > 2 * 1440:
                self.state[i] = 9; self.unserved += 1
                self.log('unserved', f'{s.id} closed unserved', 'No authorised CX option within 48 h', refs=[s.id]); continue
            if self.t < self.exc_ready[i]:
                continue
            permitted = (s.booked in self.cert_recoveries or (self.t - self.exc_started[i]) > 180)
            if not permitted:
                continue
            poss = [j for j, f in enumerate(self.flights) if j > s.booked and f.route == s.route and s.category in f.categories
                    and s.kg <= AIRCRAFT_TYPES[f.type].max_piece_kg and f.status == 'scheduled'
                    and f.cutoff > self.t + s.handle + 15 and j not in self.flight_departed]
            if poss:
                self.target[i] = poss[0]; self.state[i] = 2
                self.log('rebooked', f'{s.id} rebooked on {self.fname(poss[0])}', f'Next authorised CX service to {s.route}', refs=[s.id])
            else:
                self.exc_ready[i] = self.t + 45
        free = self.w.staging - self.counts()['staging']
        if free > 0:
            candidates = [i for i in self.state.alive() if self.state[i] == 2 and self.s[i].arrival <= self.t]
            candidates.sort(key=lambda i: (self.s[i].tier != 'PR1', self.s[i].arrival))
            for i in candidates[:free]:
                self.state[i] = 3
        ct = self.counts()
        full = ct['staging'] >= self.w.staging and ct['outside'] > 0
        if full and not self.staging_full:
            self.log('staging', 'Accumulation area full', f'{ct["outside"]} shipment(s) queuing on the inbound line')
        self.staging_full = full

    # ---- Model II: time-aware priority ---------------------------------------------------
    def priority(self, i):
        s = self.s[i]; j = self.target[i]; f = self.flights[j]; q = self.counts()
        slack = f.cutoff - self.t - s.handle
        base = TIERS[s.tier] + (12 if s.category in SPECIAL else 0)
        temporal = 105 / (max(0, slack) + 15)
        cold = 40 * max(0, 1 - (self.cold[i] - self.t) / 120) if self.cold[i] < 10 ** 9 else 0
        score = (base + 140 * temporal + min(80, max(0, self.t - s.arrival) * .10) + cold
                 + 28 * q['outside'] / max(1, self.w.outside_limit)) / (s.handle + 7) ** .24
        if slack < 0:
            score *= .35   # cannot make cutoff any more: escalate, don't spend the next team on it
        if self.t < s.ready:
            score *= .85   # not yet actionable
        flags = []
        if self.t < s.ready: flags.append('docs')
        if s.category in self.seen_holds: flags.append('hold')
        if slack < 0: flags.append('late')
        if self.state[i] == 2: flags.append('line')
        return score, slack, flags

    def _refresh_ranking(self):
        prev = self.rank_of; rows = []
        for i in self.state.alive():
            if self.state[i] not in ACTIONABLE:
                continue
            score, slack, flags = self.priority(i)
            rows.append((score, i, slack, flags))
        rows.sort(key=lambda r: ('late' in r[3], -r[0]))  # feasible work first, then escalations
        self.rank_of = {}; self.ranking = []
        for r, (score, i, slack, flags) in enumerate(rows, 1):
            s = self.s[i]; f = self.flights[self.target[i]]
            self.rank_of[s.id] = r
            self.ranking.append({'cargo': s.id, 'rank': r, 'prev': prev.get(s.id), 'score': round(score, 1),
                                 'intensity': intensity(s.tier, slack), 'slack': slack, 'flags': flags,
                                 'flight': f.id, 'flight_no': f.number, 'stand': f.stand + 1, 'tier': s.tier,
                                 'category': s.category, 'kg': s.kg, 'route': s.route})
        self.rank_t = self.t

    # ---- autopilot (Model III bounded exact subset) ------------------------------------------
    def _decision_candidates(self):
        results = []; q = self.counts(); pressure = q['backlog'] / max(1, self.w.staging)
        recent = sum(0 <= self.t - e.received <= 65 for e in self.received_events[:self.er])
        density = sum(0 <= self.flights[j].cutoff - self.t <= 120 and self.flights[j].status == 'scheduled' for j in self.window())
        fatigue = (self.t % 1440) / 1440
        cognitive = min(2.2, .43 * min(2, pressure) + .27 * min(2, density / 2) + .20 * min(2, recent / 2) + .10 * fatigue)
        for i in self.state.alive():
            s = self.s[i]
            if self.state[i] != 3 or self.t < s.ready or self.t < self.safety_hold_until.get(i, 0) or s.category in self.seen_holds:
                continue
            j = self.target[i]; f = self.flights[j]
            if j in self.obs_cancel or j in self.flight_departed or f.on_stand > self.t:
                continue
            if self.t + s.handle > f.cutoff:
                continue
            base = TIERS[s.tier] + (12 if s.category in SPECIAL else 0)
            slack = max(0, f.cutoff - self.t - s.handle); temporal = 105 / (slack + 15)
            if self.role == 'novice_manual':
                score = 18 + max(0, self.t - s.arrival) * .32 + base * .25 + temporal * 10
            elif self.role == 'expert_manual':
                score = (base * .87 + 95 * temporal + min(100, max(0, self.t - s.arrival) * .16)) / (s.handle + 10) ** .23
            else:
                score = (base + 140 * temporal + min(80, max(0, self.t - s.arrival) * .10)
                         + 28 * q['outside'] / max(1, self.w.outside_limit)) / (s.handle + 7) ** .24
            score += (rand01(self.w.seed, s.id, self.role + '-policy') - .5) * self.p['noise'] * 115
            results.append((score, i, j))
        results.sort(reverse=True)
        return results, cognitive

    def _dispatch(self):
        free, special = self.worker_free()
        if free <= 0:
            return
        candidates, cognitive = self._decision_candidates()
        if not candidates:
            return
        chosen = candidates[:]
        if self.p['assist'] and len(candidates) > 1:
            vals = [(i, max(0, score), self.s[i].category in SPECIAL) for score, i, j in candidates[:9]]
            _, inds = exact_subset(vals, free, special); ids = set(inds)
            chosen = [c for c in candidates if c[1] in ids] + [c for c in candidates if c[1] not in ids]
        for score, i, j in chosen:
            if free <= 0:
                break
            s = self.s[i]
            if s.category in SPECIAL and special <= 0:
                continue
            self.cognitive_sum += cognitive
            threshold = self.p['error'] * (1 + .75 * cognitive) / 15  # per-minute hazard (v17 was per 15-min epoch)
            mistake = rand01(self.w.seed, s.id, f'decision-{self.t}') < threshold
            if mistake:
                self.errors += 1; self.reworks += 1; self.decision_count += 1
                dt = self.p['delay'] * (1 + cognitive); self.decision_minutes += dt
                self.safety_hold_until[i] = self.t + math.ceil(dt + 23 + 12 * cognitive)
                self.log('error', f'{s.id} needs a re-check', 'Paperwork mismatch caught by the guard; no unsafe load', 'assist', [s.id])
                if self.role == 'novice_manual':
                    free = max(0, free - 1)
                continue
            ok, _ = self.actually_feasible(i, j)
            if not ok:
                self.blocked += 1; continue
            self.request(s.id, self.flights[j].id, actor='assist')
            free -= 1
            if s.category in SPECIAL:
                special -= 1

    # ---- clock -----------------------------------------------------------------------------
    def set_demand(self, x):
        self.demand = min(DEMAND_RANGE[1], max(DEMAND_RANGE[0], float(x)))
        self.log('staging', f'Cargo rate set to {self.demand:.2g}×', 'Applies to bookings offered from now on', 'operator')

    @property
    def done(self):
        return self.t > self.horizon

    def step(self, auto=False):
        if self.done:
            return
        self._event_flow()
        if auto:
            self._dispatch()
        ct = self.counts(); q = ct['backlog']; self.peak_q = max(self.peak_q, q)
        self.backlog_area += q * DT; self.stage_area += ct['staging'] * DT
        self.external_area += ct['outside'] * DT; self.exception_area += ct['exceptions'] * DT
        saturated = ct['outside'] >= self.w.outside_limit or ct['exceptions'] >= self.w.exception_limit
        if saturated:
            self.red_zone_time += DT; self.red_seq += DT
            if self.red_seq >= 60 and self.first_red < 0:
                self.first_red = self.t
        else:
            self.red_seq = 0
        red = self.red_seq >= 60
        if red and not self.in_red:
            self.log('redzone', 'Red zone: queues saturated for 60 min', f'{ct["outside"]} on the line, {ct["exceptions"]} in exceptions')
        self.in_red = red
        if self.t % RANK_EVERY == 0:
            if self.trace:  # offline studies don't display the ranking
                self._refresh_ranking()
            self.history.append({'t': self.t, 'staging': ct['staging'], 'outside': ct['outside'], 'exceptions': ct['exceptions']})
            if len(self.history) > 96:
                self.history = self.history[-96:]
        for j in self.window():
            f = self.flights[j]
            if len(self.reservations[j]) > f.slots or sum(self.s[i].kg for i in self.reservations[j]) > f.kg:
                raise AssertionError('flight capacity invariant')
        if ct['staging'] > self.w.staging:
            raise AssertionError('staging invariant')
        self.t += DT

    def run(self, auto=True):
        while not self.done:
            self.step(auto)
        return self.summary()

    # ---- outputs --------------------------------------------------------------------------
    def summary(self):
        horizon = self.horizon
        due = [i for i, s in enumerate(self.s) if not s.quote and i not in self.skipped and self.state[i] != 0
               and self.flights[s.booked].scheduled <= horizon]
        good = [i for i in due if self.state[i] == 6 and self.assigned[i] == self.s[i].booked]
        goodset = set(good)
        tier_miss = sum(TIERS[self.s[i].tier] for i in due if i not in goodset)
        pr1_due = [i for i in due if self.s[i].tier == 'PR1']
        error_cost = self.errors * 27 + self.reworks * 14
        hold_cost = .005 * self.stage_area + .012 * self.external_area + .021 * self.exception_area
        loss = tier_miss + error_cost + hold_cost + self.unserved * 140
        count = self.counts(); open_count = len(self.state.live)
        conservation = self.admitted == count['flown'] + open_count + self.unserved
        if not conservation:
            raise AssertionError('shipment conservation invariant')
        return {'role': self.role, 'seed': self.w.seed, 'load': self.w.load, 'scenario': self.w.scenario, 'days': self.w.days,
                'due_confirmed': len(due), 'original_fulfilled': len(good), 'original_uplift_rate': len(good) / max(1, len(due)),
                'pr1_due': len(pr1_due), 'pr1_misses': sum(i not in goodset for i in pr1_due),
                'quote_offered': self.quote_offered, 'quote_flown': self.quote_served, 'admitted': self.admitted,
                'flown': count['flown'], 'open_cases': open_count, 'unserved': self.unserved,
                'peak_backlog': self.peak_q, 'red_zone_minutes': self.red_zone_time, 'errors': self.errors,
                'reworks': self.reworks, 'guard_blocked': self.blocked, 'manual_loads': self.manual_loads,
                'loss_units': loss, 'net_margin_units': self.net_quote_value - loss, 'conservation': int(conservation)}

    def flight_view(self, j):
        f = self.flights[j]; tp = AIRCRAFT_TYPES[f.type]; free, kg = self.flight_free(j)
        # only what the operator has *received* is shown: an unreported cancellation still looks scheduled
        status = 'cancelled' if j in self.obs_cancel else ('scheduled' if f.status == 'cancelled' else f.status)
        return {'id': f.id, 'number': f.number, 'route': f.route, 'city': ROUTES[f.route], 'stand': f.stand,
                'type': f.type, 'type_name': tp.name, 'model': tp.model, 'length_m': tp.length_m, 'span_m': tp.span_m,
                'hold': tp.hold, 'max_piece_kg': tp.max_piece_kg, 'categories': list(tp.categories),
                'land': f.land, 'on_stand': f.on_stand, 'cutoff': f.cutoff, 'departure': f.departure,
                'scheduled': f.scheduled, 'delay': f.departure - f.scheduled, 'status': status,
                'slots': self.obs_slots[j], 'used': len(self.reservations[j]), 'kg': f.kg, 'kg_left': kg,
                'booked': sum(1 for i in self.state.live if self.target[i] == j and self.state[i] != 7)}

    def snapshot(self, since: int = 0):
        t = self.t; ct = self.counts()
        flights = [self.flight_view(j) for j in range(max(0, self.wlo - 2 * self.cfg.stands), len(self.flights))
                   if self.flights[j].land - 8 <= t <= self.flights[j].departure + CLEAR_AFTER_DEPARTURE
                   and self.flights[j].land < t + 300]
        cargo = []
        for i in self.state.alive():
            s = self.s[i]; st = self.state[i]
            if st not in (2, 3, 4, 5, 7):
                continue
            f = self.flights[self.target[i]]
            r = self.rank_of.get(s.id)
            slack = f.cutoff - t - s.handle
            cargo.append({'id': s.id, 'category': s.category, 'tier': s.tier, 'route': s.route, 'kg': s.kg, 'state': st,
                          'target': f.id, 'target_no': f.number, 'stand': f.stand + 1, 'cutoff': f.cutoff,
                          'arrival': s.arrival, 'ready': s.ready, 'docs_ready': t >= s.ready, 'handling': s.handle,
                          'eta': self.work_end[i] if st == 4 else None, 'assigned': self.flights[self.assigned[i]].id if self.assigned[i] >= 0 else None,
                          'quote': s.quote, 'hold': s.category in self.seen_holds, 'rank': r, 'slack': slack,
                          'intensity': intensity(s.tier, slack)})
        wf, sf = self.worker_free()
        return {'t': t, 'clock': hhmm(t), 'day': t // 1440 + 1, 'start': self.w.start, 'horizon': self.horizon, 'done': self.done,
                'stands': self.cfg.stands, 'role': self.role, 'demand': self.demand, 'demand_range': DEMAND_RANGE, 'scenario': self.w.scenario, 'seed': self.w.seed,
                'counts': ct, 'flights': flights, 'cargo': cargo,
                'staging': {'capacity': self.w.staging, 'used': ct['staging'], 'waiting': ct['waiting'], 'handling': ct['handling'],
                            'ready': ct['ready'], 'outside': ct['outside'], 'outside_limit': self.w.outside_limit,
                            'exceptions': ct['exceptions'], 'pressure': round(100 * ct['backlog'] / max(1, self.w.staging)),
                            'avg_used': round(self.stage_area / max(1, self.t - self.w.start), 1),
                            'avg_pct': round(100 * self.stage_area / max(1, self.t - self.w.start) / self.w.staging),
                            'red_zone': self.in_red, 'workers_free': wf, 'workers': max(0, self.w.workers - self.crew_loss),
                            'specialists_free': sf, 'holds': sorted(self.seen_holds), 'history': self.history[-48:]},
                'ranking': self.ranking[:14], 'ranked_total': len(self.ranking), 'rank_t': self.rank_t, 'rank_every': RANK_EVERY,
                'events': [e for e in self.events if e['id'] > since][-60:], 'event_seq': self.event_seq,
                'kpis': {'uplifted': ct['flown'], 'sales': self.quote_served, 'errors': self.errors, 'unserved': self.unserved,
                         'blocked': self.blocked, 'manual_loads': self.manual_loads, 'red_minutes': self.red_zone_time,
                         'revenue': round(self.net_quote_value, 1)}}


def compare(world: World):
    return {r: Simulation(world, r, trace=False).run(True) for r in ROLES}
