"""Independent engineering tests for v11 truthful, reproducible scope.

Passing this suite does not establish full paper implementation or Cathay ROI.
"""
from __future__ import annotations
import itertools
import math
import random
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from fusion_app import app
from relay.schemas import parse_time
from relay.state import project
from v11.audit import data_audit, live_consistency
from v11.benchmark import run_episode,select_v11,paired_suite,SCENARIOS
from v11.legacy_percent import legacy_cost_percent
from v7_product import V7Lab
from v11.conductor import Conductor
from unified_lab import paired_queue_benchmark


def test_full_data_audit_uses_all_five_real_files():
    result=data_audit()
    assert result['status']=='PASS' and result['error_count']==0
    assert result['counts']=={'flights':429,'shipments':636,'pieces':793,'ulds':14,'historical_events':5120}
    assert not result['external_distribution_calibration']


def test_legacy_denominators_reproduce_exact_original_absolute_saving():
    lab=V7Lab(seed=2048)
    try:
        pct=legacy_cost_percent(lab,episodes=100,seed=4141)
        r=pct['results'][0]
        older=paired_queue_benchmark(lab,episodes=100,seed=4141)
        assert math.isclose(r['saved_cost_units'],older['paired_saving_units'],abs_tol=1e-3)
        assert math.isclose(r['saved_cost_pct'],100*r['saved_cost_units']/r['baseline_mean_cost_units'],abs_tol=.002)
    finally:lab._tmp.cleanup()


def _score(j,t):
    age=max(0,t-j['admit_tick']);duration=max(1,j['duration']);slack=j['deadline_tick']-(t+duration)
    return ((20*int(slack>=0)+12*int(0<=slack<=2)+6*j['priority']+.9*age
             +5*min(3,max(0,-slack))+4*int(j.get('network_at_risk',False))
             +60*int(j.get('recovery_pending',False))) / (duration**.6))


def test_v11_exact_observable_two_class_selection_matches_bruteforce():
    rng=random.Random(42)
    for i in range(225):
        tick=rng.randrange(2,30)
        jobs=[{'id':str(k),'admit_tick':rng.randrange(0,tick),
          'deadline_tick':tick+rng.randrange(-7,15),'duration':rng.randrange(1,6),
          'priority':rng.randrange(1,4),'cold':bool(rng.randrange(2)),
          'network_at_risk':bool(rng.randrange(2)),'blocked_reason':'CUSTOMS' if rng.randrange(9)==0 else None}
              for k in range(rng.randrange(0,9))]
        handlers=rng.randrange(2,5);stands=rng.randrange(2,5);cold_bays=rng.randrange(0,5)
        chosen,_=select_v11(jobs,[],tick,handlers,stands,cold_bays)
        assert all(j['blocked_reason'] is None for j in chosen)
        assert len(chosen)<=min(handlers,stands)
        assert sum(j['cold'] for j in chosen)<=cold_bays
        if min(handlers,stands)>1:
            feasible=[j for j in jobs if j['blocked_reason'] is None]
            oracle=max((sum(_score(j,tick) for j in subset)
                for n in range(len(feasible)+1) for subset in itertools.combinations(feasible,n)
                if n<=min(handlers,stands) and sum(j['cold'] for j in subset)<=cold_bays),default=0.)
            assert abs(sum(_score(j,tick) for j in chosen)-oracle)<1e-8


def test_v11_single_server_fallback_exactly_matches_safe_fcfs():
    jobs=[{'id':str(i),'admit_tick':i,'deadline_tick':100,'duration':3,
           'priority':3-i%3,'cold':False,'network_at_risk':False,'blocked_reason':None}
           for i in range(4)]
    chosen,meta=select_v11(jobs,[],2,handlers=1,stands=4,cold_bays=1)
    assert [j['id'] for j in chosen]==['0']
    assert 'FCFS' in meta['status']


def test_v11_cold_zero_never_assigns_cold_work_even_if_urgency_high():
    j={'id':'c1','admit_tick':0,'deadline_tick':0,'duration':2,'priority':3,'cold':True,
       'network_at_risk':True,'blocked_reason':None}
    chosen,meta=select_v11([j],[],tick=100,handlers=6,stands=5,cold_bays=0)
    assert chosen==[]


