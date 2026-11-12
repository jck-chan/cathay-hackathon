"""RELAY v7 shadow-product projections and structured experiments.

No real bookings, cargo moves or customer communications. The v5 optimizers are
unchanged: this layer makes its scope, staging events and outcomes inspectable.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
import math, random, statistics, time, json, uuid
from relay.state import project
from relay.schemas import parse_time
from v5_lab import AuditedLab, audit_lab, data_quality_report
from unified_lab import paired_queue_benchmark, safe_job

PHASE_LABEL={"WAIT":"Awaiting staging", "HOLD":"Verification / hold", "WORK":"Simulated staging in progress", "DONE":"Simulated staging complete"}

class V7Lab(AuditedLab):
    def _init(self, seed):
        self.journal=defaultdict(list)
        self._stage_last={}
        self._proposal_last={}
        super()._init(seed)
        self._capture_ground_events()
        self._capture_proposals()

    def _stage_status(self):
        result={}
        p=self.policies.get('relay',{})
        for j in p.get('waiting',[]):result[j['id']]='HOLD' if j.get('blocked_reason') else 'WAIT'
        for a in p.get('active',[]):result[a['job']['id']]='WORK'
        for sid in p.get('completed',[]):result[sid]='DONE'
        return result

    def _journal(self, sid, kind, text, authority='SIMULATED_GROUND_STATE', extra=None):
        entries=self.journal[sid]
        row={'tick':self.t,'at':self.store.clock(),'kind':kind,'message':text,
             'authority':authority,'source':'RELAY_SYNTHETIC_SHADOW', 'real_customer_notification':False}
        if extra:row.update(extra)
        if not entries or any(entries[-1].get(k)!=row.get(k) for k in ('tick','kind','message')):
            entries.append(row)
        if len(entries)>100:del entries[:-100]

    def _capture_ground_events(self):
        status=self._stage_status()
        for sid,phase in sorted(status.items()):
            if self._stage_last.get(sid)==phase:continue
            msg={"WAIT":"Work order admitted into a simulated staging queue",
                 "HOLD":"Ground work paused: independent verification / authorization required",
                 "WORK":"Ground work started under RELAY scheduling (simulated)",
                 "DONE":"Ground staging work completed in the simulator; NOT an airline delivery milestone"}[phase]
            self._journal(sid,'GROUND_'+phase,msg)
        self._stage_last=status

    def _advance_policies(self):
        super()._advance_policies()
        self._capture_ground_events()

    def _capture_proposals(self):
        if not self.latest:return
        for a in self.latest.get('proposed_actions',[]):
            sid=a['shipment_id']; route=tuple(a.get('route',[]))
            if self._proposal_last.get(sid)==route:continue
            self._proposal_last[sid]=route
            self._journal(sid,'RECOVERY_PROPOSED',
                 'Alternative route proposed by bounded MILP; not carrier-confirmed',
                 'OPTIMIZER_PROPOSAL_ONLY',{'candidate_route':list(route),'decision_id':self.latest['id']})

    def _evaluate(self):
        res=super()._evaluate()
        self._capture_proposals()
        return res

    def incident(self,kind='flight_cancelled'):
        out=super().incident(kind)
        ev=self.recent_event
        if ev:
            sid=ev['entity_id'] if ev.get('entity_type')=='shipment' else None
            impacted=[sid] if sid else [s['id'] for s in self.store.catalog('shipment')
                 if s['id'] in self.admitted and s.get('assigned_flight_id')==ev['entity_id']]
            for current in impacted:
                self._journal(current,'DISRUPTION_OBSERVED',
                    f"{kind.replace('_',' ').title()} observed in synthetic source; recovery subject to constraints",
                    'SYNTHETIC_OPERATIONAL_EVENT',{'event_id':ev['event_id']})
            self._capture_ground_events()
        return self.snapshot()

    def review(self,choice,decision_id,expected_snapshot_version):
        result=super().review(choice,decision_id,expected_snapshot_version)
        for proposal in self.latest.get('proposed_actions',[]):
            self._journal(proposal['shipment_id'], 'INTERNAL_'+choice.upper(),
               'Supervisor '+('approved' if choice=='approve' else 'rejected')+
               ' a SIMULATED workflow; no airline booking or physical movement',
               'SIMULATED_INTERNAL_REVIEW',{'decision_id':decision_id})
        return result

    def step(self,*args,**kwargs):
        out=super().step(*args,**kwargs)
        self._capture_ground_events()
        return self.snapshot()

    def fast_forward(self, ticks, rate, chaos, handlers, cold_bays, stands):
        if not isinstance(ticks,int) or not 1<=ticks<=100:
            raise ValueError('ticks must be between 1 and 100')
        start=time.perf_counter()
        # Every tick is processed by the actual simulator; no animation-only time skip.
        # The legacy model evaluates each batch and after material event changes.
        for at in range(0,ticks,12):
            self.step(min(12,ticks-at), rate=rate,chaos=chaos, handlers=handlers,
                      cold_bays=cold_bays,stands=stands)
        res=self.snapshot();duration=max(.0001,time.perf_counter()-start)
        res['fast_forward']={'requested_ticks':ticks,'processed_ticks':ticks,
            'simulated_minutes_advanced':ticks*10,
            'wall_seconds':round(duration,3),'actual_ticks_per_wall_second':round(ticks/duration,3),
            'semantics':'ALL_TICKS_SIMULATED; SOLVER_REEVALUATED_PER_BATCH_OR_EVENT; NOT_REAL_TIME_TELEMETRY'}
        return res

    def create_order(self, destination, weight_kg, handling, service, length_cm, width_cm, height_cm):
        """SYNTHETIC customer request inserted transactionally, not airline booking.

        This deliberately does not set assigned_flight_id: OAG flight schedules
        are never silently promoted to remaining confirmed cargo capacity.
        """
        from datetime import timedelta
        from relay.schemas import Shipment, Piece, EventIn, ts, parse_time
        if destination not in ('SIN','LHR','NRT','LAX','FRA','BKK','SYD','DXB'):
            raise ValueError('Destination must belong to the synthetic route catalog')
        if not isinstance(weight_kg,int) or not 10<=weight_kg<=450:raise ValueError('weight must be 10–450 kg')
        if handling not in ('GENERAL','COL') or service not in ('STANDARD','PRIORITY','CRITICAL'):
            raise ValueError('Only general or cool synthetic orders are supported; DGR needs authorization')
        if any(not isinstance(v,int) or v<15 or v>180 for v in (length_cm,width_cm,height_cm)):
            raise ValueError('each dimension must be an integer 15–180 cm')
        with self.lock:
            if len([x for x in self.admitted if x.startswith('SYN-DEMO-')])>=30:
                raise ValueError('synthetic order entry limited to 30 per scenario; reset to try more')
            sid='SYN-DEMO-'+uuid.uuid4().hex[:12].upper()
            pid=sid+'-P1';now=self.store.clock();deadline=ts(parse_time(now)+timedelta(hours=48))
            shipment=Shipment(id=sid,awb='SYN-CX-D'+sid[-8:],booking_id='SYN-REQUEST-'+sid,
                client_id='SYN-DEMO-ACCOUNT',origin='HKG',destination=destination,
                created_at=now,accepted_at=now,deadline=deadline,weight_kg=weight_kg,
                piece_ids=[pid],service=service,handling=handling,status='RCS',
                booked_flight_id=None,assigned_flight_id=None,custody_state='RECEIVED').model_dump()
            piece=Piece(id=pid,shipment_id=sid,weight_kg=weight_kg,
                length_cm=length_cm,width_cm=width_cm,height_cm=height_cm,special_handling=handling).model_dump()
            with self.store.tx(True) as con:
                con.execute('INSERT INTO catalog(kind,id,body) VALUES (?,?,?)',('shipment',sid,json.dumps(shipment)))
                con.execute('INSERT INTO catalog(kind,id,body) VALUES (?,?,?)',('piece',pid,json.dumps(piece)))
                self.store.increment(con)
            ev=EventIn(event_id='SYN-ORDER-'+uuid.uuid4().hex,
                event_type='shipment_milestone',entity_type='shipment',entity_id=sid,
                event_time=now,received_at=now,source='SYNTHETIC_TRACK_TRACE',source_revision=1,trusted=True,
                payload={'code':'RCS','airport':'HKG','note':'Synthetic request accepted for demo staging, not confirmed flight booking'})
            accepted=self.store.append_event(ev)
            if accepted['disposition']!='ACCEPTED':raise RuntimeError('synthetic order admission event rejected')
            job=safe_job(shipment,now);job['admit_tick']=self.t
            job['network_at_risk']=False
            for p in self.policies.values():p['waiting'].append(dict(job))
            self.admitted.add(sid)
            self._journal(sid,'CUSTOMER_REQUEST_ACCEPTED',
                'Synthetic customer request accepted for staging; airline flight NOT booked',
                'SYNTHETIC_CUSTOMER_REQUEST')
            self._capture_ground_events()
            self._log('CUSTOMER','synthetic request received '+sid+' → '+destination,
                      'SYNTHETIC_CUSTOMER_REQUEST',sid)
            self._evaluate()
            self._apply_network_context()
            return {'awb':shipment['awb'],'shipment_id':sid,'status':'SYNTHETIC_REQUEST_RECEIVED_NOT_BOOKED',
                'state':self.snapshot(),'tracking':self.customer_journey(shipment['awb'])}

    def customer_journey(self,awb):
        with self.lock:
            basic=self.track(awb)
            s=next((s for s in self.store.catalog('shipment') if s['awb']==awb),None)
            if s is None:raise KeyError('AWB unknown')
            sid=s['id'];phase=self._stage_status().get(sid,'NOT_IN_STAGING')
            d=self.latest or {}
            proposal=next((p for p in d.get('proposed_actions',[]) if p['shipment_id']==sid),None)
            route=next((p for p in d.get('model_iii',{}).get('plan',[]) if p['shipment_id']==sid),None)
            selected=route if proposal else None
            review='NONE'
            if proposal:
                review=('STALE_REQUIRES_RECALC' if d.get('snapshot_version')!=self.store.version() else
                    'INTERNAL_APPROVAL_ONLY' if self.store.get_decision(d['id'])['status']=='APPROVED_SIMULATION_ONLY' else
                    'PENDING_INTERNAL_REVIEW')
            # Physical ground workflow transitions are an independent, explicitly synthetic overlay.
            entries=[{'at':m.get('event_time'),'kind':m.get('code'),'message':'Air cargo milestone recorded in synthetic source',
                      'authority':'SYNTHETIC_CARGO_TRACKING_EVENT','source':m.get('source'),
                      'observed':True} for m in basic.get('observed_milestones',[])]
            entries += [{**e,'observed':False} for e in self.journal.get(sid,[])]
            entries.sort(key=lambda e:(e.get('at') or '',e.get('tick',0)))
            existing_eta=basic.get('estimated_arrival_utc')
            eta_past_due=bool(existing_eta and parse_time(existing_eta)<parse_time(self.store.clock()) and basic.get('status') not in ('ARR','RCF','NFD','DLV'))
            basic['eta_past_due_without_arrival_confirmation']=eta_past_due
            if eta_past_due:
                basic['eta_status']='EXPIRED_SYNTHETIC_ETA_REQUIRES_AUTHORITATIVE_UPDATE'
                basic['customer_service_message']='Previous synthetic ETA has passed without a recorded arrival; new authoritative information is required.'
            basic['ground_twin']={'phase':phase,'phase_label':PHASE_LABEL.get(phase,'Not admitted to staging'),
                'simulated_only':True,'not_flight_milestone':True}
            basic['route_decision']={'original_assigned_flight_id':s.get('assigned_flight_id'),
                'tentative_alternative_flights':proposal.get('route',[]) if proposal else [],
                'tentative_arrival_utc':selected.get('arrival_utc') if selected else None,
                'review_status':review,'carrier_confirmed':False,
                'customer_eta_changed_by_proposal':False,
                'warning':'Candidate ETA is NOT the displayed carrier ETA; no new booking is confirmed.'}
            basic['journey_events']=entries[-100:]
            basic['simulation_clock']=self.store.clock()
            basic['real_customer_notifications_sent']=False
            return basic

    def snapshot(self):
        s=super().snapshot()
        s['version']='7.0'
        s['journey_activity']=sorted(
           [dict(x,shipment_id=sid) for sid,es in self.journal.items() for x in es],
           key=lambda e:(e['tick'],e['at']))[-35:]
        s['truth_contract']={
           'staging':'SCHEMATIC_SIMULATED_WORK_ORDERS',
           'network':'SYNTHETIC_SCOPED_MILP_NOT_BOOKING',
           'customer':'SOURCE_MILESTONES_SEPARATE_FROM_SIMULATED_GROUND_ACTIVITY',
           'physical':'NO_CERTIFIED_AIRCRAFT_LOAD_OR_3D_RESTRAINT',
           'economic':'SYNTHETIC_COST_UNITS_ONLY', 'real_commands':False}
        s['journal_count']=sum(map(len,self.journal.values()))
        return s


def experiment_grid(lab,episodes=250,seed=707):
    """Paired, identical synthetic inputs within each scenario (NOT empirical ROI)."""
    if not isinstance(episodes,int) or not 100<=episodes<=2000:raise ValueError('episodes must be 100..2000')
    original=(lab.rate,lab.handlers,lab.cold_bays,lab.stands)
    cases=[('balanced',2.,3,1,3),('peak_demand',4.,3,1,3),
           ('crew_scarcity',3.,1,1,3),('cold_scarcity',3.,3,0,3),
           ('extra_crew',3.,5,2,5)]
    try:
        results=[]
        for label,rate,h,c,st in cases:
            lab.rate,lab.handlers,lab.cold_bays,lab.stands=rate,h,c,st
            r=paired_queue_benchmark(lab,episodes=episodes,seed=seed)
            results.append({'scenario':label,'parameters':{'arrival_rate':rate,'crew':h,'cold_bays':c,'stands':st},
                            'mean_synthetic_cost_advantage':r['paired_saving_units'],
                            'confidence_interval_mc_95':r['ci_95_mc'],
                            'regression_fraction':r['regression_fraction'],
                            'missed_targets_fcfs':r['missed_staging_targets_fcfs'],
                            'missed_targets_relay':r['missed_staging_targets_relay']})
        return {'episodes_per_scenario':episodes,'seed':seed,'results':results,
            'evidence_scope':'PAIRED_SYNTHETIC_STAGING_MONTE_CARLO; NOT 3-MODEL JOINT RE-OPTIMIZATION',
            'empirical_cathay_validation':False,'currency':'UNITLESS_SIMULATED_COST',
            'distribution_shift_tested':False,
            'interpretation':'Within these assumptions, urgency-aware staging can reduce penalty cost; outcomes depend strongly on capacity and assumed deadlines.'}
    finally:lab.rate,lab.handlers,lab.cold_bays,lab.stands=original
