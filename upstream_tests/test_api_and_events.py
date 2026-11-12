import pytest
from fastapi.testclient import TestClient
from relay.schemas import EventIn,EvaluationRequest,ReviewIn
from relay.engine import evaluate,customer_track
from relay.state import project
from relay.store import Conflict
from relay.simulator import tick,paired_benchmark
from relay.fixtures import scarcity


def evt(id='E-TEST-01',etype='capacity_changed',fid='SYN-F30-02',trusted=True,source='SYNTHETIC_INVENTORY'):
    return EventIn(event_id=id,event_type=etype,entity_type='flight',entity_id=fid,
       event_time='2026-11-09T00:40:00Z',received_at='2026-11-09T00:40:11Z',
       source=source,source_revision=7,trusted=trusted,
       payload={'remaining_kg':120,'cool_remaining_kg':10})


def test_unverified_external_cannot_change_capacity(repo):
    orig=project(repo,repo.clock())['flights']['SYN-F30-02']['remaining_kg']
    e=evt(source='OAG_EXTERNAL_UNVERIFIED',trusted=True)
    x=repo.append_event(e);assert x['disposition']=='OBSERVED_UNVERIFIED'
    assert project(repo,repo.clock())['flights']['SYN-F30-02']['remaining_kg']==orig
    assert len(repo.logs('INPUT'))==1


def test_trusted_capacity_event_idempotent_and_audited(repo):
    x=repo.append_event(evt()); assert x['disposition']=='ACCEPTED'
    assert project(repo,repo.clock())['flights']['SYN-F30-02']['remaining_kg']==120
    y=repo.append_event(evt());assert y['duplicate'] and y['snapshot_version']==x['snapshot_version']
    bad=evt();bad.payload={'remaining_kg':199,'cool_remaining_kg':10}
    with pytest.raises(Conflict):repo.append_event(bad)


def test_invalid_times_rejected():
    with pytest.raises(ValueError):EventIn(event_id='BAD',event_type='flight_delay',entity_type='flight',entity_id='F',
        event_time='2026-11-09T01:00:00Z',received_at='2026-11-09T00:00:00Z',source='X',payload={})


def test_stale_review_rejected(repo):
    d=evaluate(repo,EvaluationRequest())
    assert d['status']=='PENDING_REVIEW' # current future synthetic day has proposed reroutes
    repo.append_event(evt())
    req=ReviewIn(decision='approve',reviewer='Demo manager',expected_snapshot_version=d['snapshot_version'],idempotency_key='review-1')
    with pytest.raises(Conflict):repo.review(d['id'],req,repo.clock())


def test_review_and_tasks_do_not_change_booking_without_confirmation(repo):
    d=evaluate(repo,EvaluationRequest())
    req=ReviewIn(decision='approve',reviewer='Operations supervisor',expected_snapshot_version=d['snapshot_version'],idempotency_key='review-2')
    out=repo.review(d['id'],req,repo.clock())
    assert out['status']=='APPROVED_SIMULATION_ONLY' and not out['real_world_execution']
    assert len(out['task_ids'])==4*len(d['proposed_actions'])>0
    assert repo.review(d['id'],req,repo.clock())==out
    for a in d['proposed_actions']:
        t=customer_track(repo,repo.get_catalog('shipment',a['shipment_id'])['awb'])
        assert t['recovery_updates']
        assert t['recovery_updates'][0]['carrier_booking_status']=='NOT_CONFIRMED_BY_THIS_APPROVAL'
        assert repo.get_catalog('shipment',a['shipment_id'])['assigned_flight_id']!=a['route'][0]


def test_tick_and_benchmark_are_actual_repeatable(repo):
    d=evaluate(repo,EvaluationRequest())
    x=paired_benchmark(d,10000,seed=12)
    y=paired_benchmark(d,10000,seed=12)
    assert x==y and x['runs']==10000
    z=tick(repo,40)
    assert z['clock']>d['created_at'] and z['ingestion']['disposition']=='ACCEPTED'


def test_api_openapi_and_three_outputs(repo,monkeypatch,dataset):
    import relay.api as api
    monkeypatch.setattr(api,'store',repo)
    monkeypatch.setattr(api,'DATA_DIR',dataset)
    with TestClient(api.app) as client:
        h=client.get('/health');assert h.status_code==200
        assert '/v1/decisions/evaluate' in client.get('/openapi.json').json()['paths']
        d=client.post('/v1/decisions/evaluate',json={});assert d.status_code==200,d.text
        d=d.json()
        assert client.get('/v1/logs',params={'category':'PROCESS'}).json()['items']
        assert client.get('/v1/logs',params={'category':'DECISION'}).json()['items']
        ev=client.post('/v1/events',json=evt().model_dump(),headers={'X-Relay-Sandbox-Role':'simulator'});assert ev.status_code==201
        assert client.get('/v1/logs',params={'category':'INPUT'}).json()['items']
        assert client.post('/v1/decisions/'+d['id']+'/review',json={
          'decision':'approve','reviewer':'a','expected_snapshot_version':d['snapshot_version'],
          'idempotency_key':'review-id-1'}).status_code==422  # reviewer too short
        assert client.get('/v1/digital-twin/state').status_code==200
        assert client.get('/v1/research/scarcity-case').status_code==200


def test_policy_and_review_requires_sandbox_role(repo,monkeypatch,dataset):
    import relay.api as api
    monkeypatch.setattr(api,'store',repo)
    monkeypatch.setattr(api,'DATA_DIR',dataset)
    with TestClient(api.app) as client:
        r=client.put('/v1/autonomy-policy',json={'mode':'BOUNDED_AUTO'})
        assert r.status_code==403
        q=client.put('/v1/autonomy-policy',headers={'X-Relay-Sandbox-Role':'supervisor'},json={'mode':'BOUNDED_AUTO'})
        assert q.status_code==200
        assert q.json()['real_operational_auto_execution'] is False
        d=client.post('/v1/decisions/evaluate',json={}).json()
        assert d['review_required'] is True
        a=client.post(f'/v1/decisions/{d["id"]}/review',json={
          'decision':'approve','reviewer':'Supervisor','expected_snapshot_version':d['snapshot_version'],
          'idempotency_key':'review-id-2'})
        assert a.status_code==403


def test_dimension_conflict_blocks_routing(repo):
    d=evaluate(repo,EvaluationRequest())
    sid=d['input_evidence']['shipment_ids'][0]
    e=EventIn(event_id='CONFLICT-S1',event_type='shipment_dimension_conflict',entity_type='shipment',entity_id=sid,
        event_time='2026-11-09T00:35:00Z',received_at='2026-11-09T00:35:03Z',
        source='SYNTHETIC_MEASUREMENT',source_revision=8,trusted=True,payload={'reason':'actual dimensions conflict'})
    repo.append_event(e)
    new=evaluate(repo,EvaluationRequest(shipment_ids=[sid]))
    assert new['model_iii']['excluded'][sid]=='DIMENSIONS_UNVERIFIED_VERIFY_FIRST'
    assert new['action']=='VERIFY_OR_HOLD'