def test_full_cohort_counts_unfinished_work_as_missed_with_penalty():
    j={'id':'c1','admit_tick':1,'deadline_tick':2,'duration':5,'priority':3,'cold':True,
       'network_at_risk':False,'blocked_reason':None}
    result=run_episode({1:[j]},SCENARIOS['cold_outage'],horizon=3,drain=5)
    for p in result['policies'].values():
        assert p['on_time_rate']==0 and p['outstanding']==1
        assert p['missed_cohort']==1 and p['unresolved_penalty']>0
        assert p['completion_rate']==0 and p['unsafe_assignments']==0


def test_paired_benchmark_includes_denominator_and_disclosure():
    lab=V7Lab(seed=2048)
    try:
        result=paired_suite(lab,episodes=42,seed=4141,scenario_names=['normal','crew_shortage'])
        assert result['real_airline_cost_reduction_pct'] is None
        for scenario in result['results']:
            for cmp in scenario['comparisons']:
                b=cmp['mean_cost_baseline_units'];n=cmp['mean_cost_policy_units']
                assert abs(cmp['cost_reduction_pct']-100*(b-n)/b)<.01
                assert len(cmp['cost_reduction_ci95_pct'])==2
                assert 0<=cmp['policy_regression_fraction_pct']<=100
                assert 0<=cmp['completion_rate_policy_pct']<=100
        assert result['horizon_arrival_ticks']==24 and result['drain_ticks_cap']==110
    finally:lab._tmp.cleanup()


def test_paired_benchmark_is_reproducible_without_mutating_lab():
    lab=V7Lab(seed=2048)
    try:
        old_t=lab.t; old_version=lab.store.version()
        a=paired_suite(lab,episodes=40,seed=2026,scenario_names=['normal'])
        b=paired_suite(lab,episodes=40,seed=2026,scenario_names=['normal'])
        for result in (a,b):
            result['results'][0].pop('elapsed_benchmark_seconds')
        assert a==b and old_t==lab.t and old_version==lab.store.version()
    finally:lab._tmp.cleanup()


def test_live_three_twins_share_one_clock_and_no_real_execution():
    c=Conductor(seed=2401)
    try:
        assert live_consistency(c)['status']=='PASS'
        c.step(2)
        x=live_consistency(c)
        assert x['status']=='PASS' and x['tick']==2
        assert x['simulated_only'] is True
        assert c.lab.v11_dispatch_enabled
    finally:c.pause();c.lab._tmp.cleanup()


def test_unsafe_old_recommendation_never_auto_commits_actual_airline_booking():
    c=Conductor(seed=2048)
    try:
        c.incident('shipment_dimension_conflict')
        x=live_consistency(c)
        assert x['status']=='PASS'
        assert c.snapshot()['customer_projection']['route_decision']['carrier_confirmed'] is False
    finally:c.pause();c.lab._tmp.cleanup()


def test_manual_delay_and_congestion_update_the_canonical_projection():
    c=Conductor(seed=2048)
    try:
        store=c.lab.store
        before=project(store,store.clock())
        for _ in range(2):
            event=c.incident('flight_delay')['latest_event']
            assert event['event_type']=='flight_delay'
            flight_id=event['entity_id']
            after=project(store,store.clock())
            delay=parse_time(after['flights'][flight_id]['estimated_departure'])-parse_time(
                before['flights'][flight_id]['estimated_departure'])
            assert delay.total_seconds()==45*60
            before=after

        event=c.incident('terminal_congestion')['latest_event']
        assert event['event_type']=='terminal_congestion'
        assert project(store,store.clock())['terminal_capacity_fraction']==.65
    finally:c.pause();c.lab._tmp.cleanup()


