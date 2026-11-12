# RELAY v12 — Final Technical Audit and Handoff

**2026-11-11 | local synthetic shadow-mode research prototype | version 12.0**

## Executive conclusion

v12 introduces a *genuine* five-world, same-input, side-by-side staging-policy comparison on top of the complete v11 codebase. Select any 2–5 simultaneously visible ground digital twins; all five underlying policy states still advance with one clock, identical synthetic arrival tape, resource assumptions, weather and disruptions. The former three-perspective RELAY v11 product (Ground, Control Tower, Customer) is preserved at `/v11` and the Evidence Lab at `/v11/evidence`.

**These are five staging decision-policy worlds, not five copies of the joint three-paper airline-wide optimizer.** The comparison arena is an intentionally separate isolated synthetic experiment. The original Model I/II/III orchestration is unmodified and remains bounded. The v12 arena is also the default `/` URL; `/v11` retains its own prior user interface.

## Exactly what was tested

- **77/77** selected math/data/API/safety and v11/v12 regression tests passed in a new run (`pytest -q upstream_tests tests/test_v11_quality.py tests/test_v12_five_way.py`). These include 500 randomly generated hybrid selector constraint cases and 25 independent parity fixtures comparing legacy v11 cohort accounting with v12 copied cohort runner for FCFS, v10 and v11 strategies.
- **500 paired synthetic episodes × 6 scenarios × 5 policies = 15,000 policy outcome records**. Original dataset is 3,000 independent common-input workload episodes; same inputs are replayed by all policies (seed 9099). Reports in `reports/V12_FIVE_POLICY_HOLDOUT.json` and `_episodes.csv`, `_summary.csv`.
- **Native Chromium WebGL2 visual QA:** 3/3 WebGL contexts in 3-card layout, 5/5 in 5-card layout, 2-card layout and minimum-two selection guard tested; no observed JavaScript exceptions; no root document vertical scrolling at 1600×970. Screenshots `V12_BROWSER_*`.
- **Browser UI controls with real FastAPI TestClient responses**: Step +10, request 100×, resource form, weather incident and 6-scenario benchmark drawer, all passed. Local Chromium network access is restricted, so the browser used a TestClient-backed fetch bridge, **not a direct localhost network E2E test**. In a separate independent check, the Python HTTP server returned status 200 for `/`.
- **100× local-stage engine short test:** requested 50 staging ticks/s, observed about 52.42 ticks/s over a ~2.4-second period on this container, with 126 simulated ticks and 268 admitted synthetic orders. This is a short local lightweight five-way staging test, **not** a benchmark of full Models I/II/III at 100× or of the user's Windows hardware.
- **30-day source historical dataset audit** (`/v11/api/data-audit`): `PASS`, 0 structural/reference issues detected, 429 flights, 636 shipments, 793 pieces, 14 ULDs, 5,120 synthetic historical events; no empirical Cathay calibration.
- **No real-world commands sent, no airline capacity/booking certification**.

## Five policies (frozen, same input and constraints)

| Policy | Mechanism | Status |
|---|---|---|
| FCFS | Oldest eligible task first | baseline |
| RELAY v10 | Observable urgency heuristic | existing v10 |
| RELAY v11 | Deadline/priority/duration current-tick two-class triage | existing v11 |
| RELAY + Model A | Experimental deadline guard (critical priority) | NEW integrated staging selector |
| RELAY + EDF | Experimental earliest-deadline emphasis, cost-first | NEW integrated staging selector |

Neither hybrid is a foundation LLM. Neither claims an exact global optimum across the airline network. All policies apply the same capacity, custody-gate eligibility and nonpreemptive active-task accounting. When a weather disruption reduces capacity below work already started, those jobs do not vanish; new assignments are constrained by the remaining free capacity.

## Final 500-episode holdout (seed 9099)

**Percentage cost reduction vs the corresponding synthetic FCFS cost mean; positive is better.** Unitless modeled penalty, not HKD.

| Scenario | v10 | v11 | v11 + Model A | v11 + EDF |
|---|---:|---:|---:|---:|
| Normal | 6.51% | 8.82% | 11.47% | **17.53%** |
| Peak | 0.40% | 17.22% | 18.18% | **22.24%** |
| Crew shortage | **−0.37%** | 0.00% | 0.00% | 0.00% |
| Cold outage | 1.15% | 2.50% | 2.79% | **3.74%** |
| High capacity | 11.19% | 10.62% | 14.75% | **23.95%** |
| Temporary disruption | 1.93% | 10.07% | 10.88% | **15.88%** |

**Cost–quality tradeoff, normal scenario:**

| Policy | Cost mean (synthetic units) | Cost reduction vs FCFS | Full-cohort on-time rate | Worst-decile cost / episode |
|---|---:|---:|---:|---:|
| FCFS | 1946.84 | 0% | 39.36% | 4279.24 |
| v10 | 1820.14 | 6.51% | 36.41% | 4164.85 |
| v11 | 1775.19 | 8.82% | 64.02% | 3757.37 |
| Model A | 1723.60 | **11.47%** | **64.04%** | 3663.19 |
| EDF | **1605.65** | **17.53%** | 56.64% | **3471.60** |

