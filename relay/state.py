"""Deterministic, receipt-time-bounded state projection (no future-data leakage)."""
from __future__ import annotations
from copy import deepcopy
from .schemas import parse_time
from .synthetic import calibration

MILESTONES=['BKD','RCS','DEP','ARR','RCF','NFD','DLV']


def project(store, as_of, include_all=False):
    cutoff=parse_time(as_of)
    flights={x['id']:x for x in store.catalog('flight')}
    shipments={x['id']:x for x in store.catalog('shipment') if parse_time(x['created_at'])<=cutoff}
    pieces={x['id']:x for x in store.catalog('piece') if x['shipment_id'] in shipments}
    ulds={x['id']:x for x in store.catalog('uld')}
    # A synthetic canonical acceptance timestamp is known at/after that time only.
    for s in shipments.values():
        if s['status']=='BKD' and parse_time(s['accepted_at'])<=cutoff:s['status']='RCS'
    catalog_f=list(flights.values());catalog_s=list(shipments.values())
    evs=store.events(until=as_of)
    provenance=[]; milestone_index={s:[] for s in shipments}
    # Sort received-time information, then use field revision (not event insertion order) to guard overwrites.
    latest={}
    conflicts=set(); customs_holds=set(); terminal_capacity_fraction=1.0
    for e in evs:
        if e['disposition'] not in ('ACCEPTED','OBSERVED_UNVERIFIED'):
            continue
        k=e['event_type']; eid=e['entity_id']; body=e['payload']
        if e['disposition']=='OBSERVED_UNVERIFIED':
            if k=='shipment_dimension_conflict' and eid in shipments: conflicts.add(eid)
            continue
        merged_key={'flight_cancelled':'flight_state','flight_restored':'flight_state','flight_state_update':'flight_state',
            'uld_unavailable':'uld_availability','uld_restored':'uld_availability',
            'customs_hold':'customs_state','customs_released':'customs_state',
            'shipment_dimension_conflict':'dimensions_state','shipment_dimension_verified':'dimensions_state'}.get(k,k)
        field_key=(e['entity_type'],eid,merged_key,body.get('code') if k=='shipment_milestone' else '')
        rank=(int(e['source_revision']),e['event_time'],e['event_id'])
        if field_key in latest and latest[field_key]>rank:continue
        latest[field_key]=rank
        applied=False
        if e['entity_type']=='flight' and eid in flights:
            f=flights[eid]
            if k=='flight_cancelled':f['status']='Canceled';applied=True
            elif k=='flight_state_update' and body.get('state') in ('Scheduled','OutGate','InAir','Landed','InGate','Canceled','Diverted'):
                f['status']=body['state'];applied=True
            elif k=='flight_restored':f['status']='Scheduled';applied=True
            elif k=='flight_delay':
                from datetime import timedelta
                from .schemas import ts
                d=int(body.get('delay_seconds',0))
                if 0<=d<=86400:
                    f['estimated_departure']=ts(parse_time(f['scheduled_departure'])+timedelta(seconds=d))
                    f['estimated_arrival']=ts(parse_time(f['scheduled_arrival'])+timedelta(seconds=d))
                    applied=True
            elif k=='capacity_changed':
                rem=body.get('remaining_kg');cool=body.get('cool_remaining_kg')
                if isinstance(rem,int) and 0<=rem<=5000 and (cool is None or (isinstance(cool,int) and 0<=cool<=rem)):
                    f['remaining_kg']=rem
                    if cool is not None:f['cool_remaining_kg']=cool
                    else:f['cool_remaining_kg']=min(f['cool_remaining_kg'],rem)
                    applied=True
        elif e['entity_type']=='shipment' and eid in shipments:
            s=shipments[eid]
            if k=='shipment_dimension_conflict':conflicts.add(eid);applied=True
            elif k=='shipment_dimension_verified':
                pid=body.get('piece_id');dims=body.get('dimensions_cm')
                if pid in pieces and pieces[pid]['shipment_id']==eid and isinstance(dims,list) and len(dims)==3 and all(isinstance(n,int) and 0<n<600 for n in dims):
                    pieces[pid].update(zip(['length_cm','width_cm','height_cm'],dims))
                    pieces[pid]['dimensions_verified']=True
                    conflicts.discard(eid);applied=True
            elif k=='customs_hold':customs_holds.add(eid);applied=True
            elif k=='customs_released':customs_holds.discard(eid);applied=True
            elif k=='customer_priority_update' and body.get('service') in ('STANDARD','PRIORITY','CRITICAL'):
                s['service']=body['service'];applied=True
            elif k=='booking_change' and body.get('confirmation')=='CONFIRMED' and body.get('flight_id') in flights:
                s['assigned_flight_id']=body['flight_id'];applied=True
            elif k=='shipment_milestone' and body.get('code') in MILESTONES:
                milestone_index[eid].append({'code':body['code'],'event_time':e['event_time'],
                      'received_at':e['received_at'],'airport':body.get('airport'),
                      'source':e['source'],'confidence':'OBSERVED_SYNTHETIC'})
                if body['code'] in ('DLV','DEP','ARR','RCF','NFD','RCS') and MILESTONES.index(body['code'])>=MILESTONES.index(s['status'] if s['status'] in MILESTONES else 'BKD'):
                    s['status']=body['code']
                    if body['code']=='DLV':s['custody_state']='DELIVERED'
                    elif body['code']=='DEP':s['custody_state']='DEPARTED'
                    elif body['code'] in ('ARR','RCF','NFD'):s['custody_state']='ARRIVED'
                    applied=True
        elif e['entity_type']=='uld' and eid in ulds:
            if k=='uld_unavailable':ulds[eid]['availability']='DAMAGED';applied=True
            elif k=='uld_restored':ulds[eid]['availability']='AVAILABLE';applied=True
        elif e['entity_type']=='terminal' and k=='terminal_congestion':
            frac=body.get('capacity_fraction',1.0)
            duration=body.get('duration_seconds',3*3600)
            if isinstance(frac,(int,float)) and .2<=frac<=1.0 and isinstance(duration,int) and 0<duration<=86400:
                if parse_time(e['event_time'])<=cutoff<parse_time(e['event_time'])+__import__('datetime').timedelta(seconds=duration):
                    terminal_capacity_fraction=frac;applied=True
        if applied:
            provenance.append({'event_id':e['event_id'],'event_type':k,'entity_id':eid,'received_at':e['received_at']})
    for sid,s in shipments.items():
        s['dimension_conflict']=sid in conflicts
        s['customs_hold']=sid in customs_holds
    for mil in milestone_index.values():mil.sort(key=lambda x:x['event_time'])
    training_events=store.events(until=as_of)
    result={'as_of':as_of,'snapshot_version':store.version(),'flights':flights,'shipments':shipments,'pieces':pieces,
        'ulds':ulds,'milestones':milestone_index,'terminal_capacity_fraction':terminal_capacity_fraction,
        'calibration':calibration(training_events,catalog_f,catalog_s,as_of),
        'evidence_applied_count':len(provenance),'recent_evidence':provenance[-12:]}
    if not include_all:
        # Many historical records are retained in DB; only near-horizon flights are exposed in compact twin state.
        from datetime import timedelta
        floor=cutoff-timedelta(hours=10);ceiling=cutoff+timedelta(days=3)
        result['flights']={k:f for k,f in flights.items() if floor<=parse_time(f['scheduled_departure'])<=ceiling}
        result['shipments']={k:s for k,s in shipments.items() if s['status']!='DLV' and parse_time(s['accepted_at'])<=cutoff+timedelta(days=2)}
        result['pieces']={k:p for k,p in pieces.items() if p['shipment_id'] in result['shipments']}
    return result
