# Production gap register — CTO acceptance gates

**Do not confuse a technically working optimizer with an authorized aviation operations system.** This register is intended to prevent seemingly impressive numerical outputs from being mistaken for safe, implementable instructions.

## G0 — Blocking for any real operational write

| Issue | Current implementation | Before real Cathay use |
|---|---|---|
| **True live inventory** | Simulated `remaining_kg`, not OAG cargoTonnage | Operator-authorized remaining/allocatable inventory with holds, allotments, revisions, expiry, carrier approval and race control |
| **Full 3D ULD safety** | Four 2D flat cells; no aircraft moment/CG restraint model | Approved ULD contours, aircraft-position compatibility, support/restraint/net limits, centre of gravity, DG segregation, dynamic reweigh/dimension measurements, signoff by qualified load control |
| **Customs/security/DGR** | DGR excluded, customs hold blocks | Official classification, screening, customs status and legal control planes. Never use probabilistic relief for hard restrictions |
| **Irreversible state / operations** | `RECEIVED` vs locked custody gate; simulated tasks only | Real milestones for built/sealed/loaded, safe abort/compensation workflow, verified rollback rules and emergency stops |
| **External confirmation** | Approval creates *draft* tasks only | Booking request/hold/commit handshake with signed confirmation, post-commit reconciliation, idempotency at provider, conflict/timeout resolution |
| **Approval / RBAC** | Spoofable local role header, no tenant auth | Enterprise SSO, genuine authorization, dual control as required, signed traceability, audit retention and privacy/supplier approval |
| **Evidence authority** | Synthetic whitelisted string sources | Provider signed webhook/HMAC/mTLS/OAuth, field-level mapping, signed version, idempotency, replay protection, clock skew, retention, SLA and freshness checks |
| **Safety/cost validation** | Synthetic partial constraints and costs | Cargo Operations, GHA, Cargo Revenue, Risk/Compliance agree every hard rule and failure mode; independent shadow pilot and holdback approval |

## G1 — Needed for a credible internal pilot

| Issue | Workstream | Suggested acceptance test |
|---|---|---|
| 30-day synthetic ≠ statistical calibration | Data Science + Cargo Ops | Historical real case sample with outcomes, systematic missingness, correlated weather/ground delays, separate holdout window |
| Verification kernel not calibrated | Warehouse + Quality | Inspection sensitivity/specificity and latency by subtype; calibration curves, Brier/log loss, drift alarms |
| PIVOT only one step | Applied OR | Finite horizon semi-Markov controller with expiry/inspection/approval joint kernels; test rollback, timeouts and nonanticipativity |
| Network route set incomplete | Cargo Commercial/Operations | All permitted carriers, freighters, interline capacity, special handling, GHA/customs, truck alternatives and published cutoff accuracy |
| Stochastic scenario simplification | Quant Research | Block-bootstrap/conditional scenario model; actual rare tail-event validation, scenario reduction with out-of-sample CVaR |
| 3D scene topology is illustrative | Technical Engineering + Airport Ops | Geo/coordinate, aircraft turnaround, handling path and zone layouts approved, no real-property misrepresentation |
| `unit_slots_remaining` not hard enforced | Cargo Network Planning | Multi-ULD mixed-piece loadability + actual aircraft ULD position and compartment allocation to replace kg proxy |
| Shipping customer tracking | Customer Experience | Per-client access controls, consent, notifications on confirmed recovery only, ETA calibration, reason-code translation, journey testing |
| Combinatorial optimization scalability | SRE + OR | 100/1000/10000 shipments; p50/p95/p99 latency under disruptions; memory, tenant isolation, timeout and safe fallback |
| Failure handling | SRE | Database outage, delayed source, partial batch, provider timeout/retry, concurrency stress, failover and disaster recovery |
| Solver impartiality | Model Governance | Baselines with identical information/resources; no peeking at future events; monetary cost terms audited by Finance; negative-case reporting |

## G2 — Research enhancement, not a block to basic decision support

- Full Graver basis or cluster exchange discovery, shown to improve runtime/quality **beyond** established MILP/column generation on meaningful airline instances. Today the integer fixture is correct but not a production algorithm.
- Column generation/branch-and-price with admissible dual prices; correct exact lower bounds, valid Benders cuts and mathematical guarantees.
- Learned routing/scheduling heuristics paired with a complete deterministic guard; LLM can explain logged evidence but MUST never define hard safety constraints or issue commands.
- Robust or distributionally robust optimization when true rare-event distribution is unknown; meaningful empirical safety and regret tests rather than self-certified guarantees.

## Role of real provider APIs

**Cathay Cargo published APIs** include Quote, Booking, Get Booking Details, Cancel Booking, ONE Record Track & Trace and Push. Their production/testing access explicitly requires Cathay approval. A generic OAG subscription is not a substitute for sellable/held/confirmed inventory.

**IATA ONE Record:** July 2026 endorsed API 2.3.0 / ontology 3.3.0; immutable logistics events and data-owner permissions are relevant. Our internal JSON format is not a certified implementation of its API.

**GHA / cargo terminal:** Technical details of staffing, actual work-order scheduling, freeze points, 3D build-up and PPE/equipment need operational data. None should be reverse-engineered from a public photo or a fabricated flight capacity figure.

## Safe migration path

1. `READ_ONLY` simulator: validate events and statuses, no dispatch or customer notifications.
2. Historical replay/shadow mode: frozen historical snapshots, independent operational outcome truth, no future leakage; compare baselines.
3. Human-in-loop staging: show proposals to authorized operations staff with real time cutoffs, errors, manual veto, and audit; no actual commitments.
4. Sandboxed partner APIs: test hold / reject / expiry / booking statuses; reconcile and roll back failed effects, still nonproduction.
5. Approved pilot: formal safety/compliance/regulatory signoff, authentication and security review, fallback, operational runbooks, monitoring, defined incident response and measured KPI acceptance.

At every stage, an explicit `UNKNOWN` is safer than silently filling missing data with a convenient fabricated number.
