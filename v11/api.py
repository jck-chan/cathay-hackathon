"""HTTP API for the three-twin simulation and its evidence."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from geometry3d import preflight
from relay.state import project
from relay.store import Conflict, Missing
from unified_lab import IncidentKind
from v5_lab import audit_lab
from v7_product import V7Lab, experiment_grid
from .audit import data_audit, live_consistency
from .benchmark import paired_suite
from .conductor import Conductor
from .sandboxes import DispatchPolicy, Sandbox, SandboxManager

ROOT = Path(__file__).resolve().parents[1]
router = APIRouter(prefix='/v11/api')
DEFAULT_SANDBOX_ID = 'relay'
# The default RELAY sandbox retains the paired metrics used by the older
# dashboards and the Control Tower's same-input comparison.
sandboxes = SandboxManager(
    Sandbox('fcfs', 'FCFS Baseline', Conductor(seed=2048, dispatch_policies=('fcfs',))),
    Sandbox(DEFAULT_SANDBOX_ID, 'RELAY', Conductor(seed=2048)),
)
V11_DISPATCH_ENABLED = sandboxes.get(DEFAULT_SANDBOX_ID).conductor.lab.v11_dispatch_enabled


def get_sandbox(sandbox_id: str) -> Sandbox:
    try:
        return sandboxes.get(sandbox_id)
    except KeyError as e:
        raise HTTPException(404, f'Unknown sandbox: {sandbox_id}') from e


def resolve_sandbox(sandbox_id: str | None) -> Sandbox:
    if sandbox_id is not None:
        return get_sandbox(sandbox_id)
    available = sandboxes.list()
    if not available:
        raise HTTPException(404, 'No sandboxes available')
    return next((s for s in available if s.id == DEFAULT_SANDBOX_ID), available[0])


def sandbox_conductor(sandbox_id: str | None) -> Conductor:
    return resolve_sandbox(sandbox_id).conductor


class SandboxInfo(BaseModel):
    id: str
    name: str
    policy: DispatchPolicy


class SandboxCreate(BaseModel):
    name: str
    policy: DispatchPolicy = 'relay'
    seed: int = Field(2048, ge=0, le=2147483647)


@router.get('/sandboxes', tags=['Three-twin simulation'])
def v11_list_sandboxes() -> list[SandboxInfo]:
    return [SandboxInfo(id=s.id, name=s.name, policy=s.policy) for s in sandboxes.list()]


@router.post('/sandboxes', tags=['Three-twin simulation'], status_code=201)
def v11_create_sandbox(p: SandboxCreate) -> SandboxInfo:
    try:
        s = sandboxes.create(p.name, policy=p.policy, seed=p.seed)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return SandboxInfo(id=s.id, name=s.name, policy=s.policy)


@router.delete('/sandboxes/{sandbox_id}', tags=['Three-twin simulation'], status_code=204)
def v11_delete_sandbox(sandbox_id: str) -> None:
    try:
        sandboxes.delete(sandbox_id)
    except KeyError as e:
        raise HTTPException(404, f'Unknown sandbox: {sandbox_id}') from e


@router.get('/state',tags=['Three-twin simulation'])
def v11_state(awb: str | None = Query(None, max_length=80), sandbox_id: str | None = None):
    sandbox = resolve_sandbox(sandbox_id)
    target = sandbox.conductor
    return {
        **target.snapshot(awb),
        'sandbox_id': sandbox.id,
        'ground_policy': target.lab.ground_policy,
    }


@router.get('/sandboxes/{sandbox_id}/ground', tags=['Three-twin simulation'])
def v11_ground_state(sandbox_id: str):
    sandbox = get_sandbox(sandbox_id)
    target = sandbox.conductor
    with target.guard:
        state = target.lab.snapshot()
        return {
            'tick': state['tick'],
            'clock': state['clock'],
            'resources': state['resources'],
            'latest_event': state['latest_event'],
            'unified_events': list(target.events)[-35:],
            'ground': state['policies'][sandbox.policy],
            'v8': target.playback_state(),
        }

class EnvironmentSettings(BaseModel):
    rate:float|None=Field(None,ge=.25,le=5)
    chaos:float|None=Field(None,ge=0,le=1)
    handlers:int|None=Field(None,ge=1,le=6)
    cold_bays:int|None=Field(None,ge=0,le=3)
    stands:int|None=Field(None,ge=1,le=6)
    weather:Literal['AUTO','CLEAR','RAIN','FOG','STORM']|None=None

class SimulationControl(EnvironmentSettings):
    action:Literal['start','pause','step','reset','speed','mode','tune','recalculate']
    speed:int|None=None
    mode:str|None=None
    count:int=Field(1,ge=1,le=100)
    seed:int|None=Field(None,ge=0,le=2147483647)

@router.post('/control',tags=['Three-twin simulation'])
def v11_control(p:SimulationControl,sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    try:
        if p.action=='start':return conductor.start()
        if p.action=='pause':return conductor.pause()
        if p.action=='step':return conductor.step(p.count)
        if p.action=='reset':return conductor.reset(p.seed)
        if p.action=='speed':
            if p.speed is None:raise ValueError('speed is required')
            return conductor.set_speed(p.speed)
        if p.action=='mode':
            if p.mode is None:raise ValueError('mode is required')
            return conductor.set_mode(p.mode)
        if p.action=='tune':return conductor.configure({k:v for k,v in p.model_dump().items()
                                 if k in ('rate','chaos','handlers','cold_bays','stands','weather') and v is not None})
        if p.action=='recalculate':
            with conductor.guard:
                conductor.lab._evaluate();conductor._observe('RECALCULATE');return conductor.snapshot()
    except Conflict as e:raise HTTPException(409,str(e)) from e
    except ValueError as e:raise HTTPException(422,str(e)) from e

class IncidentRequest(BaseModel):
    kind:IncidentKind

@router.post('/incident',tags=['Three-twin simulation'])
def v11_incident(p:IncidentRequest,sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    try:return conductor.incident(p.kind)
    except ValueError as e:raise HTTPException(422,str(e)) from e

class OrderRequest(BaseModel):
    destination:Literal['SIN','LHR','NRT','LAX','FRA','BKK','SYD','DXB']='NRT'
    weight_kg:int=Field(125,ge=10,le=450)
    handling:Literal['GENERAL','COL']='GENERAL'
    service:Literal['STANDARD','PRIORITY','CRITICAL']='PRIORITY'
    length_cm:int=Field(70,ge=15,le=180)
    width_cm:int=Field(55,ge=15,le=180)
    height_cm:int=Field(45,ge=15,le=180)

@router.post('/order',tags=['Three-twin simulation'])
def v11_order(p:OrderRequest,sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    try:return conductor.order(**p.model_dump())
    except ValueError as e:raise HTTPException(422,str(e)) from e

class ReviewRequest(BaseModel):
    decision_id:str
    expected_snapshot_version:int=Field(ge=0)
    choice:Literal['approve','reject']

@router.post('/review',tags=['Three-twin simulation'])
def v11_review(p:ReviewRequest,sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    try:return conductor.review(p.choice,p.decision_id,p.expected_snapshot_version)
    except Conflict as e:raise HTTPException(409,str(e)) from e

@router.post('/tasks/{task_id}/done',tags=['Three-twin simulation'])
def v11_task_done(task_id:str,sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    try:return conductor.task_ack(task_id)
    except (Conflict,Missing) as e:raise HTTPException(409,str(e)) from e

@router.get('/audit',tags=['Evidence Lab'])
def v11_audit(sandbox_id: str | None = None):
    target = sandbox_conductor(sandbox_id)
    with target.guard:
        return audit_lab(target.lab)

@router.get('/evidence',tags=['Evidence Lab'])
def v11_evidence(sandbox_id: str | None = None):
    target = sandbox_conductor(sandbox_id)
    with target.guard:
        return target.lab.evidence()

@router.get('/uld3d',tags=['Evidence Lab'])
def v11_uld3d(height_cm:int=Query(145,ge=50,le=300),sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    with conductor.guard:
        state=project(conductor.lab.store,conductor.lab.store.clock())
        sid={j['id'] for j in conductor.lab.snapshot()['shipment_objects']
             if not j['blocked_reason'] and j['handling']!='DGR'}
        ps=[p for p in state['pieces'].values() if p['shipment_id'] in sid]
        us=[u for u in state['ulds'].values() if u['availability']=='AVAILABLE']
        return preflight(ps,us[0],height_cm,max_pieces=6) if ps and us else {'status':'NO_ELIGIBLE_PIECES','placements':[]}

@router.get('/experiment',tags=['Evidence Lab'])
def v11_experiment(episodes:int=Query(250,ge=100,le=2000),seed:int=707,sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    with conductor.guard:return experiment_grid(conductor.lab,episodes,seed)

@router.get('/health',tags=['Evidence Lab'])
def v11_health():
    return {'ok':True,'version':'11.0','one_clock':True,'auto_shadow_default':True,
            'actual_airline_commands':False,'production_certified':False,'data':'SYNTHETIC',
            'ground_dispatch':
            'V11_OBSERVABLE_TRIAGE' if V11_DISPATCH_ENABLED else 'V10_OBSERVABLE_URGENCY',
            'model_i':'BOUNDED_2D_DIAGNOSTIC',
            'model_ii':'ONE_STEP_BAYES_LOCAL_PROXY',
            'model_iii':'FINITE_COLUMN_SCENARIO_MILP',
            'real_data':False,'carrier_confirmed_routes':False,
            'production_safety_certified':False,'real_commands_sent':False,
            'cross_site_localhost_write_guard':True,
            'authentication_available':False}


@lru_cache(maxsize=1)
def _v11_pinned_results():
    return json.loads((ROOT/'reports'/'V11_OUT_OF_SAMPLE_SEED_2026_500x6.json').read_text(encoding='utf-8'))


@router.get('/kpis',tags=['Evidence Lab'])
def v11_kpis():
    return _v11_pinned_results()


@router.get('/v10-original-kpis',tags=['Evidence Lab'])
def v11_old_kpis():
    return json.loads((ROOT/'reports'/'V10_ORIGINAL_PERCENT_DENOMINATORS.json').read_text(encoding='utf-8'))


@router.get('/data-audit',tags=['Evidence Lab'])
def v11_data_audit():
    return data_audit()


@router.get('/trace',tags=['Evidence Lab'])
def v11_trace(sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    with conductor.guard:return live_consistency(conductor)


@router.get('/recompute',tags=['Evidence Lab'])
def v11_recompute(episodes:int=Query(100,ge=40,le=500),seed:int=2026):
    """Run from a new isolated lab; never pause or corrupt current twin clock."""
    lab=V7Lab(seed=2048)
    try:return paired_suite(lab,episodes=episodes,seed=seed)
    finally:lab._tmp.cleanup()


@router.get('/scope',tags=['Evidence Lab'])
def v11_scope(sandbox_id: str | None = None):
    conductor = sandbox_conductor(sandbox_id)
    with conductor.guard:
        s=conductor.snapshot()
        return {'three_model_status':s.get('decision'),
                'decision_scope':conductor.lab.last_scope,
                'truth_contract':s.get('truth_contract'),
                'current_tick':s['tick'],
                'notes':['Not all unadmitted shipments are optimized in each decision.',
                         'Model I is not an airworthiness certificate.',
                         'Model II uses local route-cost proxy and is not full belief-MDP.',
                         'Model III is finite-column MILP, not runtime Graver/cluster mutation.',
                         'No external capacity or booking confirmation is connected.']}


@router.get('/advanced-data',tags=['Evidence Lab'])
def v11_advanced_metrics():
    return json.loads((ROOT/'reports'/'V11_ADVANCED_PPT_DATA.json').read_text(encoding='utf-8'))
