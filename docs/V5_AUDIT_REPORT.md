# RELAY v5 — Independent-style engineering & research validity audit

**Review scope:** Source code inherited from RELAY v4; mathematical modules `relay/{models,engine,routing,state,store}.py`; simulation `unified_lab.py`, `live_sim.py`; new audited control tower `v5_lab.py`, `oag_bridge.py`, `static/v5*`; five JSONL catalog files; existing and new tests. This is a source-based test and structural review, not third-party certification or access to airline operational truth.

## 1. Executive verdict

**Sensible bounded research decision-support prototype? Yes. Production-ready autonomous Cathay Cargo optimizer? No.** Mathematical derivations in the research papers exceed the scope of the implemented optimizers. The software chooses numerical plans with honest caveats. Operator-facing reliability means *fail closed when information is insufficient*, not merely optimizing synthetic cost.

The essential progress over v4 is (i) truthful numerical provenance for Model II; (ii) explicit evaluation scope and exclusion list; (iii) data-quality and runtime invariant audit API; (iv) OAG public-schema-shaped adapter with no fake carrier inventory; (v) independent small-model oracles and hostile-input tests; (vi) four-step UX and new evidence/observability page.

## 2. Algorithm and model examination

| Claim / input | Real implementation | What can correctly be concluded | Missing before production |
|---|---|---|---|
| Model I recovery-aware ULD arrangement | Permute up to four small 2D floor pieces per diagnostic batch, evaluate synthetic access costs and discrete CVaR within nominal cost slack | Exact optimum in its **candidate library**; nominal-budgeted risk objective non-degradation | 3D solids, contour, safety margins, mass distribution, restraints, stacking, DG, real recovery handling sequences, airline load certification; sequential coupling to routing |
| Model II verification value | Explicit finite observation/error/expiry mass; evaluate prior/posterior action costs; verify exact decomposition | One-step Bayes algebra and cost identity valid under assumed sensor and **local** action costs | Full semi-Markov POMDP, verification queue, real sensor calibration, joint scenario MILP re-solve per post-observation branch, authoritative confirmations |
| Model III cargo network recovery | Binary path-choice MILP with shared synthetic flight kg, cold kg and hourly slots, risk scenarios and unserved penalty; SciPy HiGHS | Numerically optimal relative to **enumerated columns**, given all included shipments and synthetic capacities | Comprehensive candidate generation/pricing, actual network data and MCT, certified ULD & DG safety, real operator available inventory/confirmations, fully nonanticipative multi-stage recourse |
| Cluster/Graver exchange | Separate algebraic/test fixture | Shows an isolated mathematical identity, not a production speedup or proof of optimum | Certified kernel exchanges, proven bounded search, benchmark against exact MILP, no false speedup claim |
| Live staging vs mathematical models | Shared catalog IDs, event store and clock; separate simplified dispatch policy, not actual ramp/cargo execution | Tests operational controls and visualizes current synthetic queue | Directly bind certified flight/ULD work instructions to physical equipment and process telemetry |
| Historical model | 30-day internally coherent generated records | Replayable structured data; synthetic posterior & scenario examples | Measured empirical distributions, timestamp freshness, seasonality, label/selection bias, missing/censored observations, cost calibration |
| `Model II` route cost provenance | Local function `route_costs` used per alternative, not scenario joint MILP | Corrected to `LOCAL_CANDIDATE_ROUTE_COST_PROXY_NOT_JOINT_MILP` | True nested optimization, capacity-opportunity cost, branching consistency |

**Notable v4 misstatement fixed:** The phrase `SCENARIO_MILP_ROUTE_COSTS` was not an accurate description of the Model II counterfactual cost computation. This is a *scientific validity* issue, not merely a copy-edit.

## 3. Cross-model interaction and gate logic

Intended: evidence snapshot → geometry candidate feasibility → network/route optimization → Bayesian choice to verify/hold/recover → operator approval → tasks → customer projection. Existing implementation actually runs I and III as partly independent analyses, then II as a per-shipment gate. This is a partial integration. **There is no full outer stochastic optimization over all I/II/III decisions with guaranteed joint consistency of packing and routing.**

Observed/tested invariants:
- All dual-world admissions refer to canonical shipment IDs; same input set to FCFS and RELAY.
- Unverified dimensions and customs conflicts are blocked from relevant proposed route changes.
- Proposals are always tentative, not booked. Real command count is zero.
- Review rejects stale snapshot decisions. v5 mock external observations advance an external evidence revision, invalidate review, and block conflicting route approval even after reevaluation until independently confirmed.
- Shipment evaluation cap is **24**; excluded IDs are reported rather than claiming all-network optimality.
- The external OAG-type observation does **not** silently write remaining kg, cold capacity or confirmed booking.

**Remaining interaction weakness:** a Model II hold is applied as a shipment gate after the route MILP. The MILP may optimize capacity for a held shipment that is later omitted from action proposals; the optimum does not necessarily apply to the post-gate *executable subset*. This requires an iterative or integrated optimization with consistent fixed/blocked decisions. Under the current implementation, do **not** sell Model III optimum as the best directly executable global workflow.

## 4. Input-data verification

Synthetic canonical catalog counts: **429 flights**, **636 shipments**, **793 pieces**, **14 ULDs**, **5,120 historical events**. Automated checks cover duplicate IDs, shipment-piece membership, weight sums, assigned/booked flight references, origin matching, scheduled departure-before-arrival, event-time ≤ receipt-time, positive piece dimensions/mass, synthetic capacity authority. Each passed in local catalog.

