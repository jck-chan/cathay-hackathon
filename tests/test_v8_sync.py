"""Regression tests for the shared clock, projections and simulation controls."""
import time,pytest
from fastapi.testclient import TestClient
from v11.conductor import Conductor
from fusion_app import app
from relay.store import Conflict

@pytest.fixture
def c():
    x=Conductor(seed=2048)
    yield x
    x.pause()
    x.lab._tmp.cleanup()

def test_default_auto_shadow_is_simulation_only(c):
    s=c.snapshot()
    assert s['v8']['mode']=='AUTO_SHADOW'
    assert s['view_clock_contract']['ground_tick']==s['view_clock_contract']['tower_tick']==s['view_clock_contract']['customer_tick']==0
    assert s['physical_execution'] is False and s['real_customer_notifications'] is False

def test_auto_review_does_not_confirm_carrier(c):
    s=c.snapshot()
    assert s['decision']['status']=='APPROVED_SIMULATION_ONLY'
    assert s['tasks']
    assert s['customer_projection']['route_decision']['carrier_confirmed'] is False
    assert s['customer_projection']['route_decision']['review_status']=='INTERNAL_SANDBOX_APPROVED_NOT_CARRIER_CONFIRMED'

def test_ground_customer_order_enters_both_policies_and_tower(c):
    before=c.snapshot()['work_orders_total']
    order=c.order(destination='SYD',weight_kg=125,handling='COL',service='CRITICAL',length_cm=60,width_cm=50,height_cm=40)
    s=c.snapshot(order['awb'])
    assert s['work_orders_total']==before+1
    assert order['shipment_id'] in [j['id'] for j in s['shipment_objects']]
    assert s['customer_projection']['awb']==order['awb']
    assert s['customer_projection']['ground_twin']['phase'] in ('WAIT','HOLD','WORK','DONE')
    assert s['portfolio_coverage']['admitted']==s['portfolio_coverage']['shown']
    assert order['shipment_id'] in {j['id'] for p in c.lab.policies.values() for j in p['waiting']}
    assert any(e['kind']=='ORDER' and e['shipment_id']==order['shipment_id'] for e in s['unified_events'])

def test_shared_time_and_completed_actual_ticks(c):
    s0=c.snapshot();s1=c.step(2)
    assert s1['tick']==s0['tick']+2
    assert s1['view_clock_contract']=={'ground_tick':2,'tower_tick':2,'customer_tick':2,'snapshot_version':s1['snapshot_version']}
    # V9 corrects misleading V8 speed metric: manual Step is not autoplay throughput.
    assert s1['v8']['actual_ticks_per_second']==0
    assert all(p['unsafe_dispatches']==0 for p in s1['policies'].values())

def test_real_disruption_propagates_and_gates(c):
    x=c.incident('shipment_dimension_conflict')
    sid=x['latest_event']['entity_id']
    assert any(e['kind']=='DISRUPTION' and e['entity_id']==sid for e in x['unified_events'])
    assert sid not in {p['shipment_id'] for p in x['decision']['proposed_actions']}
    awb=c.lab.store.get_catalog('shipment',sid)['awb']
    doc=c.snapshot(awb)['customer_projection']
    assert any(e['kind']=='DISRUPTION_OBSERVED' for e in doc['journey_events'])
    assert doc['route_decision']['carrier_confirmed'] is False

def test_speed_target_not_faked(c):
    s=c.set_speed(100)
    assert s['v8']['speed_target']==100
    assert s['v8']['actual_ticks_per_second']==0
    assert s['v8']['target_ticks_per_second']==50.
    with pytest.raises(ValueError):c.set_speed(120)

def test_pause_preempts_cpu_saturated_worker(c):
    c.set_speed(100)
    c.start();t=time.perf_counter();s=c.pause()
    assert not s['v8']['running']
    assert time.perf_counter()-t < 9.0

def test_manual_controls_block_running_steps(c):
    c.start()
    with pytest.raises(Conflict):c.step(1)
    c.pause()
    assert c.step(1)['tick']>=1

def test_review_mode_can_be_changed(c):
    c.set_mode('ADVISORY')
    assert c.snapshot()['v8']['mode']=='ADVISORY'
    c.set_mode('MANUAL_REVIEW')
    assert c.snapshot()['v8']['mode']=='MANUAL_REVIEW'
    c.set_mode('AUTO_SHADOW')
    assert c.snapshot()['v8']['mode']=='AUTO_SHADOW'

def test_all_admitted_orders_projected(c):
    c.step(12)
    for i in range(10):
        c.order(destination='NRT',weight_kg=100,handling='GENERAL',service='PRIORITY',length_cm=50,width_cm=45,height_cm=35)
    s=c.snapshot()
    assert s['work_orders_total']>30
    assert len(s['shipment_objects'])==s['work_orders_total']
    assert not s['portfolio_coverage']['truncated']
    assert s['shipment_objects'][0]['id'].startswith('SYN-DEMO-')

def test_no_external_authority_misrepresentation(c):
    s=c.snapshot()
    assert s['truth_contract']['network']=='SYNTHETIC_SCOPED_MILP_NOT_BOOKING'
    assert s['decision']['model_i']['certificate'] is False
    assert s['customer_projection']['route_decision']['carrier_confirmed'] is False
    assert all(x.get('real_customer_notification') is False for x in s['customer_projection']['journey_events'] if 'real_customer_notification' in x)

def test_same_shipments_cost_and_feasibility(c):
    c.step(3)
    s=c.snapshot()
    assert all(x['unsafe_dispatches']==0 for x in s['policies'].values())
    assert s['decision']['model_iii']['status'] in ('OPTIMAL_ENUMERATED_MILP','TIME_LIMIT_WITH_INCUMBENT','INFEASIBLE')
    assert all(p['shipment_id'] not in {x['shipment_id'] for x in s['decision']['model_ii']['cases']} for p in s['decision']['proposed_actions'])

def test_v11_http_routes_and_validation():
    with TestClient(app) as client:
        assert 'RELAY' in client.get('/').text
        for path in ['/v11/api/state','/v11/api/audit','/v11/api/health','/v11']:
            assert client.get(path).status_code==200,path
        assert client.post('/v11/api/control',json={'action':'speed','speed':101}).status_code==422
        assert client.post('/v11/api/order',json={'destination':'NRT','handling':'DGR'}).status_code==422
        assert client.post('/v11/api/incident',json={'kind':'INVALID'}).status_code==422
        assert client.get('/v11/api/health').json()['actual_airline_commands'] is False
