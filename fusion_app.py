"""HTTP entry point for the RELAY three-twin simulation and five-policy arena."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from v11.api import conductor, router as v11_router
from v11.mcp_server import MCP_PATH, MCPTransport, create_mcp_server
from v12.arena import FiveWorldArena
from v12.policies import LABELS as V12_LABELS

ROOT = Path(__file__).resolve().parent
@asynccontextmanager
async def lifespan(app: FastAPI):
    mcp = create_mcp_server()
    transport = mcp.streamable_http_app()
    async with mcp.session_manager.run():
        yield {'relay_mcp_transport': transport}


app = FastAPI(title='RELAY Fusion', version='12.0', lifespan=lifespan)
app.include_router(v11_router)
V12 = FiveWorldArena(conductor.lab, seed=9099)

app.mount('/aircraft', StaticFiles(directory=ROOT / 'static' / 'aircraft'), name='aircraft')

# Frontend assets shared by the three-twin views.
@app.get('/v8', include_in_schema=False)
def v8_home():return FileResponse(ROOT/'static'/'v8.html', media_type='text/html',headers={'Cache-Control':'no-store'})

@app.get('/v8.css',include_in_schema=False)
def v8_css():return FileResponse(ROOT/'static'/'v8.css',media_type='text/css')

@app.get('/v8.js',include_in_schema=False)
def v8_js():return FileResponse(ROOT/'static'/'v8.js',media_type='text/javascript')

@app.get('/v8_scene.js',include_in_schema=False)
def v8_scene():return FileResponse(ROOT/'static'/'v6_scene.js',media_type='text/javascript')

# Presentation assets shared by the three-twin UI.
@app.get('/v9',include_in_schema=False)
def v9_home():return FileResponse(ROOT/'static'/'v10.html',media_type='text/html',headers={'Cache-Control':'no-store'})
@app.get('/v9.css',include_in_schema=False)
def v9_css():return FileResponse(ROOT/'static'/'v9.css',media_type='text/css',headers={'Cache-Control':'no-store'})
@app.get('/v9.js',include_in_schema=False)
def v9_js():return FileResponse(ROOT/'static'/'v9.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})
@app.get('/v9_scene.js',include_in_schema=False)
def v9_scene():return FileResponse(ROOT/'static'/'v9_scene.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})
@app.get('/v10',include_in_schema=False)
def v10_home():
    return FileResponse(ROOT/'static'/'v10.html',media_type='text/html',headers={'Cache-Control':'no-store'})

@app.get('/v10.css',include_in_schema=False)
def v10_css():
    return FileResponse(ROOT/'static'/'v10.css',media_type='text/css',headers={'Cache-Control':'no-store'})

@app.get('/v10_scene.js',include_in_schema=False)
def v10_scene():
    return FileResponse(ROOT/'static'/'v10_scene.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

@app.get('/v10_ui.js',include_in_schema=False)
def v10_ui():
    return FileResponse(ROOT/'static'/'v10_ui.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

# -------------------------------------------------------------------------
# v11: independent measurement surfaces + read-only production-gap evidence.
# V10 3D/three-paper model code remains available; stage policy uses v11
# observable-time multiobjective triage. Synthetic shadow mode only.
# -------------------------------------------------------------------------
@app.middleware('http')
async def v11_local_request_guard(request: Request, call_next):
    """Block browser cross-site writes to a localhost simulation.

    This is *not* authentication or tenant isolation. Never deploy this as a
    network-exposed airline/customer service without real auth, RBAC and TLS.
    """
    if request.method in ('POST','PUT','PATCH','DELETE'):
        origin=request.headers.get('origin','')
        fetch_site=request.headers.get('sec-fetch-site','')
        # Treat the exact current localhost origin as the only browser write
        # origin. Different local ports must not obtain write privileges.
        local_host=request.headers.get('host','').lower()
        own='http://'+local_host
        if fetch_site=='cross-site' or (origin and origin!=own) or (
            request.url.hostname not in ('127.0.0.1','localhost','testserver')):
            return JSONResponse({'detail':'Cross-site mutation request blocked in local synthetic sandbox'},status_code=403)
    response=await call_next(request)
    if request.url.path.startswith(('/v11/api/','/v12/api/')):
        response.headers['Cache-Control']='no-store'
    return response


@app.get('/v11',include_in_schema=False)
def v11_home():
    return FileResponse(ROOT/'static'/'v11.html',media_type='text/html',headers={'Cache-Control':'no-store'})


@app.get('/v11/evidence',include_in_schema=False)
def v11_evidence_page():
    return FileResponse(ROOT/'static'/'v11_evidence.html',media_type='text/html',headers={'Cache-Control':'no-store'})


# Export reproducible plots without giving arbitrary filesystem paths to clients.
_V11_PUBLIC_FIGURES = frozenset({
    'V11_COST_REDUCTION_PERCENT.png', 'V11_SLA_GAIN_PP.png',
    'V11_TAIL_RISK_REDUCTION_PERCENT.png', 'V11_LEAD_TIME_PERCENT.png',
    'V11_V10_HEAD_TO_HEAD.png', 'V11_ARRIVAL_FREQUENCY.png',
    'V11_STATISTICAL_CONVERGENCE.png', 'V11_SAVINGS_DISTRIBUTION.png',
    'V11_TAIL_RISK_CVAR90.png', 'V11_ROI_SENSITIVITY_HYPOTHETICAL.png',
    'V11_SCENARIO_PROB_COST.png',
    'V11_PROBABILITY_OF_REGRESSION.png', 'V11_COST_COMPONENTS.png',
    'V11_BACKLOG_RECOVERY_COUNTEREXAMPLE.png', 'V11_FINITE_MILP_RUNTIME.png',
})

@app.get('/v11/chart/{filename}',include_in_schema=False)
def v11_export_chart(filename:str):
    if filename not in _V11_PUBLIC_FIGURES:raise HTTPException(404,'Chart not available')
    return FileResponse(ROOT/'reports'/filename,media_type='image/png',headers={'Cache-Control':'public, max-age=3600'})

# -------------------------------------------------------------------------
# v12 FIVE-WAY POLICY COMPARISON -- v11 research engine is unchanged.
# Parallel worlds share a NEW staging-only synthetic workload and clock.
# It is intentionally isolated from the separate /v11 airline-network lab;
# no invented causal claim connects the two independent experiments.
# -------------------------------------------------------------------------
@app.get('/',include_in_schema=False)
@app.get('/v12',include_in_schema=False)
def v12_home():
    return FileResponse(ROOT/'static'/'v12.html',media_type='text/html',headers={'Cache-Control':'no-store'})

@app.get('/v12.css',include_in_schema=False)
def v12_css():
    return FileResponse(ROOT/'static'/'v12.css',media_type='text/css',headers={'Cache-Control':'no-store'})

@app.get('/v12.js',include_in_schema=False)
def v12_js():
    return FileResponse(ROOT/'static'/'v12.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

@app.get('/v12/api/state',tags=['v12 five-way arena'])
def v12_state():return V12.snapshot()

@app.get('/v12/api/health',tags=['v12 five-way arena'])
def v12_health():
    return {'ok':True,'version':'12.0','policies':V12_LABELS,
       'parallel_policies':5,'min_visible':2,'max_visible':5,
       'scope':'SYNTHETIC_STAGING_ONLY','real_commands_sent':False,
       'model_i_ii_iii_unchanged':True,'shared_arrivals_resources_weather':True,
       'production_certified':False}

class V12Action(BaseModel):
    action:Literal['start','pause','step','reset','speed','configure','incident']
    count:int=Field(1,ge=1,le=200)
    seed:int=Field(9099,ge=0,le=2147483647)
    scenario:Literal['normal','peak','crew_shortage','cold_outage','high_capacity','temporary_disruption']='normal'
    speed:int|None=None
    arrival_rate:float|None=Field(None,ge=.1,le=8)
    handlers:int|None=Field(None,ge=1,le=12)
    stands:int|None=Field(None,ge=1,le=12)
    cold_bays:int|None=Field(None,ge=0,le=6)
    chaos:float|None=Field(None,ge=0,le=1)
    incident:Literal['RAIN','STORM','FOG','CLEAR','CREW_SHORTAGE','COLD_OUTAGE','DEMAND_SURGE']|None=None

@app.post('/v12/api/control',tags=['v12 five-way arena'])
def v12_control(p:V12Action):
    try:
        if p.action=='start':return V12.start()
        if p.action=='pause':return V12.pause()
        if p.action=='step':return V12.step(p.count)
        if p.action=='reset':return V12.reset(p.seed,p.scenario)
        if p.action=='speed':
            if p.speed is None:raise ValueError('speed required')
            return V12.set_speed(p.speed)
        if p.action=='configure':
            opts={k:v for k,v in p.model_dump().items() if k in
             ('arrival_rate','handlers','stands','cold_bays','chaos') and v is not None}
            return V12.configure(opts)
        if p.action=='incident':
            if not p.incident:raise ValueError('incident required')
            return V12.incident(p.incident)
        raise ValueError('unknown action')
    except ValueError as exc:raise HTTPException(status_code=422,detail=str(exc)) from exc

@app.get('/v12/api/benchmark',tags=['v12 five-way arena'])
def v12_benchmark_data():
    p=ROOT/'reports'/'V12_FIVE_POLICY_HOLDOUT.json'
    if not p.exists():raise HTTPException(503,'Benchmark not generated; run python -m v12.benchmark')
    return json.loads(p.read_text(encoding='utf-8'))


app.add_route(MCP_PATH, MCPTransport(), methods=['GET', 'POST', 'DELETE'], include_in_schema=False)
