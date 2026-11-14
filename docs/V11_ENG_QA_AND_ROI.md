# RELAY v11 — Engineering QA, mathematical scope, experimental evidence and ROI

**Evidence date:** 2026-11-11 · **Scope:** synthetic local decision-support prototype; no real aircraft or cargo operational authority.

## Evaluation design

- Source: `reports/V11_OUT_OF_SAMPLE_SEED_2026_500x6.json` and `reports/V11_EPISODE_LEVEL_DATA_500x6.csv`, generated from `v11/benchmark.py`.
- 500 episodes/scenario, six distinct predefined synthetic stress cases; 24 10-minute arrival ticks plus a bounded 110-tick completion/drain horizon.
- Identical synthetic arrival streams and job templates for FCFS, V10 staging and V11 staging (paired common random numbers).
- Synthetic arrivals Poisson by scenario, not fitted to an airline. Cost ledger: handling + waiting + overdue waiting + completed-job lateness + outstanding-job penalty. Task priority and duration drawn from synthetic work-order templates.
- **Full-cohort SLA:** all admitted tasks included; unfinished tasks remain missed, preventing old 21-tick partial-window bias.
- **Cost reduction** = (average FCFS modeled cost − average policy modeled cost) / average FCFS modeled cost × 100%. (Ratio of group means, not mean of per-episode percentages.)
- **CI:** 600 paired bootstrap resamples of episode pairs. This captures sampling uncertainty within *fixed synthetic generator assumptions*, **not** external validity.
- **CVaR90** is empirical cost of worst 10% of *episode totals*. **Not** Model III's internally modeled scenario CVaR.
- **Statistical convergence** means cumulative sample estimator settles as n grows. **Not** deterministic MILP solver convergence or a hardware optimization speedup claim.

## Pinned measured synthetic results — seed 2026

| Scenario | Cost saved | 95% paired CI | On-time pp change | Lead ticks saved | Tail-cost CVaR90 saved | V11 worse episode fraction |
|---|---:|---:|---:|---:|---:|---:|
| Normal | +8.045% | 7.10–8.95% | +23.562 pp | 3.531% | 11.417% | 28.0% |
| Peak | +16.658% | 16.15–17.16% | +28.066 pp | 7.291% | 16.495% | 0.4% |
| Crew shortage | 0% | 0–0% | 0 pp | 0% | 0% | 0% |
| Cold outage | +2.411% | 2.24–2.61% | +23.756 pp | 1.675% | 2.423% | 5.6% |
| High capacity | +9.951% | 9.05–10.78% | +28.755 pp | 6.591% | 15.004% | 20.4% |
| Temporary disruption | +9.537% | 9.14–9.99% | +14.171 pp | 3.699% | 10.197% | 3.6% |

Note: under high capacity, the v10 staging policy shows 11.624% cost reduction in the *same new full-cohort benchmark*, more than v11's 9.951%, although v11's SLA is better. We have **not** proven universal multiobjective dominance.

Independent second seed 707 produces 8.373% normal and 16.511% peak cost reductions. These replicate under the **same generator**, not a real-world holdout.

## Adverse case disclosure

- `temporary_disruption`: 90% of the restoration-time backlog clears after 22.234 ticks with FCFS and 25.596 ticks with v11 (both cleared in 100% of these episodes). Thus **15.121% slower** on that specific recovery-clearance metric, despite lower average staging cost.
- `crew_shortage`: v11 intentionally uses FCFS when one feasible server remains; *0% benefit* is a truthful guard, not a performance breakthrough.
- `peak`: small portion of unfinished work remains after cutoff: mean 0.16 items v11 vs 0.01 FCFS; backlog charge is explicit. Larger simulated horizon/cost parameter studies remain warranted.
- `normal`: 28% of paired episodes are more expensive under v11. Do not claim `always better`.

## Statistical inputs and frequency

Normal scenario arrival rate λ=2 work orders/10-min tick. From 12,000 generated ticks, sample mean 1.9725, variance 1.9589. Agreement with Poisson λ=2 checks generator, NOT empirical airport arrivals. Other scenario λ values are predefined, not historical arrival-rate estimates. `V11_ARRIVAL_FREQUENCY.png` and `V11_STATISTICAL_CONVERGENCE.png` show input-frequency and sampling-convergence evidence.

