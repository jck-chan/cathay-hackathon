# RELAY Fusion v11 — Three Digital Twins

**Three synchronized light-theme digital twins + bounded mathematical decision engine + reproducible synthetic effectiveness benchmark.**

**IMPORTANT:** This is a **LOCAL synthetic shadow-mode research prototype**, **not airline production software**. It does not connect to Cathay/OAG live credentials, confirm airline bookings, issue real cargo commands, certify ULD loading, or establish real ROI. Simulated cargo penalty units have no known HKD conversion.


Open `/` or `/v11` for Ground, Control Tower, and Customer. Open
`/v11/evidence` for the Evidence Lab. The three views and chat use the
`/v11/api/*` routes, and the simulation tools are available at `/mcp`.
Earlier releases are available in Git history.

### v11 sandboxes

Ground Twin opens the first two listed sandboxes. Each pane can select any
sandbox by name, including the same sandbox in both panes. Choose **Create
sandbox…**, enter a name, and choose a dispatch policy (FCFS, RELAY v10, RELAY
v11, RELAY + Model A, or RELAY + EDF). The new sandbox opens in that pane and
appears in both menus. Use the trash button beside a
sandbox to delete it. Ground environment controls apply to the distinct sandboxes on display.
Playback controls apply to every sandbox.

`GET /v11/api/sandboxes` lists IDs, names and dispatch policies in display
order. `GET /v11/api/sandbox-models` lists the dispatch model IDs and names.
`POST /v11/api/sandboxes` accepts a name and optional policy and seed,
and returns the created sandbox's ID.
`DELETE /v11/api/sandboxes/{sandbox_id}` stops and removes a sandbox.
Pass `sandbox_id` as a query parameter to REST simulation routes. REST calls
without an ID use the initial RELAY sandbox when available, or the first
remaining sandbox. **MCP reads and sandbox-local writes** target all current
sandboxes by default, unless `scope="sandboxes"` and
`sandbox_ids=["id1", "id2"]` select a subset. Results identify each sandbox
and report partial failures; single-sandbox reads are returned in the same
batch envelope. Created sandboxes are available until deletion or restart.

### Adding agents to the three twins

Put new agent code under `v11/agents/` and use the HTTP routes defined in
`v11/api.py`. The shared clock and simulation controls live in `v11/conductor.py`.

| Suggested file | API calls |
|---|---|
| `v11/agents/control_centre.py` | Read `GET /v11/api/state`, set `MANUAL_REVIEW` through `POST /v11/api/control`, and submit decisions to `POST /v11/api/review`. |
| `v11/agents/ground_worker.py` | Post disruptions to `/v11/api/incident` and tune environment settings through `/v11/api/control`. |
| `v11/agents/customer.py` | Submit synthetic orders to `POST /v11/api/order` and track the returned AWB with `GET /v11/api/state?awb=…`. |

### Connect an MCP harness

From the project folder, run `sh run_unix.sh` on macOS or Linux, or run
`run_windows.bat` on Windows. These scripts install the required packages and
start the same server that serves the dashboard. Leave the server running and
add `http://127.0.0.1:8766/mcp` to a local harness using **Streamable HTTP**.
The local server requires no token. If you set `RELAY_PORT`, use that port in
the URL. The older `/v11/mcp` URL still works.

Each tool name starts with the view it belongs to. The server sends the same
guide to the harness in the `instructions` field of its MCP `initialize` reply.

| View | Prefix | MCP tools |
|---|---|---|
| Ground environment | `ground_` | `ground_list_sandboxes`, `ground_create_sandbox`, `ground_delete_sandbox`, `ground_start_simulation`, `ground_pause_simulation`, `ground_step_simulation`, `ground_set_playback_speed`, `ground_configure_environment`, `ground_inject_incident` |
| Control centre | `control_` | `control_get_state`, `control_set_review_mode`, `control_recalculate_decision`, `control_review_decision`, `control_mark_task_done` |
| Customer | `customer_` | `customer_place_order`, `customer_place_order_all_sandboxes`, `customer_track_shipment` |

**MCP step example**

```json
{"count": 5}
```

Advances every sandbox by five ticks. To return snapshots for only two:

```json
{"count": 5, "scope": "sandboxes", "sandbox_ids": ["relay", "fcfs"]}
```

All v11 sandboxes advance on one server-owned clock. Play, pause, step, speed
and reset affect every sandbox. A new sandbox simulates up to the current tick
using its own starting seed and policy. On MCP playback tools, scope selects
which sandbox snapshots are returned.

