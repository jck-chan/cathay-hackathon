# RELAY Mathematics, Engineering and Execution Semantics

## 0. Operational intent

Keep valuable cargo recovery alternatives available for as long as feasible and legal, without confusing **recommendation** with **authority**. Optimize physical arrangement (*Model I*), decision-relevant verification (*Model II*), and globally coupled flight alternatives (*Model III*) using a versioned information state.

```
external sources / booking / warehouse / OAG observation
   -> typed timestamped events + immutable original payload
   -> provenance / source-field authority / idempotency
   -> receipt-time snapshot, unknowns, available resources
   -> MODEL I: candidate physical feasibility (synthetic 2D only)
   -> MODEL III: time-expanded itinerary master, shared inventory, CVaR
   -> MODEL II: cost-of-verification using Model III downstream cost function
   -> explicit REVIEW / HOLD / ESCALATE GATE
   -> local simulation outbox -> [four dependent departmental tasks]
   -> customer projection of observed milestones and qualified forecasts
```

This prototype creates decisions, task drafts and logs, but **has no physical command transport**. An actual implementation would need separate authenticated command adapters with two-phase confirmation, downstream acknowledgment, a reconciliation ledger and emergency manual controls.

## 1. Input, event time, receipt time, revision

Every event has an immutable `event_id`, an entity reference, `event_time` (time event occurred), `received_at` (time it became observable), `source`, source-specific monotonically increasing `source_revision`, `trusted` flag and typed payload. `project(state, as_of=t)` ingests only `received_at<=t`. That blocks look-ahead even when operational systems back-date an incident.

Use field authority, not a universal source rank: OAG flight status does not certify cargo inventory; carrier booking confirmation does not certify geometry; a cloud model does not authorize safety. Accepted events mutate their domain only. Unverified events may trigger review but not physical authorization.

The database maintains an increasing snapshot version. The review API must present the version against which the decision was evaluated. Changes between evaluation and review force a new solve (HTTP 409). Replaying the same event ID with the same payload is idempotent; conflicting payloads with the same ID are rejected.

## 2. Model I — real bound, limited geometry

Let `z` assign up to four pieces to four **nonoverlapping, flat synthetic 2D cells** in one synthetic ULD. Every piece must fit its assigned cell and the sum of piece masses plus tare must be below gross synthetic load. Unsafe/DGR or unverified input is excluded upstream.

Compute the lexicographic nominal benchmark `z0` and its nominal handling cost `C*`. The bounded candidate set is

\[
\mathcal Z_\Delta=\{z\in \mathcal Z_\mathrm{2D}: C(z)\le C^*+\Delta\}.
\]

For each disturbance `ω` involving access to a target piece, calculate a **constructed** local retrieval/rehandling loss `L(z,ω)` from the actual 2D pieces in front of it. Optimize

\[
\min_{z\in\mathcal Z_\Delta}\operatorname{CVaR}_{\alpha}(L(z,\omega))
+0.2\mathbb E[L(z,\omega)].
\]

The algorithm enumerates all `4! = 24` placements for four distinct pieces and returns **globally exact results within this finite 2D candidate library**. It checks no overlap, cell dimensions, tare and ULD gross load. Its risk dominance follows because nominal `z0` is feasible in the Δ-bounded set; strict improvement is not claimed unless computed.

**Critical research-to-code gap:** The paper includes 3D solid placement, orientation SO(3), contours, support/restraint, load/moment limits, frozen tasks, multi-ULD assignment and stochastic recourse. None of those is fully operationalized here. The route planner applies a simple synthetic 2D piece-to-ULD screen, not a loading safety certificate. This is a deliberately *refusable* approximation, not a false 3D safety promise.

## 3. Model III — actual mixed-integer program

For shipment `i`, enumerate a finite route set `P_i` consisting of one- or two-flight itineraries on the current *time-expanded graph*, plus a labeled `UNRESOLVED_ESCALATION` path. Discard routes violating scheduled/estimated departure, 40-minute planning cutoff after the snapshot, minimum 2-hour connection, blocked flight status, modeled remaining kg and cold-chain capacity.

Let binary `x_ip` select an itinerary. With route incidence `a_ipf` and current synthetic inventory `C_f`, solve

\[
\begin{aligned}
\min_{x,\eta,h\ge0}\quad &\sum_\omega p_\omega L_\omega(x)
 +\beta\left(\eta+\frac{1}{1-\alpha}\sum_\omega p_\omega h_\omega\right),\\
\text{subject to}\quad&\sum_{p\in P_i}x_{ip}=1,\\
&\sum_{i,p:f\in p}w_i x_{ip}\le C_f,\\
&\sum_{i,p:f\in p,\,i\,\mathrm{cold}}w_i x_{ip}\le C_f^{\mathrm{cold}},\\
&\text{synthetic hourly terminal work-cell bounds},\\
&h_\omega\ge L_\omega(x)-\eta,\\
&x_{ip}\in\{0,1\},\;h_\omega\ge0.
\end{aligned}
\]

`L_ω(x)=Σ_i Σ_p c_ipω x_ip`. The same scenario-cost implementation is used to calculate a **feasible FCFS baseline** with the same resource capacities, not a separate favorable scoring system. The nonlinear risk functional becomes a linear epigraph. `scipy.optimize.milp` invokes the HiGHS mixed-integer solver on CPU.

