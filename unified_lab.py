"""RELAY v4: ONE synthetic canonical dataset / one event clock / one shipment ID.

Operational research *shadow* twin. Work orders are simulated staging/documentation tasks,
NOT a physical cargo/flight actuation system. Both policies share the same observed
records, service times, eligibility restrictions and event trajectory. All three
research models run against this lab's own isolated event-sourced Store.
"""
from __future__ import annotations
import math, random, statistics, tempfile, threading, time, uuid, os
from datetime import timedelta
from pathlib import Path
from collections import Counter
from typing import Literal, get_args
from relay.store import Store, Conflict
from relay.schemas import EventIn, EvaluationRequest, ReviewIn, TaskAckIn, parse_time, ts
from relay.state import project
from relay.engine import evaluate, customer_track
from relay.simulator import tick as make_operational_event

DATA = Path(__file__).resolve().parent / 'data'
PRIORITY={'STANDARD':1,'PRIORITY':2,'CRITICAL':3}
IncidentKind = Literal['flight_delay','flight_cancelled','capacity_changed','terminal_congestion',
                       'shipment_dimension_conflict','shipment_dimension_verified']


def safe_job(s, now, step_seconds=600):
    """Observable-only work-order features (no hidden mismatch/latent oracle)."""
    remaining=(parse_time(s['deadline'])-parse_time(now)).total_seconds()
    return {'id':s['id'],'awb':s['awb'],'destination':s['destination'],
      'client_id':s['client_id'],'priority':PRIORITY.get(s['service'],1),
      'cold':s['handling']=='COL','handling':s['handling'],
      'weight_kg':s['weight_kg'],'deadline_tick':max(1,math.ceil(remaining/step_seconds)),
      'duration':min(5,max(2,math.ceil(s['weight_kg']/110)+int(s['handling']=='COL'))),
      'blocked_reason':('DGR_REQUIRES_AUTHORIZED_RULES' if s['handling']=='DGR' else
                        'CUSTOMS_HOLD' if s.get('customs_hold') else
                        'MEASUREMENT_VERIFICATION_REQUIRED' if s.get('dimension_conflict') else None)}


def select_tasks(waiting, active, tick, handlers=3, stands=3, cold_bays=1, policy='relay'):
    """Exact ranking for single-slot general + cold restricted slots. No loading certification.

    Both comparators filter IDENTICAL hard guards before choosing. For a fixed queue,
    durations and execution constraints, the RELAY policy maximizes an observable
    urgency score; the FCFS baseline greedily assigns oldest eligible requests.
    """
    free=max(0,min(handlers,stands)-len(active))
    cold_free=max(0,cold_bays-sum(int(x['job']['cold']) for x in active))
    eligible=[j for j in waiting if j['blocked_reason'] is None]
    if free==0 or not eligible:return [], {'status':'NO_ELIGIBLE_CAPACITY','eligible':len(eligible),'score':0,'scope':'STAGING_TASKS_ONLY'}
    if policy=='fcfs':
        chosen=[]
        for j in sorted(eligible,key=lambda x:(x['admit_tick'],x['id'])):
            if len(chosen)>=free:break
            if j['cold'] and sum(k['cold'] for k in chosen)>=cold_free:continue
            chosen.append(j)
        return chosen,{'status':'FCFS_FEASIBLE','eligible':len(eligible),'score':None,'scope':'STAGING_TASKS_ONLY'}
    def urgency(j):
        # All these attributes are visible at the decision epoch.
        slack=j['deadline_tick']-(tick+j['duration'])
        return 5*j['priority']+12*max(0,3-slack)+.75*(tick-j['admit_tick'])+4*int(j.get('network_at_risk',False))
    categories=[]
    for is_cold in (False,True):
        items=sorted([(urgency(j),j) for j in eligible if j['cold']==is_cold],key=lambda a:(-a[0],a[1]['admit_tick'],a[1]['id']))
        categories.append(items[:free])
    normal,cold=categories
    cp=[0.]
    gp=[0.]
    for score,_ in cold:cp.append(cp[-1]+score)
    for score,_ in normal:gp.append(gp[-1]+score)
    winner=(-math.inf,0,0)
    for n_c in range(min(free,cold_free,len(cold))+1):
        n_g=min(len(normal),free-n_c)
        value=cp[n_c]+gp[n_g]
        if value>winner[0]+1e-9:winner=(value,n_c,n_g)
    selected=[j for _,j in cold[:winner[1]]]+[j for _,j in normal[:winner[2]]]
    assert len(selected)+len(active)<=min(handlers,stands)
    assert sum(int(x['job']['cold']) for x in active)+sum(int(j['cold']) for j in selected)<=cold_bays
    return selected,{'status':'OPTIMAL_OBSERVABLE_URGENCY','eligible':len(eligible),
                     'score':round(winner[0],3),'scope':'EXACT_TWO_CLASS_STAGING_SELECTION'}


