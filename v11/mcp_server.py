"""MCP tools for the local three-twin simulation."""
from __future__ import annotations

from typing import Annotated, Any, Literal
from contextlib import ExitStack
from uuid import uuid4
from . import api as simulation_api

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
Each v11 sandbox has its own shipments, flights, event store, decisions and 10-minute
clock, shared by its Customer, Ground and Control Tower views. DIFFERENT sandboxes
do not share clocks or stores. Use ground_list_sandboxes, ground_create_sandbox,
and ground_delete_sandbox to manage the dynamic sandbox registry.
Every MCP read/write defaults to scope='all', targeting every existing sandbox.
For a subset pass scope='sandboxes' AND sandbox_ids=['id1','id2'].
Each result carries sandbox_id; inspect complete/failed for partial success.
Writes affect every client viewing the targeted sandbox(s).
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

Read control_get_state for all sandboxes (or a selected subset)
Read tick, clock, v8.running/mode/config, decision.id/status/snapshot_version/
stale/warnings/proposed_actions, tasks[].depends_on_task_id, policies[ground_policy],
shipment_objects, unified_events, portfolio_coverage
and view_clock_contract. The full snapshot is large: extract relevant
fields. The top-level snapshot_version describes shared state; for a review
use decision.snapshot_version (not the top-level version). Check
decision_scope before claiming global optimality.

End-to-end scenario (customer -> ground -> control -> customer)
1. Pause with ground_pause_simulation to obtain stable clocks. This pauses
   every sandbox by default, or the selected sandbox IDs. Set control_set_review_mode to
   MANUAL_REVIEW if you want explicit operator-style review. Read state.
