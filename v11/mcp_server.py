"""MCP tools for the local three-twin simulation."""
from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import PlainTextResponse
from starlette.types import Receive, Scope, Send

from .api import (
    EnvironmentSettings,
    IncidentRequest,
    OrderRequest,
    ReviewRequest,
    SimulationControl,
    v11_control,
    v11_incident,
    v11_order,
    v11_review,
    v11_state,
    v11_task_done,
)

MCP_PATH = '/mcp'
LEGACY_MCP_PATH = '/v11/mcp'

INSTRUCTIONS = """\
RELAY Three Twins is a local, synthetic air-cargo simulation. Nothing here \
touches a real airline system. Three views share one clock and one set of \
shipments, and each tool name starts with the view it belongs to.

Tool prefixes
- ground_*   Ground environment: the simulation clock, playback speed, \
resources (crew, stands, cold bays), weather, and disruptions.
- control_*  Control centre: the full simulation state, the current \
recommendation, its review, and ground work orders.
- customer_* Customer: placing a cargo order and tracking it by air waybill (AWB).

Getting started
1. Call control_get_state to read the current tick, decision, tasks, and queues.
2. Call ground_pause_simulation before acting, so the state does not move under you.
3. Advance time with ground_step_simulation. One tick is 10 simulated minutes.

Reviewing decisions
1. Call control_set_review_mode with MANUAL_REVIEW. In AUTO_SHADOW the \
simulator reviews proposals itself.
2. Read the decision from control_get_state.
3. Call control_review_decision with that decision's id and snapshot_version. \
A stale snapshot_version is rejected; read the state again and retry.

Good to know
- Every change is visible in the dashboard and to every other client at once.
- IDs come from tool results: task IDs from control_get_state, AWBs from \
customer_place_order.
- Resetting the simulation is not available here; use the dashboard.
"""


class MCPTransport:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        transport = scope.get('state', {}).get('relay_mcp_transport')
        if transport is None:
            transport = PlainTextResponse('MCP lifespan is unavailable', status_code=503)
        elif scope.get('path') != MCP_PATH:
            scope = {**scope, 'path': MCP_PATH, 'raw_path': MCP_PATH.encode()}
        await transport(scope, receive, send)


def create_mcp_server(public_domains: set[str] | None = None) -> FastMCP:
    public_hosts = sorted(public_domains or ())
    local_hosts = ['127.0.0.1', 'localhost', '[::1]', 'testserver']
    mcp = FastMCP(
        'RELAY Three Twins',
        instructions=INSTRUCTIONS,
        streamable_http_path=MCP_PATH,
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[*local_hosts, *(f'{host}:*' for host in local_hosts), *public_hosts],
            allowed_origins=[
                *(f'http://{host}' for host in local_hosts),
                *(f'http://{host}:*' for host in local_hosts),
                *(f'https://{host}' for host in public_hosts),
            ],
        ),
    )
    read_only = ToolAnnotations(readOnlyHint=True, openWorldHint=False)

    @mcp.tool(annotations=read_only)
    async def control_get_state() -> dict[str, Any]:
        """Read the full shared state: tick, decision, tasks, resources, queues, and recent events."""
        return await run_in_threadpool(v11_state, None)

    @mcp.tool(annotations=read_only)
    async def customer_track_shipment(awb: Annotated[str, Field(min_length=1, max_length=80)]) -> dict[str, Any]:
        """Read the customer journey for an AWB returned by customer_place_order."""
        state = await run_in_threadpool(v11_state, awb)
        customer = state['customer_projection']
        if customer is None:
            raise ValueError(f'No admitted shipment with AWB {awb}')
        return customer

    @mcp.tool()
    async def customer_place_order(order: OrderRequest) -> dict[str, Any]:
        """Create a synthetic cargo request and return its AWB and shipment ID."""
        result = await run_in_threadpool(v11_order, order)
        return {'awb': result['awb'], 'shipment_id': result['shipment_id']}

    @mcp.tool()
    async def ground_inject_incident(incident: IncidentRequest) -> dict[str, Any]:
        """Inject a disruption into the shared simulation. The simulator chooses the affected entity."""
        state = await run_in_threadpool(v11_incident, incident)
        return state['latest_event']

    @mcp.tool()
    async def control_review_decision(review: ReviewRequest) -> dict[str, Any]:
        """Approve or reject the current proposal. Take decision_id and snapshot_version from control_get_state."""
        result = await run_in_threadpool(v11_review, review)
        return result['review']

    @mcp.tool()
    async def control_mark_task_done(task_id: str) -> dict[str, Any]:
        """Mark a simulated work order done. Use a task ID from control_get_state."""
        result = await run_in_threadpool(v11_task_done, task_id)
        return result['result']

    @mcp.tool()
    async def ground_start_simulation() -> dict[str, Any]:
        """Start autoplay for the shared Ground, Control Tower, and Customer clock."""
        return await apply_control(SimulationControl(action='start'))

    @mcp.tool()
    async def ground_pause_simulation() -> dict[str, Any]:
        """Pause autoplay so agents can act at the current simulation tick."""
        return await apply_control(SimulationControl(action='pause'))

    @mcp.tool()
    async def ground_step_simulation(count: Annotated[int, Field(ge=1, le=100)] = 1) -> dict[str, Any]:
        """Advance the simulation by count ticks. Each tick is 10 simulated minutes."""
        return await apply_control(SimulationControl(action='step', count=count))

    @mcp.tool()
    async def ground_set_playback_speed(speed: Literal[1, 4, 16, 32, 100]) -> dict[str, Any]:
        """Set the requested autoplay multiplier."""
        return await apply_control(SimulationControl(action='speed', speed=speed))

    @mcp.tool()
    async def ground_configure_environment(settings: EnvironmentSettings) -> dict[str, Any]:
        """Set arrival rate, disruption probability, crew, stands, cold bays, or weather."""
        control = SimulationControl(action='tune', **settings.model_dump(exclude_none=True))
        return await apply_control(control)

    @mcp.tool()
    async def control_set_review_mode(mode: Literal['AUTO_SHADOW', 'MANUAL_REVIEW', 'ADVISORY']) -> dict[str, Any]:
        """Choose whether eligible proposals are auto-reviewed, manually reviewed, or advisory."""
        return await apply_control(SimulationControl(action='mode', mode=mode))

    @mcp.tool()
    async def control_recalculate_decision() -> dict[str, Any]:
        """Recalculate the current recommendation at the same simulation tick."""
        state = await run_in_threadpool(v11_control, SimulationControl(action='recalculate'))
        return {'decision': state['decision']}

    return mcp


async def apply_control(control: SimulationControl) -> dict[str, Any]:
    state = await run_in_threadpool(v11_control, control)
    return {'tick': state['tick'], 'clock': state['clock'], **state['v8']}
