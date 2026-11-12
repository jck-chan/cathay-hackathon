# RELAY v3.1 → v4: critical audit, research validity and operational gaps

## v3.1 baseline assessment (engineering judgment, not Cathay endorsement)

| Dimension | v3.1 /10 | Explanation |
|---|---:|---|
| Mathematical research formulation | 7.5 | All three research proposals have executable, scoped mathematical components. |
| Model I fidelity | 3.0 | Independent bounded 2D candidate batches, NOT aircraft 3D, restraint, approved operations. |
| Model II fidelity | 4.5 | Exact finite one-step Bayes; fixed PIVOT outcome in the old live queue was not continuous belief updates. |
| Model III fidelity | 6.5 | Real enumerated MILP with synthetic capacity/CVaR; incomplete real route catalog and certification. |
| Input realism | 3.0 | Structured synthetic 30-day UTC-second-resolution history; NOT Cathay telemetry or calibrated probabilities. |
| Event architecture | 6.0 | As-of projection, source/revision, immutable events; old live queue separate from canonical network. |
| Cross-model integration | 2.5 | 3D queue had its own generated job IDs unrelated to Model II/III shipment IDs. |
| Solver speed and robustness | 7.5 | v3.1 resolved live solver timeout using exact special-case enumeration, not true global scale. |
| Governance | 5.0 | Approval and simulated task workflow present, but local unauthenticated shortcuts, no real carrier confirmation. |
| 3D UX | 6.0 | Convincing schematic visuals, but not a true geospatial/physical process digital twin. |
| B2B tracking | 4.5 | Customer-safe projection but not real event provenance/ETA calibration/notification. |
| Benchmark validity | 3.0 | The published 10,000 draws are synthetic conditional resamples; not 10,000 end-to-end reoptimizations. |
| Real production readiness | 1.5 | No real operator data, routing/ULD certification, staff authorization or approvals. |
| Hackathon demo potential | 7.0 | Strong research story with explicit limits; easily overclaimed if presented without boundary disclosures. |

Overall *real-world maturity* about 4.5/10. Demo potential about 7/10.

## Audit findings in actual v3.1 code

- `live_sim.py::LiveCargoWorld._new_job`: generates synthetic `CX-SIM-*` independently of the `SYN-S*` canonical v2 shipment catalog; v2 network decisions cannot cause those particular queue shipments to re-route.
- `live_sim.py::LiveCargoWorld.__init__`: calls `pivot_exact` only at startup. Its action is not a live per-AWB Bayesian posterior updated on incoming warehouse events.
- `live_sim.py::_new_job/_schedule`: assigns fixed Model I synthetic scenario losses as independent job blockers and a separate latent mismatch penalty. It does not solve full physical arrangement for each displayed cargo item. Apparent relative performance can be partially baked into the simulation assumptions.
- `relay/engine.py::_physical_diagnostics`: segments pieces into independent batches of four and evaluates finite 2D candidates, not a unified aircraft-compatible load.
- `relay/engine.py::_uncertainty_controller`: one-step verification advice on uncertain shipments only; does not represent general sequential semi-Markov POMDP control from Model II paper.
- `relay/routing.py`: MILP optimizes only known enumerated routes and synthetic capacities. Does not grant airline booking, ULD contour or DGR approval.
- `relay/simulator.py::paired_benchmark`: each draw resamples stored scenario losses; no 10,000 independent network MILP solves.
- `fusion_app.py::network_scene`: explicitly marks planning-stage proposals as simulated movement only; these are not observed cargo motion.

## What v4 materially changes

1. Main UI, customer portal, work orders and three-model optimizer are all served from **one v4 isolated Store** and one simulation clock; same `SYN-S*` IDs across all views.
2. Both staging dispatch policies use the SAME observable work-order releases, durations, resource bounds and safety gates. No hidden actual dimension error is fed directly into just the optimized policy. The policy uses observable priority, slack, age and modelled global unresolved risk.
3. Typed synthetic cancellation, inventory and dimension events are appended to the **same event ledger**, immediately triggering full Model I/II/III replanning, with strict source, timestamp and snapshot version.
4. Hard holds suspend affected active staging tasks in both comparator worlds. No staging completion is called physical loading or carrier acceptance.
5. One-click, visible incident/review/customer/benchmark actions; no Swagger/JSON knowledge required. Existing v3.1 3D theatre remains under `/show` for comparison only.
6. 2D candidate-library ULD placement, model II case decisions and Model III route candidates are shown side-by-side with their validity/certification limits.
7. Benchmarks compare equal-event work-order policies without hard-coding performance advantages; output discloses scope and CI.
8. New regression and HTTP/UI-wire tests cover canonical data linkage and approval boundaries.

## What v4 does NOT fix — a serious production-gap register

### P0: before any airline pilot with real operations

- Written data contracts for shipment/piece/ULD/flight/job status, field authority, freshness, units and clock skew.
- Real-time **bookable** cargo inventory vs OAG schedule/maximum aircraft tonnage; quotes != holds != bookings.
- ULD contour, support/restraint, aircraft position compatibility, load-control envelope, DGR and cold-chain operator restrictions. Must use approved rules/validators, and explicitly fail closed on missing authority.
- Confirmed operational workflow: when cargo is received, built, sealed, loaded, departed, arrived, customs cleared; which acts are irreversible and which need a human.
- Authenticated roles, approvals, audit signatures, operator confirmation, idempotent transactional outbox, compensation on partial failures, rate limiting and customer tenancy.
- Calibrate delay, rejection, inspection quality, handling/task durations, prices/penalties and event correlations with consented historical records. Track uncertainty and data quality; no invented precise probabilities.

### P1: for a persuasive pilot benchmark

- Pair actual counterfactual policies on logged decision epochs; use offline replay/digital shadow before any actuation.
- No double-counting cost across Model I/II/III; shared cost ledger with physical units/currency and approved service priorities.
- Explicit capacity reservation state machine: available → quoted → held → internally approved → carrier confirmed → assigned → operated.
- Model III physical feasibility callbacks from Model I for EVERY chosen route/ULD, or mark as conditional, not actionable.
- Full Model II sequential semi-Markov controller with state belief and correlated observation kernels, independent likelihood calibration, option cutoffs and confidence limits.
- Screen deadlines and SLA outcomes on actual service delivery, not staging completion; report negative cases and bias confidence intervals.
- Scale tests: >1000 simultaneous shipments, 1000+ concurrent live updates, correct gap/timeout fallback behavior, warm start/incremental solves and performance SLOs.

### P2: after formal feasibility validation

- Genuine airport-ground 3D facility coordinates, RFID/scanner event inputs, path planning, multi-ULD geometry and handling resource scheduling.
- Customer consent, opt-in push notifications, partner SLA dashboard, observed-vs-predicted ETA provenance and model drift monitoring.
- Proven incremental benefit of cluster/Graver proposals against strong ILP/column-generation baselines; do not imply algebraic encodings automatically outperform MILP.

## Representative external technical grounding

- Cathay Cargo's public API describes Quote, Booking, Booking Details, Cancel, ONE Record Track & Trace and Push API; testing requires an approved account.
- IATA ONE Record defines object/event exchange, revisions, authorization and immutable events.
- IATA ULD Regulations cover operational safety, restraint, handling and ongoing airworthiness; 2D placement is insufficient.

References: https://www.cathaycargo.com/en-us/help-and-support/cathaycargo-APIs.html ; https://iata-cargo.github.io/ONE-Record/ ; https://www.iata.org/en/publications/manuals/uld-regulations/
