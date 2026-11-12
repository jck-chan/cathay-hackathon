# Sources, interpretation and evidence levels

## Primary mathematical sources — user-provided

- `real_model1(3).pdf`: *Recovery-Aware Cargo Arrangement: An Improvement Theorem, a Two-Stage Model, and a Computed Example*, RELAY Model I, 22 Oct 2026, 8 pages.
- `real_model2(2).pdf`: *PIVOT: The Decision Value of Verification Before Recovery*, RELAY Model II, 22 Oct 2026, 6 pages.
- `real_model3(2).pdf`: *Certified Cluster Exchanges: From Local Cargo Recovery to Global Integer and Stochastic Optimisation*, RELAY Model III, 22 Oct 2026, 8 pages.

**Important:** Those papers articulate broader research formulations than v1 code implements. Model I's real three-dimensional certified recourse/scheduling, Model II's semi-Markov belief control and Model III's full Graver-augmented global certified operations remain substantial ongoing engineering and research projects. Do not claim they are shipped just because the bounded synthetic implementation runs.

## Public standards and business sources (verified November 2026)

1. [Cathay Cargo APIs official list](https://www.cathaycargo.com/en-us/help-and-support/cathaycargo-APIs.html): published Quote (rates/schedules/available capacity), Booking, Booking Details, Cancel, ONE Record Track & Trace and Push. **Does not prove Hackathon or public testing rights**.
2. [Cathay developer testing environment](https://cx-developer-portal.ezycargo.com/get-started): authorization/approval process for API access, including subscription choices.
3. [IATA ONE Record 2026-07 specification](https://iata-cargo.github.io/ONE-Record/): current endorsed release, immutable event and object concepts.
4. [IATA ONE Record Logistics Events](https://iata-cargo.github.io/ONE-Record/2026-07/API-Security/logistics-events/): append-only logistics event semantics, provenance and event timestamp requirements.
5. [IATA ONE Record release history](https://github.com/IATA-Cargo/ONE-Record/releases): July 2026 API 2.3.0 / ontology 3.3.0.
6. [IATA ONE Record data sharing purpose](https://www.iata.org/one-record): single shipment record and secure data exchange.
7. [IATA ULDR and limitations](https://www.iata.org/en/publications/manuals/uld-regulations/): airworthiness/safety restrictions beyond 2D geometry.
8. [OAG Flight Info v2 fields](https://knowledge.oag.com/docs/flight-info-api-response-layout-descriptions): scheduled/estimated/actual, parent flight state, equipment data.
9. [OAG flight status taxonomy](https://knowledge.oag.com/docs/understanding-flight-status-states): Scheduled/OutGate/InAir/Landed/InGate/Canceled/Diverted, delay is a separate timeliness indicator.
10. [OAG cargoTonnage definition](https://knowledge.oag.com/docs/flight-info-api-migration-fvxml): maximum freight capacity, NOT remaining bookable cargo inventory.
11. [IATA Cargo iQ milestone schematic](https://www.iata.org/contentassets/23608a1cdaa543ef877cc617ce99d21e/cargo-iq-master-slides.pdf): BKD / RCS / DEP / ARR / RCF / NFD / DLV tracking milestone language (used as analogous labels; not compliance claim).
12. [SciPy milp/HiGHS documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html): mixed-integer LP time limit, integrality and MIP gap settings.

## Source vs. inference vs. synthetic choice

| Question | Directly supported by public source | This software's inference or invented assumption |
|---|---|---|
| Does Cathay advertise shipment/booking APIs? | Yes, public website | Any actual working credentials or access rights: **NO** |
| Does OAG give status and maximum cargo tonnage? | Yes, documented fields | Actual confirmed remaining allotment: **NO** |
| Are ONE Record events append-only? | Yes, documented | Internal JSONL/SQLite is ONE Record compliant: **NO** |
| Is air cargo ULD loading regulated? | Yes, IATA ULDR | 2D cell placement certifies flight load: **NO** |
| Can HiGHS solve this finite MILP exactly? | Yes, conditional solver optimal status | All alternative airline routes and safety rules exhaustively modeled: **NO** |
| Does RELAY save Cathay money? | Not established | Any displayed savings are **synthetic-model results only** |

All random rates, service priorities, flight timetables, capacity, cost penalties, geometry, terminal hourly limits, crew workflow order and scenario probabilities in this release are synthetic, assumed operationally plausible examples for software testing — **not claimed as accurately describing Cathay's private operations**.
