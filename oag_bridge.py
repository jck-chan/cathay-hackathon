"""OAG Flight Info v2-shaped PREVIEW adapter. No key, HTTP requests or licensed OAG data.

Documented fields only. The generated sample is synthetic and is *not* represented
as an actual OAG response. It never mutates carrier booking or remaining capacity.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from relay.schemas import parse_time

STATE_MAP={'Scheduled':'Scheduled','Canceled':'Canceled','Cancelled':'Canceled',
           'OutGate':'OutGate','InAir':'InAir','Landed':'Landed','InGate':'InGate',
           'Proposed':'Proposed'}

def _field(d: dict, *keys, default=None):
    x=d
    for k in keys:
        if not isinstance(x,dict):return default
        x=x.get(k)
    return default if x is None else x

def _utc(value):
    """Accept complete ISO8601 UTC instants only; reject ambiguous local schedule times."""
    if not isinstance(value,str):raise ValueError('flight UTC timestamp missing')
    # Preserve the declared source timezone; never silently reinterpret an offset as UTC.
    try:
        literal=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError as exc:
        raise ValueError('ISO8601 UTC timestamp invalid') from exc
    if literal.tzinfo is None or literal.utcoffset().total_seconds()!=0:
        raise ValueError('explicit UTC (+00:00 or Z) timestamp expected')
    d=parse_time(value)
    return d.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')

def normalize_instance(raw:dict)->dict:
    """Extract a strict subset of published Flight Info v2 semantics, not a full spec claim."""
    if not isinstance(raw,dict):raise ValueError('flight object must be JSON object')
    carrier=_field(raw,'carrier','iata') or _field(raw,'carrierCode','iata')
    num=raw.get('flightNumber')
    origin=_field(raw,'departure','airport','iata')
    destination=_field(raw,'arrival','airport','iata')
    dep=_field(raw,'departure','scheduledTime','utc')
    arr=_field(raw,'arrival','scheduledTime','utc')
    if not (isinstance(carrier,str) and len(carrier)==2 and carrier.isalpha()):raise ValueError('IATA carrier missing')
    if not (isinstance(num,int) and not isinstance(num,bool) and 1<=num<=9999):raise ValueError('flightNumber must be an integer')
    for name,code in [('departure airport',origin),('arrival airport',destination)]:
        if not (isinstance(code,str) and len(code)==3 and code.isalpha()):raise ValueError(name+' IATA code invalid')
    d=_utc(dep);a=_utc(arr)
    if parse_time(a)<=parse_time(d):raise ValueError('flight arrival not after departure')
    statuses=raw.get('statusDetails') or []
    state=(statuses[0].get('state') if isinstance(statuses,list) and statuses and isinstance(statuses[0],dict) else raw.get('state'))
    if state is None:state='Unknown'
    if state not in STATE_MAP and state!='Unknown':raise ValueError('unsupported flight state: '+str(state))
    return {'carrier_iata':carrier.upper(),'flight_number':num,
            'departure_iata':origin.upper(),'arrival_iata':destination.upper(),
            'scheduled_departure_utc':d,'scheduled_arrival_utc':a,
            'flight_state':STATE_MAP.get(state,'Unknown'),
            'service_type':raw.get('serviceType'),
            'oag_status_key':raw.get('statusKey'),
            'evidence_status':'EXTERNAL_OBSERVATION_NOT_CARRIER_CONFIRMATION',
            'remaining_bookable_cargo_kg':None,
            'booking_confirmed':False,
            'physical_load_certificate':False}

def normalize_envelope(body:dict,max_records=100):
    if not isinstance(body,dict) or not isinstance(body.get('data'),list):raise ValueError('expected Flight Info data[] envelope')
    if len(body['data'])>max_records:raise ValueError('too many flight records')
    records=[normalize_instance(x) for x in body['data']]
    keys=[(r['carrier_iata'],r['flight_number'],r['departure_iata'],r['scheduled_departure_utc']) for r in records]
    if len(keys)!=len(set(keys)):raise ValueError('duplicate flight instance identity')
    paging=body.get('paging') or {}
    if not isinstance(paging,dict):raise ValueError('invalid paging')
    return {'records':records,'count':len(records),'next_cursor_url':paging.get('next'),
            'license':'NO_OAG_LICENSED_RECORDS_IN_SAMPLE',
            'fields_not_supplied':['remaining_bookable_cargo_kg','ULD_fit','airline_booking_confirmation','operational_authorization']}

def synthetic_v2_sample(flights:list[dict],limit=12)->dict:
    """Make illustrative v2-shaped fields from RELAY synthetic catalog (NOT OAG data).

    The crosswalk exists exclusively in the top-level demoMappings, never as an OAG field.
    """
    rows=[];links=[]
    for i,f in enumerate(flights[:limit]):
        idx=2000+i
        rows.append({'carrier':{'iata':'CX'},'flightNumber':idx,
          'departure':{'airport':{'iata':f['origin']},'scheduledTime':{'utc':f['scheduled_departure']}},
          'arrival':{'airport':{'iata':f['destination']},'scheduledTime':{'utc':f['scheduled_arrival']}},
          'statusDetails':[{'state':f['status'] if f['status'] in STATE_MAP else 'Unknown'}],
          'serviceType':'Cargo', 'statusKey':f'SYNTHETIC-OAG-STATUS-{i:04d}'})
        links.append({'demo_status_key':f'SYNTHETIC-OAG-STATUS-{i:04d}',
                      'synthetic_relay_flight_id':f['id'],
                      'link_method':'EXPLICIT_SYNTHETIC_DEMO_CROSSWALK_NOT_EXTERNAL_JOIN'})
    return {'data':rows,'paging':{'limit':limit,'totalCount':len(rows)},
            'demoMappings':links,
            'source':'SYNTHETIC_OAG_SCHEMA_ILLUSTRATION_NOT_OAG_SUPPLIED',
            'not_provided':['cargo inventory','bookable capacity','booking','load-control certificate']}

def observations_for_demo(sample:dict):
    norm=normalize_envelope(sample)
    link={r['demo_status_key']:r['synthetic_relay_flight_id'] for r in sample['demoMappings']}
    return [{**x,'synthetic_flight_id':link.get(x['oag_status_key'])} for x in norm['records']]
