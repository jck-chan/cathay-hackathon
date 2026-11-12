# RELAY v5: How to operate the four-step demonstration

The new single-page user journey matches four practical perspectives, not four disconnected dashboards:

## 01 — Live Operations

Click **Step one batch** to add one synthetic batch of actual canonical cargo work, or **Start streaming** to run continuous simulated events. Two rotating/isometric terminal views show FCFS versus RELAY on the same admitted work IDs. Change crew, stand or refrigerated bays to cause measurable synthetic queue stress. Use reset to get a repeatable seed. Animated movement is *schematic only*; it is not aircraft loading evidence.

## 02 — Trigger a Disruption & inspect mathematical control tower

Click **Trigger disruption** (or the real control **Cancel a future flight**) to create a *synthetic* cancellation in the canonical event store, not in Cathay's systems. Click **Run all three models** (or guided **Inspect decision**) and read the solver summary. Model I = simplified ULD placement and risk; Model II = one-step inspect vs hold; Model III = shared capacity route assignment. **Look at the shipment coverage banner**, which explicitly says how many eligible shipments were included (up to 24), and how many were excluded. All alternative routes are tentative.

## 03 — Human Review and evidence

The recommendation card and review worklist show why a proposed change is pending. Clicking **Approve simulated workflow** only creates synthetic work threads. It is not a booking, cargo load authorization, actual ground crew instruction, customer notification or proof of external carrier confirmation. Any new event or mock OAG status evidence makes existing review stale; rerun calculations first. See **Live Integrity Audit** to find truth labels, runtime checks and known production gaps.

## 04 — Customer Tracking

Click **Load sample AWB**, then **Search shipment**. The customer page and control tower use the same synthetic booking reference / shipment ID and a shared model projection. Observed milestones are distinguished from tentative reroute/projection information. The separate customer screen is `/v5/customer`; it is illustrative and has no production authentication.

## Experimental toolboxes below

- **Research**: paired FCFS vs RELAY experiments using synthetic arrivals and capacities. Statistically valid for that *given synthetic model* only; cannot claim real-world cargo-cost reductions or completed physical routing.
- **OAG Data Sandbox**: Preview synthetic, OAG-like flight-instance fields; change status on a selected demo flight. This **does not alter** confirmed capacity or actual booking. It marks current decision stale and can block a conflicting review. Use JSON preview to see exact source labels.
- **Evidence ledger**: See INPUT → MODEL → DECISION event chains and actual solver messages. They are current process logs, not decorative invented reasons.
- **Live Integrity Audit**: See per-check PASS/FAIL for run-time invariants and *always-failed* production requirements. Those intentional production gaps are honest design warnings, not an application crash.

## What makes the UX safer

No manual JSON needed for core operator flows. Action controls are descriptive (rather than generic “Go” buttons), with post-action feedback; loading and empty states; persistent decision/snapshot/source labeling; stale-review blocking; and explicit nonclaims near uncertain data. The app **must not** be connected to real cargo systems without authentication/authorization and certified operational rules.
