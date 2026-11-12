import concurrent.futures
import pytest
from relay.schemas import EventIn,EvaluationRequest,ReviewIn,TaskAckIn
from relay.engine import evaluate
from relay.store import Conflict
from relay.state import project


def make_event(i,kind,entity_type,entity_id,received,source,payload,rev=10):
    return EventIn(event_id=i,event_type=kind,entity_type=entity_type,entity_id=entity_id,
        event_time=received,received_at=received,source=source,source_revision=rev,trusted=True,payload=payload)


def test_field_authority_not_universal(repo):
    e=make_event('RECEIPT-SPOOF','capacity_changed','flight','SYN-F30-02',
        '2026-11-09T00:55:00Z','SYNTHETIC_TRACK_TRACE',{'remaining_kg':1,'cool_remaining_kg':0})
    orig=project(repo,repo.clock())['flights']['SYN-F30-02']['remaining_kg']
    out=repo.append_event(e)
    assert out['disposition']=='OBSERVED_UNVERIFIED'
    assert project(repo,repo.clock())['flights']['SYN-F30-02']['remaining_kg']==orig


def test_invalid_mutation_quarantined(repo):
    e=make_event('BAD-DATA','capacity_changed','flight','SYN-F30-02',
        '2026-11-09T00:55:00Z','SYNTHETIC_INVENTORY',{'remaining_kg':-200})
    assert repo.append_event(e)['disposition']=='QUARANTINED'


def test_late_milestones_do_not_rollback_customer_status(repo):
    active=[s for s in project(repo,repo.clock())['shipments'].values() if s['custody_state']=='RECEIVED']
    sid=active[0]['id']
    a=make_event('M-DEP','shipment_milestone','shipment',sid,'2026-11-09T00:34:00Z','SYNTHETIC_TRACK_TRACE',{'code':'DEP','airport':'HKG'},rev=4)
    b=make_event('M-OLD-RCS','shipment_milestone','shipment',sid,'2026-11-09T00:45:00Z','SYNTHETIC_TRACK_TRACE',{'code':'RCS','airport':'HKG'},rev=3)
    repo.append_event(a);repo.append_event(b)
    assert project(repo,repo.clock())['shipments'][sid]['status']=='DEP'
    assert project(repo,repo.clock())['shipments'][sid]['custody_state']=='DEPARTED'


def test_congestion_has_bounded_duration(repo):
    e=make_event('CONGEST','terminal_congestion','terminal','HKG-T1',
       '2026-11-09T00:58:00Z','SYNTHETIC_GROUND_OPS',
       {'capacity_fraction':.55,'duration_seconds':240},rev=100)
    repo.append_event(e)
    assert project(repo,'2026-11-09T01:00:00Z')['terminal_capacity_fraction']==.55
    assert project(repo,'2026-11-09T01:05:00Z')['terminal_capacity_fraction']==1.0


def test_received_time_not_event_time_controls_visibility(repo):
    old=project(repo,'2026-11-09T01:00:00Z')['flights']['SYN-F30-02']['remaining_kg']
    e=EventIn(event_id='LATE-INPUT',event_type='capacity_changed',entity_type='flight',entity_id='SYN-F30-02',
       event_time='2026-11-09T00:30:00Z',received_at='2026-11-09T01:01:00Z',
       source='SYNTHETIC_INVENTORY',source_revision=11,trusted=True,
       payload={'remaining_kg':80,'cool_remaining_kg':20})
    repo.append_event(e)
    assert project(repo,'2026-11-09T01:00:00Z')['flights']['SYN-F30-02']['remaining_kg']==old
    assert project(repo,'2026-11-09T01:02:00Z')['flights']['SYN-F30-02']['remaining_kg']==80


def test_ground_tasks_dependency_and_no_physical_execution(repo):
    d=evaluate(repo,EvaluationRequest())
    a=repo.review(d['id'],ReviewIn(decision='approve',reviewer='Supervisor',expected_snapshot_version=d['snapshot_version'],
                                   idempotency_key='task-review-1'),repo.clock())
    tasks=repo.tasks(d['id']);assert tasks
    first=tasks[0];second=tasks[1]
    assert second['depends_on_task_id']==first['id']
    with pytest.raises(Conflict):
        repo.ack_task(second['id'],TaskAckIn(worker='Ground',status='DONE',idempotency_key='task-out-of-order'),repo.clock())
    x=repo.ack_task(first['id'],TaskAckIn(worker='Ground',status='DONE',idempotency_key='task-first'),repo.clock())
    y=repo.ack_task(second['id'],TaskAckIn(worker='Ground',status='DONE',idempotency_key='task-second'),repo.clock())
    assert x['simulation_only'] and y['simulation_only']
    assert all(not t['physical_execution_permitted'] for t in repo.tasks(d['id']))


def test_parallel_replay_of_same_event_is_safe(repo):
    e=make_event('CONCURRENT-ID','flight_delay','flight','SYN-F30-02',
                 '2026-11-09T00:57:00Z','SYNTHETIC_FLIGHT_OPS',{'delay_seconds':1800})
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        out=list(pool.map(repo.append_event,[e]*12))
    assert sum(not item['duplicate'] for item in out)==1
    assert len([x for x in repo.events(entity_id='SYN-F30-02') if x['event_id']=='CONCURRENT-ID'])==1
