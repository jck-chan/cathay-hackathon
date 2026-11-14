"""Server-owned playback for the v11 three-twin simulation.

One V7Lab/store is the authority for all three *views*.  An auto-review is
strictly a simulated internal work-order authorization; real booking/physical
execution is never exposed.  The requested playback multiplier is a throughput
target, never a promise that the CPU achieved it.
"""
from __future__ import annotations
from collections import deque
from threading import RLock, Thread, Event
import math, time, uuid, random
from v7_product import V7Lab
from relay.store import Conflict
from relay.state import project
from unified_lab import safe_job

SPEEDS = (1, 4, 16, 32, 100)
MODES = ('AUTO_SHADOW','MANUAL_REVIEW','ADVISORY')

class SimulationClock:
    """Advance all attached labs together, publishing snapshots between batches."""

    def __init__(self):
        self.guard = RLock()
        self.members: list[Conductor] = []
        self.running = False
        self.speed = 1
        self.tick = 0
        self.worker_error = None
        self.actual_ticks_per_sec = 0.0
        self._samples = deque(maxlen=250)
        self._started_at = 0.0
        self._stop = Event()

    def attach(self, conductor):
        with self.guard:
            # A new sandbox replays the elapsed ticks with its own seed and policy.
            self._advance_lab(conductor, self.tick)
            conductor.clock = self
            conductor.guard = self.guard
            self.members.append(conductor)

    @staticmethod
    def _advance_lab(conductor, count):
        for offset in range(0, count, 4):
            conductor._advance(min(4, count - offset))

    def _advance(self, count):
        try:
            for conductor in self.members:
                conductor._advance(count)
        except Exception as exc:
            self._halt()
            self.worker_error = f'{type(exc).__name__}: {exc}'
            self._record('ERROR', self.worker_error)
            raise
        self.tick += count

    def _record(self, kind, message):
        for conductor in self.members:
            conductor._record(kind, message)

    def _worker(self, stop_event):
        due = time.monotonic()
        while not stop_event.is_set():
            with self.guard:
                if stop_event.is_set():
                    return
                target_tps = self.speed * .5
                batch = min(4, max(1, math.ceil(target_tps * .25)))
                try:
                    self._advance(batch)
                except Exception:
                    return
                now = time.monotonic()
                self._samples.append((now, batch))
                while self._samples and now - self._samples[0][0] > 5:
                    self._samples.popleft()
                elapsed = max(now - max(self._started_at, now - 5), .1)
                self.actual_ticks_per_sec = round(sum(n for _, n in self._samples) / elapsed, 2)
            due = max(due + batch / target_tps, now)
            # Yield even when a batch exceeds its wall-clock budget.
            stop_event.wait(max(.05, due - time.monotonic()))

    def _require_healthy(self):
        if self.worker_error:
            raise Conflict('Reset the shared simulation before advancing after an engine error')

    def start(self):
        with self.guard:
            self._require_healthy()
            if self.running:
                return
            self._stop = Event()
            self.running = True
            self._samples.clear()
            self._started_at = time.monotonic()
            self._record('PLAY', 'Shared synthetic clock started')
            Thread(target=self._worker, args=(self._stop,), name='RELAY-synthetic-clock', daemon=True).start()

    def _halt(self):
        self._stop.set()
        self.running = False
        self.actual_ticks_per_sec = 0.0

    def pause(self):
        with self.guard:
            self._halt()
            self._record('PAUSE', 'Shared synthetic clock paused')

    def set_speed(self, value):
        if value not in SPEEDS:
            raise ValueError('Unsupported speed')
        with self.guard:
            self.speed = value
            self._record('SPEED', f'{value}× requested for the shared synthetic clock')

    def step(self, count):
        with self.guard:
            if self.running:
                raise Conflict('Pause shared simulation before manual stepping')
            self._require_healthy()
            for offset in range(0, count, 4):
                self._advance(min(4, count - offset))

    def reset(self, seed):
        with self.guard:
            self._halt()
            for conductor in self.members:
                conductor._reset_lab(seed)
            self.tick = 0
            self.worker_error = None

    def detach(self, conductor):
        with self.guard:
            self.members.remove(conductor)
            if not self.members:
                self._halt()
                self.tick = 0
                self.speed = 1
                self.worker_error = None


