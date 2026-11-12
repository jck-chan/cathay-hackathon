# RELAY v1 REST / SSE contract (OpenAPI is authoritative)

Interactive schema: `http://127.0.0.1:8765/docs`. Machine-readable schema: `docs/openapi.json` or `GET /openapi.json`. All requests/responses are JSON except `GET /v1/stream` (SSE). Times UTC RFC3339 seconds (`Z`) unless otherwise stated. An `as_of` query influences the mathematical snapshot, not historical SQL mutation.

## `POST /v1/decisions/evaluate`

Request (optional fields):

```json
{
  "as_of": "2026-11-09T01:00:00Z",
  "shipment_ids": ["SYN-S30-002", "SYN-S30-004"],
  "risk_alpha": 0.9,
  "risk_weight": 0.12,
  "time_limit_s": 3
}
```

Empty `{}` selects up to 16 accepted/open synthetic shipments at the virtual clock. Max 24 shipment IDs per request. A successful response contains:

- `id`, `created_at`, `snapshot_version`, `status` (`PENDING_REVIEW` or `ADVISORY_ONLY`), `action`, `review_required`, `reason_codes`;
- `input_evidence` including received-event count, capped recent evidence, calibration training cutoff, selected IDs;
- `process_logs` with exactly ordered `SNAPSHOT -> MODEL_I -> MODEL_III -> MODEL_II -> GATE` stages;
- `model_i` (`status`, `validity`, `baseline`, `risk_aware`, `nominal_budget_units`, `options_evaluated`);
- `model_ii` (posterior, verification net value, `I`,`A`,`B`,`c` decomposition, actual downstream route-cost matrix);
- `model_iii` (`status`, tentative `plan`, `excluded`, `metrics`, `baseline_fcfs`, scenario probabilities, flight capacity usage, solver gap/bound);
- `proposed_actions`: only changed, **tentative** routes; `real_commands_sent:false` always.

No customer-suitable API should return the full decision object. Use `/v1/customer/track/{awb}` instead.

## `POST /v1/events`

Fields: `event_id`, `event_type`, `entity_type`, `entity_id`, `event_time`, `received_at`, `source`, `source_revision`, `trusted`, `payload`. Statuses: `201 CREATED`, `409 CONFLICT` if same ID and different payload, `422` if validation fails. Returns `{event_id,disposition,duplicate,snapshot_version,reason}`. Event receipt is not synonymous with trusted operational status. A source may be trusted for one field but not another; read `DATA_DICTIONARY.md`.

`POST /v1/events/batch` accepts `{ "events": [EventIn, ...] }`, max 100. **Per-item commits, not atomic**; API explicitly returns `atomic:false` with per-event results. Retry failed events by their stable event IDs.

Example POST using curl (replace with your actual locally running port):

```bash
curl -X POST http://127.0.0.1:8765/v1/events \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"DEMO-E101","event_type":"capacity_changed","entity_type":"flight","entity_id":"SYN-F30-02","event_time":"2026-11-09T01:00:00Z","received_at":"2026-11-09T01:00:00Z","source":"SYNTHETIC_INVENTORY","source_revision":7,"trusted":true,"payload":{"remaining_kg":220,"cool_remaining_kg":50}}'
```

## `POST /v1/decisions/{id}/review`

Header: `X-Relay-Sandbox-Role: supervisor`. **Not real authentication; sandbox only.**

```json
{
  "decision": "approve",
  "reviewer": "Synthetic cargo supervisor",
  "expected_snapshot_version": 2,
  "idempotency_key": "unique-review-request-123",
  "reason": "Tentative routing accepted for internal planning"
}
```

Returns `APPROVED_SIMULATION_ONLY` and IDs of four dependent local tasks per tentative reroute. Current snapshot must equal the evaluation version, otherwise **HTTP 409**. No actual booking, customs, loading, reroute or physical instruction is executed; the human approval is necessary but **not sufficient** for execution in a real cargo environment.

## `GET /v1/operations/tasks`

A local simulation outbox. Each task contains department, task type, dependency, target shipment, proposed itinerary, a flag requiring external booking confirmation, and `physical_execution_permitted:false`. Task types are `RECONFIRM_BOOKABLE_CAPACITY`, `CHECK_ULD_AND_BUILDUP_FEASIBILITY`, `PREPARE_CHANGE_REQUEST_NO_PHYSICAL_MOVE`, `PREPARE_CUSTOMER_EXPLANATION_NOT_SEND`.

`POST /v1/operations/tasks/{task_id}/ack` requires header `X-Relay-Sandbox-Role: ground` or `supervisor` and JSON `{ "worker":"Demo team", "status":"DONE", "idempotency_key":"task-complete-001" }`. `DONE` checks that any upstream task dependency is completed first. This does not change the flight inventory or physical shipment status.

## `GET /v1/customer/track/{awb}`

Only synthetic waybill identifiers are accepted. Returns `observed_milestones` (event UTC, receipt UTC, airport, source), `estimated_arrival_utc`, an illustrative `eta_uncertainty_window_utc`, `eta_status`, `customer_service_message`, `recovery_updates`, `data_label`, and `no_operational_commitment:true`. No internal prices, solver bounds, model risk penalties, other clients' shipments or human logs. **The API is not actually authenticated**; production clients must add per-tenant authorization.

## `GET /v1/digital-twin/state`

Returns scene ready structures: `flights`, `shipments`, `ulds`, `terminal_capacity_fraction`, `scene_nodes` in illustrative meters, `latest_2d_uld_placements` with synthetic 2D x/y and dimensions, `ground_tasks`, version and data freshness. Scene coordinates are schematic and MUST NOT be presented as the real Cathay City, ramp or terminal floorplan.

## Realtime streams

`GET /v1/logs?category=INPUT|PROCESS|DECISION|OUTPUT&limit=80` returns durable log sequences. `GET /v1/stream?after=0` produces SSE messages with incremental `id`, `event`, and `data` JSON. Frontend should persist last sequence and recover by polling `/v1/logs` if it disconnects. Real production needs proper filtering, authentication, bounded retention, and replay cursors.

## `POST /v1/simulator/tick`

`{ "advance_seconds":40, "seed":27, "auto_evaluate":true }`: moves virtual UTC clock forward, samples a seeded event conditioned on the latest simulated state, records it as a trusted **synthetic source**, and reruns the math engine. Does not continuously run by itself; a frontend timer can call this endpoint. Supports 1–7200 seconds per tick. Rate sliders belong to the frontend or a future simulation scheduler.

## `POST /v1/benchmark/paired`

Request: `{ "decision_id":"DEC-...", "runs":10000, "seed":2026 }`. Returns **computed** same-draw synthetic scenario outcomes, mean costs, mean paired savings, conditional Monte Carlo confidence bounds and cases RELAY was worse. It *does not* run 10,000 MILPs and *does not* estimate any real Cathay operational saving.

## Errors and versioning

- HTTP 422: invalid time, unknown selected shipment, unbounded requested sample, invalid payload.
- HTTP 404: unknown decision/waybill/task/entity.
- HTTP 403: missing simulated staff role on protected local actions.
- HTTP 409: duplicate ID with conflicting content, concurrent/stale review, invalid task transition or clock rewind.
- The contract is currently `/v1`. Schema changes require semantic versioning, reproducible golden responses and backward-compatibility tests before external integration.
