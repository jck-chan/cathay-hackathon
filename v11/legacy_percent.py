"""Recover the missing *cost denominators* of v10's 21-tick benchmark.

Do not conflate this legacy censored-window result with v11 full-cohort
Poisson+drain benchmark. The algorithm is deliberately identical to v10.
"""
import random,statistics
from relay.state import project
from unified_lab import safe_job, select_tasks, new_policy
from v11.benchmark import SCENARIOS


def legacy_cost_percent(lab,episodes=500,seed=707):
    out=[]
    for label,rate,h,c,st in [('normal',2.,3,1,3),('peak',4.,3,1,3),
                              ('crew_shortage',3.,1,1,3),('cold_outage',3.,3,0,3),
                              ('high_capacity',3.,5,2,5)]:
        templates=[safe_job(s,lab.store.clock()) for s in lab._pool(project(lab.store,lab.store.clock()))]
        rng=random.Random(seed);base_cost=[];relay_cost=[]
        base_misses=relay_misses=0
        for run in range(episodes):
            policies={'fcfs':new_policy(),'relay':new_policy()}
            for t in range(1,22):
                arrivals=max(0,int(rng.gauss(rate,1.05)))
                jobs=[]
                for i in range(arrivals):
                    j=dict(templates[rng.randrange(len(templates))]);j['id']=f'{run}-{t}-{i}'
                    j['admit_tick']=t;j['deadline_tick']=t+rng.randrange(3,14)
                    jobs.append(j)
                for p in policies.values():p['waiting'].extend([dict(j) for j in jobs])
                for name,p in policies.items():
                    for a in p['active']:a['remaining']-=1
                    active=[]
                    for a in p['active']:
                        if a['remaining']>0:active.append(a);continue
                        j=a['job'];p['completed'].append(j['id']);p['cost']+=j['duration']*1.5
                        if t>j['deadline_tick']:
                            p['missed']+=1;p['cost']+=(t-j['deadline_tick'])*3*j['priority']
                    p['active']=active
                    p['cost']+=sum(.35*j['priority'] for j in p['waiting'])
                    chosen,_=select_tasks(p['waiting'],p['active'],t,handlers=h,stands=st,cold_bays=c,policy=name)
                    ids={x['id'] for x in chosen}
                    p['waiting']=[j for j in p['waiting'] if j['id'] not in ids]
                    p['active'] += [{'job':j,'duration':j['duration'],'remaining':j['duration']} for j in chosen]
            base_cost.append(policies['fcfs']['cost'])
            relay_cost.append(policies['relay']['cost'])
            base_misses+=policies['fcfs']['missed'];relay_misses+=policies['relay']['missed']
        b=statistics.fmean(base_cost);r=statistics.fmean(relay_cost)
        out.append({'scenario':label,'baseline_mean_cost_units':round(b,4),
                    'relay_mean_cost_units':round(r,4),
                    'saved_cost_units':round(b-r,4),'saved_cost_pct':round(100*(b-r)/b,3),
                    'baseline_misses_recorded':base_misses,'relay_misses_recorded':relay_misses,
                    'recorded_misses_reduction_pct':round(100*(base_misses-relay_misses)/base_misses,3) if base_misses else None})
    return {'episodes_per_scenario':episodes,'seed':seed,'results':out,
            'scope':'EXACT_V10_CLIPPED_GAUSSIAN_21_TICK_BENCHMARK; UNFINISHED_WORK_CENSORED',
            'quality_warning':'Cost % uses incomplete-window ledger and is not a real-world estimate.'}
