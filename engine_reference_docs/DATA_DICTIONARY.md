# Canonical 30-day synthetic dataset — field-level contract

**Dataset period (received-event window):** 2026-10-10T00:00:00Z ≤ `received_at` < 2026-11-09T00:00:00Z. Clock-incremental event generation starts at 2026-11-09T01:00:00Z. Historical context can include schedule/booking records created around the period boundaries, but the *observed-event training labels* are strictly within the above window. All timestamps are UTC RFC3339 at whole-second precision. Every dataset ID is fabricated.

## File schema

| File | Primary key | Important fields | Units / authority |
|---|---|---|---|
| `flights.jsonl` | `id` | `carrier`, `flight_number`, `origin`, `destination`, `scheduled_departure`, `scheduled_arrival`, `estimated_departure`, `estimated_arrival`, `status`, `remaining_kg`, `cool_remaining_kg`, `unit_slots_remaining`, `revision`, `capacity_authority` | All dates UTC; kg synthetic operator inventory; NOT OAG maximum cargo tonnage |
| `shipments.jsonl` | `id` | `awb`, `booking_id`, `client_id`, `piece_ids`, `origin`, `destination`, `created_at`, `accepted_at`, `deadline`, `weight_kg`, `service`, `handling`, `status`, `custody_state`, `booked_flight_id`, `assigned_flight_id`, `consent_to_split` | one waybill references 1 or 2 pieces; priority synthetic; no real customer identifiers |
| `pieces.jsonl` | `id` | `shipment_id`, `weight_kg`, `length_cm`, `width_cm`, `height_cm`, `special_handling`, `dimensions_verified` | cm, kg; no rotation/restraint certification |
| `ulds.jsonl` | `id` | `uld_type`, `usable_length_cm`, `usable_width_cm`, `max_gross_kg`, `tare_kg`, `availability`, `zone`, `model_scope` | simplified synthetic 2D footprint only |
| `historical_events.jsonl` | `event_id` | `event_type`, `entity_type`, `entity_id`, `event_time`, `received_at`, `source`, `source_revision`, `trusted`, `payload` | immutable event envelope; typed field-specific source authority |
| `latent_test_only.jsonl` | `date` | `latent_weather`, `congested` | **GROUND TRUTH FOR GENERATOR ONLY; must not be consumed by decision logic** |
| `manifest.json` | — | `seed`, actual record counts, start/end, quality labels | generated, not operator telemetry |

**Critical distinction:** Shipment booked/assigned flights and derived candidate flight routes represent *planning references*. None of the synthetic booking statuses are an actual Cathay hold, allotment, reservation, transfer clearance or airworthiness approval.

## Status taxonomy

- Flight provider: `Scheduled`, `OutGate`, `InAir`, `Landed`, `InGate`, `Canceled`, `Diverted`. **Delayed is a timeliness attribute**, not a parent flight status. Only the modeled schedule/estimate mutation can move `estimated_*` timestamps.
- Shipment: `BKD` booked, `RCS` ready for carriage, `DEP` departed, `ARR` arrived, `RCF` received into warehouse, `NFD` notified, `DLV` delivered. These mirror common Cargo iQ/FSU-style milestone *names*; this sandbox is **not** a Cargo iQ-certified implementation.
- Custody: `RECEIVED`, `BUILDING`, `SEALED`, `LOADED`, `DEPARTED`, `ARRIVED`, `DELIVERED`. Frozen stages are blocked from new packing/recovery actions; the prototype does not implement a whole GHA task system.
- Validation: `ACCEPTED` (matches demo field-specific source authority), `OBSERVED_UNVERIFIED` (quarantined from authoritative mutation), `QUARANTINED` (bad payload/entity or unknown ID).
- Model III: `OPTIMAL_ENUMERATED_MILP`, `FEASIBLE_UNPROVEN_MILP`, `FALLBACK_ALL_UNRESOLVED`, `NO_ELIGIBLE_SHIPMENTS`. `UNRESOLVED_ESCALATION` is never counted as successful service.
- Approval: `ADVISORY_ONLY`, `PENDING_REVIEW`, `APPROVED_SIMULATION_ONLY`, `REJECTED`; `QUEUED_SIMULATED`, `ACKNOWLEDGED`, `DONE`, `FAILED` for local task records. None is a live booking confirmation.

