# RELAY v7 — audit, experiments, and real-world validity

**Date:** 10 November 2026. All inputs, scenarios and outputs in the downloadable project are synthetic. This is a working shadow research product, **not production-certified airline software**.

## What is actually solving what

| Layer | Implementation and correct scope | Unimplemented part of research paper |
|---|---|---|
| Model I | Risk-aware ULD placement over limited **2D** finite candidate batches. `geometry3d.py` adds a separate **3D AABB floor-envelope preflight** using recorded synthetic piece height and **user-assumed height**. | True aircraft contours, three-dimensional collision/stacking/loading-path constraints, cargo restraint/support, per-piece certified candidates, coupled second-stage physical rehandling optimization, center-of-gravity and aircraft load-control certification. A 3D visualization is **not** equivalent to 3D certification. |
| Model II | Per-shipment one-step Bayesian verification with explicit `HOLD` gate and exact algebraic value-of-information decomposition. | Full sequential belief-state semi-Markov policy; verified sensor likelihood; counterfactual **global MILP reoptimization** for every posterior outcome; real-time calibrated option expiry. Local proxy costs are explicitly labeled. |
| Model III | Shared flight and cold-chain capacity MILP on finite time-expanded candidate itineraries with `UNRESOLVED` fallback. HiGHS reports status and finite-model gap. | Whole-network global optimality, full path-generation/Graver exchange, true remaining cargo inventory and legal operational confirmation. |
| Ground Twin | Separate exact two-class task selection for observable urgency compared with FCFS. Both get same admitted work orders. | No demonstrable true Model I physical movement execution, no dynamic staffing/shift calendars, no equipment geolocation or operational schedule confirmation. |
| Control Tower | Candidate decision, human review, version gates, department-task **simulation only**. | Airline/carrier confirmations, authenticated sign-off and outbox execution, role-based authorization. |
| Customer Twin | Original synthetic tracking milestones plus **separately labeled ground simulation**, proposed route, review stage and customer-facing status. A newly requested synthetic order is inserted into the same catalog and appears in both Ground and Control Tower. | Real order acceptance/EDI, real carrier booking, independently confirmed reroute, customer notification delivery, per-tenant authentication. |

The shared business request -> ground queue -> re-evaluation -> customer journey is a **real software causal chain inside this synthetic sandbox**, not a real-world operational integration. The 3-model route solver and the staging dispatcher share shipment identity, snapshot and some route-risk signals, but are **not one jointly solved end-to-end stochastic optimization problem**. This distinction is a fundamental production gap.

## Internal input quality and mathematics

`data_quality_report()` verified **10/10 internal schema/referential checks** against the generated 30-day catalog: **429 flights, 636 shipments, 793 pieces, 14 ULDs, 5,120 historical events**. `audit_lab()` returned **22/22 current software invariants passing**, plus **four deliberately failing production-gap gates** (physical 3D certification, sequential belief controller, Graver integration, empirical validation). These are **integrity** checks, not evidence that the synthetic distributions match real Cathay operations. They cannot check missing real-world processes not represented in the model.

A separately added v7 test module passed **9/9** tests: customer-initiated synthetic order changes both ground policies and Control state; distinct event authorities, chronology, uncertainty gate; exact actual tick-time fast-forward; 125 randomized geometry preflight cases with no 3D overlap, floor/height/mass bounds; service-mode rejection for DGR; API routes and scenario results.

Legacy math and regression tests are included in the repository. An unrestricted run in the available tool environment took too long to complete. Therefore **do not interpret the old version's previous headline 87-passed claim as a newly rerun v7 complete pass**. Targeted old checks and the offline browser suite ran, but broader coverage still requires a dedicated continuous-integration runner with a time budget.

## Honest paired synthetic efficiency results

Ran `experiment_grid` with **500 paired episodes in each scenario**, seed=707, using the same synthetic arrivals and deadlines in both policies. This is a staging-scheduler comparison, NOT a numerical test of the complete three-paper optionality policy, and NOT monetary ROI. Positive `FCFS cost − RELAY cost` means RELAY is cheaper in the synthetic cost function.

| Scenario | Average improvement (synthetic cost units) | 95% Monte Carlo CI for mean | Fraction of episodes where RELAY is worse | Missed staging targets FCFS -> RELAY |
|---|---:|---:|---:|---:|
| Balanced (2 orders/tick, 3 crew, 1 cold bay) | +18.63 | [16.64,20.61] | 15.6% | 1532 -> 1038 |
| Peak demand (4 orders/tick, 3 crew) | +20.50 | [15.39,25.61] | 40.2% | **4961 -> 5973 (worse)** |
| Crew scarcity (3 orders/tick, 1 crew) | **−14.76** | [−19.25,−10.27] | **62.2%** | **2101 -> 2532 (worse)** |
| Cold scarcity (3 orders/tick, 0 cold bays) | +42.58 | [39.75,45.40] | 2.8% | 2300 -> 1354 |
| Extra crew (3 orders/tick, 5 crew, 2 cold bays) | +35.84 | [33.32,38.35] | 3.4% | 2257 -> 973 |

