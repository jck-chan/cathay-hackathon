"""Independent invariants for v7 synthetic business→ground→control→customer flow."""
import math, random, pytest
from v7_product import V7Lab,experiment_grid
from geometry3d import preflight,no_overlap
from relay.schemas import parse_time

@pytest.fixture
def lab():
    x=V7Lab(seed=818)
    yield x
    x._tmp.cleanup()

def test_three_way_canonical_admission(lab):
    old=lab.snapshot()['work_orders_total']
    obj=lab.create_order('NRT',135,'GENERAL','PRIORITY',70,55,45)
    s=obj['state'];sid=obj['shipment_id'];track=obj['tracking']
    assert s['work_orders_total']==old+1
    assert sid in {r['id'] for r in s['shipment_objects']}
    for p in lab.policies.values():assert sid in {j['id'] for j in p['waiting']}
    assert track['ground_twin']['phase']=='WAIT'
    assert track['route_decision']['original_assigned_flight_id'] is None
    assert track['route_decision']['carrier_confirmed'] is False
    assert any(x['kind']=='CUSTOMER_REQUEST_ACCEPTED' for x in track['journey_events'])
    assert all(x.get('real_customer_notification') is not True for x in track['journey_events'])

def test_customer_observation_is_not_staging(lab):
    awb=lab.sample_awb();before=lab.customer_journey(awb)
    lab.step(3,chaos=0)
    after=lab.customer_journey(awb)
    assert after['real_customer_notifications_sent'] is False
    assert all(x['authority']!='SIMULATED_GROUND_STATE' or not x['observed'] for x in after['journey_events'])
    assert len(after['journey_events'])>=len(before['journey_events'])
    assert after['route_decision']['carrier_confirmed'] is False

def test_incident_recomputes_and_exposes_gate(lab):
    s=lab.incident('shipment_dimension_conflict')
    sid=s['latest_event']['entity_id'];doc=lab.customer_journey(lab.store.get_catalog('shipment',sid)['awb'])
    assert any(x['kind']=='DISRUPTION_OBSERVED' for x in doc['journey_events'])
    assert sid not in {p['shipment_id'] for p in (lab.latest or {}).get('proposed_actions',[])}
    assert doc['route_decision']['carrier_confirmed'] is False

def test_fast_forward_real_time_and_shared_work(lab):
    old=lab.snapshot();new=lab.fast_forward(16,2.0,0,3,1,3)
    assert new['tick']==old['tick']+16
    assert (parse_time(new['clock'])-parse_time(old['clock'])).total_seconds()==16*600
    assert new['fast_forward']['processed_ticks']==16
    assert new['fast_forward']['simulated_minutes_advanced']==160
    assert new['policies']['fcfs']['unsafe_dispatches']==0
    assert new['policies']['relay']['unsafe_dispatches']==0
    assert len(new['journey_activity'])>len(old['journey_activity'])

def test_3d_synthetic_envelope_rigorous_no_overlap():
    rng=random.Random(25)
    uld={'id':'T','usable_length_cm':300,'usable_width_cm':200,'tare_kg':100,'max_gross_kg':1200}
    for _ in range(125):
        items=[{'id':f'P{i}','length_cm':rng.randint(35,120),'width_cm':rng.randint(30,100),
                'height_cm':rng.randint(30,160),'weight_kg':rng.randint(20,200)} for i in range(7)]
        r=preflight(items,uld,145)
        for x in r['placements']:
            assert x['x_cm']>=0 and x['y_cm']>=0 and x['z_cm']==0
            assert x['x_cm']+x['length_cm']<=300
            assert x['y_cm']+x['width_cm']<=200
            assert x['height_cm']<=145
        assert all(no_overlap(a,b) for i,a in enumerate(r['placements']) for b in r['placements'][i+1:])
        assert sum(x['weight_kg'] for x in r['placements'])<=1100
        assert r['independent_real_aircraft_certification'] is False

def test_3d_height_constraint_changes_preflight():
    u={'id':'U','usable_length_cm':300,'usable_width_cm':200,'tare_kg':0,'max_gross_kg':1000}
    p=[{'id':'P','weight_kg':10,'length_cm':60,'width_cm':50,'height_cm':125}]
    assert not preflight(p,u,100)['placements']
    assert len(preflight(p,u,150)['placements'])==1

def test_experiment_reports_both_gain_and_regression(lab):
    r=experiment_grid(lab,100,707)
    assert len(r['results'])==5
    assert r['empirical_cathay_validation'] is False
    assert all(0<=x['regression_fraction']<=1 for x in r['results'])
    assert all(len(x['confidence_interval_mc_95'])==2 for x in r['results'])
