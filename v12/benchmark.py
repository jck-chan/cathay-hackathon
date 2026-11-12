"""Five-way paired benchmark; same v11 arrival/penalty semantics.
Run with python -m v12.benchmark (default 100 episodes/scenario).
"""
from __future__ import annotations
from pathlib import Path
import argparse, json, csv, time
from v12.policies import POLICIES,LABELS
from v11.benchmark import SCENARIOS, _record_inputs
from v7_product import V7Lab
from relay.state import project
from unified_lab import safe_job
import numpy as np

# Reuse a verbatim copy of v11's cohort accounting and only replace dispatch
# routing to experimental selectors; assertions below regression-test parity.
from v12.runner import run_episode

def run(episodes=100,seed=9099,scenarios=None):
    if not 1<=episodes<=1000:raise ValueError('episodes must be 1..1000')
    lab=V7Lab(seed=2048)
    try:
        st=project(lab.store,lab.store.clock())
        templates=[safe_job(s,st['as_of']) for s in lab._pool(st)]
        templates=[j for j in templates if j['blocked_reason'] is None]
    finally:lab._tmp.cleanup()
    records=[];episode_records=[]
    allscenarios=list(scenarios or SCENARIOS)
    for name in allscenarios:
        if name not in SCENARIOS:raise ValueError('unknown scenario')
        cfg=SCENARIOS[name]
        # Stable seed per scenario independent of subset / invocation order.
        scenario_index=list(SCENARIOS).index(name)
        rng=np.random.default_rng(seed+scenario_index*10007)
        rows=[]
        for ix in range(episodes):
            jobs=_record_inputs(rng,templates,cfg,ix,24)
            result=run_episode(jobs,cfg,policies=POLICIES)
            rows.append(result)
            for policy,out in result['policies'].items():
                episode_records.append({'scenario':name,'seed':seed,'episode':ix,
                    'policy':policy,'admitted':result['admitted'],
                    'cost':round(out['cost'],5),'on_time_pct':round(100*out['on_time_rate'],5),
                    'completed':result['admitted']-out['outstanding'],
                    'outstanding':out['outstanding'],
                    'unsafe':out['unsafe_assignments']})
        baseline=np.array([r['policies']['FCFS']['cost'] for r in rows])
        for policy in POLICIES:
            costs=np.array([r['policies'][policy]['cost'] for r in rows])
            ontimes=np.array([r['policies'][policy]['on_time_rate'] for r in rows])
            base=baseline.mean()
            records.append({'scenario':name,'policy':policy,'label':LABELS[policy],
             'episodes':episodes,'seed':seed,'cost_mean':round(float(costs.mean()),4),
             'cost_reduction_pct':round(100*float((base-costs.mean())/base),4) if base else 0.,
             'on_time_pct':round(float(100*ontimes.mean()),4),
             'worse_than_fcfs_pct':round(float(100*np.mean(costs>baseline)),4),
             'cv90':round(float(np.mean(np.sort(costs)[-max(1,int(np.ceil(len(costs)*.1))):])),4),
             'unsafe_assignments':sum(r['policies'][policy]['unsafe_assignments'] for r in rows),
             'status':'SYNTHETIC_STAGING_ONLY'})
    return {'version':'12.0','scope':'SYNTHETIC_STAGING_NOT_AIRLINE_ROI',
            'policies':LABELS,'scenarios':allscenarios,'seed':seed,
            'episodes_per_scenario':episodes,'results':records,
            'episodes':episode_records}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--episodes',type=int,default=100)
    ap.add_argument('--seed',type=int,default=9099)
    ap.add_argument('--output',type=str,default='reports/v12_validation')
    args=ap.parse_args()
    t=time.perf_counter();out=run(args.episodes,args.seed)
    p=Path(args.output);p.parent.mkdir(parents=True,exist_ok=True)
    with (p.with_suffix('.json')).open('w') as f:json.dump({k:v for k,v in out.items() if k!='episodes'},f,indent=2)
    for name,rows in [('summary',out['results']),('episodes',out['episodes'])]:
        if rows:
            with (p.parent/(p.name+'_'+name+'.csv')).open('w',newline='') as f:
                writer=csv.DictWriter(f,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
    print('Five-strategy benchmark:',len(out['results']),'policy-scenarios,',len(out['episodes']),'policy episodes;',round(time.perf_counter()-t,1),'s')