def new_policy():
    return {'waiting':[],'active':[],'completed':[],'missed':0,'cost':0.,'lead_sum':0.,
            'last_selected':[],'last_meta':{},'unsafe_dispatches':0}


class UnifiedLab:
    def __init__(self,seed=2048):
        self.lock=threading.RLock()
        self._tmp=tempfile.TemporaryDirectory(prefix='relay-v4-shadow-')
        self._init(seed)

    def _init(self,seed):
        self.seed=int(seed)
        # V11 staged-task dispatch; use RELAY_V11_DISPATCH=0 for a reproducible v10 A/B replay.
        self.v11_dispatch_enabled=(os.getenv('RELAY_V11_DISPATCH','1')!='0')
        self.rng=random.Random(self.seed)
        self.store=Store(str(Path(self._tmp.name)/('v4-'+uuid.uuid4().hex[:8]+'.sqlite')))
        self.store.load_demo(DATA)
        self.t=0
        self.rate=2.0
        self.chaos=.2
        self.handlers=3;self.stands=3;self.cold_bays=1
        self.admitted=set()
        self.policies={'fcfs':new_policy(),'relay':new_policy()}
        self.history=[]
        self.latest=None
        self.recent_event=None
        self._log('SYSTEM','One canonical 30-day synthetic dataset loaded','SYSTEM')
        # Four ALREADY-ACCEPTED work orders exist at T0, like a real shift
        # handover. The first model evaluation uses precisely these same IDs.
        initial=self._pool(project(self.store,self.store.clock()))[:4]
        for record in initial:
            j=safe_job(record,self.store.clock());j['admit_tick']=0
            j['deadline_tick']=j['deadline_tick']
            j['network_at_risk']=False
            self.admitted.add(record['id'])
            for policy in self.policies.values():policy['waiting'].append(dict(j))
            self._log('INPUT','inherited accepted work order '+record['id'],
                      'CANONICAL_SYNTHETIC_CATALOG',record['id'])
        self._evaluate()
        self._apply_network_context()

    def reset(self, seed=None):
        with self.lock:
            self._tmp.cleanup()
            self._tmp=tempfile.TemporaryDirectory(prefix='relay-v4-shadow-')
            self._init(self.seed if seed is None else seed)
            return self.snapshot()

    def _log(self,kind,message,source='V4_SHADOW',ref=None):
        self.history.append({'tick':self.t,'clock':self.store.clock(),'category':kind,
                             'source':source,'message':message,'ref':ref})
        self.history=self.history[-180:]

    def _pool(self,state):
        # No invented live shipments: staged work orders link to a canonical AWB.
        return sorted([s for s in state['shipments'].values()
                       if s['custody_state']=='RECEIVED' and
                          parse_time(s['accepted_at'])<=parse_time(state['as_of'])],
                      key=lambda s:(s['accepted_at'],s['id']))

    def _evaluate(self):
        t=time.perf_counter()
        try:
            state=project(self.store,self.store.clock())
            scoped=[sid for sid in sorted(self.admitted) if sid in state['shipments'] and state['shipments'][sid]['custody_state']=='RECEIVED'][:24]
            d=evaluate(self.store,EvaluationRequest(shipment_ids=scoped,time_limit_s=2.0))
            self.latest=d
            self._log('MODEL','I: '+str(d['model_i']['status'])+
                     ' | II: '+str(d['model_ii']['action'])+
                     ' | III: '+str(d['model_iii']['status'])+f' | {d["engine_runtime_ms"]:.1f}ms',
                     'REAL_PYTHON_SOLVERS',d['id'])
            self._log('DECISION',d['action']+' / '+d['status']+
                     f' / {len(d["proposed_actions"])} tentative changes',
                     'VERSIONED_DECISION',d['id'])
        except (ValueError,Conflict) as exc:
            self.latest=None
            self._log('ERROR',str(exc),'SOLVER')
        return round((time.perf_counter()-t)*1000,2)

    def _pause_newly_blocked_active(self,state):
        # An authoritative new dimensional/customs hold must not allow an active
        # simulated staging work order to continue; apply to BOTH worlds.
        for p in self.policies.values():
            keep=[]
            for a in p['active']:
                j=a['job']
                if j['id'] in state['shipments']:
                    reason=safe_job(state['shipments'][j['id']],state['as_of'])['blocked_reason']
                    if reason:
                        j['blocked_reason']=reason
                        p['waiting'].append(j)
                        self._log('GATE','paused staging work order '+j['id']+' : '+reason,'AUTHORITATIVE_HARD_GUARD')
                        continue
                keep.append(a)
            p['active']=keep

    def _apply_network_context(self):
        # Only public-facing, observable PLAN information can influence the
        # RELAY dispatch score. This remains a planning signal, not approval.
        if not self.latest:return
        risks={x['shipment_id'] for x in self.latest.get('plan',[])
               if x.get('kind')=='UNRESOLVED_ESCALATION'}
        for p in self.policies.values():
            for j in p['waiting']:
                j['network_at_risk']=j['id'] in risks

    def _advance_policies(self):
        for name,p in self.policies.items():
            done=[]
            for a in p['active']:
                a['remaining']-=1
                if a['remaining']<=0:
                    j=a['job'];done.append(j)
                    p['completed'].append(j['id'])
                    p['lead_sum']+=self.t-j['admit_tick']
                    # Same realized service durations and accounting in both worlds.
                    p['cost']+=j['duration']*1.5
                    if self.t>j['deadline_tick']:
                        p['missed']+=1
                        p['cost']+=3*j['priority']*(self.t-j['deadline_tick'])
                else:pass
            p['active']=[a for a in p['active'] if a['remaining']>0]
            p['cost']+=sum(.35*j['priority'] for j in p['waiting'])
            if name=='relay' and self.v11_dispatch_enabled:
                from v11.benchmark import select_v11
                selected,meta=select_v11(p['waiting'],p['active'],self.t,
                    handlers=self.handlers,stands=self.stands,cold_bays=self.cold_bays)
            else:
                selected,meta=select_tasks(p['waiting'],p['active'],self.t,
                    handlers=self.handlers,stands=self.stands,cold_bays=self.cold_bays,policy=name)
            ids={j['id'] for j in selected}
            p['waiting']=[j for j in p['waiting'] if j['id'] not in ids]
            for j in selected:
                if j['blocked_reason'] is not None:
                    p['unsafe_dispatches']+=1
                    raise AssertionError('blocked cargo assigned')
                p['active'].append({'job':j,'remaining':j['duration'],'duration':j['duration']})
            p['last_selected']=[j['id'] for j in selected]
            p['last_meta']=meta
            if name=='relay' and (selected or p['waiting']):
                self._log('DISPATCH',f"staging queue={len(p['waiting'])}, selected={','.join(p['last_selected']) or 'none'}; "
                          f"rule={meta['status']}; crew≤{self.handlers}, stands≤{self.stands}, cold≤{self.cold_bays}",
                          'SHARED_OBSERVED_WORK_ORDERS')

    def step(self,count=1,rate=None,chaos=None,handlers=None,cold_bays=None,stands=None):
        with self.lock:
            if not isinstance(count,int) or not 1<=count<=12:raise ValueError('count must be 1..12')
            if rate is not None:
                if not .25<=float(rate)<=5:raise ValueError('rate must be 0.25..5')
                self.rate=float(rate)
            if chaos is not None:
                if not 0<=float(chaos)<=1:raise ValueError('chaos must be 0..1')
                self.chaos=float(chaos)
            for name,val,lo,hi in [('handlers',handlers,1,6),('stands',stands,1,6),('cold_bays',cold_bays,0,3)]:
                if val is not None:
                    if not isinstance(val,int) or not lo<=val<=hi:raise ValueError(name+' out of range')
                    old=getattr(self,name)
                    setattr(self,name,val)
                    if old!=val:self._log('CONTROL',f'{name}: {old} → {val}; already active work is not preempted',
                                          'SIMULATED_RESOURCE_POLICY')
            for _ in range(count):
                self.t+=1
                if self.t%5==0 and self.chaos>0 and self.rng.random()<self.chaos:
                    incident=make_operational_event(self.store,600,self.seed+self.t)
                    if incident.get('event'):
                        self.recent_event=incident['event']
                        self._log('INPUT',incident['event']['event_type']+' / '+incident['event']['entity_id'],
                                  incident['event']['source'],incident['event']['event_id'])
                else:
                    self.store.set_clock(ts(parse_time(self.store.clock())+timedelta(seconds=600)))
                state=project(self.store,self.store.clock())
                pool=[s for s in self._pool(state) if s['id'] not in self.admitted]
                arrivals=min(len(pool), self._poisson(self.rate))
                for s in pool[:arrivals]:
                    job=safe_job(s,state['as_of'])
                    job['admit_tick']=self.t
                    job['network_at_risk']=False
                    job['deadline_tick']=self.t+job['deadline_tick']
                    # ensure hard gates rechecked against current evidence below
                    for p in self.policies.values():p['waiting'].append(dict(job))
                    self.admitted.add(s['id'])
                    self._log('INPUT','work-order released '+s['id']+' → '+s['destination']+
                              ' / '+s['handling'],'CANONICAL_SYNTHETIC_CATALOG',s['id'])
                # If new authoritative evidence changes a job, both policies see the same gate.
                for p in self.policies.values():
                    for j in p['waiting']:
                        if j['id'] in state['shipments']:
                            j['blocked_reason']=safe_job(state['shipments'][j['id']],state['as_of'])['blocked_reason']
                self._pause_newly_blocked_active(state)
                if self.recent_event is not None and self.recent_event.get('received_at')==self.store.clock():
                    self._evaluate()  # incident must update route context before dispatch
                self._apply_network_context()
                self._advance_policies()
            solve_ms=self._evaluate()
            out=self.snapshot();out['last_evaluate_wall_ms']=solve_ms
            return out

    def _poisson(self,rate):
        # Knuth draw, seeded and identical input for two policies.
        l=math.exp(-rate);k=0;product=1.
        while product>l:
            k+=1;product*=self.rng.random()
        return k-1

    def incident(self, kind='flight_cancelled'):
        with self.lock:
            if kind not in get_args(IncidentKind):
                raise ValueError('unsupported incident')
            s=project(self.store,self.store.clock())
            if kind=='terminal_congestion':
                entity_type='terminal';entity_id='HKG-T1';source='SYNTHETIC_GROUND_OPS'
                payload={'capacity_fraction':.65,'duration_seconds':3*3600}
            elif kind.startswith('flight') or kind=='capacity_changed':
                flights=[f for f in s['flights'].values() if f['status']=='Scheduled' and
                         parse_time(f['estimated_departure'])>parse_time(s['as_of'])+timedelta(minutes=35)]
                future_used={x['assigned_flight_id'] for x in self._pool(s)}
                flights.sort(key=lambda x:(x['id'] not in future_used,x['estimated_departure']))
                if kind=='flight_delay':
                    delay_seconds=45*60
                    flights=[f for f in flights if parse_time(f['estimated_departure'])+timedelta(seconds=delay_seconds)
                             <=parse_time(f['scheduled_departure'])+timedelta(days=1)]
                if not flights:raise ValueError('no future synthetic flight available; reset the scenario')
                f=flights[0];entity_type='flight';entity_id=f['id']
                source='SYNTHETIC_FLIGHT_OPS'
                if kind=='flight_delay':
                    current_delay=parse_time(f['estimated_departure'])-parse_time(f['scheduled_departure'])
                    payload={'delay_seconds':max(0,int(current_delay.total_seconds()))+delay_seconds}
                elif kind=='flight_cancelled':
                    payload={'reason_code':'SYNTHETIC_DISRUPTION'}
                else:
                    source='SYNTHETIC_INVENTORY'
                    payload={'remaining_kg':max(0,int(f['remaining_kg']*.22)),
                             'cool_remaining_kg':max(0,int(f['cool_remaining_kg']*.22))}
            else:
                if kind=='shipment_dimension_verified':
                    candidates=[x for x in self._pool(s) if x['dimension_conflict']]
                    if not candidates:raise ValueError('no disputed dimension to verify; first inject a mismatch')
                    x=next((z for z in candidates if z['id'] in self.admitted),candidates[0])
                    piece=s['pieces'][x['piece_ids'][0]]
                    payload={'piece_id':piece['id'],
                         'dimensions_cm':[piece['length_cm'],piece['width_cm'],piece['height_cm']]}
                else:
                    candidates=[x for x in self._pool(s) if not x['dimension_conflict'] and x['handling']!='DGR']
                    if not candidates:raise ValueError('no verifiable shipment currently available')
                    x=next((z for z in candidates if z['id'] in self.admitted),candidates[0])
                    payload={'piece_id':x['piece_ids'][0],'reason':'scanner/acceptance dimensions disagree'}
                entity_type='shipment';entity_id=x['id']
                source='SYNTHETIC_MEASUREMENT'
            prior_revision=max((e['source_revision'] for e in self.store.events(until=s['as_of'],entity_id=entity_id)
                                if e['disposition']=='ACCEPTED'),default=0)
            revision_floor=(2000 if kind=='shipment_dimension_verified' else 1000)+self.t
            event=EventIn(event_id='V4-'+uuid.uuid4().hex[:18],event_type=kind,entity_type=entity_type,
                          entity_id=entity_id,event_time=self.store.clock(),received_at=self.store.clock(),
                          source=source,source_revision=max(prior_revision+1,revision_floor),trusted=True,payload=payload)
            ing=self.store.append_event(event)
            assert ing['disposition']=='ACCEPTED',ing
            self.recent_event=event.model_dump()
            self._log('INPUT',kind+' / '+entity_id,source,event.event_id)
            new_state=project(self.store,self.store.clock())
            for p in self.policies.values():
                for j in p['waiting']:
                    if j['id'] in new_state['shipments']:
                        j['blocked_reason']=safe_job(new_state['shipments'][j['id']],new_state['as_of'])['blocked_reason']
            self._pause_newly_blocked_active(new_state)
            self._evaluate()
            self._apply_network_context()
            return self.snapshot()

    def review(self,choice,decision_id,expected_snapshot_version):
        with self.lock:
            if not self.latest or self.latest['id']!=decision_id:raise Conflict('not current decision')
            result=self.store.review(decision_id,ReviewIn(decision=choice,reviewer='v4 sandbox supervisor',
                  expected_snapshot_version=expected_snapshot_version,idempotency_key='v4-'+uuid.uuid4().hex,
                  reason='Shadow review via local UI'),self.store.clock())
            self._log('REVIEW',choice+' / '+decision_id,'SIMULATED_OPERATOR',decision_id)
            return result

    def sample_awb(self):
        if self.admitted:return self.store.get_catalog('shipment',sorted(self.admitted)[0])['awb']
        items=self._pool(project(self.store,self.store.clock()))
        return items[0]['awb'] if items else None

    def track(self,awb):return customer_track(self.store,awb)

    def snapshot(self):
        with self.lock:
            state=project(self.store,self.store.clock())
            decision=self.store.get_decision(self.latest['id']) if self.latest else None
            included=set(self.admitted)
            statuses={}
            for label,p in self.policies.items():
                for j in p['waiting']:statuses.setdefault(j['id'],{})[label]='HOLD' if j['blocked_reason'] else 'WAIT'
                for a in p['active']:statuses.setdefault(a['job']['id'],{})[label]='WORK'
                for jid in p['completed']:statuses.setdefault(jid,{})[label]='DONE'
            display=[]
            for sid in sorted(included):
                if sid not in state['shipments']:continue
                s=state['shipments'][sid];j=safe_job(s,state['as_of'])
                display.append({**j,'stage_baseline':statuses.get(sid,{}).get('fcfs','UNKNOWN'),
                                'stage_relay':statuses.get(sid,{}).get('relay','UNKNOWN'),
                                'assigned_flight_id':s.get('assigned_flight_id'),
                                'dimension_conflict':s.get('dimension_conflict',False),
                                'customs_hold':s.get('customs_hold',False),
                                'status':s['status']})
            pstats={}
            timing=lambda j:{k:j.get(k) for k in ('admit_tick','deadline_tick','duration')}
            for label,p in self.policies.items():
                n=len(p['completed']);pstats[label]={'completed':n,'waiting':len(p['waiting']),
                  'blocked':sum(bool(j['blocked_reason']) for j in p['waiting']),
                  'active':len(p['active']),'missed_work_order_targets':p['missed'],
                  'mean_staging_lead_ticks':round(p['lead_sum']/n,3) if n else None,
                  'cost_units':round(p['cost'],3),'unsafe_dispatches':p['unsafe_dispatches'],
                  'solver':p['last_meta'],'selected':p['last_selected'],
                  'objects':[{'id':j['id'],'status':'WAIT','cold':j['cold'],'priority':j['priority'],
                              'destination':j['destination'],'blocked':bool(j['blocked_reason']),**timing(j)} for j in p['waiting'][:120]] +
                            [{'id':a['job']['id'],'status':'MOVING','cold':a['job']['cold'],
                              'priority':a['job']['priority'],'destination':a['job']['destination'],**timing(a['job']),
                              'progress':1-a['remaining']/a['duration']} for a in p['active']]}
            tasks=self.store.tasks(decision['id']) if decision else []
            return {'version':'4.0','mode':'CANONICAL_SYNTHETIC_SINGLE_WORLD','clock':state['as_of'],
              'tick':self.t,'rate':self.rate,'chaos':self.chaos,'seed':self.seed,
              'resources':{'handlers':self.handlers,'cold_bays':self.cold_bays,'stands':self.stands},
              'snapshot_version':state['snapshot_version'],'work_orders_total':len(included),
              'available_canonical_orders':len(self._pool(state)),
              'shipment_objects':display[-30:],'policies':pstats,
              'decision_scope_ids':(self.latest or {}).get('input_evidence',{}).get('shipment_ids',[]),
              'decision_scope_truncated':len(self.admitted)>24,
              'latest_event':self.recent_event,'logs':self.history[-40:],
              'decision':{'id':decision['id'],'status':decision['status'],'action':decision['action'],
                  'created_at':decision['created_at'],'snapshot_version':decision['snapshot_version'],
                  'stale':decision['status']=='PENDING_REVIEW' and decision['snapshot_version']!=state['snapshot_version'],
                  'proposed_actions':decision['proposed_actions'],
                  'warnings':decision['reason_codes'],
                  'solver_runtime_ms':decision['engine_runtime_ms'],
                  'model_i':{'status':decision['model_i']['status'],
                     'coverage_fraction':decision['model_i'].get('coverage_fraction'),
                     'risk_improvement_units':decision['model_i'].get('aggregate_risk_improvement_units',0),
                     'placements':decision['model_i'].get('risk_aware',{}).get('placements',[]),
                     'certificate':False},
                  'model_ii':{'status':decision['model_ii']['status'],
                     'affected_shipments':decision['model_ii']['affected_shipments'],
                     'cases':[{'shipment_id':x['shipment_id'],'action':x['action'],
                               'verification_net_value':x['verification_net_value']} for x in decision['model_ii'].get('cases',[])]},
                  'model_iii':{'status':decision['model_iii']['status'],
                     'candidate_columns':decision['model_iii'].get('candidate_columns'),
                     'unresolved':decision['model_iii'].get('metrics',{}).get('unresolved_count'),
                     'gap':decision['model_iii'].get('solver',{}).get('mip_gap'),
                     'routes':decision['model_iii'].get('plan',[])[:24],
                     'risk_objective':decision['model_iii'].get('metrics',{}).get('risk_adjusted_objective'),
                     'fcfs_risk_objective':decision['model_iii'].get('baseline_fcfs',{}).get('risk_adjusted_objective')}
              } if decision else None,'tasks':tasks,
              'flights':[{'id':f['id'],'origin':f['origin'],'destination':f['destination'],
                     'departure':f['estimated_departure'],'status':f['status'],
                     'remaining_kg':f['remaining_kg']} for f in list(state['flights'].values())[:28]],
              'data_provenance':'30-day generated history + synthetic authoritative updates; not Cathay data',
              'physical_execution':False,'real_customer_notifications':False,
              'benchmark_scope':'Matched dispatch policy on shared canonical work orders; not airline-wide ROI'}


