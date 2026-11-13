"""Frozen independent exploratory selectors used by the v12 staging-only arena.

These are NOT Graver/mutation solvers, LLM agents, or 3-paper joint control.
Inputs are observable work-order features at the current tick only. Hard safety
and cold-resource guards match the original v11 benchmark selector.
"""
import math
from typing import Literal
from unified_lab import select_tasks
from v11.benchmark import select_v11

LABELS = {
 'FCFS': 'FCFS',
 'RELAY_V10': 'RELAY v10',
 'RELAY_V11': 'RELAY v11',
 'A_CRITICAL': 'RELAY + Model A',
 'A_EDF': 'RELAY + EDF',
}
DispatchModel = Literal['FCFS', 'RELAY_V10', 'RELAY_V11', 'A_CRITICAL', 'A_EDF']
POLICIES = tuple(LABELS)


def select_hybrid(waiting, active, tick, handlers, stands, cold_bays, variant):
    if variant not in ('CRITICAL','EDF'):
        raise ValueError('unsupported hybrid selector')
    free=max(0,min(handlers,stands)-len(active))
    cold_free=max(0,cold_bays-sum(int(a['job']['cold']) for a in active))
    if free<=0:return [],{'status':'NO_CAPACITY'}
    if free==1:return select_v11(waiting,active,tick,handlers,stands,cold_bays)
    eligible=[j for j in waiting if j.get('blocked_reason') is None]
    if not eligible:return [],{'status':'NO_ELIGIBLE_WORK'}
    def score(j):
        age=max(0,tick-j['admit_tick']);duration=max(1,j['duration'])
        slack=j['deadline_tick']-(tick+duration)
        if variant=='EDF':
            value=(25*int(slack>=0)+25*int(0<=slack<=2)
                 +30*j['priority']/(1+max(0,slack))+3*min(age,10)
                 +6*min(5,max(0,-slack))+45*int(j.get('recovery_pending',False)))
            return value/duration**.65
        value=(20*int(slack>=0)+30*int(0<=slack<=2)+13*j['priority']
               +1.1*age+5*min(5,max(0,-slack))+60*int(j.get('recovery_pending',False)))
        return value/duration**.6
    pools={}
    for is_cold in (False,True):
        ranked=sorted(((score(j),j) for j in eligible if bool(j['cold'])==is_cold),
                      key=lambda x:(-x[0],x[1]['admit_tick'],x[1]['id']))
        pools[is_cold]=ranked[:free]
    ordinary=pools[False];cold=pools[True]
    gp=[0.];cp=[0.]
    for score_,_ in ordinary:gp.append(gp[-1]+score_)
    for score_,_ in cold:cp.append(cp[-1]+score_)
    best=(-math.inf,0,0)
    for nc in range(min(cold_free,free,len(cold))+1):
        ng=min(len(ordinary),free-nc)
        candidate=(cp[nc]+gp[ng],nc,ng)
        if candidate[0]>best[0]+1e-9:best=candidate
    chosen=[j for _,j in cold[:best[1]]]+[j for _,j in ordinary[:best[2]]]
    chosen.sort(key=lambda j:(j['admit_tick'],j['id']))
    assert all(j['blocked_reason'] is None for j in chosen)
    assert len(chosen)+len(active)<=min(handlers,stands)
    assert sum(int(j['cold']) for j in chosen)<=cold_free
    return chosen,{'status':'V12_TWO_CLASS_OBSERVABLE_HEURISTIC',
                   'variant':variant,'objective':best[0],
                   'scope':'CURRENT_TICK_NOT_GLOBAL_OPTIMUM'}


def select_policy(name,waiting,active,tick,handlers,stands,cold_bays):
    if name=='FCFS':return select_tasks(waiting,active,tick,handlers,stands,cold_bays,'fcfs')
    if name=='RELAY_V10':return select_tasks(waiting,active,tick,handlers,stands,cold_bays,'relay')
    if name=='RELAY_V11':return select_v11(waiting,active,tick,handlers,stands,cold_bays)
    if name=='A_CRITICAL':return select_hybrid(waiting,active,tick,handlers,stands,cold_bays,'CRITICAL')
    if name=='A_EDF':return select_hybrid(waiting,active,tick,handlers,stands,cold_bays,'EDF')
    raise ValueError('unknown policy')
