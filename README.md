# RELAY — Every cargo decision has a consequence

**An interactive air-cargo decision-support demonstrator that helps operators decide what can move, what should move next, and how to use limited handling capacity.**

Built for the Cathay hackathon, RELAY turns cargo operations into a visible, testable decision loop: inspect the apron, check a shipment, prioritise the queue, assign work, and measure the outcome.

> **Prototype scope:** The current demo is **v13 Live Apron**, a synthetic research simulator. Flights, shipments, operator behaviours and costs are simulated. RELAY does not connect to airline inventory, make bookings or authorise real cargo movements.

## The problem

A cargo queue is more than a list of arrival times. A shipment may be urgent but missing paperwork, booked onto a flight nearing cutoff, dependent on cold-chain handling, or competing for the same crew as another shipment.

The decision has three parts:

1. **Can it move?** Check eligibility and operational constraints.
2. **What matters next?** Rank feasible work as conditions change.
3. **What can we actually execute?** Assign work within available capacity.

RELAY brings these questions into one interactive environment so a judge can see both the recommendation and its operational consequence.

## What we built

| Experience | What judges can explore |
| --- | --- |
| **Live Apron** | A 3D airport with aircraft movements, inbound cargo, staging, loading and exceptions. Drag cargo onto a stand and see the backend accept or reject the action with a reason. |
| **Decision support** | A changing priority leaderboard, feasibility checks and an autopilot that selects work within the simulated constraints. |
| **Evidence** | Replay identical synthetic worlds under manual and RELAY-assisted operator policies. Inspect paired effects, confidence intervals and downloadable result rows. |
| **How it works** | A plain-language explanation and a three-box puzzle that makes constraints tangible. |
| **Agent and MCP** | A chat interface and external-agent tools that inspect and operate the same simulation through a shared tool registry. |

The core interaction is deliberately concrete: **a recommendation becomes a checked action, and that action changes the world you can see.**

## Run the demo

**Requirements:** Python 3.10+ and a browser. The core v13 simulator uses the Python standard library; Three.js is bundled locally.

From the repository root, on macOS or Linux:

```bash
sh run_unix.sh
```

Open **[RELAY Live Apron](http://127.0.0.1:8766/)**. The launcher opens the browser automatically unless `RELAY_NO_BROWSER=1` is set.

For a direct launch on any platform:

```bash
python3 v13/server.py --port 8766 --open
```

On Windows, use `py` in place of `python3`. Running `v13/server.py` without a port argument uses port **8813**.

<details>
<summary>Run with Docker</summary>

```bash
docker build -t relay-fusion .
docker run --rm -p 127.0.0.1:8766:8766 relay-fusion
```

Open [localhost:8766](http://127.0.0.1:8766/).

</details>

## A five-minute judge walkthrough

1. **See the operation.** Open Live Apron and start the clock. Follow cargo from the inbound line into staging, then watch the available aircraft and flight cutoffs.
2. **Test a decision.** Pause and drag a shipment toward a stand. Green or red feedback shows feasibility; inspect the reason for a rejected assignment. Try an eligible shipment to see an accepted action.
3. **Add pressure.** Increase Cargo rate and advance the clock. Observe the priority ranking, staging occupancy, exceptions and free handling teams. New demand is admitted over time, so the effect is not instantaneous.
4. **Use decision support.** Enable Autopilot and observe how it assigns work. The event log makes the resulting actions inspectable.
5. **Check the evidence.** Open Evidence and run a paired study. Compare manual and assisted policies for both simulated new and senior operators; inspect differences and export the rows.

Use **How it works** to explain the decision logic. The agent is an optional extension; the apron and evidence demo do not require an AI API key.

## How the decision engine works

| Layer | Role in v13 | Scope |
| --- | --- | --- |
| **Model I — Feasibility** | Checks aircraft policy, route, booking authorisation, documents, holds, capacity, crew, cutoff and cold-chain limits. | Backend rules for this synthetic world; not certified aircraft loading. |
| **Model II — Priority** | Recomputes cargo priority as the simulated operation changes. | A modelled ranking policy, not an empirically validated airline policy. |
| **Model III — Assignment** | Uses bounded exact subset selection for assisted dispatch under limited handling capacity. | Exact within the bounded candidate problem; not a globally optimal airport schedule. |

The browser sends actions to the Python server. The server owns the simulation state and validates load requests. Chat and MCP use the shared tool registry to access that same world.

**Implementation:** Python simulation and HTTP server · Three.js 3D interface · Streamable HTTP MCP · optional gateway-backed chat.

## Evidence judges can inspect

The v13 Evidence tab runs four **simulated operator policies** on each generated world:

| | Manual | RELAY-assisted |
| --- | --- | --- |
| New operator | Novice manual policy | Novice assisted policy |
| Senior operator | Expert manual policy | Expert assisted policy |

All four receive identical exogenous arrivals, incidents and flights for each seed. This paired design supports comparisons within the simulator without confusing different input scenarios with policy effects. It is **not a study of human participants**.

The study reports booked-flight uplift, priority-one misses, unserved shipments, peak backlog, red-zone time, caught operator errors, modelled loss and average staging use. It includes per-world results and paired differences. Confidence intervals use mean ± 1.96 × standard error across seeds; they describe synthetic sampling variability, not real-world transferability. Small studies should be treated as exploratory.

**No real airline savings claim is made.** Modelled loss units have no validated currency conversion. The live study is the place to inspect v13 results for the chosen configuration.

## Why this matters

RELAY demonstrates three useful capabilities together:

- **Explainable operational decisions:** the interface exposes why a proposed load is blocked and makes the resulting action visible.
- **Testable assistance:** paired replay lets reviewers examine where a policy helps, where it does not, and what tradeoffs appear.
- **A shared interface for people and agents:** direct manipulation, chat and MCP operate on the same simulated state.

The intended value is better prioritisation under pressure, fewer avoidable assignment errors, and a practical environment for testing decision support. Establishing that value in airline operations would require calibrated data and an operational evaluation.

## From demonstrator to operational pilot

A credible next step is a read-only shadow pilot using authorised historical or operational data. That would require validating cargo rules with domain experts, calibrating arrival and handling assumptions, comparing recommendations against actual outcomes, and measuring both benefits and adverse cases.

Production use would additionally need identity and access controls, auditability, monitoring, integration contracts and operational certification where applicable. The prototype’s host and origin checks do not establish production readiness.

## Explore the implementation

| Resource | Contents |
| --- | --- |
| [v13 guide](v13/README.md) | Detailed controls, configuration, aircraft assets and MCP setup |
| [Simulation engine](v13/relay13/engine.py) | World generation, state transitions, guards, ranking and dispatch |
| [Evidence runner](v13/relay13/evidence.py) | Paired study, metrics and confidence intervals |
| [Agent tool registry](v13/relay13/tools.py) | Tools shared by chat and MCP |
| [Integrated research paper](docs/papers%20v13/RELAY_Integrated_Research.pdf) | Research background and model formulation |
| [Economic and operational value paper](docs/papers%20v13/RELAY_Economic_Operational_Value.pdf) | Supporting value analysis |

Run the v13 tests:

```bash
python3 -m unittest discover -s v13/tests
```

For optional chat, configure `AI_GATEWAY_API_KEY` and `RELAY_CHAT_MODEL`, or set `RELAY_CHAT_MODEL=demo` for the scripted offline agent. See the [v13 guide](v13/README.md#tab-4--agent-and-mcp) for configuration and the MCP connection URL.