This does **not** prove a universally better policy: under crew shortage v10 is worse than FCFS, and under normal operation EDF is cheaper but less on-time than Model A. One server scenario deliberately falls back to FCFS for v11 and the two hybrids. Choice should depend on approved service and cost objectives.

### Algorithm, probability, uncertainty and ROI

- The benchmark uses the **same synthetic Poisson arrival process** and **common random numbers** for all five strategies, with 24 admission ticks and up to 110 drain ticks. Remaining jobs are explicitly censored and penalized. The scenario likelihoods are **not** calibrated to Cathay operations.
- The underlying 2D placement / finite one-step Bayesian VOI / finite-column scenario MILP are still the same bounded mathematical systems inherited from v11. A PASS of software tests is **not** proof that every claim in the three research papers is implemented.
- The operational cost percentage is relative **only to the synthetic penalty objective**. Real currency mapping, implementation costs, airline booking outcomes, human intervention effort and true annual economic ROI are unknown. Use a hypothetical sensitivity analysis, never an asserted HKD saving.
- Tables and plots are for **the five-way staging benchmark**, not direct observed financial ROI from Model I+II+III.
- The live comparison screen reports **provisional censored cost if the simulation stopped at the current tick**, not a terminal benchmark score. The pinned 500-episode comparison is the appropriate research evidence.

## Math traceability — why 100% production correctness cannot be claimed

1. **Model I:** paper requires certified placement solids inside 3D ULD contour, non-overlap, support/restraint, safe physical recovery paths. Implementation offers bounded 2D diagnostics and 3D box preflight, not certified aircraft loadability.
2. **Model II:** paper defines an event-driven semi-Markov belief controller with sequential verification/recovery tradeoffs and quality-certified observations. Implementation validates bounded finite one-step posterior and VOI identities; several downstream costs use proxies, not full scenario MILP reoptimization for every observation.
3. **Model III:** paper proves certified Graver/cluster encoded exchange optimality under assumptions. Runtime implements finite-column scenario HiGHS MILP, not an exhaustive operationally certified Graver/cluster optimizer nor full route-generation pricing. A solver `MIP gap=0` is scoped to its modeled candidate set only.
4. **Models interacting:** v11 shares evidence/IDs and applies safety gates, but HOLD/VERIFY -> re-optimize all released shared capacity -> physical execution/booking confirmation is not a complete closed-loop control proof.
5. **3D simulation:** staging animation is a procedural, state-driven projection, not collision-certified airport telemetry or flight movement tracking. Five policy scenes can differ in queue/active status; animations are illustrative.
6. **Data:** original historical catalog and every parallel arrival are entirely synthetic; no actual Cathay data, costs, OAG licensed live credentials, service durations or real traffic scenario probabilities.
7. **Security:** localhost-only shadow API, cross-site write restrictions but no identity, multi-tenant isolation, RBAC, signed approvals or real production monitoring.

## Engineering issues found and addressed while building v12

- Restoring / reducing resource capacity mid-shift: started work is not erased; prohibit illegal *new* starts, requeue never fabricated.
- Headless Chromium may lack WebGL2 under some sandbox settings. Tested actual native WebGL2 in Xvfb display mode, not just Canvas fallback.
- UI `step` inputs had invalid HTML `step` constraints for default floats; made compatible with existing real default values, then reran live form submissions.
- Rapid button interactions previously could be silently discarded while a request was in flight; serialized commands in the interface to protect order.
- Display only policies selected by the user but **compute all five** to prevent hidden/visible selection from contaminating the experiment.
- Zero-order screens now show a blank on-time value rather than a misleading 100% score.

## Stop/go decision

**STOP broad feature expansion for Hackathon presentation.** v12 is sufficient as a compelling **auditable synthetic decision-support demonstrator**: five-way comparable working policies, real bounded numerical solvers, reproducible test inputs and honest measurable synthetic tradeoffs.

**DO NOT DEPLOY** as a multi-tenant production airline control system; it lacks the certified operational guardrails, true operator feed integrations and production security. Next expenditure should go to one real data pilot / ground-truth service-cost calibration and a scoped shadow-mode evaluation. That changes external validity much more than a v13 UI or another synthetic algorithm.

## Version journey

v1–v2: three mathematical back-end models, event data and safety review gates; v3: first full-stack simulation integration; v3.1: fixed live MILP fallback crash; v4: canonical shipment IDs and shared synthetic clock; v5: data/provenance QA, OAG-compatible mock and mathematical caveat visibility; v6: redesigned light-theme three-view UX; v7: richer staging scenarios and 3D box preflight; v8: synchronized Ground/Control/Customer control; v9: native WebGL2 ground representation; v10: animated ground activity, mathematical cards and customer route arcs; v11: complete-cohort synthetic benchmark and more robust observable triage; **v12: five simultaneously computed selectable shared-input policy twins, added Model A/EDF and fully comparable 500-episode holdout.**

**Final engineering judgment:** mature hackathon research MVP; *not* validated production airline recovery optimization. Preserve that distinction in every pitch, KPI graph and demo.
