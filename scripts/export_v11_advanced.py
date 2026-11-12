"""Generate reproducible, presentation-ready empirical charts from v11 SYNTHETIC episodes.

NOT a flight operations study. No airline ROI, no dollars from unitless synthetic costs.
Includes a clearly labelled hypothetical unit-to-HKD conversion sensitivity.
"""
from __future__ import annotations
import csv, json, math, statistics, sys
from pathlib import Path
from collections import Counter

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.stats import poisson

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from v11.benchmark import SCENARIOS, _record_inputs, run_episode
from relay.state import project
from unified_lab import safe_job
from v7_product import V7Lab

OUT=ROOT/'reports'
OUT.mkdir(exist_ok=True)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,
                     'axes.spines.top':False,'axes.spines.right':False,
                     'axes.titleweight':'bold','figure.dpi':145})
TEAL='#0C796C'; NAVY='#1F3445'; GOLD='#E7A83E'; RED='#C75C56'; GRID='#DFE8E6'

def save(fig,name):
    fig.tight_layout(pad=1.5)
    fig.savefig(OUT/name,dpi=205,bbox_inches='tight',facecolor='white')
    plt.close(fig)

def label(ax):
    ax.grid(axis='y',alpha=.3,color=GRID);ax.set_axisbelow(True)

lab=V7Lab(seed=2048)
try:
    st=project(lab.store,lab.store.clock())
    templates=[safe_job(s,st['as_of']) for s in lab._pool(st)]
    templates=[j for j in templates if j['blocked_reason'] is None]
finally:
    lab._tmp.cleanup()
assert len(templates)==22

n_episodes=500;horizon=24;drain=110;seed=2026
sample={};rows=[]
for ix,name in enumerate(SCENARIOS):
    cfg=SCENARIOS[name];rng=np.random.default_rng(seed+ix*10007);runs=[]
    for episode in range(n_episodes):
        jobs=_record_inputs(rng,templates,cfg,episode,horizon)
        res=run_episode(jobs,cfg,horizon=horizon,drain=drain)
        pair={k:res['policies'][k] for k in ('FCFS','RELAY_V10','RELAY_V11')}
        runs.append((jobs,pair))
        for pname,item in pair.items():
            rows.append({'scenario':name,'episode':episode,'policy':pname,'seed':seed,
                         'admitted':res['admitted'],'cost_units':item['cost'],
                         'on_time_rate':item['on_time_rate'],
                         'staging_lead_ticks':item['restricted_lead_ticks'],
                         'outstanding':item['outstanding'],
                         'completed':item['arrivals']-item['outstanding']})
    sample[name]=runs
with (OUT/'V11_EPISODE_LEVEL_DATA_500x6.csv').open('w',newline='',encoding='utf-8-sig') as file:
    writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)

pinned=json.loads((OUT/'V11_OUT_OF_SAMPLE_SEED_2026_500x6.json').read_text(encoding='utf-8'))
validation=[]
for scen in pinned['results']:
    name=scen['scenario']; runs=sample[name]
    for policy in ('FCFS','RELAY_V10','RELAY_V11'):
        measured=float(np.mean([r[1][policy]['cost'] for r in runs]))
        reported=scen['policy_means'][policy]['cost']
        validation.append(abs(measured-reported)<0.00011)
assert all(validation), 'Episode data do not recreate the pinned report means'

# 1. Poisson arrival frequency, as *generated* (not observed airport arrival law)
normal=sample['normal'];arrival_counts=[len(items) for jobs,_ in normal for items in jobs.values()]
counts=Counter(arrival_counts);x=np.arange(0,max(10,max(counts)+1));N=len(arrival_counts)
obs=np.array([100*counts.get(int(k),0)/N for k in x]);law=100*poisson.pmf(x,2.)
fig,ax=plt.subplots(figsize=(11.8,5.1));ax.bar(x-.18,obs,width=.35,label='Generated frequency',color=TEAL)
ax.bar(x+.18,law,width=.35,label='Poisson(λ=2) assumption',color=GOLD)
ax.set(title='Order arrivals / 10-minute tick — normal synthetic scenario',xlabel='New staging jobs per tick',ylabel='Frequency (%)');ax.legend();label(ax)
ax.text(.99,.94,'500 episodes × 24 ticks = 12,000 observations\nSYNTHETIC INPUT LAW — NOT CATHAY DATA',ha='right',va='top',transform=ax.transAxes,fontsize=10,color='#596F72')
save(fig,'V11_ARRIVAL_FREQUENCY.png')

