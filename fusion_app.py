"""HTTP entry point for the RELAY three-twin simulation."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from v11.api import router as v11_router
from v11.chat import chat_runtime, router as v11_chat_router
from v11.mcp_server import LEGACY_MCP_PATH, MCP_PATH, MCPTransport, create_mcp_server

ROOT = Path(__file__).resolve().parent


def relay_public_domains() -> set[str]:
    return {
        'cathay.ckchan.com',
        os.getenv('RELAY_PUBLIC_DOMAIN', '').strip().lower(),
        os.getenv('RAILWAY_PUBLIC_DOMAIN', '').strip().lower(),
    } - {''}


@asynccontextmanager
async def lifespan(app: FastAPI):
    mcp = create_mcp_server(relay_public_domains())
    transport = mcp.streamable_http_app()
    async with mcp.session_manager.run(), chat_runtime(mcp) as chat:
        yield {'relay_mcp_transport': transport, 'relay_chat': chat}


app = FastAPI(title='RELAY Fusion', version='11.0', lifespan=lifespan)
app.include_router(v11_router)
app.include_router(v11_chat_router)

app.mount('/aircraft', StaticFiles(directory=ROOT / 'static' / 'aircraft'), name='aircraft')
app.mount('/scene', StaticFiles(directory=ROOT / 'static' / 'scene'), name='scene')

@app.get('/request_button.js', include_in_schema=False)
def request_button_js():
    return FileResponse(ROOT / 'static' / 'request_button.js', media_type='text/javascript')


@app.get('/request_button.css', include_in_schema=False)
def request_button_css():
    return FileResponse(ROOT / 'static' / 'request_button.css', media_type='text/css')


# Frontend assets loaded by the v11 twins.
@app.get('/v8.css',include_in_schema=False)
def v8_css():return FileResponse(ROOT/'static'/'v8.css',media_type='text/css')

@app.get('/v8_scene.js',include_in_schema=False)
def v8_scene():return FileResponse(ROOT/'static'/'v6_scene.js',media_type='text/javascript',headers={'Cache-Control':'no-cache'})

@app.get('/v9.css',include_in_schema=False)
def v9_css():return FileResponse(ROOT/'static'/'v9.css',media_type='text/css',headers={'Cache-Control':'no-store'})
@app.get('/v9.js',include_in_schema=False)
def v9_js():return FileResponse(ROOT/'static'/'v9.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

@app.get('/v10.css',include_in_schema=False)
def v10_css():
    return FileResponse(ROOT/'static'/'v10.css',media_type='text/css',headers={'Cache-Control':'no-store'})

@app.get('/v10_scene.js',include_in_schema=False)
def v10_scene():
    return FileResponse(ROOT/'static'/'v10_scene.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

@app.get('/v11_chat.css',include_in_schema=False)
def v11_chat_css():
    return FileResponse(ROOT/'static'/'v11_chat.css',media_type='text/css',headers={'Cache-Control':'no-store'})

@app.get('/v11_chat.js',include_in_schema=False)
def v11_chat_js():
    return FileResponse(ROOT/'static'/'v11_chat.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

@app.get('/v11_tower.css',include_in_schema=False)
def v11_tower_css():
    return FileResponse(ROOT/'static'/'v11_tower.css',media_type='text/css',headers={'Cache-Control':'no-store'})

@app.get('/v11_tower.js',include_in_schema=False)
def v11_tower_js():
    return FileResponse(ROOT/'static'/'v11_tower.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

@app.get('/v10_ui.js',include_in_schema=False)
def v10_ui():
    return FileResponse(ROOT/'static'/'v10_ui.js',media_type='text/javascript',headers={'Cache-Control':'no-store'})

# -------------------------------------------------------------------------
# v11: independent measurement surfaces + read-only production-gap evidence.
# V10 3D/three-paper model code remains available; stage policy uses v11
# observable-time multiobjective triage. Synthetic shadow mode only.
# -------------------------------------------------------------------------
@app.middleware('http')
async def v11_request_guard(request: Request, call_next):
    """Restrict writes to the local or configured public simulation origin."""
    if request.method in ('POST','PUT','PATCH','DELETE'):
        origin = request.headers.get('origin')
        fetch_site = request.headers.get('sec-fetch-site')
        host = request.headers.get('host', '').lower()
        if host in relay_public_domains():
            # Railway terminates TLS before forwarding to the container.
            expected_origin = f'https://{host}'
            native_mcp = request.url.path in (MCP_PATH, LEGACY_MCP_PATH) and fetch_site is None
            allowed = origin == expected_origin or (
                origin is None and (fetch_site == 'same-origin' or native_mcp)
            )
        else:
            allowed = request.url.hostname in ('127.0.0.1', 'localhost', 'testserver') and (
                origin is None or origin == f'http://{host}'
            )
        if fetch_site == 'cross-site' or not allowed:
            return JSONResponse({'detail': 'Cross-site mutation request blocked in synthetic sandbox'}, status_code=403)
    response=await call_next(request)
    # Development/demo policy: never reuse cached pages, scripts, styles,
    # images, or GET API results. This also covers mounted StaticFiles
    # (/scene/*, /aircraft/*) that otherwise emit their own cache headers.
    # API mutations are uncached too; leave MCP streaming headers intact.
    if request.method in ('GET', 'HEAD') and request.url.path not in (MCP_PATH, LEGACY_MCP_PATH):
        response.headers['Cache-Control'] = 'no-store'
    elif request.url.path.startswith('/v11/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/',include_in_schema=False)
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

for mcp_path in (MCP_PATH, LEGACY_MCP_PATH):
    app.add_route(mcp_path, MCPTransport(), methods=['GET', 'POST', 'DELETE'], include_in_schema=False)


@app.get('/v11_customer.css', include_in_schema=False)
def v11_customer_css():
    return FileResponse(ROOT/'static'/'v11_customer.css', media_type='text/css')

@app.get('/v11_customer.js', include_in_schema=False)
def v11_customer_js():
    return FileResponse(ROOT/'static'/'v11_customer.js', media_type='text/javascript')