def test_v11_http_report_and_provenance():
    with TestClient(app) as client:
        for p in ['/','/v11','/v11/evidence','/v11/api/health','/v11/api/kpis','/v11/api/v10-original-kpis',
                  '/v11/api/data-audit','/v11/api/trace','/v11/api/scope','/v10']:
            response=client.get(p)
            assert response.status_code==200,(p,response.text[:200])
        assert 'RELAY 11' in client.get('/v11').text  # v12 uses / as its entry point
        health=client.get('/v11/api/health').json()
        assert health['ground_dispatch']=='V11_OBSERVABLE_TRIAGE'
        assert health['real_commands_sent'] is False and health['production_safety_certified'] is False
        report=client.get('/v11/api/kpis').json()
        assert report['episodes_per_scenario']==500
        assert report['real_airline_cost_reduction_pct'] is None
        assert len(report['results'])==6


def test_v11_cross_origin_mutation_protection():
    with TestClient(app) as client:
        attack=client.post('/v11/api/control',json={'action':'step'},headers={'Origin':'https://remote.attacker.invalid'})
        assert attack.status_code==403
        attack=client.post('/v11/api/control',json={'action':'step'},headers={'Sec-Fetch-Site':'cross-site'})
        assert attack.status_code==403
        legitimate=client.get('/v11/api/health')
        assert legitimate.status_code==200


def test_v11_recompute_caps_abusive_large_runs_and_does_not_advance_clock():
    with TestClient(app) as client:
        old_tick=client.get('/v11/api/state').json()['tick']
        assert client.get('/v11/api/recompute?episodes=10000').status_code==422
        response=client.get('/v11/api/recompute?episodes=40&seed=101')
        assert response.status_code==200
        assert len(response.json()['results'])==6
        assert client.get('/v11/api/state').json()['tick']==old_tick


def test_v11_visual_contract_retains_old_three_tabs():
    root=Path(__file__).resolve().parents[1]
    text=(root/'static'/'v11.html').read_text(encoding='utf-8')
    assert [t for t in ('ground','tower','customer','chat') if f'data-tab="{t}"' in text]==['ground','tower','customer','chat']
    assert text.count('data-tab="')==4  # three twins + AI chat
    assert 'v10_scene.js' in text and '/v10_ui.js' in text
    assert 'Evidence & KPIs' in text
    assert 'v11_research' not in text  # no fake animations claiming an optimizer ran


def test_v11_active_cold_bay_and_handler_capacity_with_bruteforce_oracle():
    """Independent oracle when servers and cold bays are already occupied."""
    rng=random.Random(1167)
    for trial in range(130):
        tick=rng.randrange(4,32)
        capacity=rng.randrange(2,7)
        cold_bays=rng.randrange(0,4)
        used=rng.randrange(0,capacity+1)
        active_cold=rng.randrange(0,min(used,cold_bays)+1)
        active=[{'job':{'cold':i<active_cold}} for i in range(used)]
        jobs=[{'id':f'R{trial}-{k}','admit_tick':rng.randrange(0,tick),
               'deadline_tick':tick+rng.randrange(-8,13),'duration':rng.randrange(1,8),
               'priority':rng.randrange(1,4),'cold':bool(rng.randrange(2)),
               'network_at_risk':bool(rng.randrange(2)),
               'blocked_reason':None if rng.randrange(5) else 'CUSTOMS'}
               for k in range(rng.randrange(0,11))]
        chosen,_=select_v11(jobs,active,tick,capacity,capacity,cold_bays)
        slots=capacity-used;cool=cold_bays-active_cold
        assert len(chosen)<=slots
        assert sum(j['cold'] for j in chosen)<=cool
        assert all(j['blocked_reason'] is None for j in chosen)
        if slots>1:
            feasible=[j for j in jobs if j['blocked_reason'] is None]
            oracle=max((sum(_score(j,tick) for j in ss)
                for n in range(len(feasible)+1)
                for ss in itertools.combinations(feasible,n)
                if n<=slots and sum(j['cold'] for j in ss)<=cool),default=0)
            assert math.isclose(sum(_score(j,tick) for j in chosen),oracle,abs_tol=1e-8)


