# RELAY V10 QA / testing evidence

**Scope:** verified locally against copied V9 source; no assertion of complete production certification.

## Tests executed

- `pytest tests/test_v10_experience.py -q`: **10/10 passed**
- `pytest tests/test_v6_ui_contracts.py -q`: **11/11 passed**
- `pytest tests/test_v9_ground.py -q`: **3/3 passed**
- Chromium via `xvfb-run -a env V10_HEADED=1 python tests/v10_browser_qa.py`: **passed** with **zero page JavaScript exceptions**. Screenshots: Ground initial, Ground with selected tick-18 state, Ground insights, Control Tower, Customer Globe. Native WebGL2 was actually available.
- Controlled animation fixture: backend-generated tick-18 state, explicit `running=true`, requested speed 100×, measured ticks/s fixture 4.0. UI displayed **7.0× visual tempo**, **4.00 verified ticks/s fixture** (clearly separated). Across screenshots about 0.85 seconds apart, approximately **8.9%** left and **9.8%** right of 3D scene pixels changed materially (>25 channel intensity), indicating movement rather than static tick counters. Because throughput in this screenshot fixture was injected, it is a visual QA result, not a measured solver benchmark.
- Separate **real engine** measurement: 4-second run at requested 100× reached tick 16; instantaneous / sampled actual throughput **3.22 ticks/s**, target 50 ticks/s, no worker error. This measurement is environment- and scenario-dependent.
- `python -m compileall` and `node --check` passed for changed Python/JS.
- `GET /`, `/v10`, `/v10.css`, `/v10_scene.js`, `/v10_ui.js`, `/v8/api/state` smoke tests all HTTP 200.

## Incomplete test coverage / unresolved items

- Full historical monolithic pytest run exceeded the requested environment timeout after 27 passing tests. A separate v8 sync group likewise timed out after 9 passing tests. **Do not claim the complete historical suite passed**.
- Browser Chromium UI tests run with backend snapshots captured by TestClient injected into an offline page due local Chromium navigation policy. They validate real rendering, events, and interactions but are NOT a full networked E2E browser test against a live Windows server. API contracts tested separately.
- Windows hardware, GPU drivers and exact screen-size interactions require on-device validation.
- No airline safety certification, independent external data calibration or real revenue/cost efficacy study.

## Meaningful truth constraints

- WebGL particles and elevated route arcs are representational, not real positions.
- No backend solver was replaced by an animation.
- `AUTO` weather updates are internally seeded scenarios, not empirical forecasts.
- Internal sandbox approval never implies carrier booking confirmation.
