"""v5 contract, math oracle, evidence integrity and API adversarial regression tests.
No real airline operations or licensed OAG data are involved.
"""
import itertools, json, math, random
from datetime import datetime,timedelta,timezone
from pathlib import Path
import pytest
from relay.models import cvar,model2_pivot,model1_placement
from relay.routing import solve_global,scenarios,candidate_routes,route_costs,risk_score
from relay.schemas import ts
from v5_lab import AuditedLab,audit_lab,data_quality_report
from oag_bridge import normalize_envelope,normalize_instance,synthetic_v2_sample

@pytest.fixture
def lab():
    x=AuditedLab(seed=2048)
    yield x
    x._tmp.cleanup()

@pytest.mark.parametrize('seed',[2,607,2048])
def test_replay_determinism_and_both_worlds_same_work_ids(seed):
    x=AuditedLab(seed=seed)
    y=AuditedLab(seed=seed)
    try:
        for _ in range(2):
            a=x.step(1,1.5,.3,3,1,3);b=y.step(1,1.5,.3,3,1,3)
            assert a['shipment_objects']==b['shipment_objects']
            assert a['policies']['relay']['selected']==b['policies']['relay']['selected']
            assert a['policies']['fcfs']['selected']==b['policies']['fcfs']['selected']
            assert audit_lab(x)['runtime_pass']==audit_lab(x)['runtime_total']
    finally:x._tmp.cleanup();y._tmp.cleanup()


def test_all_canonical_input_integrity_checks_pass():
    result=data_quality_report()
    assert result['pass_count']==result['check_count']
    assert result['catalog_counts']=={'flights':429,'shipments':636,'pieces':793,'ulds':14,'historical_events':5120}
    assert result['calibration']=='SYNTHETIC_NOT_EMPIRICALLY_VALIDATED'


def test_exact_discrete_cvar_by_direct_tail_integration():
    rng=random.Random(97)
    for _ in range(500):
        raw=[rng.random() for _ in range(4)]
        p=[x/sum(raw) for x in raw]
        losses=[rng.randrange(0,35) for _ in range(4)]
        a=rng.uniform(.1,.95)
        v=cvar(losses,p,a)
        # Integral of upper quantile, direct atom-tail mass from largest losses.
        remaining=1-a; tail_cost=0.0
        for l,q in sorted(zip(losses,p),reverse=True):
            used=min(remaining,q)
            tail_cost+=l*used;remaining-=used
            if remaining<=1e-12:break
        assert math.isclose(v,tail_cost/(1-a),rel_tol=1e-10,abs_tol=1e-9)


def test_bayesian_identity_randomized_and_probability_mass():
    r=random.Random(242)
    for _ in range(400):
        prior=r.random(); sensitivity=r.random();fp=r.random();expiry=r.random()
        costs={'HOLD':[r.uniform(1,100),r.uniform(100,600)],
               'ASSESS_RECOVERY':[r.uniform(1,180),r.uniform(180,600)]}
        d=model2_pivot(prior,sensitivity,fp,expiry,inspection_cost=4,delay_cost=3,costs=costs)
        assert math.isclose(sum(x['joint_probability'] for x in d['options_after_verification']),1.,abs_tol=2e-6)
        assert abs(d['verification_net_value'] - (d['cost_immediate']-d['cost_verify']))<1e-4
        assert abs(d['verification_net_value']-d['identity']['I_minus_A_minus_B_minus_c'])<1e-4
        assert d['downstream_cost_provenance']=='LOCAL_CANDIDATE_ROUTE_COST_PROXY_NOT_JOINT_MILP'


def test_uld_risk_never_worse_than_baseline_under_budget():
    r=random.Random(46)
    u={'availability':'AVAILABLE','usable_length_cm':300,'usable_width_cm':230,'tare_kg':50,'max_gross_kg':1200}
    for _ in range(100):
        pp=[{'id':str(i),'length_cm':r.randrange(10,90),'width_cm':r.randrange(10,95),
             'weight_kg':r.randrange(1,30),'special_handling':r.choice(['GENERAL','COL'])} for i in range(4)]
        d=model1_placement(pp,u,{'dimension_conflict_rate':r.random()*.1},alpha=.9)
        assert d['status']=='EXACT_OPTIMUM_WITHIN_2D_CANDIDATE_LIBRARY'
        assert d['risk_aware']['nominal_handling_cost_units']<=d['baseline']['nominal_handling_cost_units']+2.5+1e-8
        assert d['risk_aware']['risk_objective_units']<=d['baseline']['risk_objective_units']+1e-8
        assert d['validity'].startswith('SYNTHETIC_2D')


