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
  a speed dropdown (0.25× to 16×), base TPS, measured TPS, a cargo-rate dropdown and Autopilot.
  One tick is one simulated minute. The effective rate is TPS × multiplier.
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
  - **Staging capacity**: the hard cap with waiting, loading and ready segments; the
    inbound line; exceptions; free handling teams; demand pressure; and a 4-hour sparkline.

Tabs 2 and 3 are placeholders.

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
| `server.py` | stdlib HTTP server and the background sim clock (`/api/state`, `/api/control`, `/api/step`, `/api/reset`, `/api/check`, `/api/load`, `/api/offload`) |
| `relay13/engine.py` | world generator (stand rotations, bookings, incidents), the `Simulation` state machine, ranking, autopilot (bounded exact subset), `snake_dp` |
| `relay13/aircraft.py` | aircraft types, per-type policy, `AirportConfig` |
| `static/js/scene/*` | renderer and sky (`world.js`), aircraft motion (`aircraft.js`), cargo units and tags (`cargo.js`), drag and drop (`interaction.js`), procedural PBR textures (`textures.js`), coordinates and paths (`layout.js`) |
| `static/js/ui/*` | ranking, log and staging panels; icons |
