"""MCP tools for the local three-twin simulation."""
from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
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

MCP_PATH = '/v11/mcp'


class MCPTransport:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        transport = scope.get('state', {}).get('relay_mcp_transport')
        if transport is None:
            transport = PlainTextResponse('MCP lifespan is unavailable', status_code=503)
        await transport(scope, receive, send)


def create_mcp_server() -> FastMCP:
    mcp = FastMCP(
        'RELAY Three Twins',
        instructions='Operate the local synthetic three-twin cargo simulation. '
        'The dashboard and all tools share one clock and one set of orders. '
        'Use simulation ticks for scheduling and MANUAL_REVIEW for agent reviews.',
        streamable_http_path=MCP_PATH,
        stateless_http=True,
        json_response=True,
    )
    read_only = ToolAnnotations(readOnlyHint=True, openWorldHint=False)

    @mcp.tool(annotations=read_only)
    async def get_state() -> dict[str, Any]:
        """Read the current tick, decision, tasks, resources, queues, and recent events."""
        return await run_in_threadpool(v11_state, None)

    @mcp.tool(annotations=read_only)
    async def track_shipment(awb: Annotated[str, Field(min_length=1, max_length=80)]) -> dict[str, Any]:
        """Read the customer journey for an admitted synthetic air waybill."""
        state = await run_in_threadpool(v11_state, awb)
        customer = state['customer_projection']
        if customer is None:
            raise ValueError(f'No admitted shipment with AWB {awb}')
        return customer

    @mcp.tool()
    async def place_order(order: OrderRequest) -> dict[str, Any]:
        """Create a synthetic cargo request and return its AWB and shipment ID."""
        result = await run_in_threadpool(v11_order, order)
        return {'awb': result['awb'], 'shipment_id': result['shipment_id']}

    @mcp.tool()
    async def inject_incident(incident: IncidentRequest) -> dict[str, Any]:
        """Inject a disruption into the shared simulation. The simulator chooses the affected entity."""
        state = await run_in_threadpool(v11_incident, incident)
        return state['latest_event']

    @mcp.tool()
    async def review_decision(review: ReviewRequest) -> dict[str, Any]:
        """Approve or reject the current synthetic proposal using its ID and snapshot version."""
        result = await run_in_threadpool(v11_review, review)
        return result['review']

    @mcp.tool()
    async def mark_task_done(task_id: str) -> dict[str, Any]:
        """Mark a simulated work order done. Use a task ID from get_state."""
        result = await run_in_threadpool(v11_task_done, task_id)
        return result['result']

    @mcp.tool()
    async def start_simulation() -> dict[str, Any]:
        """Start autoplay for the shared Ground, Control Tower, and Customer clock."""
        return await apply_control(SimulationControl(action='start'))

    @mcp.tool()
    async def pause_simulation() -> dict[str, Any]:
        """Pause autoplay so agents can act at the current simulation tick."""
        return await apply_control(SimulationControl(action='pause'))

    @mcp.tool()
    async def step_simulation(count: Annotated[int, Field(ge=1, le=100)] = 1) -> dict[str, Any]:
        """Advance the paused simulation by count ticks. Each tick is 10 simulated minutes."""
        return await apply_control(SimulationControl(action='step', count=count))

    @mcp.tool()
    async def set_playback_speed(speed: Literal[1, 4, 16, 32, 100]) -> dict[str, Any]:
        """Set the requested autoplay multiplier."""
        return await apply_control(SimulationControl(action='speed', speed=speed))

    @mcp.tool()
    async def configure_environment(settings: EnvironmentSettings) -> dict[str, Any]:
        """Set arrival rate, disruption probability, crew, stands, cold bays, or weather."""
        control = SimulationControl(action='tune', **settings.model_dump(exclude_none=True))
        return await apply_control(control)

    @mcp.tool()
    async def set_review_mode(mode: Literal['AUTO_SHADOW', 'MANUAL_REVIEW', 'ADVISORY']) -> dict[str, Any]:
        """Choose whether eligible proposals are auto-reviewed, manually reviewed, or advisory."""
        return await apply_control(SimulationControl(action='mode', mode=mode))

    @mcp.tool()
    async def recalculate_decision() -> dict[str, Any]:
        """Recalculate the current recommendation at the same simulation tick."""
        state = await run_in_threadpool(v11_control, SimulationControl(action='recalculate'))
        return {'decision': state['decision']}

    return mcp


async def apply_control(control: SimulationControl) -> dict[str, Any]:
    state = await run_in_threadpool(v11_control, control)
    return {'tick': state['tick'], 'clock': state['clock'], **state['v8']}
