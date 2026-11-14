"""Paired evidence study: the same synthetic worlds replayed by the four operator roles.

Each seed generates one world; all four roles (new/senior operator x manual/RELAY-assisted) run it
with identical exogenous arrivals, incidents and flights, so differences are attributable to the
decision policy (paired design, as in the v13 papers). Results are cached per parameter set.
"""
from __future__ import annotations

import math
import statistics
import threading
from concurrent.futures import ProcessPoolExecutor

from .aircraft import AirportConfig
from .engine import ROLE_LABELS, ROLES, Simulation, generate

METRICS = {
    'original_uplift_rate': ('On booked flight', '%', 'higher'),
    'pr1_misses': ('PR1 (First) misses', 'shipments', 'lower'),
    'unserved': ('Closed unserved', 'shipments', 'lower'),
    'peak_backlog': ('Peak backlog', 'shipments', 'lower'),
    'red_zone_minutes': ('Red-zone time', 'min', 'lower'),
    'errors': ('Operator errors caught', 'count', 'lower'),
    'loss_units': ('Modelled loss', 'units', 'lower'),
    'avg_staging_pct': ('Avg staging use', '%', 'context'),
}
_cache: dict = {}
_lock = threading.Lock()


def _one(args):
    seed, days, scenario, demand, stands = args
    w = generate(seed, days=days, load=demand, scenario=scenario, config=AirportConfig(stands=stands))
    out = {}
    for role in ROLES:
        sim = Simulation(w, role, trace=False)
        hist = []
        while not sim.done:
            sim.step(True)
            if sim.t % 15 == 0:
                c = sim.counts(); hist.append([sim.t, c['backlog'], c['staging'], c['outside'], c['exceptions']])
        s = sim.summary()
        s['avg_staging_pct'] = 100 * sim.stage_area / max(1, sim.horizon - w.start) / w.staging
        s['original_uplift_rate'] *= 100
        out[role] = {'summary': {k: s[k] for k in METRICS} | {'due_confirmed': s['due_confirmed'], 'flown': s['flown']},
                     'timeline': hist}
    return seed, out


def _ci(xs):
    m = statistics.fmean(xs)
    if len(xs) < 2:
        return m, 0.0
    return m, 1.96 * statistics.stdev(xs) / math.sqrt(len(xs))


def run(seeds=6, days=1, scenario='mixed', demand=1.0, stands=5, base_seed=1300):
    key = (seeds, days, scenario, round(demand, 2), stands, base_seed)
    with _lock:
        if key in _cache:
            return _cache[key]
    jobs = [(base_seed + k, days, scenario, demand, stands) for k in range(seeds)]
    try:
        with ProcessPoolExecutor(max_workers=min(4, seeds)) as ex:
            results = dict(ex.map(_one, jobs))
    except (OSError, RuntimeError):  # no process support (e.g. restricted sandbox): run inline
        results = dict(map(_one, jobs))
    per_seed = [{'seed': s, 'role': r, **results[s][r]['summary']} for s in sorted(results) for r in ROLES]
    aggregate = {}
    for metric in METRICS:
        aggregate[metric] = {}
        for r in ROLES:
            m, h = _ci([results[s][r]['summary'][metric] for s in results])
            aggregate[metric][r] = {'mean': m, 'ci95': h}
    paired = []
    for base, assisted, who in (('novice_manual', 'novice_assisted', 'New operator'), ('expert_manual', 'expert_assisted', 'Senior operator')):
        for metric in METRICS:
            diffs = [results[s][assisted]['summary'][metric] - results[s][base]['summary'][metric] for s in results]
            m, h = _ci(diffs)
            wins = sum((d > 0) if METRICS[metric][2] == 'higher' else (d < 0) for d in diffs)
            paired.append({'who': who, 'metric': metric, 'mean_diff': m, 'ci95': h, 'better_in': wins, 'n': len(diffs)})
    first = min(results)
    res = {
        'params': {'seeds': seeds, 'days': days, 'scenario': scenario, 'cargo_rate': demand, 'stands': stands,
                   'seed_range': [base_seed, base_seed + seeds - 1]},
        'roles': {r: ROLE_LABELS[r] for r in ROLES}, 'metrics': {k: {'label': v[0], 'unit': v[1], 'better': v[2]} for k, v in METRICS.items()},
        'aggregate': aggregate, 'paired': paired, 'per_seed': per_seed,
        'timeline': {'seed': first, 'columns': ['t', 'backlog', 'staging', 'outside', 'exceptions'],
                     'roles': {r: results[first][r]['timeline'] for r in ROLES}},
        'notes': ['Synthetic worlds and hypothetical operator parameters (v13 papers, Models I-III); not measured Cathay '
                  'performance.', 'Paired design: every role replays the identical world per seed.',
                  '95% CI = mean ± 1.96·s/√n across seeds.'],
    }
    with _lock:
        _cache[key] = res
    return res
