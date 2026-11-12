# OAG Developer Portal → RELAY, with honest flight-data semantics

## Official public sources checked

- OAG Developers landing and API products: https://developers.oag.com/
- Flight Info v2 developer guide and flight-instances: https://developers.oag.com/guides?api=flight-instances
- Product changes / schedules and cargo: https://developers.oag.com/whatsnew
- Schedule changelog: https://developers.oag.com/apis/schedules/changelog
- Flight Info Alerts & push migration: https://knowledge.oag.com/docs/flight-info-alerts-migration-fv-batch-aadoptimal

The precise API entitlement, request quotas, supported query parameters and licensed payload fields must be verified inside the **team's own OAG account** before connecting. Public docs show a `flight-instances` route under `https://api.oag.com`, API header `Subscription-Key`, JSON `data[]`, flight/carrier/airport codes, times, statuses and paging. The exact product, tier and environment may differ. The OAG Portal is an external evidence provider, not Cathay's internal cargo booking authority.

## v5 implementation — SYNTHETIC PREVIEW ONLY

`oag_bridge.py` reads up to twelve synthetic flights from RELAY's own canonical catalog and emits an *illustrative* OAG Flight Info v2-shaped `data[]` envelope. A clearly labeled `demoMappings` crosswalk maps generated `CX 2000+` flight numbers to the original synthetic `SYN-*` IDs. This is an artificial demonstration key; **never join live flights on it**. An example:

```json
{
  "data": [
    {
      "carrier": {"iata": "CX"},
      "flightNumber": 2000,
      "departure": {"airport": {"iata": "HKG"}, "scheduledTime": {"utc": "2026-11-10T02:00:00Z"}},
      "arrival": {"airport": {"iata": "NRT"}, "scheduledTime": {"utc": "2026-11-10T06:00:00Z"}},
      "statusDetails": [{"state": "Scheduled"}],
      "statusKey": "SYNTHETIC-OAG-STATUS-0000"
    }
  ],
  "paging": {"limit": 1},
  "source": "SYNTHETIC_OAG_SCHEMA_ILLUSTRATION_NOT_OAG_SUPPLIED"
}
```

**This example is an invented illustration**, not an OAG response, booking quote or guarantee that every listed field appears together in a licensed API response.

Parser output includes flight identity, UTC schedule, optional state, raw status key and **hard-coded unknown fields**:

```json
{
  "remaining_bookable_cargo_kg": null,
  "booking_confirmed": false,
  "physical_load_certificate": false,
  "evidence_status": "EXTERNAL_OBSERVATION_NOT_CARRIER_CONFIRMATION"
}
```

Those three fields must **never be inferred** from OAG schedules, aircraft type, `cargoTonnage`, flight operation status or airport connection availability. `cargoTonnage` is informational schedule metadata, not Cathay's remaining bookable space.

## Interface endpoints

| Endpoint | Operation |
|---|---|
| `GET /v5/api/oag/sample` | Return source-labeled synthetic preview and normalized sample |
| `POST /v5/api/oag/normalize` | Validate sample/envelope; reject non-UTC time, incomplete flight identities, invalid types, duplicate flights, >100 records |
| `POST /v5/api/oag/observe` | Set an **unverified synthetic external indicator** `Scheduled/Delayed/Canceled`; make current review stale; never mutate booked inventory |
| `GET /v5/api/oag/status` | Return stored mock observations and revision |

No request above uses OAG credentials, licensed data, network access or actual airline commands.

## What actual authorized integration should do

1. Receive OAG developer portal access, verify contract/tier and allowed flight info/schedules/alerts/products (including cargo service-type and connection fields as available). Obtain explicit rights for testing, storage and refresh frequency.
2. Keep `Subscription-Key` only in a backend environment variable / secret manager; never put it in HTML, JavaScript, localStorage or a public repository. Use HTTPS, egress policy and request/response redaction.
3. Query **flight instances** with appropriate departure date, airport, arrival airport and status filters, using official API-specific parameter names. Consume paging and/or webhook alerts following account-specific docs.
4. Parse and persist raw payload, source ID/statusKey, event-effective UTC time, API retrieval/receipt time, source revision, body hash and vendor license field policy. Reject malformed/duplicated payloads; do not re-order late observations by arrival time alone.
5. Use an **authoritative flight identity map** matching carrier, number, service date, origin/destination, operational leg and verified operator mapping. Never identify a Cathay shipment's capacity by coincidentally matching airport/date.
6. Distinguish scheduled, estimated and actual events and freshness; trigger human review on contradictions or aged external signals. Do **not** convert a suggested delay into a real cancellation without authority.
7. Maintain **separate carrier-internal supply state**: confirmed available cargo kg, ULD compatibility, booked allotments, handling eligibility, ground release, customs/DG state. Only internal approved systems should mutate these.
8. Generate feasible alternative paths via OAG schedules/connections as **candidates**. Validate minimum connection times, custody, special cargo acceptance, weather, station capabilities and internal booking confirmation. Every outcome remains tentative before independent confirmation.
9. Implement idempotent, rate-limited backoff/retry, failure handling, timeouts, caching & source freshness, and split offline synthetic/production test accounts; no graceful fallback should fabricate flight status.
10. Run offline/online shadow-mode evaluations using official authorized data before claiming actual predictive power, cost savings, or operational safety.

## Valuable OAG information for the three papers

| Feed concept | Model I | Model II | Model III |
|---|---|---|---|
| Schedule and connection graph | external timetable context | option deadline and potential expiry | alternate time-expanded candidate legs |
| Flight status/cancellation/delay | recourse scenario, **not** ULD certification | observational evidence, timing/value of verification | remove or penalize affected candidate arcs **after independent validation** |
| Alerts/push | state freshness | verification trigger | prompt replanning |
| Master airport/carrier/aircraft references | very limited geometry context | observation metadata | identity + transfer connectivity |
| Cargo tonnage / service-type metadata | not remaining ULD loading authority | indirect context only | candidate screening, **not** bookable kg |

## API example for a future authorized adapter (illustrative only)

```python
# Example boundary, deliberately NOT included as a callable live OAG implementation.
# Substitute actual account docs, terms and fields before enabling.
import os, httpx
headers = {"Subscription-Key": os.environ["OAG_SUBSCRIPTION_KEY"]}
with httpx.Client(timeout=8.0) as client:
    r = client.get("https://api.oag.com/flight-instances/", headers=headers,
                   params={"DepartureDateTime": "2026-11-10", "DepartureAirport": "HKG",
                           "ArrivalAirport": "NRT", "CodeType": "IATA", "version": "v2"})
    r.raise_for_status()
    # Store response with original source time, received time and authorization context.
```

The snippet is a **future integration sketch**, not evidence the server has been called or current OAG plan supports every shown query parameter.
