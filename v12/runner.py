"""Paired, auditable synthetic policy comparison.

NOT airline ROI, booking execution, or validation of a complete 3-model controller.
Each episode replays the SAME Poisson orders (and temporary outage) against all
policies, with censored backlog explicitly charged. No latent data used to rank jobs.
Metrics use explicit denominators. No holding cost or SLA is double counted.
"""
from __future__ import annotations
import math
import statistics
import time
from collections import defaultdict

import numpy as np

from unified_lab import select_tasks, safe_job
from v12.policies import select_policy
from relay.state import project

POLICIES = ('FCFS', 'RELAY_V10', 'RELAY_V11')
COST_DEFAULT = {'handling':1.5, 'waiting':.35, 'overdue_waiting':1.2,
                'tardiness':3.0, 'unresolved_base':40.0,
                'unresolved_overdue':3.0}
SCENARIOS = {
    'normal': {'arrival_rate': 2.0, 'handlers': 3, 'stands': 3, 'cold_bays': 1},
    'peak': {'arrival_rate': 4.0, 'handlers': 3, 'stands': 3, 'cold_bays': 1},
    'crew_shortage': {'arrival_rate': 3.0, 'handlers': 1, 'stands': 3, 'cold_bays': 1},
    'cold_outage': {'arrival_rate': 3.0, 'handlers': 3, 'stands': 3, 'cold_bays': 0},
    'high_capacity': {'arrival_rate': 3.0, 'handlers': 5, 'stands': 5, 'cold_bays': 2},
    'temporary_disruption': {'arrival_rate': 2.5, 'handlers': 3, 'stands': 3, 'cold_bays': 1,
                             'outage_from': 9, 'outage_to': 14},
}


def select_v11(waiting, active, tick, handlers, stands, cold_bays):
    """Exact single-tick maximum observable triage benefit, not horizon-global optimum.

    One-handler fallback to proven-feasible FCFS explicitly avoids the v10
    heuristic's observed pathological scarcity behavior. For more resources,
    a duration-normalized, due-date-aware benefit seeks throughput without
    sacrificing blocked-cargo or cold-bay hard guards.
    """
    slots = max(0, min(handlers, stands) - len(active))
    active_cold = sum(int(a['job']['cold']) for a in active)
    cold_free = max(0, cold_bays - active_cold)
    # Existing work is non-preemptive. A sudden resource outage can make
    # active_cold exceed the new capacity; forbid NEW cold allocations,
    # rather than crashing a live simulator on already-active work.
    if slots <= 1:
        chosen, meta = select_tasks(waiting, active, tick, handlers, stands, cold_bays, policy='fcfs')
        return chosen, {'status': 'V11_FEASIBLE_SINGLE_SERVER_FCFS', 'inner': meta['status'],
                        'scope': 'NO_RECLAIMED_BENEFIT_CLAIM'}
    eligible = [j for j in waiting if j.get('blocked_reason') is None]
    if not eligible:
        return [], {'status':'V11_NO_ELIGIBLE_WORK', 'scope':'SAFE_HOLD'}

    def benefit(job):
        # All terms are decision-epoch observable. No future realized delays.
        age = max(0, tick - job['admit_tick'])
        duration = max(1, job['duration'])
        slack = job['deadline_tick'] - (tick + duration)
        due_risk = max(0, 2-slack)
        return ((20.0 * int(slack >= 0) + 12.0 * int(0 <= slack <= 2)
                 + 6.0 * job['priority'] + 0.9 * age
                 + 5.0 * min(3, max(0, -slack))
                 + 4.0 * int(job.get('network_at_risk', False))
                 + 60.0 * int(job.get('recovery_pending', False)))
                / (duration ** .6))

    by_type = {}
    for cold in (False, True):
        items = [(benefit(j), j) for j in eligible if bool(j['cold']) == cold]
        items.sort(key=lambda x: (-x[0], x[1]['admit_tick'], x[1]['id']))
        by_type[cold] = items[:slots]
    normal = by_type[False]; cool = by_type[True]
    gp=[0.0];cp=[0.0]
    for s,_ in normal:gp.append(gp[-1]+s)
    for s,_ in cool:cp.append(cp[-1]+s)
    best = (-math.inf, 0, 0)
    for nc in range(min(cold_free, slots, len(cool))+1):
        ng=min(len(normal),slots-nc)
        value=cp[nc]+gp[ng]
        if value>best[0]+1e-9:best=(value,nc,ng)
    chosen=[j for _,j in cool[:best[1]]]+[j for _,j in normal[:best[2]]]
    chosen.sort(key=lambda j:(j['admit_tick'],j['id']))
    assert len(chosen)+len(active)<=min(handlers,stands)
    assert sum(int(j['cold']) for j in chosen) <= cold_free
    assert all(j['blocked_reason'] is None for j in chosen)
    return chosen, {'status':'V11_EXACT_SINGLE_TICK_TWO_CLASS_TRIAGE',
                    'objective':best[0], 'scope':'GREEDY_TIME_PRIORITY_PROXY_NOT_HORIZON_OPTIMAL'}