Each sandbox keeps its own shipments, flights, decisions and environment
settings. The Control Tower and shipment tracking views each let you select a
sandbox. Order fan-out assigns one synthetic AWB for cross-policy comparison.
Check `complete`, `results`, and `failed` on batch operations. Reviews and task
completion may fail in sandboxes with different decision or task IDs.

Reset stays in the dashboard and REST API. Open the Evidence Lab to run
benchmarks. Orders, reviews, and ground work through MCP are synthetic.

#### Agent workflow (MCP)

The MCP `initialize.instructions` field contains the operational playbook,
and each tool describes its inputs and effects. An agent can
follow this example without referring to application source code:

1. **Inspect and pause:** `control_get_state`, `ground_pause_simulation`,
   `control_set_review_mode(mode="MANUAL_REVIEW")`.
2. **Create and track:** `customer_place_order` returns a synthetic AWB;
   pass it to `customer_track_shipment`. The request is not a booking.
3. **Stress the scenario:** change resources/weather with
   `ground_configure_environment`, or inject an event through
   `ground_inject_incident` (the server selects the affected entity).
4. **Recompute and review:** `control_recalculate_decision`, then read
   `control_get_state.decision` for its ID, **decision.snapshot_version**,
   warnings, status, model outputs and scope. Only then call
   `control_review_decision` with a matching ID/version. Do not use the
   top-level snapshot version in place of the decision's own version.
5. **Follow dependent work:** inspect `tasks[].depends_on_task_id`, and
   use `control_mark_task_done` only for appropriate synthetic tasks.
6. **Advance and verify:** `ground_step_simulation(count=3)` while paused
   (10 simulated minutes per tick), then read state and track the AWB again.
   New ticks may replace the current decision, even after prior approval.

**Interpretation:** Model I is bounded 2D placement, not aircraft-certified
3D loading; Model II is a one-step uncertainty gate, not full sequential
Bayesian control; Model III is finite-candidate routing MILP, not a carrier
booking or an unbounded optimum. Ground staging completion is not a flight
milestone; approval and tentative arrival do not change confirmed customer
ETA. `AUTO_SHADOW` auto-reviews eligible sandbox proposals;
`MANUAL_REVIEW` requires explicit approval; `ADVISORY` disables
automatic review. Views and MCP clients targeting the same sandbox share its state.

### AI chat tab

`/v11#chat` is a chat with an agent that operates the three twins. The harness
is in `v11/chat.py`: a LangChain agent whose tools are read from the MCP server
at startup, so adding, removing or changing an MCP tool needs no harness change.
One extra local tool, `create_artifact`, renders an interactive HTML panel in
the chat; the panel runs in a sandboxed frame and reaches the simulation only
through `POST /v11/api/chat/tool`, which accepts MCP tool names. The agent can
also write `<relay-twin view="ground|tower|customer" />` in a reply to embed a
live twin. Add `sandbox_id="…"` to show a specific sandbox and `awb="…"`
on a Customer Twin to focus a shipment. **Open tab** carries that selection
into the workspace.

`POST /v11/api/chat` speaks the Vercel AI SDK UI message stream protocol, so an
AI SDK `useChat` client can use it as well as the bundled tab.

| Setting | Meaning |
|---|---|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key, from the environment or a `.env` file in the project folder. Model calls go to `https://ai-gateway.vercel.sh`. |
| `RELAY_CHAT_MODEL` | Gateway model ID (default `google/gemini-4-hydrogen`), or `demo` for a scripted offline model that needs no key. |
| `ANTHROPIC_API_KEY` | Used only when no gateway key is set: calls Anthropic directly (default model `claude-opus-5-5`). |
| `RELAY_CHAT_EFFORT` | Thinking effort for Claude models: `low`, `medium` (default), `high`, `xhigh` or `max`. |

The harness is built for prompt caching. The system prompt and tool list never
change between requests, and the server keeps each chat's exact messages, so
every turn re-sends the previous request unchanged and appends to it. History
is only cut once it passes about 150k tokens, and then at fixed block
boundaries so the cut does not move on every turn.

## Windows: install and start

1. Open the project folder containing `run_windows.bat`.
2. Stop any previous RELAY server using `127.0.0.1:8766` (Ctrl+C).
3. Double-click `run_windows.bat`. It makes a standalone `.venv` and installs requirements if missing.
4. Open **http://127.0.0.1:8766/** or **http://127.0.0.1:8766/v11** for the Ground, Control Tower, and Customer twins.
5. Open **http://127.0.0.1:8766/v11/evidence** for interactive cost, SLA, risk, probability, convergence and strictly hypothetical ROI visualizations.
6. API docs: **http://127.0.0.1:8766/docs**.

