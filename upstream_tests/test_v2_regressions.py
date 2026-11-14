"""Regression suite for failures revealed by v1 real decision response.

These tests validate the bounded synthetic research engine, never aircraft certification.
"""
from copy import deepcopy
from relay.schemas import EventIn, EvaluationRequest, ReviewIn
from relay.engine import evaluate, customer_track
from relay.state import project
from relay.store import Conflict
import pytest


def inject_uncertainty(repo, sid, index=1):
    e=EventIn(event_id=f'V2-DIM-CONFLICT-{index}', event_type='shipment_dimension_conflict',
        entity_type='shipment', entity_id=sid,
        event_time='2026-11-09T00:34:00Z', received_at='2026-11-09T00:34:01Z',
        source='SYNTHETIC_MEASUREMENT', source_revision=100+index,
        trusted=True, payload={'reason':'verified dimension conflict in synthetic inspection'})
    return repo.append_event(e)


def test_v1_conflicting_case_cannot_be_in_proposals(repo):
    original=evaluate(repo, EvaluationRequest())
    assert original['proposed_actions'], 'Regression scenario requires an original reroute proposal'
    target=original['proposed_actions'][0]['shipment_id']
    assert inject_uncertainty(repo,target)['disposition']=='ACCEPTED'
    updated=evaluate(repo,EvaluationRequest())
    assert target in updated['model_ii']['affected_shipments']
    case=next(x for x in updated['model_ii']['cases'] if x['shipment_id']==target)
    assert case['action'] in ('VERIFY','HOLD','ASSESS_RECOVERY')
    assert case['route_gate']=='BLOCKED_PENDING_INDEPENDENT_PHYSICAL_VERIFICATION'
    assert all(p['shipment_id']!=target for p in updated['proposed_actions'])
    assert updated['model_iii']['excluded'][target]=='DIMENSIONS_UNVERIFIED_VERIFY_FIRST'
    assert updated['cross_model_invariants']['no_uncertain_case_proposed_for_recovery']


def test_uncertainty_is_shipment_specific_not_a_global_hold(repo):
    before=evaluate(repo,EvaluationRequest())
    ids=before['input_evidence']['shipment_ids']
    target=before['proposed_actions'][0]['shipment_id']
    inject_uncertainty(repo,target,2)
    after=evaluate(repo,EvaluationRequest())
    blocked=set(after['model_ii']['affected_shipments'])
    assert blocked=={target}
    assert not blocked.intersection({p['shipment_id'] for p in after['proposed_actions']})
    assert all(p['shipment_id'] in ids for p in after['proposed_actions'])
    assert len(after['model_iii']['plan']) >= 1


def test_uld_batches_cover_more_than_first_four_pieces(repo):
    result=evaluate(repo,EvaluationRequest())
    model=result['model_i']
    assert model['batch_count']>=2, 'Model I must not silently stop at four pieces'
    assert model['candidate_piece_count']>4
    all_ids=[x for b in model['batches'] for x in b['piece_ids']]
    assert len(all_ids)==len(set(all_ids))==model['candidate_piece_count']
    assert model['independent_batches_only']
    assert model['operational_load_certificate'] is False
    assert model['diagnostically_placed_piece_count']+len(model['unplaced_piece_ids'])==len(all_ids)


def test_output_never_implies_booking_or_certification(repo):
    d=evaluate(repo,EvaluationRequest())
    assert d['real_commands_sent'] is False
    assert d['cross_model_invariants']['zero_real_operational_commands']
    assert d['cross_model_invariants']['physical_certification_claimed'] is False
    assert all(a['route_status']=='PROPOSAL_NOT_BOOKED' for a in d['proposed_actions'])
    assert d['model_iii']['constraints_checked']['operator_booking_confirmation'] is False
    assert d['model_iii']['constraints_checked']['certified_3D_ULD_contour'] is False


def test_customer_projection_cannot_leak_recommendation_or_cost(repo):
    d=evaluate(repo,EvaluationRequest())
    target=d['proposed_actions'][0]['shipment_id']
    awb=repo.get_catalog('shipment',target)['awb']
    before=customer_track(repo,awb)
    assert not before['recovery_updates']
    assert 'model_i' not in before and 'model_iii' not in before
    assert 'expected_cost_units' not in str(before)
    repo.review(d['id'],ReviewIn(decision='approve',reviewer='Supervisor',
        expected_snapshot_version=d['snapshot_version'],idempotency_key='v2customer'),repo.clock())
    after=customer_track(repo,awb)
    assert after['recovery_updates']
    assert all(x['status']=='INTERNAL_APPROVAL_ONLY' for x in after['recovery_updates'])
    assert all(x['carrier_booking_status']!='CONFIRMED' for x in after['recovery_updates'])


def test_decision_stale_after_event_and_review_rejected(repo):
    d=evaluate(repo,EvaluationRequest())
    event=EventIn(event_id='V2-CAP-CHANGE',event_type='capacity_changed',entity_type='flight',
        entity_id='SYN-F30-02',event_time='2026-11-09T00:52:00Z',received_at='2026-11-09T00:52:01Z',
        source='SYNTHETIC_INVENTORY',source_revision=105,trusted=True,
        payload={'remaining_kg':60,'cool_remaining_kg':5})
    repo.append_event(event)
    with pytest.raises(Conflict):
        repo.review(d['id'],ReviewIn(decision='approve',reviewer='Supervisor',
            expected_snapshot_version=d['snapshot_version'],idempotency_key='v2stale'),repo.clock())


def test_cursored_logs_no_drop_when_more_than_batch_size(repo):
    for i in range(15):
        e=EventIn(event_id=f'V2-LOG-{i:02d}',event_type='flight_delay',entity_type='flight',
          entity_id='SYN-F30-02',event_time='2026-11-09T00:55:00Z',received_at='2026-11-09T00:55:01Z',
          source='SYNTHETIC_FLIGHT_OPS',source_revision=100+i,trusted=True,
          payload={'delay_seconds':60+i})
        repo.append_event(e)
    cursor=0;seen=[]
    while True:
        chunk=repo.logs_since(cursor,limit=3)
        if not chunk:break
        seen.extend(x['sequence'] for x in chunk)
        cursor=chunk[-1]['sequence']
    assert len(seen)>=15 and seen==sorted(set(seen))
    assert not repo.logs_since(cursor,limit=3)
