# RELAY v9 — QA and Operational Reality Notes

## Scope
Presentation / ground visualization overhaul of RELAY v8; all `relay/` mathematical implementation files, historical synthetic datasets and original Control Tower / Customer screens were preserved. The V8 conductor was modified only to apply a clearly labeled weather-as-resource **synthetic scenario** and to correct reporting of completed playback ticks per actual wall-clock interval. V9 is not a flight operations control system.

## What actually ran in this environment

| Check | Result | Caveat |
| --- | --- | --- |
| Browser actual WebGL2, desktop 1440×900 | PASS | Chromium in Linux virtual X display, ANGLE/GL; not user's Windows GPU |
| Rendered ground 3D, changed to top-down 2D, 3D again | PASS | Procedural meshes, not imported real-site models |
| Mouse interaction and idle camera setup | JS regression pass | Exact trackpad feel should be confirmed on Windows |
| Weather set to RAIN, crew 6, stands 6, orders rate 5 | PASS | Rain display and resource input, synthetic weather mapping |
| Live event toast creation, click Step, 100× speed selector, Start | PASS | UI uses offline state fixture; HTTP backend verified separately |
| Tower / Customer view switch in same browser | PASS | Controls remain previous versions |
| Chromium JavaScript exceptions | 0 observed | In tested interactions only |
| Document vertical overflow at 1440×900 | NONE | Smaller and mobile layouts vary |
| Offline Canvas fallback | PASS | This fallback is more schematic than WebGL2 |
| Mocked WebGL2 draw pipeline | 26,112 draw calls in initial execution, no JS errors | Not GPU/GLSL correctness proof |
| Python targeted V9 validation | 3/3 passed | Synthetic effective capacity + asset existence |
| V5 API/data contracts | 17/17 passed | Separate run |
| V7 product tests | 9/9 passed | Separate run |
| Upstream math/data invariants | 11/11 passed | Separate run |
| V8 sync selected subset | 10/10 passed (3 deselected) | One old assumption was deliberately updated: paused manual Step is **not** playback throughput |
| Real Uvicorn GET /, /v9_scene.js, /v9.js and POST /v8/api/control weather | HTTP 200 | Client and backend exercised separately because browser loopback forbidden by test policy |
| 100× playback benchmark | 20 ticks in ~6.66s, actual measured ~4.01 ticks/s | 100× target = 50 ticks/s; **not achieved** in test environment |

### Measured benchmark detail

For `seed=4082`, a 100× requested run produced `measured_ticks_per_second=4.01`, 20 observed completed ticks, no worker error, all three displayed state ticks equal. At 1×, target is 0.5 tick/s, so this is about **8× achieved** with that workload, not 100×. The former instantaneous solver-only speed metric has been removed from playback reporting. One outdated V8 test was updated to match that corrected meaning; no solver result was changed.

### Genuine relation between input, process, output

`Conductor.config` → `V7Lab.step(rate, chaos, effective_handlers, cold_bays, effective_stands)` → shared FCFS/RELAY policy snapshots → WebGL cargo queue / carts / staff / stand count. It does **not** run a collision-certified kinematic solver. Model I/II/III outputs remain sourced separately from the canonical state. Customer milestones remain source-derived vs *simulated* task progress vs *proposed* recovery and never auto-promoted to confirmed flight status.

### Open issues

1. The warehouse geometry, GSE lanes, aircraft dimensions and service patterns are illustrative procedural approximations. Cathay CCT is a real automated seven-storey terminal with significant additional systems, which these 3D objects simplify substantially.
2. Aircraft taxiing/airborne animation is a representative synthetic scenario, not sourced from OAG or transponder coordinates. Do not count it as observed aircraft movement.
3. Active cargo vehicles follow a fixed conceptual handling corridor with progress synchronized to simulated job progress. This is neither a collision-avoidance algorithm nor a proof that an AGV route is physically clear.
4. UI frame rate depends on available GPU; Linux software rendering in QA was substantially slower than a discrete-GPU Windows system may be. No guarantee of 60 FPS or 100× solver throughput.
5. Weather-to-capacity deltas are **arbitrary scenario assumptions**, intentionally visible as such. Do not present them as airline operating regulations or independently calibrated delay distributions.
6. Deep logical gaps in Model I/II/III noted in previous v7/v8 audits remain. This was a Ground Twin scene/UX release.
7. In this sandbox, Chromium can render WebGL2 in Xvfb, but browser navigation to localhost was blocked. Actual Uvicorn HTTP endpoints were checked separately; Windows browser→backend E2E remains unverified.

## Acceptance criteria for a future physically grounded twin

Operator-provided CAD/BIM/GIS and apron lane geometries; certified equipment paths and clearances; actual ULD metadata and restraint constraints; telemetry timestamps; measured service-time distributions; weather/METAR and safety stop logic; real role/account authentication; end-to-end incident replay with operator validation; measured GPU frame-time and stable solver throughput; randomized HIL/shadow-mode field replay; calibrated costs and confidence intervals.
