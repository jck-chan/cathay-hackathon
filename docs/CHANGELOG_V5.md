# RELAY Fusion v5 — Changes from v4

## Correctness and truthfulness

- Replaced misleading Model II cost provenance label (`SCENARIO_MILP_ROUTE_COSTS`) with `LOCAL_CANDIDATE_ROUTE_COST_PROXY_NOT_JOINT_MILP`. One-step Bayes identity remains a valid result within the *local proxy* and presumed observation model.
- Added explicit decision scope: all eligible shipment count, selected max 24, omitted IDs, selection priority and bounded optimality label. No claim of optimizing all queued shipments.
- Extended review gating with *external-evidence revision*: after a synthetic flight status observation, a previous review is stale; a conflicting tentative route is disallowed even after re-evaluation until independent airline confirmation.
- Separated OAG-like public flight signal from synthetic airline internal cargo inventory. Public status records cannot mutate remaining kg or mark anything booked.
- Added live non-mutating audit endpoint for canonical catalog integrity, cross-model proposal invariants, posterior identity, schema and explicit four unmet production requirements.

## UI / UX

- Replaced primary root UI with a coherent 4-stage “Live Operations → Disruption/Math Decision → Human Review → Customer Shipment” guided journey, with linked anchor sections and real API actions.
- Preserved dual 3D/isometric simulator; made data-coverage and truth labels visible near outcomes rather than hidden in docs.
- Added inspectable source/calculation/decision evidence, a user-readable OAG data preview and explicit external-warning gate, and an “Integrity Audit” section.
- Provided dedicated v5 customer page with the same synthetic AWB and reviewed status; kept `/v4` as a legacy comparison and `/show` for original showcase.
- Improved mobile guidance header spacing; verified no horizontal overflow at 390px with static Chromium HTML/CSS screenshot.

## Tests and docs

- New `tests/test_v5_contracts.py`: 17 new tests; total Python regression **78/78** passed, including explicit independent CVaR, one-step Bayesian, small MILP enumeration, and bounded ULD checks.
- Browser-free Node.js HTTP/DOM integration driver verifies new guided buttons against a running local server; static desktop/mobile Chromium layout screenshots additionally captured.
- Added publication-quality **limitations** and references in `docs/V5_AUDIT_REPORT.md`, `docs/THREE_PAPERS_TRACEABILITY.md`, `docs/OAG_DEVELOPER_PORTAL_INTEGRATION.md`, `docs/FRONTEND_USER_GUIDE.md`, `docs/QA_V5.md`.
- Windows launcher checks dependencies without importing application as part of installation; this avoids masking app logic errors as missing pip dependencies.

## Unchanged important boundaries

- Not the full Model I/II/III theorem pipeline; 3D safety, full multi-stage Bayes and certified Graver search remain missing.
- Does not contact OAG or Cathay and must not be public-facing; all keys, bookings, capacities, ETA, costs and business benefits remain synthetic.
