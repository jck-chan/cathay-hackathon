# RELAY Fusion v5 — Executed QA, nonclaims and acceptance status

Test date: 10 November 2026. Environment: Python 3.13 Linux sandbox, FastAPI TestClient, SciPy/HiGHS, Node.js and a local HTTP server. **No Cathay, OAG or external operational systems were contacted. No Windows machine was available. Chromium could inspect *static injected HTML/CSS* at desktop and mobile widths, but the environment blocked browser network access to the local HTTP server, so **live-browser functional testing was not completed**.**

## Verified numerical / structural tests

- **78/78** Python tests passed when running `PYTHONPATH=. python -m pytest -q tests upstream_tests --disable-warnings`. The suite contains 61 inherited tests and 17 new v5 tests; see actual test files for case definitions. A change to v5 homepage text initially broke one v4 legacy contract test (77/78), and that backwards-compatibility defect was fixed prior to final rerun.
- 500 randomized CVaR calculations independently compared against a directly integrated upper-tail mass oracle.
- 400 randomized one-step Bayesian value identities / posterior probability masses (within documented rounding tolerance).
- 100 randomized 2D placement cases: within its finite library, nominal-budget compliance and risk non-degradation.
- Two shipment/two flight example: MILP risk objective checked against independently exhaustive feasible allocations and two shared capacities.
- Randomized replay/determinism against both dual-staging policies with equal canonical admitted work IDs.
- Catalog integrity **10 checks / 10 pass** on 429 flights, 636 shipments, 793 pieces, 14 ULDs and 5120 synthetic events.
- Runtime health/audit endpoint exposes **22 evaluated internal checks** plus **4 intentionally unmet production requirements** (3D safety, true multi-stage Bayes, Graver routing, empirically validated Cathay data). These numbers **are not a general production compliance score**.
- OAG public-schema-shaped envelope: parse normal samples; reject invalid/incomplete/duplicate identities, malformed envelope and wrong flight states; never synthesize non-null cargo availability or booking confirmations.
- Case review invalidated after new OAG-shaped synthetic observation; contradictory proposed flight cannot be approved without independent confirmation even after rerun.
- Legacy routes and modern four-step UI were run against a local HTTP FastAPI service; the browser-free Node.js DOM integration driver completed the guided flow, external mock, audit and evidence, customer and paired benchmark pathways.

## Known non-pass / non-implementation categories

| Category | Current result |
|---|---|
| Full 3D physical ULD safety | NOT IMPLEMENTED / UNSAFE TO CLAIM |
| Full global three-paper stochastic optimization | NOT IMPLEMENTED; partial approximations only |
| Full Graver basis / cluster exchange operational routing | NOT IMPLEMENTED |
| Multi-step belief MDP and verification scheduling | NOT IMPLEMENTED |
| Real OAG licensed data API call, rate handling, alerts ingestion | NOT IMPLEMENTED; **schema-only mock** |
| Real Cathay available cargo inventory / booking / airworthiness | NO ACCESS / NOT VALIDATED |
| Real demand/delay/cost calibration | NO GROUND TRUTH |
| True cost/ROI or real delivery SLA benefits | NOT MEASURED |
| Visual layout acceptance | STATIC desktop/mobile Chromium screenshots produced, no horizontal overflow at 390px; live HTTP browser navigation blocked by environment policy |
| Windows 11 installer/end-to-end run | NOT RUN in user environment |
| Security/role-based production review | NOT PRESENT; sandbox only |

## How to re-run

```bash
python -m pytest -q tests upstream_tests
```

For manual UI: `python launch.py`, open `http://127.0.0.1:8765/`, use guided controls, inspect `http://127.0.0.1:8765/v5/api/audit`, then inspect `http://127.0.0.1:8765/v5/api/evidence`. To test external-warning semantics, use the OAG Preview and Set Demo Flight Indicator controls; the proposal must not be marked booked or actually update capacity.

## Release acceptance criteria

1. Every new v5 endpoint returns valid status with semantic error codes; invalid inputs don't produce internal stack traces on common cases.
2. All automated tests pass without relaxing safety-relevant inherited assertions.
3. A fresh ZIP extraction can import `fusion_app`, `v5_lab`, `oag_bridge`; required static files/data are present.
4. OAG external observations are strictly `SYNTHETIC` and never book cargo or silently mutate carrier inventory.
5. Model scopes and confidence boundaries are visible in UI and machine-readable responses.
6. Current proposed actions never become real commands; all review approvals explicitly `SIMULATION_ONLY`.

**Qualification:** This is a research/hackathon software QA statement, not safety, regulatory, cyber or commercial readiness certification.