# 2. Convergence: cumulative paired reduction, two demand levels; pointwise
# uncertainty band via nonparametric paired bootstrap, not test of reality.
fig,ax=plt.subplots(figsize=(11.8,5.4)); converged={}
for name,color in [('normal',TEAL),('peak',RED)]:
    runs=sample[name]; b=np.array([r[1]['FCFS']['cost'] for r in runs],float)
    q=np.array([r[1]['RELAY_V11']['cost'] for r in runs],float)
    ns=np.array([20,30,50,70,100,130,170,220,280,350,420,500]);cen=[];low=[];high=[]
    rng=np.random.default_rng(7000+(name=='peak'))
    for n in ns:
        ratio=100*(b[:n].mean()-q[:n].mean())/b[:n].mean()
        idx=rng.integers(0,n,(450,n))
        ub=b[:n][idx].mean(axis=1);uq=q[:n][idx].mean(axis=1)
        distribution=100*(ub-uq)/ub
        cen.append(ratio);lo,hi=np.percentile(distribution,[2.5,97.5]);low.append(lo);high.append(hi)
    ax.plot(ns,cen,'-o',markersize=4,label=f'{name.title()} cost reduction',color=color,lw=2.2)
    ax.fill_between(ns,low,high,color=color,alpha=.14)
    converged[name]={'n':ns.tolist(),'mean_reduction_pct':list(map(float,cen)),
                     'ci95_pointwise':list(zip(map(float,low),map(float,high)))}
ax.set(title='Statistical convergence: how many paired episodes are enough?',xlabel='Paired synthetic episodes included (n)',ylabel='Cumulative mean cost reduction vs FCFS (%)');ax.legend();label(ax)
ax.text(.99,.02,'Bands = paired bootstrap uncertainty; NOT solver convergence',transform=ax.transAxes,ha='right',color='#708381',fontsize=9)
save(fig,'V11_STATISTICAL_CONVERGENCE.png')

# 3. Distribution of paired benefits; includes adverse results.
fig,ax=plt.subplots(figsize=(11.8,5.3));stats={}
for name,color in [('normal',TEAL),('peak',GOLD),('temporary_disruption',NAVY)]:
    r=sample[name]; delta=np.array([x[1]['FCFS']['cost']-x[1]['RELAY_V11']['cost'] for x in r])
    ax.hist(delta,bins=27,density=True,alpha=.43,label=name.replace('_',' ').title(),color=color)
    stats[name]={'mean_delta_units':float(delta.mean()),'p_worse_pct':float(100*np.mean(delta<0)),
                 'p_equal_pct':float(100*np.mean(delta==0)),
                 'p_better_pct':float(100*np.mean(delta>0)),
                 'p10_delta_units':float(np.percentile(delta,10)),
                 'p90_delta_units':float(np.percentile(delta,90))}
ax.axvline(0,color=RED,lw=1.7,ls='--',label='Zero advantage / worse on the left')
ax.set(title='Probability distribution of paired cost savings',xlabel='Episode-level synthetic cost saved (FCFS − RELAY)',ylabel='Probability density');ax.legend();label(ax)
save(fig,'V11_SAVINGS_DISTRIBUTION.png')

# 4. Tail risk: empirical worst-decile cost changes per scenario
names=list(SCENARIOS);lines=[];pct=[]
for sr in pinned['results']:
    c=next(x for x in sr['comparisons'] if x['policy']=='RELAY_V11')
    pct.append(c['tail_cost_cvar90_reduction_pct'])
fig,ax=plt.subplots(figsize=(11.8,5));bars=ax.bar(range(len(names)),pct,color=[TEAL if v>=0 else RED for v in pct])
ax.set_xticks(range(len(names)),['Normal','Peak','Crew short','Cold unavailable','High capacity','Temporary outage'])
ax.set(title='Worst 10% of synthetic episode costs (empirical CVaR90)',ylabel='Tail cost reduction vs FCFS (%)');ax.axhline(0,color=NAVY,lw=.9);label(ax)
for x,v in enumerate(pct):ax.text(x,v+.35,('+' if v>0 else '')+f'{v:.1f}%',ha='center',fontsize=10)
save(fig,'V11_TAIL_RISK_CVAR90.png')

