# RELAY v2 — locally executed QA / evidence (2026-11-09)

**Scope:** Python 3.13 local test environment, synthetic data only. Not tested on the user's Windows laptop. Not Cathay authorized cargo or aircraft operations.

## Test results (this specific build)

- `python -m pytest -q`: **36 passed**, including **9 new targeted v2 regression tests**; observed runtime ~10.29 s.
- `python -m scripts.run_demo`: successfully generated JSON examples `01`–`10` from executed code. Initial Model III was `OPTIMAL_ENUMERATED_MILP` and output retained explicit pending review.
- `python -m scripts.stress_validation --cases 500`: **500 / 500 small synthetic MILP instances optimal**, 3,000 randomized Bayes identity samples; FCFS comparison **135 better, 365 tied, 0 worse** in identical modeled constraints. Median small-instance solver 1.715 ms, p95 5.194 ms, maximum 24.554 ms (non-representative micro-scale, variable across hardware).
- `examples/02_benchmark_initial_10000.json`: **10,000 paired synthetic Monte Carlo draws** applied to an initial selected plan, **0% observed improvement** over FCFS on that example (both plans coincide). These are NOT 10,000 MILP solves.
- `data/manifest.json`: 429 synthetic flights, 636 shipments, 793 pieces, 5,120 historical events across 30 days, plus future simulation schedule. See `docs/DATA_DICTIONARY.md`.

## Verified regressions

- Trigger a trusted synthetic shipment dimension-conflict event for a case that was originally proposed for reroute: new PIVOT case gate excludes it from proposals and Model III route assignment.
- HOLD/VERIFY applies per affected shipment; it does not suppress independent eligible shipments.
- Every Model I eligible piece is accounted for in independent 2D batches; no certified 3D claim.
- Proposal never becomes a booking or a real-world command; human review stays simulation-only and stale decisions are rejected.
- Customer projection hides proposal-only decisions and internal cost/solver data; internally approved changes remain unconfirmed.
- Accepted event invalidates latest digital-twin decision visuals until recomputation.
- Cursor-paged logs replay every sequence even when the number exceeds page size.
- HTTP mutation refuses `trusted=true` without a simulator demo header; no security claim is made about the header.

## Unresolved limitations

- One-step Bayes PIVOT advice and independently planned global network MILP are still a partial integration, not a fully joint semi-Markov control problem.
- Model I is independent, limited 2D batch diagnostics; it does NOT certify a full simultaneous load, aircraft balance or route execution.
- Current example has sparse capacity pressure: no demonstrated average cost benefit. Do not quote improvements from different simulations as validated ROI.
- The simulator's history is synthetic and cannot establish real flight disruption frequencies, sensor reliability or economic costs.
- This sandbox has no trusted identity provider, external API credentials, operator authorization, persistence hardening or production validation.

See `docs/PRODUCTION_GAP_REGISTER.md` for blocking operational and security gates.
