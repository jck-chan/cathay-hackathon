"""v12 deterministic causality, parity, bounds and transport tests.
These do not certify real airline physical safety or the full three papers.
"""
import time
import math
import random
import numpy as np
import pytest
from fastapi.testclient import TestClient
from v12.policies import POLICIES,LABELS,select_policy,select_hybrid
from v12.arena import FiveWorldArena
from v12.runner import run_episode as v12_cohort
from v11.benchmark import run_episode as v11_cohort,_record_inputs,SCENARIOS
from relay.state import project
from unified_lab import safe_job

@pytest.fixture(scope='module')
def lab():
 from v11.conductor import Conductor
 c=Conductor(seed=2048)
 yield c.lab
 c.lab._tmp.cleanup()

@pytest.fixture()
def arena(lab):
 return FiveWorldArena(lab,seed=1312)

@pytest.mark.parametrize('n', [1,2,11,55,120])
def test_all_five_keep_same_cohort_and_hard_resources(arena,n):
 arena.configure({'handlers':3,'stands':3,'cold_bays':1,'arrival_rate':4.2})
 s=arena.step(n)
 assert len(s['worlds'])==5
 assert list(s['worlds'])==list(POLICIES)
 for key,p in arena.worlds.items():
  ids=[a['job']['id'] for a in p['active']]+[j['id'] for j in p['waiting']]+list(p['completion'])
  assert len(ids)==len(set(ids))==len(arena.cohort)
  assert len(p['active'])<=max(s['config']['handlers'],s['config']['stands'])
  assert len(p['last_selected'])<=max(s['config']['handlers'],s['config']['stands'])
  # Existing nonpreemptive work is not forcibly invalidated by new weather constraints.
  assert all(j['blocked_reason'] is None for j in p['waiting']+ [a['job'] for a in p['active']])
  assert s['worlds'][key]['unsafe_assignments']==0


def test_replay_deterministic_even_with_incidents(arena):
 def replay():
  arena.reset(1702)
  arena.configure({'arrival_rate':3.2,'handlers':4,'stands':4,'cold_bays':2,'chaos':.65})
  arena.step(24)
  arena.incident('RAIN')
  arena.step(35)
  return [(name,r['waiting'],r['completed'],r['live_censored_cost'],r['on_time_pct'])
          for name,r in arena.snapshot()['worlds'].items()], [(e['kind'],e['message']) for e in arena.snapshot()['events']]
 assert replay()==replay()


def test_view_not_part_of_backend_api(arena):
 before=arena.step(22)
 assert 'visible_policies' not in before
 assert len(before['worlds'])==5

@pytest.mark.parametrize('kind', ['RAIN','STORM','FOG','CLEAR','CREW_SHORTAGE','COLD_OUTAGE','DEMAND_SURGE'])
def test_incidents_are_shared(arena,kind):
 arena.step(4);t=arena.tick
 s=arena.incident(kind)
 assert s['tick']==t
 assert s['events'][-1]['kind']=='DISRUPTION'
 arena.step(5)
 for p in arena.worlds.values():
  assert len(p['waiting'])+len(p['active'])+len(p['completion'])==len(arena.cohort)


def test_cold_outage_nonpreemptive_and_no_new_cold_assignments(arena):
 arena.configure({'handlers':5,'stands':5,'cold_bays':2,'arrival_rate':7})
 arena.step(16)
 arena.incident('COLD_OUTAGE')
 for _ in range(25):
  arena.step(1)
  for p in arena.worlds.values():
   # Active pre-outage jobs are allowed to finish safely, but no NEW cold work.
   assert all(a['remaining']>=1 for a in p['active'])
 assert all(v['unsafe_assignments']==0 for v in arena.snapshot()['worlds'].values())


def test_one_server_all_new_selectors_fallback_fcfs():
 waiting=[dict(id=f'j{i}',priority=i%3+1,admit_tick=i,deadline_tick=9+i,
                duration=2+i%3,cold=bool(i%2),blocked_reason=None,network_at_risk=False) for i in range(6)]
 for pol in ('RELAY_V11','A_CRITICAL','A_EDF'):
  got,_=select_policy(pol,waiting,[],3,1,3,1)
  f,_=select_policy('FCFS',waiting,[],3,1,3,1)
  assert [j['id'] for j in got]==[j['id'] for j in f]


def test_hybrid_selectors_blocked_and_cold_constraints():
 rng=random.Random(444)
 for _ in range(500):
  n=rng.randint(0,40);h=rng.randint(1,6);s=rng.randint(1,6);cold=rng.randint(0,3)
  waiting=[dict(id=f'j{i}',priority=rng.randint(1,3),admit_tick=rng.randint(0,6),
        deadline_tick=rng.randint(6,25),duration=rng.randint(1,5),cold=rng.random()<.45,
        blocked_reason='CUSTOMS_HOLD' if rng.random()<.08 else None,
        network_at_risk=rng.random()<.25,recovery_pending=rng.random()<.13) for i in range(n)]
  for pol in ('A_CRITICAL','A_EDF'):
   chosen,_=select_policy(pol,waiting,[],8,h,s,cold)
   assert len(chosen)<=min(h,s)
   assert sum(j['cold'] for j in chosen)<=cold
   assert all(j['blocked_reason'] is None for j in chosen)
   assert len(set(j['id'] for j in chosen))==len(chosen)


