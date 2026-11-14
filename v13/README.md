# RELAY v13 — Live Apron

A self-contained version of RELAY: a 3D airport apron where cargo arrives on an inbound
line, waits in an accumulation area, and is dragged onto aircraft. A backend guard accepts
or refuses every drop. The decision engine is ported from the RELAY v17 research code that
backs the papers in [`../docs/papers v13`](../docs/papers%20v13). It reuses nothing from
v11 or earlier versions.

> Synthetic research demonstrator. It is not certified loading, Cathay inventory, an SOP or
> a dangerous-goods permission. All flights, shipments, probabilities and costs are made up.

## Run

```bash
python3 v13/server.py --open
```

The server needs only the Python 3.10+ standard library. Three.js 0.170 is vendored under
`static/vendor`, so the app needs no network access. The server binds to
`http://127.0.0.1:8813`.

```bash
python3 -m unittest discover -s v13/tests
```

## Tab 1 — Live apron

- **Top bar** (shown on every tab): Start/Pause (Space) with New world beside it, Step *n* ticks,
  **Target TPS** (a styled preset list you can also type into; 1 tick = 1 simulated minute) next to
  the measured TPS, a cargo-rate dropdown and Autopilot.
- **3D viewport (75 %)**:
  - Five stands. Aircraft land with a 3° glide slope and flare, roll out, taxi in nose-in,
    push back, taxi out, take off and climb.
  - An inbound belt delivers cargo to the accumulation area.
  - Missed cargo goes to the exception desk.
  - Every unit carries a tag with its priority rank, colour-tinted by intensity. The tag
    shows the category, PR tier, flight and minutes to cutoff. Hover a unit to see its
    full details.
- **Drag and drop**: grab a unit from the line or the accumulation area and drop it on an
  aircraft or its stand.
  - While you drag, each stand turns green or red from `/api/check`. A red aircraft label
    shows the reason.
  - After the drop, the `check()` guard (Model I) accepts or refuses. It tests, in order:
    aircraft-type policy, route, booking authorisation, documents, mandatory holds,
    ULD/kg capacity, handling crew, cutoff including decision time, and the cold-chain
    limit.
  - To offload, drag a loading or ready unit back to the accumulation area.
- **Right column (25 %)**:
  - **Priority ranking**: Model II score, recomputed every 5 simulated minutes. Rows move
    like a race leaderboard, with ▲/▼ markers and NEW badges.
  - **Event log**: plain-language entries with an icon per type, plus filters.
  - **Staging capacity**: the live fill with the run average beside it, the hard cap with waiting, loading and ready segments; the
    inbound line; exceptions; free handling teams; demand pressure; and a 4-hour sparkline.

## Tab 2 — Evidence

The paired role study from the v13 papers, run live by `relay13/evidence.py`: each synthetic world
is replayed by a new and a senior operator, each working manually and with RELAY, with identical
arrivals, incidents and flights. The tab shows paired-effect tiles (mean difference, 95% CI, worlds
where RELAY was better), one bar chart per metric (mean ± 95% CI), backlog over the day, the paired
effect table and every world/role row with a CSV download. Choose worlds, days, scenario and cargo
rate and press **Run study**; the default study is computed in the background at start-up.

## Tab 3 — How it works

A plain-language walkthrough of RELAY’s checks, priorities and crew assignment. A three-box
puzzle lets you see how missing paperwork changes what can be loaded. The tab also explains
where the snake-graph research fits and shows results from one synthetic 30-day study.

## Tab 4 — Agent and MCP

A chat agent ported from the v11 agent page (`static/js/ui/chat.js`, `relay13/chat.py`): streamed
reasoning, tool-call cards, interactive artifacts (sandboxed panels that call simulation tools
through `relay.call`) and a link to the live apron.

- **Model**: reached through the **Vercel AI Gateway** (Anthropic Messages format, like v11).
  The default model is `google/gemini-4-hydrogen`; override it with `RELAY_CHAT_MODEL`.
  Set `RELAY_CHAT_MODEL=demo` for a scripted offline agent that needs no key.
