# RELAY Fusion v4 — reproducible QA and operational scope

## Tested in Linux / Python 3.13 container

- All original v3.1 backend/full-stack regression tests retained, with the expected v3.1 home route updated to `/show` because v4 now owns `/`.
- New v4 canonical-workspace tests cover same-shipment IDs, model invocation, source-typed flight cancellation, reduction of actual flight remaining capacity, dimension conflict/verified resolution, active work-order hold, external/booking claim boundaries, stale approval rejection, ground task dependencies, cold-bay resource constraint, reproducible seeded replay and same-catalog customer AWB.
- 200 randomized exact-dispatch test cases checked against exhaustive subset oracle for the specifically modeled two-class problem.
- Long-running high-stress sequence: 96 v4 simulated ten-minute ticks, 5 released work orders per step, full synthetic disruption intensity; result 0 attempted unsafe dispatches, no solver exceptions. **This is not a full high-volume airline simulation.**
- 10,000 paired synthetic **staging-policy episodes** computed rather than stored; comparison uses shared work orders, durations and observable resource restrictions for both policies; each episode DOES NOT re-solve network MILP. As an example with seed=707 at the default controls, mean simulated cost difference was **20.3392 units per episode** with a 95% *Monte Carlo sampling* interval of **[19.8681, 20.8104]**. In 13.75% of those sampled episodes, the RELAY staging heuristic was worse. This must never be called Cathay ROI or externally validated error reduction.
- JavaScript syntax checked with Node; mock DOM + real HTTP server tested clickable Step, incident, three mathematical result panes, ULD 2D, customer sample/track and paired benchmark. This verifies event handlers and API wiring, NOT visual pixel quality.
- Headless Chromium rendering was attempted but rejected by the test runtime with `ERR_BLOCKED_BY_ADMINISTRATOR`. Browser geometry, CSS hit targets, final screenshot and Windows launcher are therefore **not certified** by this QA.

## Architectural invariants

1. `UnifiedLab` owns a dedicated temporary SQLite Store loaded from exactly the same canonical synthetic `data/*.jsonl` catalog. It does not silently consume the separate v3 legacy live queue. Its `/v4/api/*` routes share this store; the `/v1/*` compatibility API is a separate legacy store.
2. Synthetic work-order releases refer only to canonical AWB / `SYN-S*` shipment IDs; four already-accepted work orders are present at session handover. Finite accepted pools are explicit; playback does not hallucinate endless cargo.
3. Two staging queues receive the same jobs, observed attributes, service durations, safety holds, time and shared capacity limits. Only the dispatch policies differ.
4. A newly received authoritative dimension or customs hold suspends an affected simulated active staging work order in both queues. It cannot authorize loading.
5. Flight cancellation/capacity and verified-dimension events enter the same immutable source-typed event store; Model I/II/III re-run on the updated snapshot.
6. Decision `OPTIMAL` status is never stated to prove airline-level optimality or actual ULD/aircraft safe loading.
7. Approval creates simulated dependency tasks only. Internal approval is never external carrier-booking confirmation; customer tracking retains the information boundary.
8. Model II may remain `NOT_TRIGGERED` when no evidence uncertainty exists. That's a valid result.

## Major remaining risks

- The 30-day history is generated from expert-motivated assumptions, not measured Cathay processes. Arrival-rate controls are **simulation knobs**, not trained estimates.
- Shared 3D task animations show simulated staging/documentation work. They do not render actual truck/belt-loader/ULD trajectories from certified task instructions.
- Network Model III only represents enumerated two-leg routes and synthetic network/terminal capacities. Physical/booking conditions are not production authorizations.
- Model I independent 2D batch candidates do not certify ULD load geometry, support/restraint or aircraft weight-and-balance.
- Model II remains a one-decision Bayesian gate with assumed inspection quality, not a calibrated sequential semi-Markov controller.
- v4's live staging objective is an observable weighted urgency heuristic solved exactly under two classes, not a proven minimum of real airline operational cost.
- Single local process and unprotected supervisor simulation APIs: not deployable to internet without RBAC, tenancy, outbox/idempotence design, monitoring and threat-model review.

## Commands

```bash
python -m pytest -q tests upstream_tests
node --check static/v4.js
node --check static/v4_visual.js
# Start python launch.py and then:
TEST_PORT=8765 node tests/test_v4_dom_node.js
```
