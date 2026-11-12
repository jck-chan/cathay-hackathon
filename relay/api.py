"""FastAPI sandbox backend. Local-only, all operational actions SIMULATION-ONLY."""
from __future__ import annotations
import asyncio, json, os, uuid
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Literal
from fastapi import FastAPI,HTTPException,Query,Header,Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel,Field
from .schemas import EventIn,EvaluationRequest,ReviewIn,TaskAckIn,AutonomyPolicy,ts,parse_time
from .store import Store,Conflict,Missing
from .synthetic import generate,END
from .state import project
from .engine import evaluate,customer_track
from .simulator import tick,paired_benchmark
from .models import cluster_exchange_fixture

ROOT=Path(__file__).resolve().parent.parent
DB_PATH=os.environ.get('RELAY_DB_PATH',str(ROOT/'data'/'relay_demo.sqlite'))
DATA_DIR=Path(os.environ.get('RELAY_DATA_DIR',str(ROOT/'data')))
store=Store(DB_PATH)

@asynccontextmanager
async def lifespan(app):
    if not (DATA_DIR/'manifest.json').exists():generate(DATA_DIR)
    store.load_demo(DATA_DIR)
    yield

app=FastAPI(title='RELAY — Cargo Recovery Mathematical Decision Engine',version='2.0.0',
 description='Research-grade executable synthetic-data simulator. NOT certified for any physical cargo or flight action.',
 lifespan=lifespan)

@app.exception_handler(Conflict)
async def handle_conflict(req,exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=409,content={'error':'CONFLICT','detail':str(exc)})
@app.exception_handler(Missing)
async def handle_missing(req,exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=404,content={'error':'NOT_FOUND','detail':str(exc)})

def safe_call(fn,*args,**kw):
    try:return fn(*args,**kw)
    except (ValueError,AssertionError) as e:raise HTTPException(422,detail=str(e)) from e

@app.get('/health')
def health():
    return {'ok':True,'engine':'RELAY','version':'2.0.0','mode':'SYNTHETIC_SANDBOX_ONLY',
      'sim_clock':store.clock(),'snapshot_version':store.version(),
      'real_operational_connections':False}

@app.get('/v1/data/manifest')
def manifest():return json.loads((DATA_DIR/'manifest.json').read_text())

@app.get('/v1/data/calibration')
def get_calibration(as_of:str|None=None):
    return safe_call(project,store,as_of or store.clock())['calibration']

@app.get('/v1/catalog/{kind}')
def catalog(kind:Literal['flight','shipment','piece','uld'],limit:int=Query(100,ge=1,le=500),offset:int=Query(0,ge=0)):
    rows=store.catalog(kind);return {'total':len(rows),'items':rows[offset:offset+limit]}

@app.get('/v1/events')
def get_events(after:str|None=None,until:str|None=None,entity_id:str|None=None,limit:int=Query(100,ge=1,le=1000)):
    if after:parse_time(after)
    if until:parse_time(until)
    arr=store.events(until=until,entity_id=entity_id)
    if after:arr=[e for e in arr if e['received_at']>after]
    return {'total':len(arr),'items':arr[-limit:]}

@app.post('/v1/events',status_code=201)
def ingest_event(ev:EventIn,x_relay_sandbox_role:str|None=Header(default=None)):
    # This role header is ONLY a local-demo guard, not cryptographic authentication.
    # Do not allow anonymous HTTP clients to self-assert trusted synthetic observations.
    if ev.trusted and x_relay_sandbox_role!='simulator':
        raise HTTPException(403,detail='trusted synthetic events require simulator sandbox role; not production authentication')
    return store.append_event(ev)

class BatchEvents(BaseModel):
    events: list[EventIn] = Field(min_length=1,max_length=100)
@app.post('/v1/events/batch')
def ingest_batch(payload:BatchEvents,x_relay_sandbox_role:str|None=Header(default=None)):
    if any(e.trusted for e in payload.events) and x_relay_sandbox_role!='simulator':
        raise HTTPException(403,detail='trusted synthetic events require simulator sandbox role')
    # Per-item idempotent commits. Returns partial success; caller must replay failed IDs.
    results=[]
    for ev in payload.events:
        try:results.append(store.append_event(ev))
        except Conflict as e:results.append({'event_id':ev.event_id,'error':str(e)})
    return {'items':results,'atomic':False}

@app.get('/v1/digital-twin/state')
def twin_state(as_of:str|None=None):
    state=safe_call(project,store,as_of or store.clock())
    decision_list=store.decisions(limit=1)
    sample=decision_list[0] if decision_list else None
    # Digital twin spatial coordinates are deliberately illustrative, not Cathay City geographic coordinates.
    nodes=[{'id':'HKG-TERMINAL','kind':'CARGO_TERMINAL','position_m':[0,0,0],
            'source':'SYNTHETIC_SCENE_LAYOUT'},
           {'id':'HKG-RAMP','kind':'APRON','position_m':[350,0,0],'source':'SYNTHETIC_SCENE_LAYOUT'},
           {'id':'HKG-OPS','kind':'OPERATIONS_CONTROL','position_m':[-180,0,80],'source':'SYNTHETIC_SCENE_LAYOUT'}]
    return {'as_of':state['as_of'],'snapshot_version':state['snapshot_version'],
      'flights':list(state['flights'].values()),'shipments':list(state['shipments'].values()),
      'ulds':list(state['ulds'].values()),'terminal_capacity_fraction':state['terminal_capacity_fraction'],
      'scene_nodes':nodes,'latest_decision_id':sample['id'] if sample else None,
      'latest_decision_stale':bool(sample and sample['snapshot_version']!=state['snapshot_version']),
      'latest_decision_status':sample['status'] if sample else None,
      'latest_2d_uld_placements':sample['model_i'].get('risk_aware',{}).get('placements',[])
          if sample and sample['snapshot_version']==state['snapshot_version'] else [],
      'ground_tasks':store.tasks(), 'scene_certification':'SCHEMATIC_SIMULATED_NOT_REAL_GEOGRAPHY'}

