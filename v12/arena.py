"""Five synchronized synthetic staging worlds.

ONE generated input tape, ONE server clock, ONE resource/incident trajectory,
FIVE isolated policy states. All five advance regardless of viewport selection.
This is a visualization/decision-policy comparison, *not* aircraft dispatch.
"""
from __future__ import annotations
import math,time
from threading import RLock,Thread,Event
from collections import deque
import numpy as np
from v12.policies import POLICIES,LABELS,select_policy
from v11.benchmark import COST_DEFAULT,SCENARIOS
from unified_lab import safe_job
from relay.state import project

SPEEDS=(1,4,16,32,100)
MAX_EVENTS=160


def new_policy():
 return {'waiting':[],'active':[],'completion':{},'on_time':0,
         'holding_cost':0.,'late_cost':0.,'handling_cost':0.,
         'last_selected':[],'last_meta':{},'unsafe_assignments':0,
         'selection_ms_sum':0.,'dispatch_count':0}

class FiveWorldArena:
 def __init__(self,canonical_lab,seed=9099):
  self._guard=RLock()
  state=project(canonical_lab.store,canonical_lab.store.clock())
  self._templates=[safe_job(s,state['as_of']) for s in canonical_lab._pool(state)]
  self._templates=[t for t in self._templates if t['blocked_reason'] is None]
  if not self._templates:raise RuntimeError('no eligible canonical synthetic work templates')
  self._stop=Event();self._thread=None
  self.reset(seed)

 def _log(self,kind,message,**more):
  self.seq+=1
  self.events.append({'seq':self.seq,'tick':self.tick,'kind':kind,
                      'message':message,**more})

 def reset(self,seed=9099,scenario='normal'):
  if scenario not in SCENARIOS:raise ValueError('unknown scenario')
  self._stop.set()
  with self._guard:
   self.running=False;self.error=None;self.seed=seed
   self.rng=np.random.default_rng(seed);self.tick=0;self.speed=1
   self.weather='CLEAR';self.scenario=scenario
   self.config={k:SCENARIOS[scenario][k] for k in ('arrival_rate','handlers','stands','cold_bays')}
   self.chaos=.12;self.generated=0;self.worlds={p:new_policy() for p in POLICIES}
   self.cohort={};self.seq=0;self.events=deque(maxlen=MAX_EVENTS)
   self.completed_ticks=0;self.actual_ticks_per_second=0.;self._samples=deque(maxlen=200)
   self._worker_started=None;self.last_step_ms=0
   self._effective_resources=None
   self._log('RESET',f'Identical arrival tape and capacity for all five policies · seed {seed}')
   return self.snapshot()

 def configure(self,params):
  with self._guard:
   for name,val in params.items():
    bounds={'arrival_rate':(.1,8.),'handlers':(1,12),'stands':(1,12),
            'cold_bays':(0,6),'chaos':(0,1)}
    if name not in bounds:raise ValueError('unknown setting: '+name)
    lo,hi=bounds[name]
    if not lo<=val<=hi:raise ValueError('out of range: '+name)
    if name=='chaos':self.chaos=float(val)
    else:self.config[name]=val
   self._log('TUNE','Shared inputs changed for all five worlds',settings=dict(params))
   return self.snapshot()

 def set_speed(self,v):
  if v not in SPEEDS:raise ValueError('unsupported playback speed')
  with self._guard:
   self.speed=v;self._log('SPEED',f'{v}× requested; achieved ticks/sec measured separately')
   return self.snapshot()

 def incident(self,kind):
  if kind not in ('RAIN','STORM','FOG','CLEAR','CREW_SHORTAGE','COLD_OUTAGE','DEMAND_SURGE'):
   raise ValueError('unsupported incident')
  with self._guard:
   if kind in ('RAIN','STORM','FOG','CLEAR'):self.weather=kind
   elif kind=='CREW_SHORTAGE':self.config['handlers']=1
   elif kind=='COLD_OUTAGE':self.config['cold_bays']=0
   elif kind=='DEMAND_SURGE':self.config['arrival_rate']=min(8,self.config['arrival_rate']*1.7)
   self._log('DISRUPTION',f'Shared synthetic scenario: {kind}')
   return self.snapshot()

 def _effective(self):
  handlers=int(self.config['handlers']);stands=int(self.config['stands'])
  cold=int(self.config['cold_bays'])
  if self.weather=='RAIN':stands=max(1,stands-1)
  if self.weather=='STORM':
   stands=max(1,stands-2);handlers=max(1,handlers-1)
  if self.scenario=='temporary_disruption' and 9<=self.tick<=14:
   handlers=max(1,handlers-2);stands=max(1,stands-1)
  return handlers,stands,cold

 def _tick_once(self):
  self.tick+=1
  if self.tick%8==0 and self.chaos and self.rng.random()<self.chaos:
   previous=self.weather
   self.weather=str(self.rng.choice(['CLEAR','CLEAR','RAIN','FOG','STORM']))
   if previous!=self.weather:
    self._log('WEATHER',f'{previous} → {self.weather} (synthetic, shared)',weather=self.weather)
  if self.scenario=='temporary_disruption' and self.tick in (9,15):
   self._log('DISRUPTION' if self.tick==9 else 'RESTORED', 'Temporary shared crew/stand outage' if self.tick==9 else 'Shared crew/stand capacity restored')
  n=int(self.rng.poisson(self.config['arrival_rate']))
  arrivals=[]
  for i in range(n):
   j=dict(self._templates[int(self.rng.integers(0,len(self._templates)))])
   j['id']=f'V12-{self.seed}-{self.tick:06d}-{i:03d}'
   j['admit_tick']=self.tick
   j['deadline_tick']=self.tick+int(self.rng.integers(3,14))
   j['network_at_risk']=False
   j['recovery_pending']=False
   self.cohort[j['id']]=dict(j)
   arrivals.append(j)
  self.generated+=n
  effective=self._effective()
  if self._effective_resources is not None and any(a>b for a,b in zip(effective,self._effective_resources)):
   for p in self.worlds.values():
    for j in p['waiting']:j['recovery_pending']=True
   self._log('RESTORED','Shared capacity restoration; current queued jobs flagged for recovery')
  self._effective_resources=effective
  h,s,c=effective
  if n:self._log('ARRIVAL',f'{n} new orders admitted to ALL five worlds',count=n)
  for name,p in self.worlds.items():
   p['waiting'].extend(dict(j) for j in arrivals)
   still=[]
   for a in p['active']:
    a['remaining']-=1
    if a['remaining']>0:still.append(a);continue
    j=a['job'];p['completion'][j['id']]=self.tick
    p['handling_cost']+=COST_DEFAULT['handling']*j['duration']
    if self.tick<=j['deadline_tick']:p['on_time']+=1
    else:p['late_cost']+=COST_DEFAULT['tardiness']*j['priority']*(self.tick-j['deadline_tick'])
   p['active']=still
   for j in p['waiting']:
    p['holding_cost']+=COST_DEFAULT['waiting']*j['priority']
    if self.tick>j['deadline_tick']:
     p['holding_cost']+=COST_DEFAULT['overdue_waiting']*j['priority']
   started=time.perf_counter()
   chosen,meta=select_policy(name,p['waiting'],p['active'],self.tick,h,s,c)
   p['selection_ms_sum']+=(time.perf_counter()-started)*1000;p['dispatch_count']+=1
   chosen_ids={j['id'] for j in chosen}
   p['waiting']=[j for j in p['waiting'] if j['id'] not in chosen_ids]
   # Non-preemptive existing work can exceed a suddenly reduced capacity.
   # Only NEW starts must respect the available free slots.
   if len(chosen)>max(0,min(h,s)-len(p['active'])):raise AssertionError('new dispatch resource overflow')
   if sum(a['job']['cold'] for a in p['active'])+sum(j['cold'] for j in chosen)>max(c,sum(a['job']['cold'] for a in p['active'])):
    raise AssertionError('cold capacity overflow')
   for j in chosen:
    if j.get('blocked_reason'):
     p['unsafe_assignments']+=1
     raise AssertionError('blocked cargo selected')
    p['active'].append({'job':j,'remaining':j['duration']})
   p['last_selected']=[j['id'] for j in chosen]
   p['last_meta']=meta
   if chosen and self.tick%4==0:
    self._log('DISPATCH',f'{LABELS[name]} dispatched {len(chosen)} jobs',policy=name,count=len(chosen))
  if self.tick%8==0:self._log('CLOCK',f'Tick {self.tick} · same input cohort for all 5 policies')

 def step(self,count=1):
  if not isinstance(count,int) or not 1<=count<=200:raise ValueError('step count 1..200')
  with self._guard:
   if self.running:raise ValueError('pause before manual stepping')
   t0=time.perf_counter()
   for _ in range(count):self._tick_once()
   self.completed_ticks+=count;self.last_step_ms=round(1000*(time.perf_counter()-t0),2)
   return self.snapshot()

 def _worker(self,stop):
  # Synchronization is synchronous tick completion, NOT a promise of real 100x.
  due=time.monotonic()
  try:
   while not stop.is_set():
    with self._guard:
     if not self.running:break
     desired=self.speed*.5
     batch=max(1,min(6,int(math.ceil(desired*.2))))
     now=time.monotonic();t0=time.perf_counter()
     for _ in range(batch):self._tick_once()
     self.completed_ticks+=batch;self.last_step_ms=round(1000*(time.perf_counter()-t0),2)
     self._samples.append((time.monotonic(),batch))
     while self._samples and time.monotonic()-self._samples[0][0]>5:self._samples.popleft()
     elapsed=max(.2,time.monotonic()-max(time.monotonic()-5,self._worker_started))
     self.actual_ticks_per_second=round(sum(b for _,b in self._samples)/elapsed,2)
    due=max(due+batch/max(desired,.01),time.monotonic())
    if stop.wait(max(.008,due-time.monotonic())):break
  except Exception as exc:
   with self._guard:
    self.running=False;self.error=type(exc).__name__+': '+str(exc)
    self._log('ERROR',self.error)
  finally:
   with self._guard:
    if stop is self._stop:self.running=False

 def start(self):
  with self._guard:
   if not self.running:
    self._stop=Event();self.running=True;self.error=None;self._samples.clear()
    self._worker_started=time.monotonic();self._log('PLAY','All five policy worlds started')
    self._thread=Thread(target=self._worker,args=(self._stop,),daemon=True,name='RELAY-v12-five-way')
    self._thread.start()
   return self.snapshot()

 def pause(self):
  self._stop.set()
  with self._guard:
   self.running=False;self.actual_ticks_per_second=0
   self._log('PAUSE','All five policy worlds paused on same tick')
   return self.snapshot()

 def snapshot(self):
  with self._guard:
   results={};n=len(self.cohort);base=None
   for name,p in self.worlds.items():
    outstanding={jid for jid in self.cohort if jid not in p['completion']}
    total=p['handling_cost']+p['holding_cost']+p['late_cost']
    # Live cost including explicit end-at-current-tick censored backlog.
    # Unlike the v11 final-horizon score, this is a *provisional* live score.
    unresolved=sum(COST_DEFAULT['unresolved_base']*self.cohort[jid]['priority']+
            COST_DEFAULT['unresolved_overdue']*self.cohort[jid]['priority']*
            max(0,self.tick-self.cohort[jid]['deadline_tick']) for jid in outstanding)
    cost=round(total+unresolved,3)
    # Oldest-first queue slice: the ground scene draws each order with its own deadline.
    timing=lambda j:{'admit_tick':j['admit_tick'],'deadline_tick':j['deadline_tick'],'duration':j['duration']}
    display=[{'id':j['id'],'status':'WAIT','cold':j['cold'],'priority':j['priority'],
             'blocked':bool(j.get('blocked_reason')),'destination':j['destination'],**timing(j)} for j in p['waiting'][:120]]
    display += [{'id':a['job']['id'],'status':'MOVING','cold':a['job']['cold'],
             'priority':a['job']['priority'],'destination':a['job']['destination'],**timing(a['job']),
             'progress':round(1-a['remaining']/max(1,a['job']['duration']),3)} for a in p['active']]
    results[name]={'policy':name,'label':LABELS[name],
     'completed':len(p['completion']),'waiting':len(p['waiting']),
     'active':len(p['active']),'on_time':p['on_time'],'late':len(p['completion'])-p['on_time'],
     'on_time_pct':round(100*p['on_time']/n,2) if n else None,
     'completion_pct':round(100*len(p['completion'])/n,2) if n else None,
     'live_censored_cost':cost,'accrued_cost':round(total,3),
     'unresolved_penalty_if_ended_now':round(unresolved,3),
     'unsafe_assignments':p['unsafe_assignments'],
     'last_selected':p['last_selected'],
     'dispatch_status':p['last_meta'].get('status'),
     'mean_selection_ms':round(p['selection_ms_sum']/max(1,p['dispatch_count']),4),
     'objects':display,'rendered_objects':len(display),'total_objects':len(p['waiting'])+len(p['active'])}
   base=results['FCFS']['live_censored_cost']
   handlers,stands,cold=self._effective()
   for key,val in results.items():
    val['saving_vs_fcfs_pct']=round(100*(base-val['live_censored_cost'])/base,2) if base else 0.
   return {'version':'12.0','scope':'FIVE_WAY_SHARED_INPUT_SYNTHETIC_STAGING_ONLY',
    'airline_certified':False,'real_commands_sent':False,'model_i_ii_iii_unchanged':True,
    'tick':self.tick,'seed':self.seed,'running':self.running,'speed_requested':self.speed,
    'actual_ticks_per_second':self.actual_ticks_per_second,'target_ticks_per_second':self.speed*.5,
    'weather':self.weather,'scenario':self.scenario,'config':dict(self.config),'chaos':self.chaos,
    'effective':{'handlers':handlers,'stands':stands,'cold_bays':cold},
    'common_orders_generated':n,'worlds':results,'events':list(self.events)[-70:],
    'event_sequence':self.seq,'error':self.error,
    'cost_definition':'CUMULATIVE_ACCRUED_PLUS_PROVISIONAL_UNRESOLVED_IF_ENDED_NOW',
    'comparison_fairness':'COMMON_RANDOM_NUMBERS_SAME_JOB_ATTRIBUTES_AND_RESOURCE_TRAJECTORY',
    'warning':'Snapshot cost is provisional and sensitive to incomplete backlog. Use v12 pinned cohort benchmark for headline comparisons.'}