def paired_queue_benchmark(lab:UnifiedLab,episodes=1000,seed=707):
    """Monte Carlo over sampled canonical templates; no rerun of 3-paper global solver.

    Same arrivals, duration and observed attributes for both policies; measure
    staging completion penalty differences, NOT airline financial ROI.
    """
    if not isinstance(episodes,int) or not 100<=episodes<=10000:raise ValueError('episodes must be 100..10000')
    templates=[safe_job(s,lab.store.clock()) for s in lab._pool(project(lab.store,lab.store.clock()))]
    if not templates:raise ValueError('no template work orders')
    rng=random.Random(seed);differences=[];missed_a=missed_b=0
    for run in range(episodes):
        # Separate deterministic episode; CRN pairing gives lower variance.
        policies={'fcfs':new_policy(),'relay':new_policy()}
        for t in range(1,22):
            arrivals=max(0,int(rng.gauss(lab.rate,1.05)))
            new=[]
            for i in range(arrivals):
                template=templates[rng.randrange(len(templates))]
                j=dict(template);j['id']=f'{run}-{t}-{i}';j['admit_tick']=t
                j['deadline_tick']=t+rng.randrange(3,14)
                new.append(j)
            for p in policies.values():p['waiting'].extend([dict(j) for j in new])
            for label,p in policies.items():
                for a in p['active']:a['remaining']-=1
                active=[]
                for a in p['active']:
                    if a['remaining']>0:active.append(a);continue
                    j=a['job'];p['completed'].append(j['id']);p['cost']+=j['duration']*1.5
                    if t>j['deadline_tick']:
                        p['missed']+=1;p['cost']+=(t-j['deadline_tick'])*3*j['priority']
                p['active']=active
                p['cost']+=sum(.35*j['priority'] for j in p['waiting'])
                chosen,_=select_tasks(p['waiting'],p['active'],t,handlers=lab.handlers,
                    stands=lab.stands,cold_bays=lab.cold_bays,policy=label)
                ids={x['id'] for x in chosen}
                p['waiting']=[j for j in p['waiting'] if j['id'] not in ids]
                p['active'] += [{'job':j,'duration':j['duration'],'remaining':j['duration']} for j in chosen]
        differences.append(policies['fcfs']['cost']-policies['relay']['cost'])
        missed_a+=policies['fcfs']['missed'];missed_b+=policies['relay']['missed']
    mean=statistics.fmean(differences)
    sd=statistics.stdev(differences) if episodes>1 else 0.
    return {'episodes':episodes,'seed':seed,'paired_saving_units':round(mean,4),
           'ci_95_mc':[round(mean-1.96*sd/math.sqrt(episodes),4),round(mean+1.96*sd/math.sqrt(episodes),4)],
           'regression_fraction':round(sum(x<0 for x in differences)/episodes,4),
           'missed_staging_targets_fcfs':missed_a,'missed_staging_targets_relay':missed_b,
           'scope':'SIMULATED_STAGING_ONLY; same synthetic templates and events; no 3-paper MILP per episode',
           'real_cathay_roi':None}