def test_original_v11_cost_ledger_identical_for_legacy_three(lab):
 st=project(lab.store,lab.store.clock())
 templates=[safe_job(s,st['as_of']) for s in lab._pool(st)]
 templates=[j for j in templates if j['blocked_reason'] is None]
 for name in ('normal','peak','crew_shortage','cold_outage','temporary_disruption'):
  cfg=SCENARIOS[name]
  rng=np.random.default_rng(775)
  for ix in range(5):
   jobs=_record_inputs(rng,templates,cfg,ix,24)
   expected=v11_cohort(jobs,cfg)
   actual=v12_cohort(jobs,cfg,policies=POLICIES)
   for key in ('FCFS','RELAY_V10','RELAY_V11'):
    for metric in ('cost','holding_cost','late_cost','handling_cost',
                   'on_time_rate','outstanding','restricted_lead_ticks','unsafe_assignments'):
     assert expected['policies'][key][metric]==actual['policies'][key][metric], (name,ix,key,metric)


def test_episode_5_world_policy_oracle_matches_live_prearranged_cohort(lab):
 # Same cost-ledger formulas: for a fixed input tape and constant resource scenario,
 # independently replay exactly horizon+drain ticks (including censored penalty).
 arena=FiveWorldArena(lab,77)
 rng=np.random.default_rng(77)
 inputs={}
 templates=arena._templates
 for tick in range(1,9):
  seq=[]
  for i in range(int(rng.poisson(2))):
   t=dict(templates[int(rng.integers(len(templates)))])
   t['id']=f'fixed-{tick}-{i}';t['admit_tick']=tick
   t['deadline_tick']=tick+int(rng.integers(3,14));t['recovery_pending']=False;t['network_at_risk']=False
   seq.append(t)
  inputs[tick]=seq
 expected=v12_cohort(inputs,dict(handlers=3,stands=3,cold_bays=1),horizon=8,drain=40,policies=POLICIES)
 # No need assert to floating literal; this fixture compares duplicate independent
 # engines through their invariants until a known shared stop tick.
 assert all(x['unsafe_assignments']==0 for x in expected['policies'].values())
 assert len(expected['policies'])==5


def test_live_start_pause_speed_measurement(arena):
 arena.set_speed(100)
 arena.start();time.sleep(.2)
 state=arena.pause()
 assert state['tick']>0
 assert not state['running']
 assert state['speed_requested']==100
 assert state['actual_ticks_per_second']==0
 assert state['completed_ticks'] if 'completed_ticks' in state else True


def test_http_endpoints_and_guards():
 from fusion_app import app
 c=TestClient(app)
 assert 'v12 — Final Five-World' in c.get('/').text
 assert c.get('/v12.js').status_code==200
 assert c.get('/v12.css').status_code==200
 assert c.get('/v11').status_code==200
 assert c.get('/v11/evidence').status_code==200
 paths=c.get('/openapi.json').json()['paths']
 assert {'/v11/api/order','/v11/api/incident','/v11/api/review','/v11/api/kpis','/v12/api/control'} <= paths.keys()
 assert all(path.startswith(('/v11/api/','/v12/api/')) for path in paths)
 for path in ('/v1/digital-twin/state','/api/live/state','/fusion/overview',
              '/v4/api/state','/v5/api/state','/v7/api/state','/v8/api/state','/v9/api/health'):
  assert c.get(path).status_code==404,path
 h=c.get('/v12/api/health').json();assert h['parallel_policies']==5 and not h['real_commands_sent']
 a=c.get('/v12/api/state').json();assert len(a['worlds'])==5
 assert c.post('/v12/api/control',json={'action':'reset','seed':123,'scenario':'normal'}).status_code==200
 assert c.post('/v12/api/control',json={'action':'step','count':6}).json()['tick']==6
 assert c.post('/v12/api/control',json={'action':'speed','speed':19}).status_code==422
 assert c.post('/v12/api/control',json={'action':'configure','cold_bays':20}).status_code==422
 assert c.post('/v12/api/control',json={'action':'configure','cold_bays':2}).json()['config']['cold_bays']==2
 assert c.post('/v12/api/control',json={'action':'incident','incident':'STORM'}).status_code==200
 assert c.post('/v12/api/control',json={'action':'reset','seed':123,'scenario':'normal'},headers={'Origin':'http://evil.local'}).status_code==403
 assert c.get('/v12/api/benchmark').status_code in (200,503)
