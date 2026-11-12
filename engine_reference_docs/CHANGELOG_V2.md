# RELAY v2: changes from the v1 decision-response audit

## Corrected

1. **Per-shipment PIVOT:** v1 evaluated one arbitrary shipment, while the final optimizer could recommend recovery for that same shipment despite PIVOT HOLD. v2 evaluates dimension-uncertain cases individually, excludes them from Model III eligible routes, and prevents any of their IDs from entering `proposed_actions` until independently verified.
2. **Physical diagnostic coverage:** v1 calculated 2D packing for at most four pieces. v2 evaluates eligible pieces across multiple independent 2×2 ULD batches, with `batches`, `candidate_piece_count`, `coverage_fraction`, and `unplaced_piece_ids`. These are *separate diagnostics*, not a globally certified loading solution.
3. **Unverified input authority:** v2 HTTP mutation endpoint requires the `simulator` sandbox role header for `trusted=true` events. **A client can forge this header; it is not real authentication.** Outside a local demo, disable this endpoint or implement a signed, authorized adapter.
4. **Stale visualization prevention:** digital-twin state flags if its latest decision was computed against an earlier data snapshot; stale placements are withheld.
5. **SSE replay:** event stream uses ascending, cursor-based database reads rather than only the newest 200 logs, so slow clients can catch up.
6. **Reproducibility and tests:** added v1 conflict regressions, external event authority tests, customer projection, snapshot staleness, multi-batch diagnostics and paged log tests.

## Still NOT implemented / demonstrated

- Full 3D physical safety certification, airworthiness, actual aviation permissions, shared physical slot allocation, DGR certification or real authority for cargo movement.
- Dynamic multi-stage POMDP. PIVOT remains independently solved one-step advice; not all resource interactions are jointly optimized with it.
- Complete Graver basis and generalized cluster mutation optimizer. The cluster paper's small integer fixture is checked separately.
- Genuine Cathay Cargo connectivity, production security, customer identity authentication, multi-instance concurrency, cloud operations or external commitments.
- General proof RELAY beats FCFS. The provided 10,000 paired scenario draws for the initial instance demonstrate **0% improvement**, which is an honest result; small stress instances show improvement only in some cases.

All IDs, scenario probabilities, costs, capacities and simulated operations are synthetic. No real commands are emitted.
