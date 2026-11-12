"""Test harness for real-time event stream and paired counterfactuals. Only synthetic."""
from __future__ import annotations
import random,uuid,statistics,math
from datetime import timedelta
from .schemas import ts,parse_time,EventIn
from .state import project
from .models import cvar


def tick(store,advance_seconds=40,seed=27):
    if not (1<=advance_seconds<=7200):raise ValueError('advance_seconds must be 1..7200')
    old=store.clock(); new=ts(parse_time(old)+timedelta(seconds=advance_seconds))
    state=project(store,old)
    rng=random.Random(f'{seed}:{old}')
    # Select flights still in the future, no event where a plane has already departed.
    future=[f for f in state['flights'].values() if parse_time(f['estimated_departure'])>parse_time(new)+timedelta(hours=1) and f['status']=='Scheduled']
    ships=[s for s in state['shipments'].values() if parse_time(s['accepted_at'])<=parse_time(new) and s['custody_state']=='RECEIVED' and s['handling']!='DGR']
    if not future and not ships:
        store.set_clock(new);return {'clock':new,'event':None,'reason':'no active synthetic entities'}
    types=['flight_delay','capacity_changed','shipment_dimension_conflict','flight_cancelled','terminal_congestion']
    weights=[.42,.25,.18,.07,.08]
    k=rng.choices(types,weights=weights)[0]
    if k.startswith('flight') or k=='capacity_changed':
        if not future:k='terminal_congestion'
    elif k=='shipment_dimension_conflict':
        ships=[s for s in ships if not s['dimension_conflict']]
        if not ships:k='terminal_congestion'
    source='SYNTHETIC_GROUND_OPS'; entity_type='terminal';eid='HKG-T1';payload={'capacity_fraction':round(rng.uniform(.62,.94),3)}
    if k in ('flight_delay','flight_cancelled','capacity_changed'):
        f=rng.choice(future);entity_type='flight';eid=f['id'];source='SYNTHETIC_FLIGHT_OPS'
        payload=({'delay_seconds':rng.randrange(600,6000)} if k=='flight_delay' else
            {'reason_code':'WX_SIMULATED'} if k=='flight_cancelled' else
            {'remaining_kg':max(0,int(f['remaining_kg']*rng.uniform(.35,.87))),
             'cool_remaining_kg':max(0,int(f['cool_remaining_kg']*rng.uniform(.25,.70)))})
        if k=='capacity_changed':source='SYNTHETIC_INVENTORY'
    elif k=='shipment_dimension_conflict':
        s=rng.choice(ships);entity_type='shipment';eid=s['id'];source='SYNTHETIC_MEASUREMENT'
        payload={'piece_id':s['piece_ids'][0],'reason':'two conflicting dimensions in synthetic acceptance vs scanner'}
    prev=store.events(entity_id=eid)
    rev=2+max((int(e['source_revision']) for e in prev if e['event_type']==k),default=0)
    ev=EventIn(event_id='LIVE-'+uuid.uuid4().hex[:18],event_type=k,entity_type=entity_type,entity_id=eid,
        event_time=ts(parse_time(new)-timedelta(seconds=rng.randrange(0,min(20,advance_seconds)))),
        received_at=new,source=source,source_revision=rev,trusted=True,payload=payload)
    store.set_clock(new)
    out=store.append_event(ev)
    return {'clock':new,'event':ev.model_dump(),'ingestion':out}


def paired_benchmark(decision,runs=10000,seed=2026):
    """Paired conditional Monte Carlo; NO 10k MILP resolves. Test plan costs against FCFS on same draws."""
    if not 100<=runs<=50000:raise ValueError('runs must be between 100 and 50,000')
    g=decision['model_iii']
    if 'metrics' not in g:raise ValueError('decision has no solved network result')
    sc=g['scenario_probabilities']; names=[x['name'] for x in sc];weights=[x['probability'] for x in sc]
    a=g['metrics']['scenario_system_losses'];b=g['baseline_fcfs']['scenario_system_losses']
    rng=random.Random(seed);diff=[];cost_a=[];cost_b=[];regress=0
    for _ in range(runs):
        name=rng.choices(names,weights=weights)[0]
        # shared day-level multiplier preserves correlation and avoids independent scenario leakage
        common=math.exp(rng.gauss(0,.10)-.005)
        va=a[name]*common;vb=b[name]*common
        cost_a.append(va);cost_b.append(vb);diff.append(vb-va)
        regress+= va>vb+1e-10
    mean_a=statistics.fmean(cost_a);mean_b=statistics.fmean(cost_b);savings=statistics.fmean(diff)
    # Normal CI on paired Monte Carlo estimate (not a Cathay performance generalization).
    se=statistics.stdev(diff)/math.sqrt(runs)
    return {'status':'COMPUTED_PAIRED_SYNTHETIC_MONTE_CARLO','runs':runs,'seed':seed,
       'mean_relay_cost_units':round(mean_a,4),'mean_fcfs_cost_units':round(mean_b,4),
       'mean_paired_saving_units':round(savings,4),
       'relative_saving_pct':round(100*savings/mean_b,3) if mean_b else None,
       'confidence_95_mc_saving_units':[round(savings-1.96*se,4),round(savings+1.96*se,4)],
       'relay_worse_fraction':round(regress/runs,5),
       'meaning':'Same selected plans evaluated on sampled synthetic disruptions; 10k shared draws, NOT 10k MILP solves.',
       'limitations':['in-sample synthetic distribution, not external validation','no Cathay performance claim',
        'does not validate aircraft loading safety or true monetary ROI']}
