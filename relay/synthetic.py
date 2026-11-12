"""Seeded scenario-first synthetic data. NOT calibrated to Cathay operations.

30 exact UTC days: [2026-10-10T00:00:00Z, 2026-11-09T00:00:00Z).
Next three UTC days are a *published synthetic schedule* and current open orders.
A hidden daily disruption regime induces *correlated* outcomes.
"""
from __future__ import annotations
import json, random, math
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .schemas import Flight, Shipment, Piece, ULD, EventIn, ts, parse_time

END = datetime(2026,11,9,tzinfo=timezone.utc)
START = END - timedelta(days=30)
ROUTES = [
 ('HKG','SIN',1,5,1300),('SIN','LHR',9,22,1180),('HKG','LHR',2,16,1400),
 ('HKG','NRT',0,4,850),('NRT','LAX',8,18,900),('HKG','LAX',4,17,1150),
 ('HKG','FRA',5,18,1100),('HKG','BKK',2,5,780),('BKK','FRA',8,20,690),
 ('HKG','SYD',5,14,1100),('SIN','SYD',9,17,870),('HKG','DXB',3,10,770),
 ('DXB','LHR',14,22,900)]
DESTINATIONS = ['LHR','NRT','SIN','LAX','FRA','SYD','BKK']


def write_jsonl(path, rows):
    with open(path,'w',encoding='utf8') as f:
        for r in rows:
            f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')