- **Credentials**: `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN`) from the environment or the
  nearest `.env` at or above `v13/`, so a worktree uses its main checkout's `.env`.
- **MCP**: `http://127.0.0.1:8813/mcp` (Streamable HTTP, stateless, JSON responses). External
  agents get the same tools the chat uses: `get_state`, `list_cargo`, `check_cargo`, `load_cargo`,
  `offload_cargo`, `control_simulation`, `step_simulation`, `new_world` and `run_evidence`.

  ```bash
  claude mcp add --transport http relay-v13 http://127.0.0.1:8813/mcp
  ```

- **Origin safety**: the server binds `127.0.0.1` and checks every request. A `Host` header
  that is not loopback gets 421, which blocks DNS rebinding. A browser `Origin` that is not
  loopback gets 403, which blocks cross-site use. A `POST` without `application/json` gets 415,
  which closes the simple-request CSRF hole. CORS headers are returned only to allowed origins.
  To allow more, set `RELAY_ALLOWED_ORIGINS=https://app.example` or
  `RELAY_ALLOWED_HOSTS=myhost:8813`.

## Aircraft types and fleet size

[`relay13/aircraft.py`](relay13/aircraft.py) defines seven types, each with its own synthetic
cargo policy (hold type, positions, payload, maximum piece weight, accepted categories):

| Type | Model file (`static/assets/aircraft/`) | Hold |
| --- | --- | --- |
| Airbus A330-300 | `a330-300.glb` (local only, see below) | ULD |
| Airbus A350-900 | `a350-cathay.glb` | ULD |
| Airbus A350-1000 | `a350-cathay.glb` (same airframe, stretched) | ULD |
| Boeing 777-300ER | `b777-300er.glb` | ULD |
| Boeing 747-8F | `b747-8f.glb` | freighter main deck |
| Boeing 747-400ERF | `b747-400erf.glb` | freighter main deck |
| Airbus A321neo | no model yet, uses the A330 stand-in | bulk only: no DG, no active pharma, ≤200 kg pieces |

The loader turns every model nose-forward automatically and stretches it to the type's real
length and span. If a GLB is missing it falls back to the A330, then the A350.
Credits, licences and editable sources are in [`assets_src/aircraft`](assets_src/aircraft/ASSET_CREDITS.md).
The A330 GLB is CC BY-NC-SA and kept out of Git as a local-use copy, like the upstream
asset folder does; without it the A330 and A321neo stands show the A350 airframe.

`AirportConfig` holds the class-level settings: `stands` (default 5), `enabled_types`,
`shipments_per_flight`, staging cap, handling teams and so on. The frontend builds the apron from
whatever stand count the server reports.

### Cargo rate

The **Cargo rate** dropdown (¼× to 3×) changes how much cargo is booked from now on. Each world
holds a 3× booking pool; the rate admits that share of it with a fixed per-shipment draw, so the
change applies mid-run without regenerating the world. **New world** keeps the chosen rate.

## Layout

| Path | Contents |
| --- | --- |
| `server.py` | stdlib HTTP server, background sim clock, origin/host guard (`/api/*`, `/api/evidence`, `/api/chat`, `/mcp`) |
| `relay13/tools.py` | the tool registry shared by MCP and the chat agent |
| `relay13/mcp.py` | MCP JSON-RPC handler |
| `relay13/chat.py` | agent loop over the Vercel AI Gateway, AI SDK UI message stream |
| `relay13/evidence.py` | paired four-role study |
| `relay13/engine.py` | world generator (stand rotations, bookings, incidents), the `Simulation` state machine, ranking, autopilot (bounded exact subset), `snake_dp` |
| `relay13/aircraft.py` | aircraft types, per-type policy, `AirportConfig` |
| `static/js/scene/*` | renderer and sky (`world.js`), aircraft motion (`aircraft.js`), cargo units and tags (`cargo.js`), drag and drop (`interaction.js`), procedural PBR textures (`textures.js`), coordinates and paths (`layout.js`) |
| `static/js/ui/*` | ranking, log and staging panels; icons |
