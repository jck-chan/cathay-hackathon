# Research paper traceability — theorem versus executable approximation

**Primary source texts reviewed:** User's three uploaded October 2026 research papers, respectively *Recovery-Aware Cargo Arrangement* (Model I, 8 pages), *PIVOT: The Decision Value of Verification Before Recovery* (Model II, 6 pages), and *Certified Cluster Exchanges* (Model III, 8 pages). The paper models are the requirements; simplified code is NOT treated as implementing omitted claims.

| Paper requirement | Status | Corresponding code | What is missing / how to validate |
|---|---|---|---|
| I: first-stage placement `R_i K_i + p_i ⊂ G_u ⊂ R^3` | **NOT IMPLEMENTED** | `relay/models.py:model1_placement` | Enumerates 2×2 2D floor slots; build 3D geometry + certified contour/stack/restraining rules |
| I: frozen/irreversible placement and safe second-stage local recourse | **NOT FULLY IMPLEMENTED** | `relay/models.py`, `relay/state.py` | Add physically verified movement paths, precedence, equipment restrictions and freeze times |
| I: minimize CVaR + λ E in nominal slack `Z_Δ` | **BOUNDED DEMO** | `model1_placement`, `cvar` | Risk criterion mathematically evaluated for synthetic access costs; independent batch 4-piece diagnostic, not full set feasible region |
| I: weak dominance in same feasible choice set | **TESTED IN BOUNDED LIBRARY** | `test_uld_risk_never_worse_than_baseline_under_budget` | Theorem only applies to the exact library and evaluated scenarios; no global physical claim |
| II: receipt-/event-time-bounded Bayesian belief | **PARTIAL** | `relay/state.py`, `model2_pivot` | Time versioning and one-step posterior; no fully sequential belief state over operational events |
| II: value identity `R0-Jq=Iq-Aq-Bq-cq` | **TESTED** | `model2_pivot`; 400 randomized identity/mass cases | Exact under specified synthetic local action-loss table, assumed sensor parameters |
| II: global recovery counterfactuals from Model III | **NOT FULLY IMPLEMENTED** | `relay/engine.py:_uncertainty_controller` | Uses local `route_costs` as a proxy; label corrected, must re-solve capacity-coupled MILP per scenario/signal |
| II: multi-stage semi-Markov decision timing | **NOT IMPLEMENTED** | `model2_pivot` | Requires transition kernel, remaining option horizon, queues and calibrated observations |
| III: time-expanded candidate paths and shared constrained assignment | **PARTIAL / TESTED** | `relay/routing.py:solve_global` | Enumerated paths with shared flight/cool/hourly kg and toy constraints, small exhaustive oracle for 2 shipments |
| III: CVaR over correlated scenarios | **PARTIAL / TESTED** | `relay/routing.py`; CVaR 500 random cases | Synthetic scenarios, not calibrated correlations or full nonanticipative stochastic recourse |
| III: certified Graver exchanges / cluster algebra mutations | **SEPARATE FIXTURE** | `relay/models.py:cluster_exchange_fixture` | No integrated Graver basis search, no proven performance advantage over HiGHS |
| III: operator approval and candidate booking confirmation | **SIMULATION GATES ONLY** | `unified_lab.py`, `v5_lab.py` | No actual operator authority, authentication, carrier inventory/booking API |

## Why this matters

Do not present a separate 3D animation as a proof of Model I airworthiness. Do not present an optimal MILP over 24 selected shipments / limited columns as an optimum for a larger real airline network. Do not present a one-step Bayes identity as a full POMDP controller. Do not present a cluster algebra explanatory identity as a deployed certified Graver solver. A real product must expose the feasibility/certification *provenance* for each downstream action.

## Desired future coupling

```
Authoritative event snapshot, provenance and uncertainty
             ↓
Model I certifies physical candidate objects and legal recovery sequences
             ↓
Model III optimizes flight+crew+ULD+ground-network resources with certified candidates
             ↓
Model II chooses verify / hold / assess at the correct time using re-solved
         downstream cost-to-go for each posterior branch
             ↓
Re-solve or fix decisions if any shipment is held / observed status changes
             ↓
Authenticated operator review → authorized external booking/ground confirmation
             ↓
Only confirmed ground status may update customer-observed milestones
```

The current v5 is intentionally a **shadow approximation** of this loop.