class Conductor:
    def __init__(self,seed=2048,*,dispatch_policies=('fcfs','relay'), clock=None):
        self.lab=V7Lab(seed=seed,dispatch_policies=dispatch_policies)
        self.mode='AUTO_SHADOW'
        self.config={'rate':2.0,'chaos':.2,'handlers':3,'cold_bays':1,'stands':3,'weather':'CLEAR'}
        self.weather_mode='AUTO'  # synthetic weather transitions; seed-reproducible, no METAR
        self._weather_rng=random.Random(seed+8887)
        self._weather_bucket=-1
        self.sequence=0
        self.events=deque(maxlen=100)
        self.review_signatures=set()
        self.last_decision_id=None
        self.last_tick=self.lab.t
        self.last_clock=self.lab.store.clock()
        self.completed_ticks=0
        self.last_advance_ms=0.0
        self._last_effective_capacity=None  # v11 observable restoration marker
        self._closed=False
        self._record('READY','One synthetic event store powers three views; no airline controls are connected.')
        self._observe('INITIAL')
        (clock or SimulationClock()).attach(self)
    def _record(self,kind,message,**extra):
        self.sequence+=1
        self.events.append({'seq':self.sequence,'tick':self.lab.t,'at':self.lab.store.clock(),
                            'kind':kind,'message':message,**extra})
    def _fingerprint(self,d):
        return tuple(sorted((p['shipment_id'],tuple(p.get('route',[]))) for p in d.get('proposed_actions',[])))
    def _can_auto_review(self,d):
        if self.mode!='AUTO_SHADOW' or not d:return False,'Not in auto-shadow mode'
        if d.get('status')!='PENDING_REVIEW' or d.get('stale') or d.get('approval_blocked_external_evidence'):
            return False,'Approval blocked by stale/uncertain evidence'
        # Unrelated DGR exclusions must not block sandbox authorization for
        # independent general-cargo proposals. A warning ON a proposed shipment
        # or with no shipment attribution is still a mandatory manual gate.
        proposed={p['shipment_id'] for p in d.get('proposed_actions',[])}
        if any(w.get('shipment_id') is None or w.get('shipment_id') in proposed for w in d.get('warnings',[])):
            return False,'Relevant safety warnings require a person'
        if not d.get('proposed_actions'):return False,'No changes to authorize'
        if self.lab.external_review_conflicts():return False,'External evidence requires verification'
        if self._fingerprint(d) in self.review_signatures:return False,'Same route proposal already processed'
        return True,'Synthetic internal approval permitted'
    def _observe(self,origin):
        d=self.lab.latest
        if d and d['id']!=self.last_decision_id:
            self.last_decision_id=d['id']
            self._record('MODEL','I · 2D load / II · verify / III · bounded network solver refreshed',
                        decision_id=d['id'],proposals=len(d.get('proposed_actions',[])),
                        model_i=d['model_i'].get('status'),model_ii=d['model_ii'].get('status'),
                        model_iii=d['model_iii'].get('status'))
            can,reason=self._can_auto_review(d)
            if can:
                try:
                    self.lab.review('approve',d['id'],d['snapshot_version'])
                    self.review_signatures.add(self._fingerprint(d))
                    self._record('AUTO_SHADOW','Algorithm accepted a synthetic internal work-order proposal; carrier has NOT confirmed it.',
                                 decision_id=d['id'],shipments=[p['shipment_id'] for p in d['proposed_actions']])
                except (Conflict,ValueError) as exc:
                    self._record('REVIEW_REQUIRED','Auto-shadow approval blocked: '+str(exc),decision_id=d['id'])
            elif d.get('proposed_actions') and reason not in ('Same route proposal already processed','Not in auto-shadow mode'):
                self._record('REVIEW_REQUIRED',reason,decision_id=d['id'])
        if self.lab.recent_event:
            ev=self.lab.recent_event
            marker=ev.get('event_id')
            if marker!=getattr(self,'_last_event_marker',None):
                self._last_event_marker=marker
                self._record('DISRUPTION',str(ev.get('event_type'))+' · '+str(ev.get('entity_id')),
                             entity_id=ev.get('entity_id'),event_id=marker)
        if self.lab.t!=self.last_tick:
            delta=self.lab.t-self.last_tick
            self.completed_ticks+=max(0,delta)
            self.last_tick=self.lab.t
            self.last_clock=self.lab.store.clock()
    def _advance(self,count):
        start=time.perf_counter()
        # WEATHER IS A TRANSPARENT SYNTHETIC CAPACITY SCENARIO, NOT A
        # REGULATORY AIRPORT OPERATING PROCEDURE OR ACTUAL METAR FEED.
        # Lightweight synthetic weather generator (scenario input, not a weather forecast).
        # Only meaningful transitions generate weather events; reproducible with reset seed.
        if self.weather_mode=='AUTO' and self.lab.t//5>self._weather_bucket:
            self._weather_bucket=self.lab.t//5
            old=self.config['weather']
            if self._weather_rng.random()<(.30+.40*self.config['chaos']):
                options=['CLEAR','CLEAR','RAIN','RAIN','FOG','STORM']
                weather=self._weather_rng.choice(options)
                if weather!=old:
                    self.config['weather']=weather
                    self._record('WEATHER',f'Synthetic weather transition: {old} → {weather}; resource assumptions applied on next calculation',previous=old,current=weather)
        before_orders=len(self.lab.admitted)
        ground_policy=self.lab.ground_policy
        before_complete=len(self.lab.policies[ground_policy]['completed'])
        settings={k:self.config[k] for k in ('rate','chaos','handlers','cold_bays','stands')}
        wx=self.config['weather']
        if wx=='RAIN':
            settings['stands']=max(1,settings['stands']-1)
        elif wx=='STORM':
            settings['stands']=max(1,settings['stands']-2)
            settings['handlers']=max(1,settings['handlers']-1)
        # V11: when OBSERVABLE operational capacity is restored, mark the
        # existing backlog for cost/SLA-aware recovery priority. This uses
        # no future outcomes and changes no airline booking/ULD safety gate.
        now_capacity=tuple(settings[k] for k in ('handlers','cold_bays','stands'))
        old_capacity=self._last_effective_capacity
        if old_capacity and any(a>b for a,b in zip(now_capacity,old_capacity)):
            marked=set()
            for policy in self.lab.policies.values():
                for j in policy['waiting']:
                    j['recovery_pending']=True;marked.add(j['id'])
            if marked:self._record('RECOVERY_WINDOW',f'{len(marked)} queued work orders flagged after simulated resource restoration',count=len(marked))
        self._last_effective_capacity=now_capacity
        self.lab.step(count=count,**settings)
        elapsed=max(time.perf_counter()-start,1e-5)
        self.last_advance_ms=round(elapsed*1000,2)
        self._observe('TICK')
        added=max(0,len(self.lab.admitted)-before_orders)
        finished=max(0,len(self.lab.policies[ground_policy]['completed'])-before_complete)
        if added:self._record('ARRIVAL',f'{added} synthetic orders entered the shared cargo simulation',count=added)
        if finished:self._record('COMPLETED',f'{finished} synthetic {ground_policy.upper()} staging jobs completed',count=finished)
    def _clock_control(self, action, *args):
        with self.guard:
            if self._closed:
                raise Conflict('Sandbox has been deleted')
            getattr(self.clock, action)(*args)
            return self.snapshot()

    def start(self):
        return self._clock_control('start')

    def close(self):
        with self.guard:
            if not self._closed:
                self._closed = True
                self.clock.detach(self)

    def pause(self):
        return self._clock_control('pause')

    def configure(self,config):
        with self.guard:
            for key,value in config.items():
                if key=='weather':
                    if value not in ('CLEAR','RAIN','FOG','STORM','AUTO'):
                        raise ValueError('weather must be AUTO, CLEAR, RAIN, FOG, or STORM')
                    self.weather_mode='AUTO' if value=='AUTO' else 'FIXED'
                    if value=='AUTO':continue  # keep last effective weather until next deterministic transition
                if key in self.config:self.config[key]=value
            self._record('TUNE','Shared resource/demand settings updated',settings=dict(self.config))
            return self.snapshot()
    def set_speed(self,value):
        return self._clock_control('set_speed', value)
    def set_mode(self,value):
        if value not in MODES:raise ValueError('Unsupported review mode')
        with self.guard:
            prior=self.mode
            self.mode=value
            self._record('MODE',value+' · no real-world commands')
            if prior!=value and value=='AUTO_SHADOW':
                # Revisit a recommendation made while human/advisory mode was
                # active; it should not require an extra simulator tick.
                self.last_decision_id=None
            self._observe('MODE')
            return self.snapshot()
    def reset(self,seed=None):
        return self._clock_control('reset', seed)

    def _reset_lab(self, seed):
        seed=self.lab.seed if seed is None else seed
        self.lab.reset(seed)
        self.weather_mode='AUTO'
        self._weather_rng=random.Random(seed+8887)
        self._weather_bucket=-1
        self.config['weather']='CLEAR'
        self.review_signatures.clear()
        self.last_decision_id=None;self._last_event_marker=None
        self.last_tick=0;self.completed_ticks=0
        self.last_clock=self.lab.store.clock()
        self._last_effective_capacity=None
        self._record('RESET','Synthetic experiment reset; previous work-order simulation discarded')
        self._observe('RESET')

    def step(self,count=1):
        return self._clock_control('step', count)
    def incident(self,kind):
        with self.guard:
            self.lab.incident(kind)
            self._observe('INCIDENT')
            return self.snapshot()
    def order(self,**payload):
        with self.guard:
            out=self.lab.create_order(**payload)
            self._record('ORDER','Synthetic customer order accepted',awb=out['awb'],shipment_id=out['shipment_id'])
            self._observe('ORDER')
            return {'awb':out['awb'],'shipment_id':out['shipment_id'],'state':self.snapshot()}
    def review(self,choice,decision_id,version):
        with self.guard:
            if choice not in ('approve','reject'):raise ValueError('Invalid review decision')
            d=self.lab.latest
            if not d or d['id']!=decision_id:raise Conflict('Selected recommendation is no longer current')
            if choice=='approve' and d.get('approval_blocked_external_evidence'):raise Conflict('Flight evidence conflict')
            result=self.lab.review(choice,decision_id,version)
            self._record('REVIEW','Supervisor '+choice+' in sandbox only',decision_id=decision_id)
            return {'review':result,'state':self.snapshot()}
    def task_ack(self,task_id):
        from relay.schemas import TaskAckIn
        with self.guard:
            # Fetch the owning simulated work order BEFORE acknowledgement so
            # its shipment can receive a customer-safe progress projection.
            relevant=self.lab.store.tasks(self.lab.latest['id'] if self.lab.latest else '')
            owning=next((x for x in relevant if x['id']==task_id),None)
            result=self.lab.store.ack_task(task_id,TaskAckIn(worker='v8 synthetic crew',status='DONE',
                idempotency_key='v8-'+uuid.uuid4().hex),self.lab.store.clock())
            if owning:
                self.lab._journal(owning['shipment_id'],'SIMULATED_HANDOFF_PROGRESS',
                    'Internal synthetic ground handoff marked DONE; no cargo loading or customer notification',
                    'SANDBOX_TASK_ACK')
            # Explicitly distinguish backend task acknowledgement from flight/physical event.
            self._record('TASK','Synthetic task marked DONE by operator',task_id=task_id,
                         shipment_id=owning['shipment_id'] if owning else None)
            return {'result':result,'state':self.snapshot()}
    def playback_state(self):
        return {'mode':self.mode,'running':self.clock.running,'speed_target':self.clock.speed,
                'target_ticks_per_second':self.clock.speed*.5,
                'actual_ticks_per_second':self.clock.actual_ticks_per_sec,
                'last_batch_ms':self.last_advance_ms,
                'weather_capacity_assumption':'RAIN: stands -1; STORM: stands -2 and crew -1; CLEAR/FOG: unchanged; non-certified synthetic',
                'visualization_scope':'PROCEDURAL_FACILITY_REPRESENTATION; NOT SURVEYED CATHAY TERMINAL OR TRACKED AIRCRAFT',
                'sequence':self.sequence,'worker_error':self.clock.worker_error,
                'weather_mode':self.weather_mode,
                'config':dict(self.config),
                'scope':'SINGLE_SERVER_OWNED_SYNTHETIC_CLOCK; PHYSICAL_AIRLINE_COMMANDS_DISABLED'}

    def snapshot(self,awb=None):
        with self.guard:
            s=self.lab.snapshot()
            s['v8']=self.playback_state()
            s['unified_events']=list(self.events)[-35:]
            s['view_clock_contract']={'ground_tick':s['tick'],'tower_tick':s['tick'],'customer_tick':s['tick'],
                                    'snapshot_version':s['snapshot_version']}
            # The legacy lab hides all but its last 30 items. v8 portfolio must
            # NOT silently lose newly created customer orders when >30 admitted.
            state=project(self.lab.store,self.lab.store.clock())
            statuses={}
            for label,p in self.lab.policies.items():
                for j in p['waiting']:statuses.setdefault(j['id'],{})[label]='HOLD' if j['blocked_reason'] else 'WAIT'
                for a in p['active']:statuses.setdefault(a['job']['id'],{})[label]='WORK'
                for sid in p['completed']:statuses.setdefault(sid,{})[label]='DONE'
            items=[]
            for sid in sorted(self.lab.admitted):
                sh=state['shipments'].get(sid)
                if sh is None:continue
                job=safe_job(sh,state['as_of'])
                items.append({**job,'ground_stage':statuses.get(sid,{}).get(self.lab.ground_policy,'UNKNOWN'),
                  'stage_baseline':statuses.get(sid,{}).get('fcfs','UNKNOWN'),
                  'stage_relay':statuses.get(sid,{}).get('relay','UNKNOWN'),
                  'assigned_flight_id':sh.get('assigned_flight_id'),
                  'dimension_conflict':sh.get('dimension_conflict',False),
                  'customs_hold':sh.get('customs_hold',False),'status':sh['status']})
            # Prefer the most recently customer-created orders in portfolio,
            # while still projecting EVERY admitted order for cross-view audit.
            items.sort(key=lambda x:(not x['id'].startswith('SYN-DEMO-'),x['id']))
            s['shipment_objects']=items
            s['portfolio_coverage']={'admitted':len(self.lab.admitted),'shown':len(items),'truncated':False}
            selected=next((j for j in items if j['awb']==awb),None) if awb else (items[0] if items else None)
            if selected:
                customer=self.lab.customer_journey(selected['awb'])
                rd=customer.get('route_decision') or {}
                decision=self.lab.latest
                if decision and rd.get('tentative_alternative_flights'):
                    persisted=self.lab.store.get_decision(decision['id'])
                    status=persisted['status']
                    if status=='APPROVED_SIMULATION_ONLY':
                        rd['review_status']='INTERNAL_SANDBOX_APPROVED_NOT_CARRIER_CONFIRMED'
                    elif status=='REJECTED':
                        rd['review_status']='REJECTED_BY_INTERNAL_REVIEW'
                    elif decision['snapshot_version']!=self.lab.store.version():
                        rd['review_status']='CURRENT_PROPOSAL_STALE_REEVALUATE'
                    else:
                        rd['review_status']='PENDING_INTERNAL_REVIEW'
                    rd['carrier_confirmed']=False
                    rd['customer_eta_changed_by_proposal']=False
                customer['route_decision']=rd
                s['customer_projection']=customer
            else:s['customer_projection']=None
            return s