def _policy():
    return {'waiting':[], 'active':[], 'completion':{}, 'on_time':0,
            'cost':0., 'holding_cost':0., 'late_cost':0., 'handling_cost':0.,
            'unresolved_penalty':0.,'unsafe_assignments':0,'starts':0,
            'selected_times_s':[], 'restore_ids':None,'restored_clear_tick':None,
            'arrivals':0}


def run_episode(input_jobs, config, *, horizon=24, drain=110, policies=POLICIES, cost_weights=None):
    """Full-cohort outcome; follow arrivals through a bounded drainage window.

    `late` for outstanding records is measured against the *evaluation end*;
    a separate unresolved penalty ensures immovable cold work is not treated
    as free. Real airport service-rate/cost parameters are NOT calibrated.
    """
    weights={**COST_DEFAULT,**(cost_weights or {})}
    states={k:_policy() for k in policies}
    final_tick=horizon+drain
    known={job['id']:job for seq in input_jobs.values() for job in seq}
    outage_to=config.get('outage_to')
    for tick in range(1,final_tick+1):
        outage=config.get('outage_from',10)<=tick<=config.get('outage_to',0)
        handlers=max(1,config['handlers']-2) if outage else config['handlers']
        stands=max(1,config['stands']-1) if outage else config['stands']
        cold_bays=0 if outage else config['cold_bays']
        for name,p in states.items():
            if tick<=horizon:
                new=input_jobs.get(tick,[])
                p['waiting'].extend(dict(j) for j in new)
                p['arrivals']+=len(new)
            remaining=[]
            for a in p['active']:
                a['remaining']-=1
                if a['remaining']>0:
                    remaining.append(a)
                    continue
                j=a['job'];p['completion'][j['id']]=tick
                p['handling_cost']+=weights['handling']*j['duration']
                if tick<=j['deadline_tick']:p['on_time']+=1
                else:
                    late_cost=weights['tardiness']*j['priority']*(tick-j['deadline_tick'])
                    p['late_cost']+=late_cost
            p['active']=remaining
            for j in p['waiting']:
                waiting_cost=weights['waiting']*j['priority']
                if tick>j['deadline_tick']:
                    waiting_cost+=weights['overdue_waiting']*j['priority']
                p['holding_cost']+=waiting_cost
            t0=time.perf_counter()
            selected,_=select_policy(name,p['waiting'],p['active'],tick,handlers,stands,cold_bays)
            p['selected_times_s'].append(time.perf_counter()-t0)
            selected_ids={j['id'] for j in selected}
            p['waiting']=[j for j in p['waiting'] if j['id'] not in selected_ids]
            for j in selected:
                if j.get('blocked_reason'):
                    p['unsafe_assignments']+=1
                    raise AssertionError('blocked item scheduled')
                p['active'].append({'job':j, 'remaining':j['duration']})
                p['starts']+=1
            if outage_to is not None and tick==outage_to:
                p['restore_ids']={j['id'] for j in p['waiting']}.union(a['job']['id'] for a in p['active'])
                # Explicitly observable disruption backlog: marked at capacity restoration.
                # The label is not latent future knowledge or a fabricated flight event.
                for j in p['waiting']:j['recovery_pending']=True
                for a in p['active']:a['job']['recovery_pending']=True
            if p['restore_ids'] is not None and p['restored_clear_tick'] is None and tick>outage_to:
                n=len(p['restore_ids'])
                cleared=sum(jid in p['completion'] for jid in p['restore_ids'])
                if n==0 or cleared>=math.ceil(.90*n):p['restored_clear_tick']=tick-outage_to
        # Once ALL admitted work has completed for all policies, no need to idle.
        if tick>=horizon and all(len(p['completion'])==len(known) for p in states.values()):
            final_tick=tick
            break
    for p in states.values():
        outstanding=set(known)-set(p['completion'])
        p['unresolved_penalty']=sum(
            weights['unresolved_base']*known[k]['priority']+weights['unresolved_overdue']*known[k]['priority']*max(0,final_tick-known[k]['deadline_tick'])
            for k in outstanding)
        p['cost']=p['holding_cost']+p['handling_cost']+p['late_cost']+p['unresolved_penalty']
        p['outstanding']=len(outstanding)
        p['overdue_outstanding']=sum(final_tick>known[k]['deadline_tick'] for k in outstanding)
        p['missed_cohort']=len(known)-p['on_time']
        p['completion_rate']=len(p['completion'])/len(known) if known else 1.
        p['on_time_rate']=p['on_time']/len(known) if known else 1.
        # Restricted mean time from admission to completion: incomplete items
        # censored at the evaluation horizon, rather than disappearing from SLA.
        p['restricted_lead_ticks']=sum((p['completion'].get(jid,final_tick)-j['admit_tick'])
                                       for jid,j in known.items())/max(len(known),1)
        p['throughput_jobs_per_tick']=len(p['completion'])/max(final_tick,1)
        p['recovery_clear_ticks']=p['restored_clear_tick']
        p['mean_dispatch_selection_ms']=(1000*statistics.fmean(p['selected_times_s'])) if p['selected_times_s'] else 0
        p['p95_dispatch_selection_ms']=(1000*float(np.percentile(p['selected_times_s'],95))) if p['selected_times_s'] else 0
        del p['waiting'],p['active'],p['restore_ids'],p['restored_clear_tick'],p['selected_times_s']
        del p['completion']
    return {'policies':states,'evaluation_end_tick':final_tick,'admitted':len(known)}


