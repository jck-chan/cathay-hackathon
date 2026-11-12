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

INSTRUCTIONS = """RELAY Three Twins -- MCP agent operating guide

What this server is
The v11 Customer, Ground, and Control Tower views share ONE server-owned
synthetic cargo simulation: the same shipments, event store, decision state,
and 10-minute ticks. All tool writes change shared state for every client.
This is a research/demo sandbox, NOT a connection to real Cathay systems:
no actual airline booking, cargo move, customer notification, certified
aircraft loading, or established financial ROI. The separate v12 five-policy
arena, Evidence Lab and standalone research API are outside this MCP.

The three views
- customer_*: admit a synthetic cargo request from HKG and track its AWB.
  Accepted request/RCS does not prove a flight booking or delivery.
- ground_*: set playback, resource availability, demand, synthetic weather,
  and disruptions. WAIT/WORK/DONE denote simulated staging, NOT flight status.
- control_*: inspect the shared state; compute and review tentative recovery
  routing decisions; acknowledge dependent simulated work orders. Internal
  approval is NOT carrier confirmation or authorization for physical work.

First tool call: control_get_state
Read tick, clock, v8.running/mode/config, decision.id/status/snapshot_version/
stale/warnings/proposed_actions, tasks[].depends_on_task_id, policies.fcfs
versus policies.relay, shipment_objects, unified_events, portfolio_coverage
and view_clock_contract. The full snapshot is large: extract relevant
fields. The top-level snapshot_version describes shared state; for a review
use decision.snapshot_version (not the top-level version). Check
decision_scope before claiming global optimality.

End-to-end scenario (customer -> ground -> control -> customer)
1. Pause with ground_pause_simulation to obtain a stable clock. This pauses
   the simulation for EVERY viewer. Set control_set_review_mode to
   MANUAL_REVIEW if you want explicit operator-style review. Read state.
2. Create a synthetic order with customer_place_order; save its returned
   AWB and shipment_id. Track it with customer_track_shipment.
3. Optionally call ground_configure_environment and/or
   ground_inject_incident. The simulator chooses which entity an incident
   affects; inspect the returned event, never invent a flight ID.
4. Use control_recalculate_decision, then control_get_state. Examine the
   current pending decision, warnings, scope, proposed routes, and model
   statuses. A proposed route is NOT booked and a tentative ETA is NOT
   the customer-facing carrier ETA.
5. To review: call control_review_decision with review.decision_id =
   decision.id, review.expected_snapshot_version =
   decision.snapshot_version, and choice approve or reject. A stale ID
   or conflicting snapshot requires re-reading and re-evaluating; never
   retry a formerly approved plan blindly. Approval makes internal,
   synthetic dependent work orders only.
6. Inspect tasks and depends_on_task_id. Use control_mark_task_done only
   for an appropriate task in the present workflow, respecting its
   prerequisites. To progress ground staging, use ground_step_simulation
   while paused, or start autoplay then pause again. Ticks, orders or
   incidents can replace the current decision and task list.
7. Track the AWB again and clearly distinguish recorded SYNTHETIC cargo
   milestones, simulated ground stage, internal reviews, candidate routes,
   and airline booking/confirmation (which this system does NOT provide).

Review modes
AUTO_SHADOW: system automatically approves only eligible sandbox proposals;
safety/evidence conflicts and previously processed proposals may block it.
MANUAL_REVIEW: wait for explicit approve/reject via control_review_decision.
ADVISORY: no automatic review; suggestions are advisory. The explicit
review endpoint remains available. Switching to AUTO_SHADOW may immediately
auto-approve a current eligible proposal.

Interpreting the three optimization models
I: bounded 2D load-placement diagnostic, not certified 3D ULD loading.
II: bounded one-step verification and uncertainty gate, not full
    sequential Bayesian control.
III: finite-candidate network MILP proposal, not proven globally optimal
     beyond the evaluated candidates and not a carrier booking.
Blocked DGR/uncertain shipments need independent authorization. Model
warnings are operational boundaries, not instructions to circumvent.
The FCFS/RELAY comparison and cost units are synthetic, not airline ROI.

Clock and safety
One tick = 10 SIMULATED minutes. Manual stepping requires paused autoplay.
Speed is a REQUESTED multiplier; actual_ticks_per_second may be lower.
Every action affects the shared sandbox. These 13 tools cannot reset it:
the dashboard/REST API provides reset separately. Never claim to have sent
real flight, warehouse, customer or booking commands.
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
        """Start here: read the authoritative, potentially large synthetic three-view snapshot. Inspect tick/clock, v8.running/mode/config, decision.id/status/snapshot_version/warnings/proposed_actions, tasks and depends_on_task_id, policies.fcfs/relay, shipment_objects and view_clock_contract. Use decision.snapshot_version for reviews; a candidate route is never a booking."""
        return await run_in_threadpool(v11_state, None)

    @mcp.tool(annotations=read_only)
    async def customer_track_shipment(awb: Annotated[str, Field(min_length=1, max_length=80)]) -> dict[str, Any]:
        """Track a synthetic shipment using the AWB returned by customer_place_order or listed in control_get_state.shipment_objects. Separately inspect source-recorded synthetic milestones, ground_twin staging state and route_decision candidate itinerary. Ground DONE or internal approval does NOT mean flight departure, airline-confirmed routing, customer ETA change or delivery."""
        state = await run_in_threadpool(v11_state, awb)
        customer = state['customer_projection']
        if customer is None:
            raise ValueError(f'No admitted shipment with AWB {awb}')
        return customer

    @mcp.tool()
    async def customer_place_order(order: OrderRequest) -> dict[str, Any]:
        """Admit a synthetic HKG-origin cargo REQUEST, not an airline booking, into the common Ground/Control/Customer simulation. Supply optional destination, weight, handling (GENERAL or COL), service and dimensions; omitted values use defaults. Save returned awb and shipment_id. Use customer_track_shipment(awb), then inspect state or recalculate a routing proposal."""
        result = await run_in_threadpool(v11_order, order)
        return {'awb': result['awb'], 'shipment_id': result['shipment_id']}

    @mcp.tool()
    async def ground_inject_incident(incident: IncidentRequest) -> dict[str, Any]:
        """Create one synthetic disruption: flight_delay, flight_cancelled, capacity_changed, terminal_congestion, shipment_dimension_conflict or shipment_dimension_verified. The simulator chooses the affected flight/shipment; the caller cannot select its ID. Inspect returned event_id/entity_id, then check control_get_state for changed recommendations. No real airline event is created."""
        state = await run_in_threadpool(v11_incident, incident)
        return state['latest_event']

    @mcp.tool()
    async def control_review_decision(review: ReviewRequest) -> dict[str, Any]:
        """Approve or reject the CURRENT pending synthetic Control Tower proposal, usually after setting MANUAL_REVIEW. First read control_get_state.decision for status, stale, warnings, id and snapshot_version. Pass review.decision_id=decision.id, review.expected_snapshot_version=decision.snapshot_version, choice=approve/reject. On stale/conflict, re-read before acting. Approval creates simulated work orders; it does NOT book flights or authorize physical dispatch."""
        result = await run_in_threadpool(v11_review, review)
        return result['review']

    @mcp.tool()
    async def control_mark_task_done(task_id: str) -> dict[str, Any]:
        """Acknowledge a simulated work order with task_id from control_get_state.tasks after internal approval. Check its status, task_type and depends_on_task_id, and respect prerequisites. A DONE acknowledgment logs a sandbox handoff, NOT aircraft loading, airline booking or customer notification. Fresh decisions/ticks may supersede task lists; re-read shared state."""
        result = await run_in_threadpool(v11_task_done, task_id)
        return result['result']

    @mcp.tool()
    async def ground_start_simulation() -> dict[str, Any]:
        """Start autoplay of the single server-owned synthetic Ground/Control/Customer clock. Progress may admit orders, complete ground staging and recalculate decisions for all connected users. Use ground_pause_simulation before manual stepping or stable review. Requested speed is not guaranteed actual throughput; no real airline activity occurs."""
        return await apply_control(SimulationControl(action='start'))

    @mcp.tool()
    async def ground_pause_simulation() -> dict[str, Any]:
        """Pause the server-owned synthetic simulation for ALL connected clients without resetting its current tick, orders or decisions. Pause before ground_step_simulation and when a stable review snapshot is required. Returns shared clock and playback settings."""
        return await apply_control(SimulationControl(action='pause'))

    @mcp.tool()
    async def ground_step_simulation(count: Annotated[int, Field(ge=1, le=100)] = 1) -> dict[str, Any]:
        """Advance 1-100 ticks of 10 simulated minutes each while autoplay is PAUSED; the shared Ground, Control Tower and Customer views update together. May admit shipments, complete staging and replace pending decisions/tasks. Running autoplay causes a conflict: call ground_pause_simulation first."""
        return await apply_control(SimulationControl(action='step', count=count))

    @mcp.tool()
    async def ground_set_playback_speed(speed: Literal[1, 4, 16, 32, 100]) -> dict[str, Any]:
        """Configure a REQUESTED synthetic autoplay speed of 1x, 4x, 16x, 32x or 100x, without advancing time by this call. Solver CPU work can prevent reaching the target: compare speed_target and target_ticks_per_second with actual_ticks_per_second. Applies to all three views."""
        return await apply_control(SimulationControl(action='speed', speed=speed))

    @mcp.tool()
    async def ground_configure_environment(settings: EnvironmentSettings) -> dict[str, Any]:
        """Tune shared synthetic simulation settings: rate (arrival intensity), chaos (disruption probability), handlers, stands, cold_bays or weather (AUTO/CLEAR/RAIN/FOG/STORM). Omitted values stay unchanged. RAIN reduces effective stands by 1; STORM reduces stands by 2 and handlers by 1, each floored at 1. These are non-certified scenario assumptions."""
        control = SimulationControl(action='tune', **settings.model_dump(exclude_none=True))
        return await apply_control(control)

    @mcp.tool()
    async def control_set_review_mode(mode: Literal['AUTO_SHADOW', 'MANUAL_REVIEW', 'ADVISORY']) -> dict[str, Any]:
        """Set shared synthetic review mode. AUTO_SHADOW may immediately approve eligible pending internal proposals but is blocked by applicable safety/evidence gates; MANUAL_REVIEW waits for explicit control_review_decision; ADVISORY suppresses automatic approval and treats recommendations as advice (explicit review API still exists). None authorizes real bookings or movements."""
        return await apply_control(SimulationControl(action='mode', mode=mode))

    @mcp.tool()
    async def control_recalculate_decision() -> dict[str, Any]:
        """Re-run the synthetic Control Tower recommendation at the SAME tick using Model I bounded 2D placement, Model II one-step uncertainty verification, and Model III finite-column network routing. May supersede decision ID/version and current task view. Inspect returned proposal/warnings and re-read control_get_state before review. No time advance or airline booking."""
        state = await run_in_threadpool(v11_control, SimulationControl(action='recalculate'))
        return {'decision': state['decision']}

    return mcp


async def apply_control(control: SimulationControl) -> dict[str, Any]:
    state = await run_in_threadpool(v11_control, control)
    return {'tick': state['tick'], 'clock': state['clock'], **state['v8']}
