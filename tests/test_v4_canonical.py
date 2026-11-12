"""Compare the original staging selector against an exhaustive oracle."""
import itertools
import random

from unified_lab import select_tasks


def test_queue_selection_matches_bruteforce_objective_on_small_instances():
    rng=random.Random(123)
    for _ in range(200):
        jobs=[];tick=rng.randrange(2,15)
        for i in range(rng.randrange(0,8)):
            jobs.append({'id':str(i),'admit_tick':rng.randrange(0,tick),
              'deadline_tick':rng.randrange(tick-3,tick+8),'duration':rng.randrange(1,5),
              'priority':rng.randrange(1,4),'cold':bool(rng.randrange(2)),
              'network_at_risk':bool(rng.randrange(2)),
              'blocked_reason':'CUSTOMS_HOLD' if rng.randrange(7)==0 else None})
        handlers=rng.randrange(1,4);cold=rng.randrange(0,4);stands=rng.randrange(1,4)
        selected,meta=select_tasks(jobs,[],tick,handlers,stands,cold,policy='relay')
        def obj(items):
            return sum(5*j['priority']+12*max(0,3-(j['deadline_tick']-tick-j['duration']))+
              .75*(tick-j['admit_tick'])+4*int(j['network_at_risk']) for j in items)
        eligible=[j for j in jobs if j['blocked_reason'] is None]
        brute=max((obj(combo) for n in range(len(eligible)+1) for combo in itertools.combinations(eligible,n)
                   if len(combo)<=min(handlers,stands) and sum(j['cold'] for j in combo)<=cold),default=0)
        assert abs(obj(selected)-brute)<1e-9
        assert sum(j['cold'] for j in selected)<=cold
        assert all(j['blocked_reason'] is None for j in selected)