def _record_inputs(rng, templates, cfg, run, horizon):
    # Same Poisson arrivals as the live generator's event law, unlike v10's
    # clipped-Gaussian Monte Carlo. All policies share exactly the same jobs.
    data={}
    for tick in range(1,horizon+1):
        n=int(rng.poisson(cfg['arrival_rate']))
        jobs=[]
        for ix in range(n):
            template=templates[int(rng.integers(len(templates)))]
            j=dict(template)
            j['id']=f'E{run}-T{tick}-J{ix}'
            j['admit_tick']=tick
            j['deadline_tick']=tick+int(rng.integers(3,14))
            # Ground tasks and future outcomes do not use hidden latent fields.
            j['network_at_risk']=False
            jobs.append(j)
        data[tick]=jobs
    return data


def paired_suite(lab, episodes=350, seed=707, scenario_names=None, policies=POLICIES,
                 horizon=24, drain=110, cost_weights=None):
    if not isinstance(episodes,int) or not 40<=episodes<=1000:raise ValueError('episodes=40..1000')
    if not isinstance(seed,int):raise ValueError('integer seed required')
    selected=scenario_names or list(SCENARIOS)
    if any(name not in SCENARIOS for name in selected):raise ValueError('invalid scenario')
    state=project(lab.store,lab.store.clock())
    templates=[safe_job(s,state['as_of']) for s in lab._pool(state)]
    templates=[j for j in templates if j['blocked_reason'] is None]
    if not templates:raise ValueError('no eligible synthetic work-order templates')
    all_results=[]
    for si,name in enumerate(selected):
        config=SCENARIOS[name]
        rng=np.random.default_rng(seed+si*10007)
        episodes_rows=[]
        started=time.perf_counter()
        for run in range(episodes):
            jobs=_record_inputs(rng,templates,config,run,horizon)
            episodes_rows.append(run_episode(jobs,config,horizon=horizon,drain=drain,policies=policies,cost_weights=cost_weights))
        arrays={p:{k:np.array([r['policies'][p][k] for r in episodes_rows],dtype=float)
                      for k in ('cost','holding_cost','late_cost','handling_cost','unresolved_penalty',
                                'on_time_rate','completion_rate','missed_cohort','outstanding',
                                'restricted_lead_ticks','throughput_jobs_per_tick')}
                  for p in policies}
        means={p:{k:round(float(np.mean(v)),5) for k,v in arrays[p].items()} for p in policies}
        records=[]
        base=arrays['FCFS']['cost']
        for p in policies:
            if p=='FCFS':continue
            cmp=arrays[p]['cost']
            base_mean=float(base.mean())
            cost_delta_pct=100*(base_mean-float(cmp.mean()))/base_mean if base_mean else None
            rng_ci=np.random.default_rng(seed+si*10007+137)
            idx=rng_ci.integers(0,episodes,(600,episodes))
            bs=base[idx].mean(axis=1); cs=cmp[idx].mean(axis=1)
            boots=np.where(bs!=0,100*(bs-cs)/bs,np.nan)
            # empirical CVaR over episode COST distribution, not the Model III CVaR
            def cvar90(a):
                a=np.sort(a);m=int(math.ceil(.1*len(a)))
                return float(np.mean(a[-m:]))
            base_tail=cvar90(base);cmp_tail=cvar90(cmp)
            base_lead=float(arrays['FCFS']['restricted_lead_ticks'].mean())
            new_lead=float(arrays[p]['restricted_lead_ticks'].mean())
            record={
              'policy':p,'cost_reduction_pct':round(float(cost_delta_pct),3),
              'cost_reduction_ci95_pct':[round(float(v),3) for v in np.nanpercentile(boots,[2.5,97.5])],
              'mean_cost_baseline_units':round(base_mean,4),
              'mean_cost_policy_units':round(float(cmp.mean()),4),
              'tail_cost_cvar90_reduction_pct':round(100*(base_tail-cmp_tail)/base_tail,3) if base_tail else None,
              'on_time_rate_baseline_pct':round(float(arrays['FCFS']['on_time_rate'].mean()*100),3),
              'on_time_rate_policy_pct':round(float(arrays[p]['on_time_rate'].mean()*100),3),
              'on_time_rate_change_pp':round(float(100*(arrays[p]['on_time_rate']-arrays['FCFS']['on_time_rate']).mean()),3),
              'on_time_rate_relative_increase_pct':round(100*(float(arrays[p]['on_time_rate'].mean())-float(arrays['FCFS']['on_time_rate'].mean()))/float(arrays['FCFS']['on_time_rate'].mean()),3) if float(arrays['FCFS']['on_time_rate'].mean()) else None,
              'full_cohort_missed_reduction_pct':round(100*(float(arrays['FCFS']['missed_cohort'].mean())-float(arrays[p]['missed_cohort'].mean()))/float(arrays['FCFS']['missed_cohort'].mean()),3) if float(arrays['FCFS']['missed_cohort'].mean()) else None,
              'mean_staging_lead_baseline_ticks':round(base_lead,3),
              'mean_staging_lead_policy_ticks':round(new_lead,3),
              'mean_staging_lead_reduction_pct':round(100*(base_lead-new_lead)/base_lead,3) if base_lead else None,
              'completion_rate_baseline_pct':round(float(arrays['FCFS']['completion_rate'].mean()*100),3),
              'completion_rate_policy_pct':round(float(arrays[p]['completion_rate'].mean()*100),3),
              'completion_rate_change_pp':round(float(100*(arrays[p]['completion_rate']-arrays['FCFS']['completion_rate']).mean()),3),
              'end_backlog_mean_baseline':round(float(arrays['FCFS']['outstanding'].mean()),3),
              'end_backlog_mean':round(float(arrays[p]['outstanding'].mean()),3),
              'backlog_reduction_pct':round(100*(float(arrays['FCFS']['outstanding'].mean())-float(arrays[p]['outstanding'].mean()))/float(arrays['FCFS']['outstanding'].mean()),3) if float(arrays['FCFS']['outstanding'].mean())>=1 else None,
              'policy_regression_fraction_pct':round(float(100*np.mean(cmp>base)),3),
              'mean_missed_cohort_baseline':round(float(arrays['FCFS']['missed_cohort'].mean()),3),
              'mean_missed_cohort_policy':round(float(arrays[p]['missed_cohort'].mean()),3),
              'cvar90_base_units':round(base_tail,4),'cvar90_policy_units':round(cmp_tail,4),
            }
            if name=='temporary_disruption':
                def recovery(pname):
                    vals=[r['policies'][pname]['recovery_clear_ticks'] for r in episodes_rows]
                    ok=[x for x in vals if x is not None]
                    return len(ok),float(np.mean(ok)) if ok else None
                n0,t0=recovery('FCFS');n1,t1=recovery(p)
                record['recovery_backlog_90pct_clearance']={
                   'baseline_clearance_observed_pct':round(100*n0/episodes,2),
                   'policy_clearance_observed_pct':round(100*n1/episodes,2),
                   'baseline_mean_ticks_if_cleared':round(t0,3) if t0 is not None else None,
                   'policy_mean_ticks_if_cleared':round(t1,3) if t1 is not None else None,
                   'conditional_time_reduction_pct':round(100*(t0-t1)/t0,3) if t0 and t1 else None,
                   'caveat':'Conditional means among cleared episodes; compare clearance percentages too.'}
            records.append(record)
        all_results.append({'scenario':name,'assumptions':config,'episodes':episodes,
                            'policy_means':means,'comparisons':records,
                            'elapsed_benchmark_seconds':round(time.perf_counter()-started,3)})
    return {'version':'11.0','synthetic_only':True,'episodes_per_scenario':episodes,'seed':seed,
       'horizon_arrival_ticks':horizon,'drain_ticks_cap':drain,'tick_minutes':10,
       'policies':list(policies),'template_count':len(templates),'results':all_results,
       'cost_weights':{**COST_DEFAULT,**(cost_weights or {})},
       'unresolved_policy':'All cohort jobs included; outstanding after bounded drain charged with explicit penalty, not omitted.',
       'relative_cost_reduction_formula':'100*(mean(FCFS_cost)-mean(policy_cost))/mean(FCFS_cost)',
       'confidence_interval':'600 common-random-number paired bootstrap samples on scenario episode pairs',
       'scope':'Synthetic 24-tick arrivals with up to 110-tick drain; shared Poisson demand; finite staging dispatch; NOT flight-level joint MILP or real-world costs',
       'real_airline_cost_reduction_pct':None,'real_airline_recovery_time_reduction_pct':None,
       'flight_recovery_optimization_speedup_pct':None,
       'quality_warning':'No baseline human planner speed observed; stage lead-time is not flight recovery latency.'}