**What these tests do NOT prove:** real flight schedule plausibility, booking-capacity accuracy, real ULD contour, actual warehouse layout, dangerous goods compatibility, airport-specific handling minima, realistic correlated weather, actual cargo demand distributions, true calibration of verification sensitivity/false positive, or representative economics. Synthetic plausibility is neither historical accuracy nor certification. Best-case benchmark savings may be sensitive to arbitrarily chosen arrival/service/delay and penalty distributions.

## 5. Input / processing / output log integrity

1. **Input logs:** use IDs, `as_of` snapshot, event source and receipt-time-bounded reconstruction. Note: any adapter later ingesting real OAG records must persist raw payload, received time, OAG status/effective time and provenance independently; current mock layer does not claim ingest persistence.
2. **Process logs:** report actual Model I bounded-2D status, batching, Model III HiGHS status and gap, Model II posterior/verification identity; corrected counterfactual cost-proxy provenance; explicit model cap and synthetic calibration.
3. **Output logs:** distinguish `PROPOSAL_NOT_BOOKED`, simulated review and work orders, customer-facing observed vs projected milestones. Do not translate simulated approval into flight or load-control confirmation.
4. **Evidence limitations:** v5 `/v5/api/evidence` is an audit projection, not tamper-evident immutable signed ledger. Several UI simulations share process memory and a local DB; auth, durable external ingestion and multi-worker consistency remain unbuilt.

## 6. OAG and external source trust boundary

OAG Flight Info v2-style schedule/status or alerts can indicate *potential* flight disruptions and enrich alternate-route discovery. Schedules, cargo tonnage metadata and connections do NOT establish available airline cargo inventory or confirmed space for the shipment. OAG sources must remain observational; an airline-authorized system must determine capacity, booking, hazardous goods acceptance and operational release.

The v5 generator produces **entirely synthetic** Flight Info-shaped objects and an explicit demo flight-ID crosswalk; it makes zero network requests and has no OAG API key. Its normalizer is a strict *public field subset*, not a contractual OAG conformance certification. Some OAG products/version payloads might use different fields, which must be verified with account access.

## 7. Security and production risks

**Critical** — Never deploy this app to a public IP: it has synthetic admin-review controls without authentication. Real deployment would require SSO/RBAC, least-privilege dual-control for high-risk actions, per-tenant AWB authorization, PII masking, audit retention, secrets management, key rotation, API throttling, comprehensive operational monitoring and secure external integrations.

**Critical** — No aircraft safety certification / booking authority. Fail-safe `HOLD` and independently validate physical feasibility before generating ground commands.

**High** — Model I/III joint consistency, withheld shipment allocation, counterfactual inspection opportunity cost, and true route availability.

**High** — Empirical cost and delay calibration, missing/censored data handling, source freshness, event replay and load testing on real network sizes.

**Medium** — Visual semantics, human cognitive workload, accessibility, staff acceptance and incident-specific customer copy.

## 8. Scores (engineering judgment, not official evaluation)

| Dimension | v4/10 | v5/10 | Rationale |
|---|---:|---:|---|
| Research foundation | 7.5 | 7.5 | Sound problem framing; implementation partial |
| ULD physical safety / Model I | 3.0 | 3.0 | Bounded 2D only |
| Bayesian verification / Model II | 4.5 | 5.0 | Honest provenance and gates; not sequential |
| Global network MILP / Model III | 6.5 | 6.5 | Bounded exact solve, not full network |
| Input referential integrity | 6.5 | 8.0 | Explicit executable audit and replay checks |
| Empirical Cathay data realism | 3.0 | 3.0 | Entirely synthetic |
| Cross-model decision integrity | 4.0 | 5.5 | Explicitly capped and better verified; still staged gates |
| External network data design | 2.0 | 5.5 | OAG-shaped mock & authority boundary, no credentials |
| Source/process/output transparency | 5.0 | 8.0 | Evidence and provenance corrected |
| Human review safety in sandbox | 5.0 | 7.0 | Snapshot + external revision fail-closed checks |
| Frontend clarity / UX | 6.0 | 8.0 | Four guided steps, cause/effect explanation |
| Statistical/ROI validity | 3.0 | 4.0 | More explicit caveats, not actual historic ROI |
| Real production readiness | 1.5 | 2.0 | No auth, real data, safety certification |
| Hackathon demo value | 8.0 | 8.5 | Better operator story, truth and interaction |

**Bottom line:** v5 is materially more credible as an *auditable shadow research system*, not yet a real airline deployment. A numerical score is a subjective product review, not a measured operational performance metric.

## 9. Highest-ROI next engineering milestones

1. Obtain anonymized *authoritative* airline booking/inventory availability, event timestamps and load-control/ULD feasibility status, preferably through a scoped test account. Without this, the system cannot propose executable operations.
2. Replace current post-hoc Model II gating with a single integrated optimization/evidence feedback loop; add feasible fleet/cargo-path certificates and reconcile held-shipment capacity.
3. Calibrate operational KPIs on representative incidents with *no-RELAY* matched baseline, avoid numerical claims from toy cost units.
4. Implement real-time event ingestion with idempotency, replay, causal source/version tracking and missingness alerts; test delayed/out-of-order source changes.
5. Add SSO RBAC, separation of customer and operator views, signed human review, external operator acknowledgement and safe multi-tenant access control.
6. Run shadow mode: present recommendations without actuating, compare retrospectively against verified outcomes, and only then consider narrowly scoped operator-in-the-loop pilots.