# 5. Illustrative deployment ROI: do not infer value/units, demand, or fees.
# N = comparable synthetic decision batches/month, k = HKD per synthetic cost unit.
# Fixed monthly expense is a hypothetical HKD 20,000. Do not mix currencies.
mean_delta=stats['normal']['mean_delta_units']
volumes=np.array([10,20,40,60,80,100])
values=np.array([.5,1.,2.,3.,5.,8.])
fee_hkd=20000.
roi=np.array([[100*(n*mean_delta*val-fee_hkd)/fee_hkd for val in values] for n in volumes])
fig,ax=plt.subplots(figsize=(10.5,5.9));vlim=max(np.max(abs(roi)),100)
from matplotlib.colors import TwoSlopeNorm
im=ax.imshow(roi,cmap='RdYlGn',norm=TwoSlopeNorm(vmin=-max(110.,abs(float(roi.min()))),vcenter=0,vmax=max(110.,float(roi.max()))),aspect='auto')
ax.set_xticks(range(len(values)),[f'HKD {v:g}' for v in values]);ax.set_yticks(range(len(volumes)),[str(v) for v in volumes]);ax.set(xlabel='Hypothetical HKD value of ONE synthetic penalty unit',ylabel='Comparable synthetic batches per month',title='Illustrative break-even ROI sensitivity — NOT observed airline savings')
for i in range(len(volumes)):
  for j in range(len(values)):
    ax.text(j,i,f'{roi[i,j]:+.0f}%',ha='center',va='center',fontsize=10,color='#202c2e')
fig.colorbar(im,ax=ax,label='Illustrative (benefit − expense) / expense (%)')
fig.text(.50,.015,'Assumption: HKD 20k monthly incremental deployment cost. Values and volume are NOT empirically calibrated.',ha='center',fontsize=9,color='#697B79')
save(fig,'V11_ROI_SENSITIVITY_HYPOTHETICAL.png')

# 6. Explicit scenario-mix illustration: contributions are model-units only.
weights={'normal':.40,'peak':.20,'crew_shortage':.15,'cold_outage':.10,'high_capacity':.10,'temporary_disruption':.05}
expected_base=sum(weights[s['scenario']]*s['policy_means']['FCFS']['cost'] for s in pinned['results'])
expected_policy=sum(weights[s['scenario']]*s['policy_means']['RELAY_V11']['cost'] for s in pinned['results'])
weighted_savings=expected_base-expected_policy
mix_pct=100*weighted_savings/expected_base
fig,ax=plt.subplots(figsize=(11.8,5.15))
contribs=[weights[s['scenario']]*(s['policy_means']['FCFS']['cost']-s['policy_means']['RELAY_V11']['cost']) for s in pinned['results']]
ax.barh(range(len(names)),contribs,color=[TEAL if v>=0 else RED for v in contribs]);ax.set_yticks(range(len(names)),[f'{s.replace("_"," ").title()} ({100*weights[s]:g}%)' for s in names]);ax.invert_yaxis();ax.set(title=f'Illustrative scenario-mix expected benefit = {mix_pct:.2f}% (synthetic units)',xlabel='Probability-weighted synthetic cost saved per episode');label(ax)
fig.text(.50,.018,'Probabilities are USER-ASSUMED EXAMPLES, not real event likelihoods.',ha='center',fontsize=9,color='#697B79')
save(fig,'V11_SCENARIO_PROB_COST.png')

# 7. Audit and chart numeric dataset
summary={'benchmark_version':'v11','synthetic_only':True,'seed':seed,
         'episodes_per_scenario':n_episodes,
         'episode_data_file':'V11_EPISODE_LEVEL_DATA_500x6.csv',
         'arrival_frequency':{'normal_count':N,'lambda':2.0,'observed':dict(counts),
                              'empirical_mean':float(np.mean(arrival_counts)),
                              'empirical_variance':float(np.var(arrival_counts,ddof=1)),
                              'modeled_Poisson_mean':2.0},
         'paired_savings_distribution':stats,
         'convergence':converged,
         'hypothetical_roi':{'incremental_cost_hkd_month':fee_hkd,'normal_synthetic_savings_per_batch_units':mean_delta,
                             'unit_conversion_values_hkd':values.tolist(),
                             'volumes_per_month':volumes.tolist(),
                             'roi_grid_percent':roi.tolist(),
                             'break_even_hkd_per_unit_at_60_batches':fee_hkd/(60*mean_delta)},
         'scenario_mix_illustration':{'assumed_probabilities':weights,'expected_FCFS_cost_units':expected_base,
                                      'expected_RELAY_cost_units':expected_policy,
                                      'cost_reduction_pct':mix_pct},
         'truth_contract':['No measured real airline ROI or recovery-time speedup',
                           'Cost CVaR90 is across simulated episodes, not MILP scenario CVaR',
                           'Statistical convergence (episodes) is not MILP solver runtime convergence',
                           'Scenario mix and HKD/unit mapping are illustrative, not fitted']}
(OUT/'V11_ADVANCED_PPT_DATA.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('created figures and episode CSV; validation',len(validation),all(validation))
print('normal delta units',mean_delta,'P(worse)',stats['normal']['p_worse_pct'],'scenario mix %',mix_pct)