**Hard disqualifiers:** dangerous goods (no certified business rule set), unverified physical dimensions, customs hold, unavailable 2D ULD candidate, and sealed/loaded/departed/arrived/delivered custody. No unresolved shipment is silently marked delivered. All route suggestions are tentative pending operator allotment, flight/load-control and physical compatibility confirmation.

**Scope of optimality:** `OPTIMAL_ENUMERATED_MILP` means certified by HiGHS **for this finite master under its provided constraints**, not the real airline system. Candidate paths are not proven complete against all possible commercial routes, time-dependent airport/customs rules, true booking inventory, specialist handling capacities or aircraft loading restrictions. Report integer feasibility, solver gap and bound. Timeouts may return feasible unproven or universal unresolved fallback.

### Cluster exchange paper

The source paper's claim for a bounded complete integer master is based on conformal Graver decomposition. Computing a full Graver basis in general is expensive. The shared engine includes one **exact, independently checked integer lattice example**: `g1=(-1,1,0,-1)`, `g2=(0,-1,1,1)`, neither is individually feasible from `v=(1,0,0,0)` while `g1+g2=(-1,0,1,0)` is feasible, conserves Mv and reduces the fixture's cost by 6. It **does not claim** to run complete Graver augmentation or an original cluster-algebra speedup in operational optimization. HiGHS MILP is the real solver.

## 4. Model II — exactly computed one-step information value

The paper's theorem is

\[
R_0-J_q=I_q-A_q-B_q-c_q,
\]

where `I` is benefit of decision-relevant information; `A` reflects changes to the feasible post-verification option set; `B` is the difference between post-test and immediate-time cost on available options; `c` is inspection price. The current engine enumerates two hidden states, two possible test signals and survival/expiry of the alternative. It recomputes posteriors using Bayes' rule and independently verifies the identity numerically. For integration the **HOLD** and **ASSESS_RECOVERY** cost matrix is derived from the same Model III route scenario pricing (including modelled fallback). This avoids inventing a disconnected decision penalty.

`VERIFY`, `HOLD` and `ASSESS_RECOVERY` are **planning policies, not permissions**. The sensory sensitivity and false positive rates are assumed synthetic values. This is **NOT** an implemented multi-period semi-Markov Bellman recursion, even though the paper derives one. That requires calibrated joint transition/observation/action-duration kernels, genuinely executable action masks, decision-dependent deadlines and sufficient historical validation.

## 5. Planning vs commitment state machine

```
EVENT_RECEIVED -> SNAPSHOT -> DECISION_CANDIDATE
                                   | no safe/known option: ESCALATE/HOLD
                                   | not enough evidence: VERIFY/HOLD
                                   | safe model proposal: PENDING_REVIEW
                                                     |
                                      HUMAN_REJECT -> REJECTED
                                                     |
                                      HUMAN_APPROVE -> APPROVED_SIMULATION_ONLY
                                                     |
                                      task1: request capacity confirmation
                                                     |
                                      task2: warehouse build-up feasibility
                                                     |
                                      task3: ground-handling change preparation
                                                     |
                                      task4: customer explanatory draft
```

A status of `APPROVED_SIMULATION_ONLY` **never** directly updates the shipment's booked flight, actually sends a ground crew instruction, or tells a customer an alternative is confirmed. Only separate trusted booking/milestone evidence may change observed customer tracking. In v11, `AUTO_SHADOW` can approve eligible synthetic proposals. `MANUAL_REVIEW` requires an explicit review, and `ADVISORY` disables automatic review.

## 6. Fast but defensible engineering choices

- **Python / SciPy HiGHS:** optimized compiled MILP kernel; no GPU needed for small/mid-size assignment masters. GPU RTX 4070 does not speed this solver.
- **Bounded horizon:** at most two legs, 12 candidate routes per shipment, max 24 requested shipments, 3 joint disruption scenarios and 3-second default solve budget. This is a **scalability guard**, not a claim of global solution completeness.
- **Geometry finite library:** exact small 2D arrangements replace an overpromised general 3D packing solver.
- **State is deterministic:** append-only logs, as-of received times, fixed seeds, explicit simulated source truth, version-controlled approvals.
- **Fail closed:** solver exception/unproven cases never trigger irreversible physical action; no fake safety permissions or API acknowledgments.
- **Human cognitive load:** expose short reason codes and exception queue, exact optimizer status, resource shortages, and needed confirmation separately from the customer's minimal projection.
- **Stable 3D interface:** backend provides transformable scene nodes / 2D piece positions / flight states / task transitions. Real 3D layout, animation and rendering belong to the engineering frontend, with physical geometry supplied by certified sources.

## 7. How to validate business outcomes honestly

Use **paired operational replays**: same event stream, same available data at the same receipt time, same initial commitments, different policies. Compare FCFS, delayed-recovery heuristic, static EVSI and expiry-aware PIVOT against RELAY. The exact KPI definitions must be signed off by Cargo Operations: missed milestones, validated service-level success, human intervention count, unnecessary physical moves, kg of disrupted shipments served, solver p50/p95, false positive actionable-alert count and real handling cost.

The benchmark's synthetic expected losses and paired Monte Carlo confidence intervals are **conditional on the simulation model** and cannot certify real airline ROI or physical safety. A 30-day synthetic history provides reproducibility, not calibration. Before a real pilot collect anonymized historical operations including failed recoveries and delayed/incorrect data and evaluate strictly out-of-sample.
