"""Presentation-ready additional QA: cost drivers, adverse episodes, recovery clearance,
MILP finite-column runtime at observable simulation snapshots. All synthetic.
"""
from __future__ import annotations
import json,csv,sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from v7_product import V7Lab
OUT=ROOT/'reports'
d=json.loads((OUT/'V11_OUT_OF_SAMPLE_SEED_2026_500x6.json').read_text())
plt.rcParams.update({'font.size':11,'figure.dpi':165,'axes.spines.top':False,'axes.spines.right':False})
TEAL='#147C71';GOLD='#E8AD4B';RED='#BD615C';BLUE='#345568'
def save(f,p):f.tight_layout();f.savefig(OUT/p,dpi=200,bbox_inches='tight',facecolor='white');plt.close(f)
# P(policy loss) all scenarios
names=[x['scenario'] for x in d['results']]; p=[next(y for y in x['comparisons'] if y['policy']=='RELAY_V11')['policy_regression_fraction_pct'] for x in d['results']]
fig,ax=plt.subplots(figsize=(11.2,4.9));bars=ax.bar(range(len(names)),p,color=[RED if x>20 else GOLD if x>0 else TEAL for x in p]);
ax.set(title='Risk: fraction of paired runs where RELAY v11 costs MORE',ylabel='Worse than FCFS (% of 500 episodes)',xticks=range(len(names)),xticklabels=[x.replace('_','\n') for x in names]);ax.set_ylim(0,max(p)+8);ax.grid(axis='y',alpha=.2);ax.set_axisbelow(True)
for b,v in zip(bars,p):ax.text(b.get_x()+b.get_width()/2,v+.8,f'{v:.1f}%',ha='center',fontsize=10)
save(fig,'V11_PROBABILITY_OF_REGRESSION.png')
# mean cost component stacked chart; plot normal + peak for FCFS and v11
keys=[('holding_cost','Waiting'),('late_cost','Late-service penalties'),('handling_cost','Processing'),('unresolved_penalty','Unresolved')];col=[GOLD,RED,TEAL,BLUE]
fig,ax=plt.subplots(figsize=(10,5.3));x=np.array([0,1,3,4]);groups=[('normal','FCFS'),('normal','RELAY_V11'),('peak','FCFS'),('peak','RELAY_V11')];bottom=np.zeros(4)
for (key,label),color in zip(keys,col):
 vals=[next(row for row in d['results'] if row['scenario']==sc)['policy_means'][policy][key] for sc,policy in groups]
 ax.bar(x,vals,bottom=bottom,color=color,label=label,width=.72)
 bottom+=np.array(vals)
ax.set_xticks(x,['Normal\nFCFS','Normal\nRELAY','Peak\nFCFS','Peak\nRELAY']);ax.set(title='Where synthetic costs come from',ylabel='Mean modeled penalty units / episode');ax.grid(axis='y',alpha=.18);ax.set_axisbelow(True)
ax.legend(ncol=2,loc='upper left');save(fig,'V11_COST_COMPONENTS.png')
# Recovery clearance opposite-case explicitly plot observed numbers
sr=next(r for r in d['results'] if r['scenario']=='temporary_disruption')
recovery=next(x for x in sr['comparisons'] if x['policy']=='RELAY_V11')['recovery_backlog_90pct_clearance']
fig,ax=plt.subplots(figsize=(8.8,4.5));vals=[recovery['baseline_mean_ticks_if_cleared'],recovery['policy_mean_ticks_if_cleared']]
ax.bar([0,1],vals,color=[BLUE,TEAL],width=.48);ax.set_xticks([0,1],['FCFS','RELAY v11']);ax.set(title='90% disruption backlog clearance: RELAY can be slower',ylabel='Average ticks to clear affected backlog');ax.set_ylim(0,max(vals)*1.23)
for j,v in enumerate(vals):ax.text(j,v+.35,f'{v:.2f} ticks',ha='center',fontsize=12)
ax.text(.5,.91,'Both policies cleared in 100% of this synthetic scenario\nRELAY requires 15.1% MORE ticks',ha='center',transform=ax.transAxes,color=RED,fontsize=10)
save(fig,'V11_BACKLOG_RECOVERY_COUNTEREXAMPLE.png')
# Optimizer runtime: actual finite candidate route MILP, not proof of scaling to Cathay.
rows=[]
for seed in (111,707,2048,2197,9917,357):
 lab=V7Lab(seed=seed)
 try:
  for k in range(6):
   latest=lab.latest or {};mo=latest.get('model_iii',{})
   rows.append({'seed':seed,'tick':lab.t,'candidate_columns':mo.get('candidate_columns',0),
                'solve_ms':mo.get('solve_ms',0.),'status':mo.get('status',''),
                'mip_gap':mo.get('solver',{}).get('mip_gap')})
   if k<5:lab.step(count=4)
 finally:lab._tmp.cleanup()
with (OUT/'V11_FINITE_MILP_RUNTIME.csv').open('w',newline='',encoding='utf-8-sig') as file:
 w=csv.DictWriter(file,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
cols=np.array([x['candidate_columns'] for x in rows],dtype=float)
ms=np.array([x['solve_ms'] for x in rows],dtype=float)
fig,ax=plt.subplots(figsize=(10.5,5.1));ax.scatter(cols,ms,color=TEAL,alpha=.8,s=52)
ax.set(title='MILP solver runtime vs enumerated route columns (6 synthetic seeds)',xlabel='Candidate itinerary columns',ylabel='HiGHS reported solve duration (ms)');ax.grid(alpha=.2);ax.set_axisbelow(True)
ax.text(.98,.93,f"{len(rows)} evaluations · range {ms.min():.1f}–{ms.max():.1f} ms\nFinite-column OPTIMAL status ≠ all real routes searched",ha='right',va='top',transform=ax.transAxes,fontsize=10,color='#637C7B')
save(fig,'V11_FINITE_MILP_RUNTIME.png')
assert all(r['status'] in ('OPTIMAL_ENUMERATED_MILP','NO_ELIGIBLE_SHIPMENTS','VALID_FEASIBLE_INCUMBENT') for r in rows)
(OUT/'V11_OPERATIONAL_EXTRAS.json').write_text(json.dumps({'probability_of_regression_pct':dict(zip(names,p)),
 'recovery_clearance_counterexample':recovery,'milp_runtime_evaluations':len(rows),
 'milp_runtime_ms':{'min':float(ms.min()),'median':float(np.median(ms)),'p95':float(np.percentile(ms,95)),'max':float(ms.max())},
 'finite_milp_candidate_columns_range':[int(cols.min()),int(cols.max())],
 'all_milp_statuses':sorted(set(row['status'] for row in rows)),
 'caveat':'Local finite-column MILP solve time (not 3-model end-to-end decision latency or real airline scale).'},indent=2),encoding='utf-8')
print('solver evaluations',len(rows),'columns',cols.min(),cols.max(),'time ms median',np.median(ms),'p95',np.percentile(ms,95),'status set',set(r['status'] for r in rows))