@app.post('/v1/decisions/evaluate')
def evaluate_endpoint(req:EvaluationRequest):return safe_call(evaluate,store,req)

@app.get('/v1/decisions/{decision_id}')
def get_decision(decision_id:str):return store.get_decision(decision_id)

@app.get('/v1/internal/review-queue')
def queue(limit:int=Query(30,ge=1,le=100)):
    ds=store.decisions(status='PENDING_REVIEW',limit=limit)
    return {'total':len(ds),'items':[{'id':d['id'],'created_at':d['created_at'],
       'snapshot_version':d['snapshot_version'],'action':d['action'],
       'warnings':d['reason_codes'],'proposed_actions':d['proposed_actions']} for d in ds]}

@app.post('/v1/decisions/{decision_id}/review')
def review(decision_id:str,req:ReviewIn,x_relay_sandbox_role:str|None=Header(default=None)):
    if x_relay_sandbox_role!='supervisor':
        raise HTTPException(403,detail='sandbox supervisor header required (not production authentication)')
    return store.review(decision_id,req,store.clock())

@app.get('/v1/operations/tasks')
def tasks(decision_id:str|None=None):return {'items':store.tasks(decision_id)}

@app.post('/v1/operations/tasks/{task_id}/ack')
def ack_task(task_id:str,req:TaskAckIn,x_relay_sandbox_role:str|None=Header(default=None)):
    if x_relay_sandbox_role not in ('supervisor','ground'):
        raise HTTPException(403,detail='sandbox staff role required')
    return store.ack_task(task_id,req,store.clock())

@app.get('/v1/customer/track/{awb}')
def customer(awb:str,as_of:str|None=None):
    try:return safe_call(customer_track,store,awb,as_of)
    except KeyError:raise HTTPException(404,detail='synthetic AWB not found')

@app.get('/v1/logs')
def logs(category:Literal['INPUT','PROCESS','DECISION','OUTPUT']|None=None,limit:int=Query(80,ge=1,le=500)):
    return {'items':store.logs(category,limit)}

@app.get('/v1/stream')
async def stream(after:int=0):
    async def live():
        cursor=after
        while True:
            rows=store.logs_since(cursor,limit=200)
            for row in rows:
                if row['sequence']>cursor:
                    cursor=row['sequence']
                    yield f'id: {cursor}\nevent: {row["category"].lower()}\ndata: {json.dumps(row)}\n\n'
            if not rows:
                await asyncio.sleep(.7)
    return StreamingResponse(live(),media_type='text/event-stream',headers={'Cache-Control':'no-cache'})

@app.get('/v1/autonomy-policy')
def policy_get():return {'policy':store.policy(),'real_operational_auto_execution':False}

@app.put('/v1/autonomy-policy')
def policy_update(req:AutonomyPolicy,x_relay_sandbox_role:str|None=Header(default=None)):
    if x_relay_sandbox_role!='supervisor':raise HTTPException(403,detail='sandbox supervisor header required')
    store.set_policy(req.model_dump())
    return {'policy':store.policy(),'physical_route_actions_still_require_human':True,
       'real_operational_auto_execution':False}

class TickRequest(BaseModel):
    advance_seconds:int=Field(default=40,ge=1,le=7200)
    seed:int=27
    auto_evaluate:bool=True
@app.post('/v1/simulator/tick')
def simulator_tick(req:TickRequest):
    out=tick(store,req.advance_seconds,req.seed)
    if req.auto_evaluate:
        try:
            d=evaluate(store,EvaluationRequest())
            out['decision_id']=d['id'];out['action']=d['action'];out['model_iii_status']=d['model_iii']['status']
        except ValueError as e:out['decision_note']=str(e)
    return out

class BenchmarkRequest(BaseModel):
    decision_id:str
    runs:int=Field(default=10000,ge=100,le=50000)
    seed:int=2026
@app.post('/v1/benchmark/paired')
def benchmark(req:BenchmarkRequest):
    return safe_call(paired_benchmark,store.get_decision(req.decision_id),req.runs,req.seed)

@app.get('/v1/research/cluster-fixture')
def cluster():return cluster_exchange_fixture()

class OAGMock(BaseModel):
    event_id:str
    flight_id:str
    state:Literal['Scheduled','OutGate','InAir','Landed','InGate','Canceled','Diverted']
    received_at:str
    event_time:str
    source_revision:int=1
@app.post('/v1/adapters/oag/example')
def oag_mock(body:OAGMock):
    """Example adapter only. OAG status is NOT Cathay booking/remaining capacity authority."""
    k='flight_cancelled' if body.state=='Canceled' else 'flight_restored'
    e=EventIn(event_id=body.event_id,event_type=k,entity_type='flight',entity_id=body.flight_id,
      event_time=body.event_time,received_at=body.received_at,source='OAG_EXTERNAL_UNVERIFIED',
      source_revision=body.source_revision,trusted=False,payload={'observed_flight_state':body.state})
    out=store.append_event(e)
    out['adapter_note']='External flight status recorded as unverified; no change to operator-authoritative inventory.'
    return out

@app.get('/v1/research/scarcity-case')
def scarcity_case():
    from .fixtures import scarcity
    return scarcity()