def _small_milp_snapshot():
    # Two 100 kg flights, two 75 kg shipments. Both cannot take same leg.
    now='2026-11-09T00:00:00Z';dep='2026-11-09T05:00:00Z';arr='2026-11-09T10:00:00Z'
    fs={}
    for i in range(2):
        key=f'F{i}'
        fs[key]={'id':key,'origin':'HKG','destination':'NRT','estimated_departure':f'2026-11-09T{5+i:02d}:00:00Z',
                 'estimated_arrival':f'2026-11-09T{10+i:02d}:00:00Z','status':'Scheduled','remaining_kg':100,'cool_remaining_kg':40}
    ss={}
    for i in range(2):
        ss[f'S{i}']={'id':f'S{i}','origin':'HKG','destination':'NRT','accepted_at':'2026-11-08T20:00:00Z',
                   'deadline':'2026-11-09T13:00:00Z','custody_state':'RECEIVED','status':'RCS',
                   'handling':'GENERAL','weight_kg':75,'service':'PRIORITY','booked_flight_id':'F0'}
    return {'as_of':now,'flights':fs,'shipments':ss,'calibration':{'delay_rate':.1,'cancellation_rate':.02,'dimension_conflict_rate':.06}}


def test_model_iii_global_integer_capacity_against_exhaustive_oracle():
    snap=_small_milp_snapshot(); alpha=.9; rw=.12
    d=solve_global(snap,['S0','S1'],alpha=alpha,risk_weight=rw,time_limit_s=10.)
    assert d['status']=='OPTIMAL_ENUMERATED_MILP'
    assert d['solver']['mip_gap']<1e-7
    probs=scenarios(snap['calibration'])
    pathsets=[]
    for s in snap['shipments'].values():
        choices=candidate_routes(s,snap['flights'],snap['as_of'])+[[]]
        pathsets.append(choices)
    oracle=math.inf
    for combo in itertools.product(*pathsets):
        counts={'F0':0,'F1':0}
        for path,s in zip(combo,snap['shipments'].values()):
            for leg in path:counts[leg['id']]+=s['weight_kg']
        if any(v>100 for v in counts.values()):continue
        losses=[sum(route_costs(s,p,probs)[k] for s,p in zip(snap['shipments'].values(),combo)) for k in range(len(probs))]
        oracle=min(oracle,risk_score(losses,probs,alpha,rw))
    assert math.isclose(d['metrics']['risk_adjusted_objective'],oracle,abs_tol=.002)
    assert len([x for x in d['plan'] if x['route']])==2
    assert len({x['route'][0] for x in d['plan']})==2


def test_oag_adapter_accepts_published_subset_and_never_invents_capacity(lab):
    raw=lab.sample_oag();out=normalize_envelope(raw)
    assert out['count']>0
    assert all(x['remaining_bookable_cargo_kg'] is None and x['booking_confirmed'] is False for x in out['records'])
    assert len(raw['demoMappings'])==out['count']
    assert raw['source']=='SYNTHETIC_OAG_SCHEMA_ILLUSTRATION_NOT_OAG_SUPPLIED'

@pytest.mark.parametrize('field,value',[
 ('flightNumber','CX123'),('flightNumber',-2),('flightNumber',True),
 ('carrier',{'iata':'ABCD'}),('departure',{'airport':{'iata':'HKG'},'scheduledTime':{'utc':'2026-11-09T12:00:00'}})])
def test_oag_adapter_rejects_invalid_or_ambiguous_records(lab,field,value):
    raw=lab.sample_oag()['data'][0].copy()
    raw[field]=value
    with pytest.raises(ValueError):normalize_instance(raw)


def test_oag_duplicate_rejected(lab):
    x=lab.sample_oag();x['data'].append(x['data'][0])
    with pytest.raises(ValueError,match='duplicate'):normalize_envelope(x)


def test_oag_external_alert_never_edits_authoritative_capacity_or_confirms_booking(lab):
    d=lab.latest;before=lab.store.get_catalog('flight',lab.sample_oag()['demoMappings'][0]['synthetic_relay_flight_id'])
    fid=before['id']
    lab.observe_demo(fid,'Canceled')
    after=lab.store.get_catalog('flight',fid)
    assert after==before
    assert lab.snapshot()['external_evidence']['stale_since_observation']
    with pytest.raises(Exception,match='external observations changed'):
        lab.review('approve',d['id'],d['snapshot_version'])
    lab._evaluate()
    assert lab.oag_decision_revision==lab.oag_revision