def generate(folder: str | Path, seed: int = 20261109) -> dict:
    folder=Path(folder); folder.mkdir(parents=True,exist_ok=True)
    rng=random.Random(seed)
    flights=[]; shipments=[]; pieces=[]; ulds=[]; events=[]; latent=[];historical_shipments_pending=[]
    regime=0
    # A latent correlated weather/handling regime has persistence across days.
    for day in range(33):
        date=START+timedelta(days=day)
        if rng.random() < (0.44 if regime else 0.15): regime=1-regime
        hot=regime==1
        congestion=(rng.random() < (0.55 if hot else 0.12))
        day_risk={'date':date.date().isoformat(),'latent_weather':int(hot),'congested':int(congestion)}
        latent.append(day_risk)
        for ri,(orig,dst,dep_h,arr_h,nominal) in enumerate(ROUTES):
            dep=date+timedelta(hours=dep_h,seconds=rng.randrange(10,3400))
            arr=date+timedelta(hours=arr_h,seconds=rng.randrange(10,3400))
            if arr<=dep:arr+=timedelta(days=1)
            fid=f'SYN-F{day:02d}-{ri:02d}'
            cap=max(250,int(nominal*rng.uniform(.50,.94)))
            cool=int(cap*rng.uniform(.08,.30))
            f=Flight(id=fid,flight_number=f'SYN{1300+ri}',origin=orig,destination=dst,
              scheduled_departure=ts(dep),scheduled_arrival=ts(arr),
              estimated_departure=ts(dep),estimated_arrival=ts(arr),
              remaining_kg=cap,cool_remaining_kg=cool,unit_slots_remaining=rng.choice([2,3,4]))
            flights.append(f.model_dump())
            # Only events received during the 30-day history can train probabilities.
            if day < 30:
                if rng.random() < (.075 if hot else .010):
                    et=dep-timedelta(hours=4,minutes=rng.randrange(0,55))
                    ev=EventIn(event_id=f'evt-CANCEL-{fid}',event_type='flight_cancelled',
                      entity_type='flight',entity_id=fid,event_time=ts(et),received_at=ts(et+timedelta(seconds=rng.randrange(1,110))),
                      source='SYNTHETIC_FLIGHT_OPS',source_revision=2,trusted=True,
                      payload={'reason_code':'WX' if hot else 'TECH'} )
                    events.append(ev.model_dump())
                elif rng.random() < (.33 if hot else .095):
                    delay=rng.randrange(1800,3*3600)
                    et=dep-timedelta(hours=3,minutes=rng.randrange(0,45))
                    events.append(EventIn(event_id=f'evt-DELAY-{fid}',event_type='flight_delay',entity_type='flight',
                      entity_id=fid,event_time=ts(et),received_at=ts(et+timedelta(seconds=rng.randrange(1,80))),
                      source='SYNTHETIC_FLIGHT_OPS',source_revision=2,trusted=True,payload={'delay_seconds':delay}).model_dump())
            # real-world operator remaining capacity is deliberately modeled separate from OAG max tonnage
        for sj in range(19 if day<30 else 22):
            sid=f'SYN-S{day:02d}-{sj:03d}'
            destination=rng.choices(DESTINATIONS, weights=[20,10,14,19,14,14,9])[0]
            handling=rng.choices(['GENERAL','COL','DGR'],weights=[.78,.18,.04])[0]
            service=rng.choices(['STANDARD','PRIORITY','CRITICAL'],weights=[.66,.27,.07])[0]
            w=rng.randrange(45,285)
            creation=date-timedelta(hours=rng.randrange(7,18),seconds=rng.randrange(60))
            accepted=date+timedelta(seconds=rng.randrange(60,1300))
            deadline=date+timedelta(hours=rng.randrange(24,49),seconds=rng.randrange(60))
            firstflight=next(f for f in flights if f['id']==f'SYN-F{day:02d}-{next(k for k,x in enumerate(ROUTES) if x[0]=="HKG" and x[1]==destination):02d}')
            # DGR is recorded for realism but excluded from any "safe-to-execute" optimization.
            count=rng.choice([1,1,1,2])
            weights=[w//count]*(count-1)+[w-(count-1)*(w//count)]
            ps=[]
            for j,ww in enumerate(weights):
                pid=f'{sid}-P{j+1}'
                ps.append(pid)
                pieces.append(Piece(id=pid,shipment_id=sid,weight_kg=ww,length_cm=rng.randrange(35,112),
                    width_cm=rng.randrange(28,79),height_cm=rng.randrange(22,70),special_handling=handling).model_dump())
            s=Shipment(id=sid,awb=f'SYN-CX-{day:02d}{sj:04d}',booking_id=f'SYN-BK-{sid}',client_id=f'SYN-CLIENT-{sj%8:02d}',
                origin='HKG',destination=destination,created_at=ts(creation),accepted_at=ts(accepted),
                deadline=ts(deadline),weight_kg=w,piece_ids=ps,service=service,handling=handling,
                booked_flight_id=firstflight['id'],assigned_flight_id=firstflight['id'],
                status='BKD',
                custody_state='RECEIVED').model_dump()
            shipments.append(s)
            if day<30:
                historical_shipments_pending.append((sid,accepted,firstflight['id'],destination))
                if rng.random() < (.12 if hot else .043):
                    evtime=accepted+timedelta(seconds=rng.randrange(30,1100))
                    events.append(EventIn(event_id=f'evt-DIM-{sid}',event_type='shipment_dimension_conflict',entity_type='shipment',entity_id=sid,
                      event_time=ts(evtime),received_at=ts(evtime+timedelta(seconds=rng.randrange(3,700))),
                      source='SYNTHETIC_HANDLING',source_revision=2,trusted=False,
                      payload={'piece_id':ps[0],'reason':'received dimensions differ from declaration'}).model_dump())
        if day<30 and congestion:
            et=date+timedelta(hours=1,seconds=rng.randrange(3600))
            events.append(EventIn(event_id=f'evt-CONG-{day}',event_type='terminal_congestion',entity_type='terminal',entity_id='HKG-T1',
                  event_time=ts(et),received_at=ts(et+timedelta(seconds=17)),source='SYNTHETIC_GROUND_OPS',
                  source_revision=day+1,trusted=True,payload={'capacity_fraction':0.72}).model_dump())
    # Historical flight lifecycle status events, generated only if the flight was not canceled.
    # Actual departure and arrival use the same scenario delay; never mark a canceled flight InAir.
    cancelled_flights={e['entity_id'] for e in events if e['event_type']=='flight_cancelled'}
    observed_delays={e['entity_id']:e['payload']['delay_seconds'] for e in events if e['event_type']=='flight_delay'}
    for f in flights:
        if f['id'] in cancelled_flights or parse_time(f['scheduled_departure'])>=END:continue
        shift=timedelta(seconds=observed_delays.get(f['id'],0))
        dep=parse_time(f['scheduled_departure'])+shift
        arr=parse_time(f['scheduled_arrival'])+shift
        for j,(state,t) in enumerate([('OutGate',dep),('InAir',dep+timedelta(minutes=20)),
                                     ('Landed',arr-timedelta(minutes=10)),('InGate',arr)]):
            events.append(EventIn(event_id=f'evt-FLT-{state}-{f["id"]}',event_type='flight_state_update',
                entity_type='flight',entity_id=f['id'],event_time=ts(t),
                received_at=ts(t+timedelta(seconds=rng.randrange(3,105))),
                source='SYNTHETIC_FLIGHT_OPS',source_revision=j+3,trusted=True,
                payload={'state':state}).model_dump())
    # Milestones are generated AFTER all flight schedules and disruptions exist.
    # This prevents future leakage, impossible DEP on a canceled flight,
    # and fictitious success when a booked departure was missed.
    flight_by_id={f['id']:f for f in flights}
    canceled={e['entity_id'] for e in events if e['event_type']=='flight_cancelled'}
    delay_by_id={e['entity_id']:e['payload']['delay_seconds'] for e in events if e['event_type']=='flight_delay'}
    for sid,accepted,booked_id,destination in historical_shipments_pending:
        firstflight=flight_by_id[booked_id]
        idx=int(booked_id.split('-')[-1]);day_idx=int(booked_id.split('-')[1][1:])
        chosen=firstflight
        if booked_id in canceled or parse_time(firstflight['scheduled_departure'])<accepted+timedelta(minutes=45):
            for d in range(day_idx+1,min(33,day_idx+4)):
                alt=flight_by_id.get(f'SYN-F{d:02d}-{idx:02d}')
                if alt and alt['id'] not in canceled and parse_time(alt['scheduled_departure'])>=accepted+timedelta(minutes=45):
                    chosen=alt;break
            if chosen['id']!=booked_id:
                when=accepted+timedelta(minutes=20,seconds=rng.randrange(30))
                events.append(EventIn(event_id=f'evt-BOOK-REPLAN-{sid}',event_type='booking_change',
                    entity_type='shipment',entity_id=sid,event_time=ts(when),
                    received_at=ts(when+timedelta(seconds=15)),source='SYNTHETIC_BOOKING',
                    source_revision=2,trusted=True,payload={'flight_id':chosen['id'],'confirmation':'CONFIRMED',
                    'reason':'synthetic cancellation or missed acceptance cutoff'}).model_dump())
        dly=delay_by_id.get(chosen['id'],0)
        actual_dep=parse_time(chosen['scheduled_departure'])+timedelta(seconds=dly)
        actual_arr=parse_time(chosen['scheduled_arrival'])+timedelta(seconds=dly)
        for code,evbase in [('RCS',accepted),('DEP',actual_dep),('ARR',actual_arr),
                            ('RCF',actual_arr+timedelta(hours=2)),
                            ('NFD',actual_arr+timedelta(hours=3)),
                            ('DLV',actual_arr+timedelta(hours=7))]:
            evtime=evbase+timedelta(seconds=rng.randrange(1,250))
            events.append(EventIn(event_id=f'evt-{code}-{sid}',event_type='shipment_milestone',
                entity_type='shipment',entity_id=sid,event_time=ts(evtime),
                received_at=ts(evtime+timedelta(seconds=rng.randrange(5,600))),
                source='SYNTHETIC_TRACK_TRACE',source_revision=1,trusted=True,
                payload={'code':code,'flight_id':chosen['id'],
                        'airport':'HKG' if code in ('RCS','DEP') else destination}).model_dump())
    for k in range(14):
        ulds.append(ULD(id=f'SYN-ULD-{k:03d}',uld_type=('SYN-AKE' if k%2 else 'SYN-PMC'),
             usable_length_cm=290 if k%2 else 310,usable_width_cm=170 if k%2 else 210,
             max_gross_kg=1600 if k%2 else 2300,tare_kg=100 if k%2 else 140,
             zone='HKG-EXPORT').model_dump())
    # DATA: separate observed logs from latent ground truth. Train only on OBSERVED outcomes.
    # Strictly 30-day OBSERVED window; future milestones do not enter the training sample.
    events=[e for e in events if START<=parse_time(e['received_at'])<END]
    events.sort(key=lambda x:(x['received_at'],x['event_id']))
    for name,rows in [('flights.jsonl',flights),('shipments.jsonl',shipments),('pieces.jsonl',pieces),('ulds.jsonl',ulds),('historical_events.jsonl',events),('latent_test_only.jsonl',latent)]:
        write_jsonl(folder/name,rows)
    observed=Counter(e['event_type'] for e in events)
    manifest={'generated_at':ts(END),'historical_start':ts(START),'historical_end_exclusive':ts(END),
        'seed':seed,'data_class':'SYNTHETIC_NOT_CATHAY','seconds_precision':True,
        'flight_records':len(flights),'shipment_records':len(shipments),'piece_records':len(pieces),
        'uld_records':len(ulds),'event_records':len(events),
        'historical_shipments':sum(1 for s in shipments if parse_time(s['accepted_at']) < END),
        'future_open_shipments':sum(1 for s in shipments if parse_time(s['accepted_at']) >= END),
        'observed_event_counts':dict(observed),'future_schedules_note':'Published hypothetical schedules, not future observed events.',
        'latent_test_only_note':'This file encodes simulation ground truth; it MUST NOT feed decision evaluation.'}
    (folder/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    return manifest


def load_jsonl(path):
    with open(path,encoding='utf8') as f:
        return [json.loads(l) for l in f if l.strip()]


def calibration(events: list[dict], flights: list[dict], shipments: list[dict], as_of: str) -> dict:
    """Simple empirical Bayes with transparent smoothing and bounded rates; no IATA/Cathay calibration."""
    cut=parse_time(as_of)
    historical=[e for e in events if parse_time(e['received_at']) <= cut and parse_time(e['received_at']) < END]
    n_f=sum(1 for f in flights if parse_time(f['scheduled_departure']) < min(cut,END))
    n_s=sum(1 for s in shipments if parse_time(s['accepted_at']) < min(cut,END))
    count=Counter(e['event_type'] for e in historical)
    # beta(1,19) prior is a synthetic *assumption*, not empirical airline knowledge
    rate=lambda k,n:(count[k]+1)/(n+20) if n else 0.05
    return {'training_cutoff':ts(min(cut,END)),'training_flights':n_f,'training_shipments':n_s,
      'delay_rate':round(rate('flight_delay',n_f),5),
      'cancellation_rate':round(rate('flight_cancelled',n_f),5),
      'dimension_conflict_rate':round(rate('shipment_dimension_conflict',n_s),5),
      'verification_sensitivity_assumed':0.90,'verification_false_positive_assumed':0.20,
      'calibration_status':'SYNTHETIC_EMPIRICAL_BAYES_WITH_ASSUMED_SENSOR_QUALITY'}