## Operational network solver speed

36 V7Lab scenarios, 6 synthetic seeds × 6 snapshot times. Observed finite-column HiGHS MILP candidate route columns 9–78, median reported solver time 5.308 ms, p95 6.199 ms, all 36 returned `OPTIMAL_ENUMERATED_MILP` with enumerated modeled routes. Does NOT imply full end-to-end latency, global-route-space optimality, or `100×` simulator throughput. A target `100×` remains limited by backend tick CPU work; rendering tempo is distinct from executed model ticks.

## Decision mathematics and paper traceability

1. **Model I**: 2D bounded candidate ULD floor plans + separate 3D box preflight; no certified 3D contour, support, restraint or physically safe rehandling path. Bounded 2D optimum is NOT original full two-stage stochastic physical recourse optimum.
2. **Model II**: exact one-step finite Bayes information identity with shipment-specific HOLD/VERIFY gate; no full sequential belief MDP. Local route cost counterfactuals are *not* independently re-solved global MILP per observation outcome.
3. **Model III**: SciPy HiGHS MILP solves shared capacity on enumerated itinerary columns; integer-cluster/Graver mutation remains a research fixture and is not live network search. The status is optimal only *within the chosen candidate set and modeled constraints*.
4. **Cross-Twin**: common event store, one clock, shared IDs and customer projection; not all physical task trajectories or real airline confirmations are instrumented. No unsafe real movement performed.
5. **Inputs**: 429 flights, 636 shipments, 793 pieces, 14 ULDs, 5,120 synthetic historical events; structural audit verifies cross-references and timestamps, but no Cathay statistical calibration or OAG license.

## Illustrative scenario mix and ROI — NOT measured airline benefits

Scenario weights used solely for the illustrative graph: normal 40%, peak 20%, crew shortage 15%, cold outage 10%, high capacity 10%, temporary disruption 5%. Their probability-weighted baseline synthetic cost is 11,109.71; v11 10,428.31; reduction **6.133%**. Not an empirical operating mix.

Let \(\Delta C\) denote synthetic penalty units saved per decision batch, \(k\) an independently calibrated HKD/unit conversion, \(N\) comparable batches/month, and \(F\) incremental deployment/operating cost HKD/month:

\[ ROI = (N \Delta C k - F)/F \times 100\%. \]

For a **purely illustrative** F=HKD20,000, N=60, normal modeled \(\Delta C\approx143.13\) units, break-even \(k\approx\)HKD2.33 per synthetic unit. All F, N, and k are unvalidated. Real HKD ROI **cannot be inferred** until real costs and comparable operations are observed.

## Security and reliability

- Added local cross-origin write rejection for simulated mutation calls. This is *not authentication*, authorization, permission segregation or client isolation; never publicly expose the server.
- New regression test covers nonpreemptive active cold work after a cold-bay outage: new cold jobs are prohibited, but the policy will not crash solely because work was already active. Real cold-chain temperature/safety consequences remain unmodeled.
- Dataset audit and cross-twin trace endpoints produce honest provenance, not real-world correctness certificates.
- `scripts/v11_offline_visual_qa.py` executed Chromium with actual TestClient snapshots and found zero JavaScript page errors across three twin tabs and report. Browser-to-HTTP server E2E is blocked by this environment (`ERR_BLOCKED_BY_ADMINISTRATOR`) and **was not** verified on Windows.
- The November 11 QA records cover selected test groups. The v11-only cleanup subsequently passed all 109 tests with `RELAY_CHAT_MODEL=demo`.

## What v11 still does NOT solve

- Empirically calibrated Cathay arrival/service/handling/disruption probabilities and true $ costs.
- Real booking capacity and external authority, OAG live credentials, certified ULD loading and 3D collision-safe actuation.
- Global end-to-end jointly optimal Model I→II→III with contingent full re-solves and certified task execution.
- Robust production deployment: secrets management, RBAC, signed audit ledger, telemetry, rate limiting, tenant isolation, external connectivity testing, performance at realistic airline scale.

**Verdict:** Useful, auditable low-cost research/hackathon prototype with demonstrated *synthetic and scenario-dependent* policy improvements; NOT perfect or production certified. Claim only the levels of evidence above.
