# RELAY Fusion v3.1 — QA Report

## Verified in this environment

- **50/50 Python automated tests passed** (`python -m pytest -q tests upstream_tests`): 36 original v2 tests, 9 full-stack tests, plus 5 v3.1 dispatch robustness tests.
- **Frontend JS parses cleanly:** `node --check static/show.js` and `node --check static/fusion.js`.
- **Node mock-DOM + real local HTTP integration:** PASS. Confirmed event listeners, actual analysis call, Model I/III rendering, simulated review/task creation, AWB customer projection, network time advancement.
- **Original live showcase remains operational:** deterministic seeded resets, 3D-state snapshot, 540-tick overloaded stress experiment, computed paired queue metrics.
- **Model II/III workflow:** a new decision is bound to a snapshot version; changed evidence makes a prior unapproved decision stale and rejects approval with HTTP 409.
- **Review safety:** approval creates simulated departmental tasks only. Dependencies reject out-of-order completion. Customer tracking shows internal approval as unconfirmed booking.
- **Research calculations:** v2 10,000 shared scenario Monte Carlo draws run in 0.016s; original showcase 10,000 synthetic episodes computed in 0.465s on this CPU. Different synthetic data distributions; do NOT mix them.
- **Double-entry UI test:** `tests/test_fusion_dom_node.js` verifies core button wiring by calling the running server and asserting populated results.
- **No duplicates/missing DOM IDs:** 97 distinct IDs present in `static/index.html`, with all static element references matched.

## Important limits

- The browser available in the container returned `ERR_BLOCKED_BY_ADMINISTRATOR` even for localhost. This prevented end-to-end visual screenshot QA, despite real HTTP and mocked-DOM tests passing. Do not claim visual/browser/Windows certification.
- Windows `.bat` launcher is supplied but not executed on Windows in this environment.
- The upper paired 3D warehouse queue and lower Model I/II/III network solver operate on separate synthetic datasets; v2 plans are individually visualized in a third planning canvas. They are NOT the same cargo record stream.
- No aircraft/ULD physical certification, real booking confirmation, real ground crew, Cathay API connection, or true monetary ROI is claimed.

## Repeat commands

```
python -m pytest -q tests upstream_tests
node --check static/show.js
node --check static/fusion.js
# start server in one window: python launch.py
# second window: TEST_PORT=8765 node tests/test_fusion_dom_node.js
```

## v3.1 reliability regression (new)

- General HiGHS timeout removed from *live dispatch only*. The two-class
  selection is solved exactly by sorting and cold-slot enumeration.
- 200 randomized small cases verified against exhaustive enumeration.
- 540 ticks in overload mode (`arrivals=5`, `chaos=1`, one handler, no
  cold bay): no exception; queues hold ineligible cold jobs rather than
  exceeding hard capacity.
- A seeded replay of 84 ticks yields identical chosen jobs and costs.
- Separate Model III network MILP still runs in the original v2 engine.
- No claims of physical flight safety or live Cathay authorization.

## Clean-archive HTTP smoke test

After extracting the v3.1 release ZIP into an empty directory, started the
FastAPI/Uvicorn process on a temporary local port using Python (no browser):

- `/health` returned HTTP 200 with `ok: true`.
- Reset `seed=42, arrivals=5, chaos=1, handlers=1, stands=1, cold_bays=0`.
- Submitted 30 HTTP `POST /api/live/step` requests, each `count=12`.
- Reached tick 360 with 2,050 generated synthetic orders, no 500 errors.
- At tick 360 there were 1,923 waiting relay orders, with available capacity
  exhausted; this was logged as `RESOURCE_BLOCKED`, not a solver exception.
- GET `/`, `/docs`, `/customer`, `/fusion/health`, `/api/live/state` all
  returned HTTP 200.

The oversized queue intentionally demonstrates overload handling; it is not
proof of real airport throughput or operational feasibility.
