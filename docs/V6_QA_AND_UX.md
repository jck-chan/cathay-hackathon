# RELAY v6 — UI/UX release notes and verification

## Goal and scope

v6 intentionally changes **presentation, discoverability, role-based workflows and interactive visualization**, not optimization mathematics. The original research core and v5 data/audit/OAG-shaped bridge are preserved. A production-*styled* front end does not imply a production-certified cargo operations platform.

## Design changes vs v5

1. **Information architecture:** replaced one long seven-section research/landing page with three mutually exclusive top tabs: Ground Twin, Control Tower, Customer Twin. All have direct operational tasks rather than starting with paragraphs.
2. **Visual identity:** predominantly white and cool gray with restrained green/teal. Built on native HTML, CSS and Canvas; no remote fonts, React dependency or screenshot-based props.
3. **Above-the-fold Ground Twin:** two real rotating, animated, light-mode 3D schematic worlds, one for FCFS and the other RELAY. Data from the existing v5 `policies` payload, not hardcoded cartoon order counts. Scene includes ULD pallets, equipment, workers, runway, planes, cold store and terminal.
4. **Dynamic visual lighting:** visual-only user-controlled + optional accelerated day/dusk/night cycle. We explicitly do not alter event-store time to manipulate lighting.
5. **Decision-first UX:** event, recommendation, scope, before/after impact and required operator action displayed early. Detailed solver outputs live in a sliding read-only evidence drawer.
6. **Internal review:** choose Advisory, Manual or Sandbox auto. Auto still uses the same v5 backend `/v5/api/review` and can only approve fresh proposals not blocked by external evidence. This is UI-mode, not extra physical authority.
7. **Customer Twin:** automatic portfolio from `shipment_objects`; no user-supplied AWB required. A draggable 3D globe illustrates a route using approximate airport coordinates (no observed GPS). Clicking a shipment loads current canonical customer projection, real synthetic milestone timestamps, ETA and recovery claims from backend.
8. **Mobile:** one-column stacking, reorganized tabs, accessible labeled controls, Escape for drawer, keyboard focus indication, CSS reduced motion preference.

## Executed test evidence (build environment)

- **47 passed**: `pytest -q tests/test_v6_ui_contracts.py upstream_tests` (11 new frontend API/UX contract tests + 36 underlying mathematical/data/safety regression tests).
- **17 passed**: `pytest -q tests/test_v5_contracts.py` including 500 CVaR tail quantile, 400 one-step Bayesian identities, 100 2D placement checks, exact small joint MILP oracle, OAG validation and event/source rules.
- **10 passed**: `pytest -q tests/test_v4_canonical.py -k 'not stress_replay_benchmark_honesty_and_seed'` (one older longer benchmark stress test omitted from that invocation; all selected passed).
- **13 passed**: `pytest -q tests/test_fusion_workflow.py -k 'not benchmarks_are_calculated_not_canned' tests/test_live_dispatch_v31.py -k 'not stress_repeated_high_arrival_events_no_solver_failure'` (stress / extensive benchmark tests omitted from that invocation, not claimed passed).
- **Chromium, real frontend execution with deterministic backend response fixtures:** rendered all three real v6 screens; stepped synthetic time, viewed model evidence drawer, displayed live AWB/customer projection, switched night lighting; zero page runtime errors, responsive 390px mobile screen with no horizontal overflow. Captured `tests/v6_ground_desktop.png`, `v6_ground_night.png`, `v6_control_tower.png`, `v6_customer_globe.png`, `v6_ground_mobile.png`.
- **Actual FastAPI HTTP at 127.0.0.1:9876:** verified `/`, `/v6`, v6 CSS/JS/3D bundle, v5 legacy UI, v5 state, audit, evidence, OAG sample, submitted `/v5/api/step` and `/v5/api/incident`, and fetched customer record with the same AWB returned by `/v5/api/state` (all returned HTTP 200).

**Testing limitation:** This build environment's Chromium disallows navigation to local HTTP targets (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). The browser used actual new frontend files with mocked responses *derived from the Python v5 engine*, and the live HTTP API was tested separately with Python. This is not the same as true browser-to-local-backend E2E on Windows. Other long-running original stress tests were excluded from the selected short regression suites. No production operations or client-specific security integration were tested.

## Truthful user-facing limitations

- The paired staging visualization uses a simplified discrete-event queue, not Model I physical 3D placement instructions. The two policies receive the same synthetic shipment IDs and timeline but should not be interpreted as certificated ground motion.
- The moving airplane on the ground and marker on globe are **visual choreography**, not aircraft telemetry or evidence of a booked route.
- Before/after staging and risk objectives are different cost models and not directly comparable; UI separates their selector and labels.
- No client-specific tenant authentication; the synthetic portfolio may mix synthetic client IDs. Not ready for a real multi-customer deployment.
- Model II verification values use local candidate-route proxy costs; full network recourse for every signal is not implemented.
- All approval actions remain simulation-only. Carrier status/capacity/booking must be separately confirmed.

## Remaining work before a real production pilot

Identity/access control, per-client tenancy, cloud data persistence, operator-approved aircraft/ULD physical validation, real OAG/Cathay authorisation, external inventory/booking reconciliation, security hardening, live monitoring, and human-in-the-loop shadow testing with actual historical data. None are silently represented as complete.