def test_v11_negative_and_no_benefit_cases_are_disclosed():
    from json import loads
    result=loads((Path(__file__).resolve().parents[1]/'reports'/'V11_OUT_OF_SAMPLE_SEED_2026_500x6.json').read_text())
    crew=next(r for r in result['results'] if r['scenario']=='crew_shortage')
    c=next(x for x in crew['comparisons'] if x['policy']=='RELAY_V11')
    assert c['cost_reduction_pct']==0 and c['on_time_rate_change_pp']==0
    outage=next(r for r in result['results'] if r['scenario']=='temporary_disruption')
    c=next(x for x in outage['comparisons'] if x['policy']=='RELAY_V11')
    assert c['recovery_backlog_90pct_clearance']['conditional_time_reduction_pct']<0
    assert result['flight_recovery_optimization_speedup_pct'] is None


def test_v11_synthetic_cost_accounting_is_exact_sum_of_charges():
    sample={'id':'sample0','admit_tick':1,'deadline_tick':3,'duration':6,
            'priority':2,'cold':False,'network_at_risk':False,'blocked_reason':None}
    report=run_episode({1:[sample]},SCENARIOS['normal'],horizon=2,drain=9)
    for p in report['policies'].values():
        assert math.isclose(p['cost'],p['holding_cost']+p['handling_cost']+p['late_cost']+p['unresolved_penalty'],abs_tol=1e-9)
        assert p['on_time']+p['missed_cohort']==1
        assert p['unsafe_assignments']==0


def test_v11_frontend_static_assets_available_and_scope_labels_present():
    with TestClient(app) as client:
        for path in ('/v10.css','/v10_scene.js','/v10_ui.js','/v9_scene.js'):
            r=client.get(path)
            assert r.status_code==200 and len(r.content)>1000
        # Running v11 servers already serve /v10.css before the new controls ship.
        page = client.get('/v11').text
        assert 'href="/v10.css"' in page
        assert 'href="/v11.css"' not in page
        assert '.simulation-controls {' in client.get('/v10.css').text
        doc=client.get('/v11/evidence').text
        assert 'NOT airline ROI' in doc or 'not a claim of airline ROI' in doc
        assert 'Model I' in doc and 'Model II' in doc and 'Model III' in doc


def test_v11_capacity_reduction_does_not_crash_active_nonpreemptive_cold_work():
    # Active cold work began before a simulated outage reduced cold_bays to 0.
    # We must not newly allocate cold work, but already-active work remains.
    tick=20
    active=[{'job':{'id':'already-working','cold':True},'remaining':2}]
    jobs=[{'id':'general','admit_tick':1,'deadline_tick':30,'duration':2,
           'priority':2,'cold':False,'blocked_reason':None},
          {'id':'new-cold','admit_tick':2,'deadline_tick':30,'duration':2,
           'priority':3,'cold':True,'blocked_reason':None}]
    chosen,_=select_v11(jobs,active,tick,handlers=4,stands=4,cold_bays=0)
    assert [j['id'] for j in chosen]==['general']


def test_v11_advanced_reports_and_figures_are_real_files_and_safe():
    root=Path(__file__).resolve().parents[1]
    with TestClient(app) as client:
        for fn in (
            'V11_STATISTICAL_CONVERGENCE.png',
            'V11_ROI_SENSITIVITY_HYPOTHETICAL.png',
            'V11_FINITE_MILP_RUNTIME.png',
            'V11_BACKLOG_RECOVERY_COUNTEREXAMPLE.png',
        ):
            response=client.get('/v11/chart/'+fn)
            assert response.status_code==200 and response.content.startswith(b'\x89PNG')
        assert client.get('/v11/chart/surprise.png').status_code==404
        meta=client.get('/v11/api/advanced-data').json()
        assert meta['synthetic_only'] is True
        assert 'hypothetical_roi' in meta
        assert (root/'reports/V11_EPISODE_LEVEL_DATA_500x6.csv').exists()
        html=client.get('/v11/evidence').text
        assert 'NOT observed airline savings' in html or 'not a claim of airline ROI' in html
        assert 'V11_FINITE_MILP_RUNTIME.png' in html
