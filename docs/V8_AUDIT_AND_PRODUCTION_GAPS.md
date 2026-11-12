# RELAY v7 → v8 audit: what is genuinely connected?

## What the implementation supports

| Causal flow | v8 status | Important caveat |
|---|---|---|
| Synthetic order accepted → canonical shipment/piece records & RCS event → both Ground queues | Implemented and tested | Not an externally accepted carrier booking |
| Ground clock tick → event store, arrivals, shared feasibility guards, FCFS/RELAY selection | Implemented and tested | Simulated staging task selection; not certified physical movements |
| Ground disruption → Model I/II/III reevaluation → Control Tower suggestion | Implemented and tested | Model III routes are tentative; Model I only bounded 2D |
| Auto selected → internal synthetic approval → task queue | Implemented and tested | No real carrier/ULD authority, identity or authenticated reviewer |
| Simulated task acknowledgement → customer-safe journal | Implemented and tested | Does not imply an actual loading or flight milestone |
| Customer portal → new order → Ground & Control → customer journal | Implemented and tested | Client/account identification is a fake single demo account |
| All three views live updating without tab-dependent timers | Implemented | Polling (~950 ms) rather than websockets; the one server worker owns the clock |
| 100× target speed | Request and measured throughput exposed | CPU bound; **not guaranteed** 100× effective throughput |
| Whole-screen 3D vs. whole-screen globe | Browser rendered | Geometry illustrative, no actual ground-truth spatial digital-twin calibration |

## The three-paper mathematical boundary

**Model I — Recovery-aware cargo arrangement.** The original paper formulates 3D physical geometry, hard weight/handling constraints, safe scenario recourse and CVaR under a nominal budget. This implementation still solves a bounded **2D floor-placement candidate library**, with a separate **axis-aligned 3D box preflight**. Neither proves aircraft contour, restraint, stacking support, aircraft center of gravity, dangerous goods segregation nor a feasible loading/unloading motion sequence. Therefore no physical airworthiness certificate can be produced. Its calculated risk benefit may be exactly zero.

**Model II — Verification before recovery.** One-step Bayesian posterior update and the verification-value identity are tested. The wider sequential POMDP/semi-Markov control and actual downstream joint Model III MILP solve *for each inspection signal* are not implemented. Costs from local route candidate proxies are explicitly labeled as such. Do not interpret a deterministic "hold" as permission to ignore a mandatory check.

**Model III — Certified cluster exchanges.** A real integer MILP solves **only its enumerated candidate flight paths and synthetic inventory** with shared capacities, temporal feasibility, unresolved option and risk objective. The cluster/Graver mathematical fixture is not a live certified network-exchange method. The optimality gap refers to the encoded finite MIP only. Even a zero gap is not real airline routing optimality or confirmed space.

**Integration gap:** although all models use the same synthetic catalog/clock, 2D physical feasibility is not an end-to-end 3D safety gate for each route, and a Model II HOLD may suppress a proposal without re-solving the whole global MILP with released capacities. Therefore the assembled solution is NOT a single fully coupled mathematical program.

## Known implementation risks, prioritized

1. **Critical, production blocker:** no actual Cathay flight-cargo inventory, acceptance, customs, restraint, loading, booked/held space or external approval authority. No real airline/physical actions permitted.
2. **Critical, production blocker:** no authenticated users, permissions, tenant-scoped customer privacy, audit signatures, secrets management or transactional external-system connectors. Only localhost sandbox.
3. **High:** Model I not complete 3D certified geometry/recourse; Model II not sequential optimal control; Model III finite candidate set, no live column generation/Graver implementation; missing full hard coupling.
4. **High:** benchmark costs and probabilities generated, not calibrated to operational reality. A 95% Monte Carlo interval is *sampling uncertainty within the synthetic world*, not real-world forecast confidence.
5. **Medium:** 100× is an acceleration **request**; solver complexity caps actual throughput, displayed in ticks/s. Worker yields to keep pause/status responsive.
6. **Medium:** rendering is 3D-looking isometric Canvas and a stylized globe; not a measured airport/aircraft/ULD 3D environment. Route marker is decorative, never a real aircraft location.
7. **Medium:** only the new v8 root uses the unified server runner. Older historical route endpoints remain as separate compatibility lab instances and should not be used as shared v8 views.
8. **Low:** the client polls instead of subscribing to a push stream; network calls can be interrupted and should surface clear offline/retry status.

## Scientific effectiveness snapshot (carried from v7, not real-world ROI)

From the v7 fixed-seed *staging-policy-only* paired synthetic study (2,000 episodes, seed 707), RELAY averaged **20.5308 synthetic cost units lower** than FCFS (sampling interval **19.4638–21.5977**), but **14.85% of matched episodes regressed**. It was **worse under crew scarcity**: 500 episode scenario mean saving **−14.7636 units**, 62.2% regressions, and more missed targets. In peak demand, aggregate cost improvement concealed **more** missed staging targets (4,961 FCFS vs 5,973 RELAY) because the objective weights different penalties. These are simulation outcomes under *assumed* costs/arrival/deadline distributions, not Cathay field data, and not gains from jointly running all three models per episode.

**Next scientifically meaningful milestone:** compare control policies on held-out, anonymized observed ground/flight events with operator-approved capacity and SLA cost estimates; report service-level constraints as well as money, confidence intervals by route/season, and degradation under distribution shift. Keep the product in shadow mode until safety/authentication and correctness signoff.
