"""Read-only data/provenance and cross-model integrity audit.

Strictly validates generated files; does NOT imply sample is empirically
representative of real Cathay/airport operations.
"""
from __future__ import annotations
import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'


def _ts(value):
    return datetime.fromisoformat(str(value).replace('Z','+00:00'))


def _read(kind):
    return [json.loads(s) for s in (DATA/(kind+'.jsonl')).read_text(encoding='utf-8').splitlines() if s.strip()]


def data_audit():
    kinds=['flights','shipments','pieces','ulds','historical_events']
    records={name:_read(name) for name in kinds}
    errors=[]
    by={k:{item.get('event_id' if k=='historical_events' else 'id'):item for item in vals}
        for k,vals in records.items()}
    for kind,items in records.items():
        key='event_id' if kind=='historical_events' else 'id'
        identifiers=[i.get(key) for i in items]
        if len(identifiers)!=len(set(identifiers)):
            errors.append(f'DUPLICATE_{kind.upper()}_IDENTIFIER')
        if any(not str(i).startswith('SYN-') for i in identifiers if kind!='historical_events'):
            errors.append(f'UNLABELLED_{kind.upper()}')
    pieces=by['pieces'];flights=by['flights'];shipments=by['shipments']
    for s in shipments.values():
        if any(pid not in pieces for pid in s['piece_ids']): errors.append(f'MISSING_PIECE:{s["id"]}')
        known=[pieces[i]['weight_kg'] for i in s['piece_ids'] if i in pieces]
        if len(known)==len(s['piece_ids']) and sum(known)!=s['weight_kg']:
            errors.append(f'WEIGHT_MISMATCH:{s["id"]}')
        for k in ('assigned_flight_id','booked_flight_id'):
            if s.get(k) and s[k] not in flights:errors.append(f'UNKNOWN_FLIGHT:{s["id"]}:{k}')
        if not (_ts(s['created_at'])<=_ts(s['accepted_at'])<=_ts(s['deadline'])):
            errors.append(f'BAD_SHIPMENT_TIMESTAMPS:{s["id"]}')
    for p in pieces.values():
        if p['shipment_id'] not in shipments:errors.append(f'UNKNOWN_SHIPMENT:{p["id"]}')
        if p['weight_kg']<=0 or any(p[k]<=0 for k in ('length_cm','width_cm','height_cm')):
            errors.append(f'NONPOSITIVE_PIECE_GEOMETRY:{p["id"]}')
    for f in flights.values():
        if not (_ts(f['scheduled_departure'])<_ts(f['scheduled_arrival'])):
            errors.append(f'NONPOSITIVE_FLIGHT_DURATION:{f["id"]}')
        if f['remaining_kg']<0 or not 0<=f['cool_remaining_kg']<=f['remaining_kg']:
            errors.append(f'INVALID_FLIGHT_CAPACITY:{f["id"]}')
    received_times=[]
    event_types=Counter()
    for e in records['historical_events']:
        event_types[e['event_type']]+=1
        try:
            event_time=_ts(e['event_time']);received=_ts(e['received_at'])
            received_times.append(received)
            if event_time>received: errors.append(f'FUTURE_RECEIPT:{e["event_id"]}')
        except Exception:errors.append(f'INVALID_EVENT_TIME:{e.get("event_id")}')
        if e.get('entity_type')=='shipment' and e['entity_id'] not in shipments:
            errors.append(f'UNKNOWN_EVENT_SHIPMENT:{e["event_id"]}')
        if e.get('entity_type')=='flight' and e['entity_id'] not in flights:
            errors.append(f'UNKNOWN_EVENT_FLIGHT:{e["event_id"]}')
    if received_times!=sorted(received_times):errors.append('RECEIPT_TIMES_OUT_OF_ORDER_FILE')
    return {'status':'PASS' if not errors else 'FAIL','error_count':len(errors),
        'errors':errors[:50],'counts':{k:len(v) for k,v in records.items()},
        'event_type_counts':dict(sorted(event_types.items(),key=lambda x:-x[1])),
        'timestamp_order_tested':True,
        'data_origin':'DETERMINISTIC_SYNTHETIC_GENERATOR_NOT_CATHAY',
        'external_distribution_calibration':False,
        'safety_certification':False,
        'interpretation':'Referential integrity and structural validity only; not empirical authenticity.'}


def live_consistency(conductor):
    """Audit a CURRENT shared snapshot, without advancing or mutating it."""
    s=conductor.snapshot()
    d=conductor.lab.latest or {}
    clocks=s.get('view_clock_contract',{})
    plan={x['shipment_id'] for x in d.get('plan',[])}
    uncertainty=set(d.get('model_ii',{}).get('affected_shipments',[]))
    proposals=d.get('proposed_actions',[])
    errors=[]
    if not (clocks.get('ground_tick')==clocks.get('tower_tick')==clocks.get('customer_tick')==s['tick']):
        errors.append('CROSS_TWIN_CLOCK_MISMATCH')
    if any(p['shipment_id'] not in plan for p in proposals):
        errors.append('PROPOSAL_MISSING_FROM_SOLVED_PLAN')
    if any(p['shipment_id'] in uncertainty for p in proposals):
        errors.append('UNCERTAIN_SHIPMENT_RECOMMENDED_FOR_RECOVERY')
    if any(p.get('route_status')!='PROPOSAL_NOT_BOOKED' for p in proposals):
        errors.append('UNCONFIRMED_ROUTE_MISREPRESENTED')
    if s.get('physical_execution') is not False or s.get('real_customer_notifications') is not False:
        errors.append('REAL_ACTION_CLAIMED')
    if any(p.get('unsafe_dispatches',0) for p in s['policies'].values()):
        errors.append('UNSAFE_STAGING_DISPATCH')
    if s.get('portfolio_coverage',{}).get('admitted')!=s.get('portfolio_coverage',{}).get('shown'):
        errors.append('MISSING_CUSTOMER_PORTFOLIO_ITEMS')
    scope=s.get('decision_scope',{})
    current=s.get('snapshot_version')
    source_version=d.get('snapshot_version')
    # A snapshot can be made stale by a new event; it must not be presented
    # as a CURRENT authoritative plan. Report stale as status, not a false fail.
    return {'status':'PASS' if not errors else 'FAIL','errors':errors,'tick':s['tick'],
            'snapshot_version':current,'decision_snapshot_version':source_version,
            'decision_stale':source_version!=current,'plan_shipments':len(plan),
            'blocked_uncertain_shipments':len(uncertainty),
            'proposed_actions':len(proposals),
            'portfolio_count':s.get('portfolio_coverage',{}).get('shown'),
            'simulated_only':True,
            'note':'Model I physical certification, carrier confirmation, and true ground equipment tracking not established.'}