The **2,000-episode** default paired experiment (seed=707) returned a mean difference of **+20.5308 synthetic units** with 95% Monte Carlo sampling interval **[19.4638,21.5977]**, and **14.85% regression episodes**. Three additional seed=100/2048/812 experiments with 500 episodes each yielded means +19.7603, +20.9536, +19.8212. Results are reproducible but the interval covers only Monte Carlo sampling uncertainty **conditional on the invented model**, not the much larger real-world model/data uncertainty. The seed sensitivity is narrow for *these* synthetic distributions.

### What these experiments really imply

- Under assumed variable deadlines and shared resources, non-FCFS urgency rules can be helpful; this gives a **testable pilot hypothesis**.
- **Not universally better:** under extreme scarcity, the current urgency objective can lower its score while hurting actual cost and/or missed targets. The optimizer maximizes an observable urgency surrogate, **not the multi-period realized penalty**. This is the next substantive mathematical defect to fix, not hide behind screenshots.
- A positive aggregate cost difference can coexist with **more missed targets** because the synthetic cost is weighted by priority and waiting/rehandling penalties. A real operator must approve a multi-objective service policy and hard service thresholds.
- Zero/equal differences in Model I and Model III on a given snapshot should be reported as zero, not mixed with staging gains. None of these experiments establishes incremental value from joint Model I/II/III recovery or validates true optionality ROI.

## Fast-forward proof and performance

A real v7 `fast_forward(100)` ran every one of **100 simulation ticks**, with synthetic clock advancing **1,000 minutes**; **23** orders were admitted, **0 knowingly unsafe staging dispatches**, and the run took **22.39 seconds** on the available CPU (**4.465 ticks per wall second**). The UI has 1×/4×/16×/32×/100× **target-speed presets**, plus +32/+100-tick batch advances that update between backend-acknowledged chunks. Those presets are *not a guaranteed physical wall-clock 100× speedup*. A CPU/solver can throttle actual throughput; the UI reports measured speed.

## Data realism and production blockers (prioritized)

**P0:** Real Cathay operator permissions, cargo space, ULD loadability, DGR/compliance rules, customs/warehouse event mapping, customer entitlements; authoritative confirmation must be a distinct source from OAG schedule/flight observations. OAG's schedules/status/connections cannot alone confirm available or booked cargo capacity. Relevant starting points: https://developers.oag.com/ and https://www.iata.org/en/publications/manuals/uld-regulations/ .

**P0:** Model II's `HOLD` must be a **capacity/reservation constraint in the Model III optimization itself**, then re-optimize the remaining network and release unused capacity. Current v5-derived engine gates proposed actions after a scoped network solve and therefore cannot claim post-gate optimality.

**P0:** Staging policy should be validated on **out-of-distribution demand**, and jointly optimize/constraint lateness rather than merely maximize an urgency heuristic. Include a fallback to manual planning if service KPIs worsen.

**P1:** Full 3D certified candidate library including aircraft contours, stacking, restraint, load path, center of mass and ULD compatibility, plus real second-stage recourse. This requires operator-supplied approved data; preflight 3D wireframes do not provide these.

**P1:** A real snapshot-driven customer journey with authenticated company isolation; typed `PROPOSED` vs `INTERNALLY_APPROVED` vs `CARRIER_CONFIRMED` vs `EXECUTED`, predictive ETA calibration, provenance and opt-in notifications. The current consumer portal remains a **public local demo**.

**P1:** Scenario harness with pre-registered objectives, held-out real historical weeks, matched human-operational baseline, latency/load/error budgets, replay at real event arrival order and an offline-first shadow pilot. Only then evaluate a monetary ROI interval.

**P2:** Actual OAG read-only integration after proper licensing, credential security, source-event deduplication, matching flight instance/route/date/timezone and stale-data handling. Current `oag_bridge.py` is synthetic public-schema-shaped data, not a live account.

## Required validation before any actual deployment

Authentication/authorization, safe data handling, comprehensive line-by-line real operational rules, outbox idempotency, independent safety approvals, actual booking confirmations, pentest, observability/alerts, load testing, disaster recovery, documented fallback and accountable human-in-the-loop. **None are satisfied merely by a clean ZIP, a solver status `OPTIMAL`, or passing synthetic unit tests.**
