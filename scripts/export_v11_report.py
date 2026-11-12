"""Build presentation-ready plots and CSV from the *measured* V11 pinned report.
No hardcoded outcome percentages. Run from repo root: python scripts/export_v11_report.py
"""
import csv,json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
report=json.loads((ROOT/'reports/V11_OUT_OF_SAMPLE_SEED_2026_500x6.json').read_text('utf-8'))
rows=[]
for r in report['results']:
    for cmp in r['comparisons']:
        rows.append({'scenario':r['scenario'],'policy':cmp['policy'],
                     'episodes':r['episodes'],'seed':report['seed'],**{k:v for k,v in cmp.items() if not isinstance(v,dict)}})
with (ROOT/'reports/V11_PRESENTATION_KPIS.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
items=[r for r in rows if r['policy']=='RELAY_V11']
labels=['Normal','Peak demand','Crew shortage','Cold capacity 0','High capacity','Temporary outage']
plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.dpi':180})

def chart(filename,title,ylabel,key,zero=True):
    fig,ax=plt.subplots(figsize=(11.5,5.1))
    vals=[x[key] for x in items]
    pos=np.arange(len(items))
    bars=ax.bar(pos,vals,width=.66)
    ax.set_xticks(pos,labels)
    ax.set_ylabel(ylabel);ax.set_title(title,fontsize=14,pad=16)
    if zero:ax.axhline(0,color='#555',linewidth=.8)
    low=min(0,min(vals));high=max(0,max(vals));span=max(high-low,1)
    ax.set_ylim(low-span*.12,high+span*.17)
    for b,v in zip(bars,vals):
        ax.text(b.get_x()+b.get_width()/2,v+(.03*span if v>=0 else -.045*span),f'{v:+.1f}'+(' pp' if key.endswith('_pp') else '%'),ha='center',fontsize=10)
    ax.grid(axis='y',alpha=.18)
    ax.text(.995,-.20,'Paired synthetic cohort benchmark · 500 episodes/scenario · seed 2026 · NOT airline ROI',
            transform=ax.transAxes,ha='right',va='top',fontsize=9,color='#606c72')
    fig.tight_layout(rect=(0,.06,1,1))
    fig.savefig(ROOT/'reports'/filename,bbox_inches='tight',dpi=200);plt.close(fig)
chart('V11_COST_REDUCTION_PERCENT.png','Synthetic staging cost reduction vs FCFS','Reduction in total synthetic cost (%)','cost_reduction_pct')
chart('V11_SLA_GAIN_PP.png','On-time delivery of staging tasks: RELAY v11 vs FCFS','On-time rate improvement (percentage points)','on_time_rate_change_pp')
chart('V11_TAIL_RISK_REDUCTION_PERCENT.png','Worst-decile simulated episode cost (CVaR90)','Tail cost reduction (%)','tail_cost_cvar90_reduction_pct')
chart('V11_LEAD_TIME_PERCENT.png','Staging lead time reduction (NOT flight recovery optimization speed)','Restricted cohort mean time reduced (%)','mean_staging_lead_reduction_pct')

# Back-to-back comparison across identical v11 full-cohort scenarios.
fig,ax=plt.subplots(figsize=(12.5,5.6));x=np.arange(len(report['results']));width=.35
old=[next(c for c in r['comparisons'] if c['policy']=='RELAY_V10')['cost_reduction_pct'] for r in report['results']]
new=[next(c for c in r['comparisons'] if c['policy']=='RELAY_V11')['cost_reduction_pct'] for r in report['results']]
ax.bar(x-width/2,old,width,label='Original v10 staging policy')
ax.bar(x+width/2,new,width,label='New v11 staging policy')
ax.axhline(0,color='#555',lw=.8);ax.set_xticks(x,labels);ax.set_ylabel('Cost reduction vs FCFS (%)')
ax.set_title('Same new full-cohort benchmark — v10 and v11 policies',fontsize=14,pad=15)
ax.legend(loc='upper left');ax.grid(axis='y',alpha=.16)
ax.text(.99,-.19,'500 paired episodes per scenario · same Poisson inputs and penalties · synthetic only',
        ha='right',transform=ax.transAxes,fontsize=9,color='#606c72')
fig.tight_layout(rect=(0,.06,1,1));fig.savefig(ROOT/'reports/V11_V10_HEAD_TO_HEAD.png',bbox_inches='tight',dpi=200);plt.close(fig)

# Summary data that the chart labels derive from, including counterexample.
print(f'Exported {len(rows)} CSV rows and 5 charts to reports/.')
for x in items:
 print(f"{x['scenario']:23} cost {x['cost_reduction_pct']:+6.2f}%  SLA {x['on_time_rate_change_pp']:+6.2f} pp  lead {x['mean_staging_lead_reduction_pct']:+6.2f}%  worst10 {x['tail_cost_cvar90_reduction_pct']:+6.2f}%")
