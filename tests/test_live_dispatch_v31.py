"""Regressions for transient missing-MILP-incumbent crashes on live events.

For the special live queue the dispatch is provably exact by enumerating the
number of cold shipments: no MILP timeouts, no unsafe over-allocation.
"""
from __future__ import annotations
import itertools
import math
import time
import numpy as np
from live_sim import LiveCargoWorld


def score(job,tick):
    return (6.*job['priority'] + 18.*max(0,3-(job['deadline']-tick))
            + 2.2*(tick-job['arrival']) + 4.*int(job['cold']) + 2.*int(job['check']))


def make_job(i,cold=False,arr=0,deadline=4,priority=1,check=False):
    return {'id':f'JOB-{i:04d}', 'arrival':arr, 'deadline':deadline,
            'priority':priority, 'cold':cold, 'check':check}


def test_zero_cold_capacity_is_a_valid_hold_not_a_crash():
    w=LiveCargoWorld(seed=9,cold_bays=0)
    cold_jobs=[make_job(i,cold=True) for i in range(10)]
    selected,meta=w._relay(cold_jobs,{'handlers':2,'stands':2,'cold':0})
    assert selected==[] and meta['objective']==0
    assert meta['status']=='NO_ELIGIBLE_CAPACITY'


def test_partial_resource_scarcity_selects_general_without_violating_cold():
    w=LiveCargoWorld(seed=9,cold_bays=0)
    jobs=[make_job(i,cold=(i%2==0),priority=1+i%3) for i in range(20)]
    selected,meta=w._relay(jobs,{'handlers':3,'stands':2,'cold':0})
    assert len(selected)==2 and all(not j['cold'] for j in selected)
    assert meta['gap']==0


def test_200_small_random_instances_match_full_bruteforce_optimum():
    w=LiveCargoWorld(seed=9)
    rng=np.random.default_rng(713)
    for _ in range(200):
        n=int(rng.integers(0,12))
        w.tick=int(rng.integers(1,40))
        jobs=[make_job(i,cold=bool(rng.integers(0,2)),
                       arr=max(0,w.tick-int(rng.integers(0,12))),
                       deadline=w.tick+int(rng.integers(-3,8)),
                       priority=int(rng.integers(1,4)),
                       check=bool(rng.integers(0,2))) for i in range(n)]
        avail={k:int(rng.integers(0,5)) for k in ('handlers','stands','cold')}
        selected,meta=w._relay(jobs,avail)
        k=min(avail['handlers'],avail['stands'])
        assert len(selected)<=k
        assert sum(j['cold'] for j in selected)<=avail['cold']
        oracle=-math.inf
        for mask in itertools.product((0,1),repeat=n):
            included=[j for j,b in zip(jobs,mask) if b]
            if len(included)<=k and sum(j['cold'] for j in included)<=avail['cold']:
                oracle=max(oracle,sum(score(j,w.tick) for j in included))
        assert math.isclose(sum(score(j,w.tick) for j in selected),oracle,abs_tol=1e-7)
        assert math.isclose(meta['objective'],oracle,abs_tol=1e-7)


def test_stress_repeated_high_arrival_events_no_solver_failure():
    w=LiveCargoWorld(seed=42,arrivals=5,chaos=1,handlers=1,stands=1,cold_bays=0)
    for _ in range(45):
        snap=w.step(12)
        assert snap['policies']['relay']['solver_status'] in {
            'OPTIMAL_EXACT_DISPATCH','NO_ELIGIBLE_CAPACITY','RESOURCE_BLOCKED','IDLE'}
    assert snap['tick']==540
    assert snap['generated']>1000
    assert snap['policies']['relay']['waiting']>0
    assert snap['policies']['relay']['active']<=1


def test_deterministic_replay_across_fresh_worlds():
    opts=dict(seed=12345,arrivals=5,chaos=.8,handlers=2,stands=2,cold_bays=1)
    a,b=LiveCargoWorld(**opts),LiveCargoWorld(**opts)
    for _ in range(7):
        x,y=a.step(12),b.step(12)
        assert x['policies']['relay']['selected']==y['policies']['relay']['selected']
        assert x['policies']['relay']['cost']==y['policies']['relay']['cost']
    assert x['generated']==y['generated']
