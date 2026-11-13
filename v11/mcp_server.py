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
    SandboxCreate,
    SimulationControl,
    v11_control,
    v11_create_sandbox,
    v11_list_sandboxes,
    v11_incident,
    v11_order,
    v11_order_all,
    v11_review,
    v11_state,
    v11_task_done,
)
from .sandboxes import DispatchPolicy

MCP_PATH = '/mcp'
LEGACY_MCP_PATH = '/v11/mcp'

INSTRUCTIONS = """RELAY Three Twins -- MCP agent operating guide

What this server is
Each v11 sandbox has its own shipments, event store, decisions and 10-minute
clock, shared by its Customer, Ground and Control Tower views. Use
ground_list_sandboxes to find IDs and ground_create_sandbox to create one.
Pass the same sandbox_id throughout a workflow. Omitting it targets the
initial RELAY sandbox or the first available sandbox if RELAY was deleted.
Writes affect every client viewing the targeted sandbox.
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

Read control_get_state for the target sandbox
Read tick, clock, v8.running/mode/config, decision.id/status/snapshot_version/
stale/warnings/proposed_actions, tasks[].depends_on_task_id, policies[ground_policy],
shipment_objects, unified_events, portfolio_coverage
and view_clock_contract. The full snapshot is large: extract relevant
fields. The top-level snapshot_version describes shared state; for a review
use decision.snapshot_version (not the top-level version). Check
decision_scope before claiming global optimality.

End-to-end scenario (customer -> ground -> control -> customer)
1. Pause with ground_pause_simulation to obtain a stable clock. This pauses
   the target sandbox for every viewer. Set control_set_review_mode to
   MANUAL_REVIEW if you want explicit operator-style review. Read state.
2. Create a synthetic order with customer_place_order (one sandbox), or
   customer_place_order_all_sandboxes (all existing sandboxes). For the latter,
   the AWB and shipment ID are shared so policies can be compared directly;
   check complete/failed for any partial writes. Save the AWB and track it
   with customer_track_shipment in the chosen sandbox.
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
Model I: bounded 2D load-placement diagnostic, not certified 3D ULD loading.
Model II: bounded one-step verification and uncertainty gate, not full
    sequential Bayesian control.
Model III: finite-candidate network MILP proposal, not proven globally optimal
     beyond the evaluated candidates and not a carrier booking.
Blocked DGR/uncertain shipments need independent authorization. Model
warnings are operational boundaries, not instructions to circumvent.
The FCFS/RELAY comparison and cost units are synthetic, not airline ROI.

Clock and safety
One tick = 10 SIMULATED minutes. Manual stepping requires paused autoplay.
Speed is a REQUESTED multiplier; actual_ticks_per_second may be lower.
The dashboard and REST API provide reset. Never claim to have sent
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
    async def ground_list_sandboxes() -> list[dict[str, Any]]:
        """List synthetic v11 sandboxes in display order. Use the returned ID to target a sandbox in tools or to embed its Ground Twin."""
        return [sandbox.model_dump() for sandbox in await run_in_threadpool(v11_list_sandboxes)]

    @mcp.tool()
    async def ground_create_sandbox(
        name: str, policy: DispatchPolicy = 'relay',
        seed: Annotated[int, Field(ge=0, le=2147483647)] = 2048,
    ) -> dict[str, Any]:
        """Create an independent, paused synthetic v11 sandbox. Choose FCFS, RELAY_V10, RELAY_V11, A_CRITICAL (RELAY + Model A), or A_EDF (RELAY + EDF). Save the returned ID for tools and live embeds."""
        sandbox = await run_in_threadpool(v11_create_sandbox, SandboxCreate(name=name, policy=policy, seed=seed))
        return sandbox.model_dump()

    @mcp.tool(annotations=read_only)
    async def control_get_state(sandbox_id: str | None = None) -> dict[str, Any]:
        """Start here: read the authoritative, potentially large synthetic three-view snapshot. Inspect tick/clock, v8.running/mode/config, decision.id/status/snapshot_version/warnings/proposed_actions, tasks and depends_on_task_id, policies[ground_policy], shipment_objects and view_clock_contract. Use decision.snapshot_version for reviews; a candidate route is never a booking."""
        return await run_in_threadpool(v11_state, None, sandbox_id)

    @mcp.tool(annotations=read_only)
    async def customer_track_shipment(awb: Annotated[str, Field(min_length=1, max_length=80)], sandbox_id: str | None = None) -> dict[str, Any]:
        """Track a synthetic shipment using the AWB returned by customer_place_order or listed in control_get_state.shipment_objects. Separately inspect source-recorded synthetic milestones, ground_twin staging state and route_decision candidate itinerary. Ground DONE or internal approval does NOT mean flight departure, airline-confirmed routing, customer ETA change or delivery."""
        state = await run_in_threadpool(v11_state, awb, sandbox_id)
        customer = state['customer_projection']
        if customer is None:
            raise ValueError(f'No admitted shipment with AWB {awb}')
        return customer

    @mcp.tool()
    async def customer_place_order(order: OrderRequest, sandbox_id: str | None = None) -> dict[str, Any]:
        """Create one synthetic HKG-origin cargo request in exactly one sandbox (default: RELAY). Supply destination, weight, handling, service and dimensions. This does not book cargo with any airline. For all sandboxes use customer_place_order_all_sandboxes."""
        result = await run_in_threadpool(v11_order, order, sandbox_id)
        return {'awb': result['awb'], 'shipment_id': result['shipment_id']}

    @mcp.tool()
    async def customer_place_order_all_sandboxes(order: OrderRequest) -> dict[str, Any]:
        """Create the SAME synthetic cargo request in every existing v11 sandbox, using one common AWB/shipment ID for comparable policies. No real booking. Returns created_count, target_count, created and failed entries, and complete; a partial result requires inspection before retrying (retries may duplicate orders)."""
        result = await run_in_threadpool(v11_order_all, order)
        return result

    @mcp.tool()
    async def ground_inject_incident(incident: IncidentRequest, sandbox_id: str | None = None) -> dict[str, Any]:
        """Create one synthetic disruption: flight_delay, flight_cancelled, capacity_changed, terminal_congestion, shipment_dimension_conflict or shipment_dimension_verified. The simulator chooses the affected flight/shipment; the caller cannot select its ID. Inspect returned event_id/entity_id, then check control_get_state for changed recommendations. No real airline event is created."""
        state = await run_in_threadpool(v11_incident, incident, sandbox_id)
        return state['latest_event']

    @mcp.tool()
    async def control_review_decision(review: ReviewRequest, sandbox_id: str | None = None) -> dict[str, Any]:
        """Approve or reject the CURRENT pending synthetic Control Tower proposal, usually after setting MANUAL_REVIEW. First read control_get_state.decision for status, stale, warnings, id and snapshot_version. Pass review.decision_id=decision.id, review.expected_snapshot_version=decision.snapshot_version, choice=approve/reject. On stale/conflict, re-read before acting. Approval creates simulated work orders; it does NOT book flights or authorize physical dispatch."""
        result = await run_in_threadpool(v11_review, review, sandbox_id)
        return result['review']

    @mcp.tool()
    async def control_mark_task_done(task_id: str, sandbox_id: str | None = None) -> dict[str, Any]:
        """Acknowledge a simulated work order with task_id from control_get_state.tasks after internal approval. Check its status, task_type and depends_on_task_id, and respect prerequisites. A DONE acknowledgment logs a sandbox handoff, NOT aircraft loading, airline booking or customer notification. Fresh decisions/ticks may supersede task lists; re-read shared state."""
        result = await run_in_threadpool(v11_task_done, task_id, sandbox_id)
        return result['result']

    @mcp.tool()
    async def ground_start_simulation(sandbox_id: str | None = None) -> dict[str, Any]:
        """Start autoplay of the targeted synthetic Ground/Control/Customer clock. Progress may admit orders, complete ground staging and recalculate decisions for all connected users. Use ground_pause_simulation before manual stepping or stable review. Requested speed is not guaranteed actual throughput; no real airline activity occurs."""
        return await apply_control(SimulationControl(action='start'), sandbox_id)

    @mcp.tool()
    async def ground_pause_simulation(sandbox_id: str | None = None) -> dict[str, Any]:
        """Pause the server-owned synthetic sandbox for its connected clients without resetting its current tick, orders or decisions. Pause before ground_step_simulation and when a stable review snapshot is required. Returns shared clock and playback settings."""
        return await apply_control(SimulationControl(action='pause'), sandbox_id)

    @mcp.tool()
    async def ground_step_simulation(count: Annotated[int, Field(ge=1, le=100)] = 1, sandbox_id: str | None = None) -> dict[str, Any]:
        """Advance 1-100 ticks of 10 simulated minutes each while autoplay is PAUSED; the shared Ground, Control Tower and Customer views update together. May admit shipments, complete staging and replace pending decisions/tasks. Running autoplay causes a conflict: call ground_pause_simulation first."""
        return await apply_control(SimulationControl(action='step', count=count), sandbox_id)

    @mcp.tool()
    async def ground_set_playback_speed(speed: Literal[1, 4, 16, 32, 100], sandbox_id: str | None = None) -> dict[str, Any]:
        """Configure a REQUESTED synthetic autoplay speed of 1x, 4x, 16x, 32x or 100x, without advancing time by this call. Solver CPU work can prevent reaching the target: compare speed_target and target_ticks_per_second with actual_ticks_per_second. Applies to all three views."""
        return await apply_control(SimulationControl(action='speed', speed=speed), sandbox_id)

    @mcp.tool()
    async def ground_configure_environment(settings: EnvironmentSettings, sandbox_id: str | None = None) -> dict[str, Any]:
        """Tune shared synthetic simulation settings: rate (arrival intensity), chaos (disruption probability), handlers, stands, cold_bays or weather (AUTO/CLEAR/RAIN/FOG/STORM). Omitted values stay unchanged. RAIN reduces effective stands by 1; STORM reduces stands by 2 and handlers by 1, each floored at 1. These are non-certified scenario assumptions."""
        control = SimulationControl(action='tune', **settings.model_dump(exclude_none=True))
        return await apply_control(control, sandbox_id)

    @mcp.tool()
    async def control_set_review_mode(mode: Literal['AUTO_SHADOW', 'MANUAL_REVIEW', 'ADVISORY'], sandbox_id: str | None = None) -> dict[str, Any]:
        """Set shared synthetic review mode. AUTO_SHADOW may immediately approve eligible pending internal proposals but is blocked by applicable safety/evidence gates; MANUAL_REVIEW waits for explicit control_review_decision; ADVISORY suppresses automatic approval and treats recommendations as advice (explicit review API still exists). None authorizes real bookings or movements."""
        return await apply_control(SimulationControl(action='mode', mode=mode), sandbox_id)

    @mcp.tool()
    async def control_recalculate_decision(sandbox_id: str | None = None) -> dict[str, Any]:
        """Re-run the synthetic Control Tower recommendation at the SAME tick using Model I bounded 2D placement, Model II one-step uncertainty verification, and Model III finite-column network routing. May supersede decision ID/version and current task view. Inspect returned proposal/warnings and re-read control_get_state before review. No time advance or airline booking."""
        state = await run_in_threadpool(v11_control, SimulationControl(action='recalculate'), sandbox_id)
        return {'decision': state['decision']}

    return mcp


async def apply_control(control: SimulationControl, sandbox_id: str | None) -> dict[str, Any]:
    state = await run_in_threadpool(v11_control, control, sandbox_id)
    return {'tick': state['tick'], 'clock': state['clock'], **state['v8']}
