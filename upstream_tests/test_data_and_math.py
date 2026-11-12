import itertools,math,collections,json
from datetime import timedelta
from pathlib import Path
from relay.synthetic import load_jsonl,START,END,calibration
from relay.schemas import parse_time,ts,Flight,Shipment,Piece,EventIn
from relay.state import project
from relay.models import model1_placement,model2_pivot,cluster_exchange_fixture,cvar
from relay.fixtures import scarcity
from relay.engine import evaluate,customer_track
from relay.schemas import EvaluationRequest
from relay.routing import solve_global


def test_exact_30_day_event_interval(dataset):
    ev=load_jsonl(dataset/'historical_events.jsonl')
    assert len(ev)>3000
    assert all(START<=parse_time(e['received_at'])<END for e in ev)
    assert all(parse_time(e['event_time'])<=parse_time(e['received_at']) for e in ev)
    assert len({e['event_id'] for e in ev})==len(ev)
    assert all(e['received_at'].endswith('Z') and '.' not in e['received_at'] for e in ev)


def test_strict_data_referential_integrity(dataset):
    f=load_jsonl(dataset/'flights.jsonl');s=load_jsonl(dataset/'shipments.jsonl');p=load_jsonl(dataset/'pieces.jsonl')
    fs={x['id'] for x in f};ss={x['id'] for x in s}
    assert len(fs)==len(f) and len(ss)==len(s)
    assert len(set(x['awb'] for x in s))==len(s)
    by=collections.defaultdict(int)
    for piece in p:
        assert piece['shipment_id'] in ss
        by[piece['shipment_id']]+=piece['weight_kg']
    assert all(by[x['id']]==x['weight_kg'] and x['booked_flight_id'] in fs for x in s)
    for x in f:Flight(**x)
    for x in s:Shipment(**x)
    for x in p:Piece(**x)


def test_no_departure_on_canceled_flight(dataset):
    ev=load_jsonl(dataset/'historical_events.jsonl')
    canceled={x['entity_id'] for x in ev if x['event_type']=='flight_cancelled'}
    assert not any(x['event_type']=='shipment_milestone' and x['payload'].get('code')=='DEP' and x['payload'].get('flight_id') in canceled for x in ev)


def test_state_snapshot_no_future_leak(repo):
    x=project(repo,'2026-11-09T01:00:00Z')
    assert x['calibration']['training_cutoff']=='2026-11-09T00:00:00Z'
    assert len(x['shipments'])>0
    for s in x['shipments'].values(): assert parse_time(s['created_at'])<=parse_time(x['as_of'])
    for e in x['recent_evidence']:assert e['received_at']<=x['as_of']
    before=project(repo,'2026-10-15T01:00:00Z')
    assert before['calibration']['training_flights']<x['calibration']['training_flights']
    assert before['evidence_applied_count']<x['evidence_applied_count']


def test_pivot_exact_decomposition_and_expiry():
    for p in [.0,.03,.15,.3,.5,.9,1]:
        for expiry in [0,.05,.2,.9,1]:
            x=model2_pivot(prior=p,expiry=expiry)
            z=x['identity']
            assert abs(x['verification_net_value'] - z['I_minus_A_minus_B_minus_c'])<2e-5
            assert abs(sum(o['joint_probability'] for o in x['options_after_verification'])-1)<1e-5
    assert model2_pivot(.4,expiry=.9)['cost_verify']>model2_pivot(.4,expiry=0)['cost_verify']


def test_cvar_exact_atom_and_bounds():
    assert cvar([0.,100.],[.9,.1],.9)==100
    assert abs(cvar([0.,100.],[.95,.05],.9)-50)<1e-9


def test_2d_packing_risk_dominance(repo):
    st=project(repo,repo.clock());p=list(st['pieces'].values())[:4]
    # Choose PMC whose 2x2 slot (155 x 105) accommodates synthetic generated pieces.
    u=next(x for x in st['ulds'].values() if x['uld_type']=='SYN-PMC')
    r=model1_placement(p,u,st['calibration'],nominal_budget=3)
    assert r['status']=='EXACT_OPTIMUM_WITHIN_2D_CANDIDATE_LIBRARY'
    assert r['options_evaluated']==24*1 # permutations of 4 distinct items in 4 slots
    assert r['risk_aware']['nominal_handling_cost_units']<=r['baseline']['nominal_handling_cost_units']+3+1e-9
    assert r['risk_aware']['risk_objective_units']<=r['baseline']['risk_objective_units']+1e-9
    slots=[q['slot'] for q in r['risk_aware']['placements']]
    assert len(slots)==len(set(slots))
    assert 'real aircraft contour' in r['not_checked']


def test_cluster_mutation_fixture():
    r=cluster_exchange_fixture()
    assert r['composite_mutation_direction']==[-1,0,1,0] and r['objective_delta']==-6


def test_scarcity_exact_beats_fcfs():
    r=scarcity()['result']
    assert r['status']=='OPTIMAL_ENUMERATED_MILP'
    assert r['metrics']['risk_adjusted_objective']+100<r['baseline_fcfs']['risk_adjusted_objective']
    assigned={p['shipment_id']:p['route'] for p in r['plan']}
    assert assigned=={'LOW':[],'HIGH':['F1']}
    assert r['capacity_usage']['F1']['allocated_kg']==140


def test_engine_end_to_end_and_no_unsafe_commands(repo):
    r=evaluate(repo,EvaluationRequest())
    assert r['status'] in ('PENDING_REVIEW','ADVISORY_ONLY')
    assert r['real_commands_sent'] is False
    assert [x['stage'] for x in r['process_logs']]==['SNAPSHOT','MODEL_I','MODEL_III','MODEL_II','CROSS_MODEL_GATE','GATE']
    assert r['model_iii']['status'].startswith(('OPTIMAL','FEASIBLE','FALLBACK'))
    assert r['model_i']['validity'].startswith('SYNTHETIC')
    assert all(a['proposal_kind']=='REQUEST_CHANGE_PENDING_EXTERNAL_CONFIRMATION' for a in r['proposed_actions'])
    assert r['input_evidence']['calibration']['training_cutoff']<=r['created_at']


def test_customer_projection_has_no_internal_costs(repo):
    r=evaluate(repo,EvaluationRequest())
    sid=r['input_evidence']['shipment_ids'][0]
    s=repo.get_catalog('shipment',sid)
    t=customer_track(repo,s['awb'])
    assert t['awb']==s['awb'] and t['no_operational_commitment']
    assert 'cost' not in str(t).lower()
    assert 'mip_gap' not in str(t)
    assert all('source' in m for m in t['observed_milestones'])