2. Create a synthetic order with customer_place_order (all sandboxes by default)
   or an explicit subset. customer_place_order_all_sandboxes is an alias. For both,
   the AWB and shipment ID are shared so policies can be compared directly;
   check complete/failed for any partial writes. Save the AWB and track it
   with customer_track_shipment in selected sandboxes.
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
One tick = 10 SIMULATED minutes PER SANDBOX. Manual stepping requires paused autoplay in every target.
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


    @mcp.tool()
    async def ground_delete_sandbox(sandbox_id: str) -> dict[str, Any]:
        """Permanently delete ONE synthetic sandbox by its ID, stopping its playback and disposing its simulation. The other sandboxes are untouched. Call ground_list_sandboxes first."""
        from .api import v11_delete_sandbox
        await run_in_threadpool(v11_delete_sandbox, sandbox_id)
        return {'deleted': True, 'sandbox_id': sandbox_id}

    @mcp.tool(annotations=read_only)
    async def control_get_state(
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Read independent simulation snapshots from ALL sandboxes by default, or selected sandbox_ids with scope='sandboxes'. Every result includes its sandbox ID, tick, clock, flights, shipments, tasks, review decisions, and policies. Each sandbox has its OWN clock and store; only Ground/Control/Customer views WITHIN that sandbox share a clock."""
        return await run_in_threadpool(_fanout, lambda sid: v11_state(None, sid), scope, sandbox_ids)

    @mcp.tool(annotations=read_only)
    async def customer_track_shipment(
        awb: Annotated[str, Field(min_length=1, max_length=80)],
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Track a synthetic AWB across all sandboxes by default, or selected sandbox_ids. Missing AWBs are reported per sandbox; shipment histories and routing are independent even if identifiers match. This is NOT carrier tracking."""
        def track(sid: str) -> dict[str, Any]:
            state = v11_state(awb, sid)
            customer = state['customer_projection']
            if customer is None:
                raise ValueError(f'No admitted shipment with AWB {awb}')
            return customer
        return await run_in_threadpool(_fanout, track, scope, sandbox_ids)

    @mcp.tool()
    async def customer_place_order(
        order: OrderRequest, scope: Literal['all', 'sandboxes'] = 'all',
        sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create the SAME synthetic shipment in all sandboxes by default, or only selected sandbox_ids. A shared generated AWB/ID allows comparison, but the orders are separate records in separate sandboxes. No airline booking. Returns per-sandbox successes/failures; do not blindly retry partial writes."""
        return await run_in_threadpool(_place_order_scoped, order, scope, sandbox_ids)

    @mcp.tool()
    async def customer_place_order_all_sandboxes(order: OrderRequest) -> dict[str, Any]:
        """Compatibility alias: create one identical synthetic request across all current independent sandboxes, with a common AWB/ID for comparisons. For explicit subsets use customer_place_order(scope='sandboxes', sandbox_ids=[...])."""
        return await run_in_threadpool(_place_order_scoped, order, 'all', None)

    @mcp.tool()
    async def ground_inject_incident(
        incident: IncidentRequest, scope: Literal['all', 'sandboxes'] = 'all',
        sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Inject the specified SYNTHETIC incident independently into all or selected sandboxes. Each simulator independently chooses an affected entity; events and IDs may differ. Returns one result/error per sandbox."""
        return await run_in_threadpool(_fanout, lambda sid: v11_incident(incident, sid)['latest_event'], scope, sandbox_ids)

    @mcp.tool()
    async def control_review_decision(
        review: ReviewRequest, scope: Literal['all', 'sandboxes'] = 'all',
        sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Review a pending synthetic recommendation in all or selected sandboxes. The supplied decision_id and expected_snapshot_version are checked independently in EACH sandbox; mismatches are reported as errors, never silently approved. Get each sandbox's decision first. Never represents a carrier booking."""
        return await run_in_threadpool(_fanout, lambda sid: v11_review(review, sid)['review'], scope, sandbox_ids)

    @mcp.tool()
    async def control_mark_task_done(
        task_id: str, scope: Literal['all', 'sandboxes'] = 'all',
        sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Acknowledge a synthetic task in all or selected sandboxes. IDs and prerequisite chains may differ; unknown task IDs generate per-sandbox errors. This does not initiate real ground handling."""
        return await run_in_threadpool(_fanout, lambda sid: v11_task_done(task_id, sid)['result'], scope, sandbox_ids)

    @mcp.tool()
    async def ground_start_simulation(
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Start each selected sandbox's INDEPENDENT autoplay clock; targets all existing sandboxes unless scoped. Returns per-sandbox tick, clock, and running state, with individual errors."""
        return await apply_control(SimulationControl(action='start'), scope, sandbox_ids)

    @mcp.tool()
    async def ground_pause_simulation(
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Pause all independent sandbox clocks by default, or selected sandbox_ids. Pausing one does not pause another unless both are targeted."""
        return await apply_control(SimulationControl(action='pause'), scope, sandbox_ids)

    @mcp.tool()
    async def ground_step_simulation(
        count: Annotated[int, Field(ge=1, le=100)] = 1,
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Advance each selected sandbox by count 10-minute ticks, all by default. EACH targeted sandbox must be paused. Their clocks are independent; partial successes and running-sandbox conflicts are explicitly reported."""
        return await apply_control(SimulationControl(action='step', count=count), scope, sandbox_ids)

    @mcp.tool()
    async def ground_set_playback_speed(
        speed: Literal[1, 4, 16, 32, 100],
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Request playback speed for all existing independent sandboxes by default, or selected IDs. Actual throughput may differ. Returns per-sandbox settings."""
        return await apply_control(SimulationControl(action='speed', speed=speed), scope, sandbox_ids)

    @mcp.tool()
    async def ground_configure_environment(
        settings: EnvironmentSettings, scope: Literal['all', 'sandboxes'] = 'all',
        sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Set synthetic demand, disruption rate, resources, or weather independently in all or selected sandbox IDs. Identical settings do not imply shared state or identical evolving outcomes."""
        return await apply_control(SimulationControl(action='tune', **settings.model_dump(exclude_none=True)), scope, sandbox_ids)

    @mcp.tool()
    async def control_set_review_mode(
        mode: Literal['AUTO_SHADOW', 'MANUAL_REVIEW', 'ADVISORY'],
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Set internal synthetic decision review mode for all sandboxes by default, or selected sandbox IDs. AUTO_SHADOW may approve independently eligible proposals; never real airline operations."""
        return await apply_control(SimulationControl(action='mode', mode=mode), scope, sandbox_ids)

    @mcp.tool()
    async def control_recalculate_decision(
        scope: Literal['all', 'sandboxes'] = 'all', sandbox_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """Recalculate independent synthetic Control Tower decisions for all or selected sandboxes at their OWN current ticks. Returns each sandbox's decision separately; no actual bookings."""
        return await run_in_threadpool(_fanout, lambda sid: {'decision': v11_control(SimulationControl(action='recalculate'), sid)['decision']}, scope, sandbox_ids)

    return mcp

def _targets(scope: str, sandbox_ids: list[str] | None) -> tuple[str, ...]:
    """Freeze a target set at call start; reject invalid/missing IDs without mutating anything."""
    if scope == 'all':
        if sandbox_ids is not None:
            raise ValueError("sandbox_ids requires scope='sandboxes'")
        targets = tuple(s.id for s in simulation_api.sandboxes.list())
    elif scope == 'sandboxes':
        if not sandbox_ids:
            raise ValueError("scope='sandboxes' requires a nonempty sandbox_ids array")
        if len(sandbox_ids) != len(set(sandbox_ids)):
            raise ValueError('Duplicate sandbox IDs are not allowed')
        targets = tuple(sandbox_ids)
        for sid in targets:
            simulation_api.get_sandbox(sid)
    else:
        raise ValueError(f'Unknown scope: {scope}')
    if not targets:
        raise ValueError('No sandboxes available')
    return targets


def _fanout(fn: Any, scope: str, sandbox_ids: list[str] | None) -> dict[str, Any]:
    targets = _targets(scope, sandbox_ids)
    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for sid in targets:
        try:
            results.append({'sandbox_id': sid, 'result': fn(sid)})
        except Exception as exc:
            failures.append({'sandbox_id': sid, 'error': str(getattr(exc, 'detail', exc))})
    return {
        'scope': scope, 'target_count': len(targets), 'success_count': len(results),
        'failure_count': len(failures), 'complete': not failures,
        'results': results, 'failed': failures,
    }


def _place_order_scoped(order: OrderRequest, scope: str, sandbox_ids: list[str] | None) -> dict[str, Any]:
    """Preflight and lock selected stores; use one shipment ID without sharing state."""
    targets = _targets(scope, sandbox_ids)
    selected = [simulation_api.get_sandbox(sid) for sid in targets]
    with ExitStack() as stack:
        for sandbox in sorted(selected, key=lambda s: s.id):
            stack.enter_context(sandbox.conductor.guard)
        full = [s.id for s in selected
                if sum(sid.startswith('SYN-DEMO-') for sid in s.conductor.lab.admitted) >= 30]
        if full:
            raise ValueError('Order capacity reached in sandboxes: ' + ', '.join(full))
        shipment_id = 'SYN-DEMO-' + uuid4().hex[:12].upper()
        created, failed = [], []
        for sandbox in selected:
            try:
                result = sandbox.conductor.order(**order.model_dump(), shipment_id=shipment_id)
                created.append({'sandbox_id': sandbox.id, 'result': {
                    'awb': result['awb'], 'shipment_id': result['shipment_id']}})
            except Exception as exc:
                failed.append({'sandbox_id': sandbox.id, 'error': str(exc)})
    return {
        'scope': scope, 'awb': 'SYN-CX-D' + shipment_id[-8:],
        'shipment_id': shipment_id, 'target_count': len(targets),
        'success_count': len(created), 'failure_count': len(failed),
        'created_count': len(created), 'complete': not failed,
        'results': created, 'created': created, 'failed': failed,
    }


async def apply_control(
    control: SimulationControl, scope: str = 'all', sandbox_ids: list[str] | None = None,
) -> dict[str, Any]:
    def perform(sid: str) -> dict[str, Any]:
        state = v11_control(control, sid)
        return {'tick': state['tick'], 'clock': state['clock'], **state['v8']}
    return await run_in_threadpool(_fanout, perform, scope, sandbox_ids)