PowerShell (from the folder containing `launch.py`):

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe launch.py
```

## Run with Docker

From the project folder:

```sh
docker build -t relay-fusion .
docker run --rm -p 127.0.0.1:8766:8766 relay-fusion
```

Open the [RELAY interface](http://127.0.0.1:8766/). To enable chat with your local
`.env` file, add `--env-file .env` before the image name in the run command.

On Railway, browser writes use the HTTPS origin of `RAILWAY_PUBLIC_DOMAIN`.
If you open RELAY through a different public hostname, set `RELAY_PUBLIC_DOMAIN`
to that hostname, for example `relay.example.com`, without a scheme or path.

## What changed in v11

- **Original v10 Ground / Control Tower / Customer visual design preserved.** It keeps WebGL2/Cinematic ground simulation, Bayesian/2D/MILP visual cards, animated elevated customer flight arcs, event feed and shared clock.
- **Ground-stage policy improved** with a small exact within-tick two-class (normal/cold) candidate selection using observable deadline risk, priority, job duration and recovery-sensitive urgency. Under one-server scarcity it explicitly falls back to feasible FCFS; this is NOT a globally optimal airline recovery controller.
- **Nonpreemptive cold job outage guard:** sudden loss of cold-capacity does not crash an already active cold job. New cold assignments remain forbidden until capacity recovers. Real cold-chain safety should be explicitly audited and externally certified.
- **New paired benchmark**: 24 ticks of synthetic Poisson arrivals, then up to 110 drain ticks; all admitted work remains in the SLA denominator, and unresolved tasks have explicit penalties. Three policies (FCFS, v10, v11) use identical episode inputs.
- **6 synthetic operating conditions × 500 paired episodes**, pinned seed 2026, plus an independent seed 707 replicate. Percentage savings, paired-bootstrap CI, on-time rate (pp), tail episode CVaR, distribution of adverse cases, backlog and lead time.
- **Evidence & KPI Studio** with 10 charts, frequency, statistical convergence, risk distribution, cost composition, scenario probability mixing, hypothetical ROI and a negative recovery-clearance counterexample. Charts available as presentation-ready PNGs and episode-level raw CSVs in `reports/`.
- **Data/lineage audits** on the 30-day synthetic historical dataset and cross-Twin read-only consistency.
- **Local cross-site write protection**, not authentication/RBAC/customer tenancy.

## Reproduce results

```powershell
.\.venv\Scripts\python.exe scripts\export_v11_report.py
.\.venv\Scripts\python.exe scripts\export_v11_advanced.py
.\.venv\Scripts\python.exe scripts\export_v11_operational.py
.\.venv\Scripts\python.exe -m pytest -q upstream_tests tests\test_v11_quality.py
```

The test suite includes slow stress and benchmark cases. `scripts/v11_offline_visual_qa.py` is an optional offline UI check that needs Chromium and Playwright.

## Key pinned synthetic percentages (seed 2026, 500 paired episodes per case)

| Scenario | v11 cost reduction vs FCFS | Full-cohort on-time rate gain (pp) | Cost CVaR90 tail reduction |
|---|---:|---:|---:|
| Normal | +8.045% | +23.562 | +11.417% |
| Peak | +16.658% | +28.066 | +16.495% |
| Crew shortage | 0.000% | 0.000 | 0.000% |
| Cold outage | +2.411% | +23.756 | +2.423% |
| High capacity | +9.951% | +28.755 | +15.004% |
| Temporary disruption | +9.537% | +14.171 | +10.197% |

Cost is **modeled unitless penalty**, not real airline expenditure. The 95% confidence intervals are *synthetic sampling uncertainty*, not uncertainty in transferring results to Cathay.

Under the temporary disruption scenario, v11 is **15.1% slower** than FCFS to clear 90% of the already-affected backlog. This material counterexample must be disclosed. Real-world risk probabilities, dollar mapping, and trip recovery speed are unvalidated.

## Reuse / responsibilities

- `relay/` — bounded physical diagnostics, finite one-step PIVOT, finite-column HiGHS scenario MILP; the incomplete research-to-production scope remains intact.
- `v11/` — reproducible benchmark, read-only QA and original-v10 percentage denominators.
- `static/v11.html` — three synced digital-twin views; `static/v11_evidence.html` — KPI evidence/report interface.
- `reports/` — pinned JSON, raw CSV (18 policy-scenario pairs and 9,000 episode-policy rows), charts and example browser QA images.
- `docs/V11_ENG_QA_AND_ROI.md` — formal interpretation and remaining limitations.

**v11 is scientifically more auditable, not certified or proven perfect.**
