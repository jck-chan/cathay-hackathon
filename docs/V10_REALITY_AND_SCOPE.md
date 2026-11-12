# V10 evidence and simulation boundaries

| Component | Input authority | Display | What is not claimed |
|---|---|---|---|
| Ground jobs | `policies.fcfs/relay.objects`, `waiting/active/completed` from server | Queue stacks, conveyors, moving tractors, bursts on completed count rise | Individually scanned, physically validated ULD/GSE coordinates |
| Ground aircraft | Stand count (modeled) and animation storyboard (decorative) | Taxi, aircraft departure loops | Actual flight identity, real apron coordinates, runway clearance |
| Weather | Seeded synthetic `AUTO` or manually selected category | Light/fog/rain and synthetic resource variation | METAR feed, historical weather observations, airport policy |
| Speed | Requested multiplier vs actual completed ticks/s | 3 separate indicators including cinematic visual tempo | Numerical engine running at 100× if throughput below target |
| Model I | `model_i.placements` and status | Bounded 2D placement diagram | Aircraft-certified 3D load/restraint |
| Model II | `model_ii.cases` and prior | Probability diagram if available | Multi-step Bayesian inference or observed sensor accuracy |
| Model III | `model_iii.routes`, `candidate_columns`, `gap` | Graph and animated route traversal | Executed Graver mutations, real airline booking |
| Customer routes | `shipment_objects` admitted to synthetic store | All destination arcs colored by risk/priority/status | Current airplane GPS, any outside airline confirmation |
| Customer ETA/status | `customer_projection`, `route_decision`, milestones | Shipment journey and disclosure | Carrier-confirmed ETA from an internal proposal |

## Important caveats

- **Visual speed != computational speed.** V10 intentionally makes high-speed playback feel energetic. It can show work-in-progress moving continuously between authoritatively observed snapshots, but DOES NOT invent solver completions, confirmations or awards.
- **3D animation != verified physics.** Choreography follows schematic terminal lanes and job status; it has no certified collision model, exact equipment dimensions, real ramp dynamics or ground-right-of-way.
- **Mathematical visualization != a trace of solver internal search.** Network dots animate over a solved assignment, not each MILP branch, and not a cluster mutation.
- **The benchmark remains synthetic** and is not proof of Cathay Cargo operational ROI.