## Source-of-truth matrix (synthetic sandbox)

| Field / mutation | Allowed demo source | External data handling |
|---|---|---|
| Flight delay, cancellation, restoration | `SYNTHETIC_FLIGHT_OPS` | OAG status can be ingested as an **unverified observation**; no cargo inventory claim |
| Bookable `remaining_kg`, `cool_remaining_kg` | `SYNTHETIC_INVENTORY` | Never inferred from aircraft cargoTonnage |
| Shipment dimensions, verification | `SYNTHETIC_MEASUREMENT` | Conflicting records block execution; explicitly require inspection |
| Shipment status/milestones | `SYNTHETIC_TRACK_TRACE` | Received UTC timestamp and source captured |
| Booked route confirmation and customer service | `SYNTHETIC_BOOKING` | Booking request, quotation and confirmation are distinguished |
| Terminal work resources | `SYNTHETIC_GROUND_OPS` | Congestion persists only for a bounded event duration |
| ULD status | `SYNTHETIC_ULD_OPS` | Flight airworthiness/ULD repair records remain external |
| Customs restrictions | `SYNTHETIC_CUSTOMS` | No optimization through customs hold |

`trusted:true` is **not** sufficient alone. `relay/store.py` checks both the event type and approved synthetic source name. This is a local demonstration of provenance; it is **not cryptographic authentication**. Real providers require signed webhooks, scoped credentials, verified identities, nonce checks and contractual authorization.

## Example event

```json
{
  "event_id": "SYN-E-BOOK-101",
  "event_type": "capacity_changed",
  "entity_type": "flight",
  "entity_id": "SYN-F30-02",
  "event_time": "2026-11-09T01:12:35Z",
  "received_at": "2026-11-09T01:12:40Z",
  "source": "SYNTHETIC_INVENTORY",
  "source_revision": 2,
  "trusted": true,
  "payload": {"remaining_kg": 280, "cool_remaining_kg": 80}
}
```

### Structured external-data adapters for future engineering

**Cathay Cargo Quote/Booking/Booking Details:** access-dependent. Store independently `quote_id`, `flight_key`, `quoted_remaining_kg`, `quote_expires_at`, `allocation_state` (`QUOTED`, `HELD`, `CONFIRMED`, `REJECTED`), `booking_revision`, `source`, `received_at`, `operator_rights`. **Never create `CONFIRMED` from OAG flight schedules.** This release intentionally does not call a real Cathay API.

**OAG Flight Info:** preserve flight `scheduleInstanceKey`, operating carrier, flight number, scheduled departure/arrival UTC, estimated/actual timestamps, `state`, updatedAt and source revision. Map `Canceled` as external evidence until reconciled. `cargoTonnage` is a maximum freight-capacity descriptor, **not the same field** as confirmed bookable inventory.

**ONE Record 2026-07:** model `Shipment`, `Piece`, `Waybill`, `Booking`, `TransportSegment`, `ULD` and immutable `LogisticsEvent`, retaining object identifiers and source/permissions. Our JSONL is a **canonical internal model inspired by this structure**, not JSON-LD ONE Record protocol compliance.

## Probabilities / correlation / simulation

- Historical generator samples a persistent hidden day-level weather/ground-congestion regime, then conditionally changes flight-delay, cancellation and cargo discrepancy outcomes. This generates correlated events **without** using real Cathay observations.
- Estimated rates use counts of only events whose `received_at` precedes the decision's `as_of`, with explicit Beta-style smoothing `(events + 1)/(exposures + 20)`. This is a **design choice**, not a statistically validated estimator for airline operations.
- Test quality is explicitly limited: verification sensitivity 0.90 and false-positive 0.20 are assumptions; three-route-loss scenario probabilities are constructed heuristically from synthetic rates; handling minutes, customer penalties, weather/ground impacts and cost units are synthetic.
- Historical latent truth and future event outcomes must never be joined into an `as_of` state. The manifest/test suite checks this property.
