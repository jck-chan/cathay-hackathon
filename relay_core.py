"""RELAY reproducible cargo-recovery digital-twin research prototype.

Everything here is SYNTHETIC, never Cathay operating data or safety approval.
Models are mathematically exact for their *declared finite abstractions*.
Python 3.10+, NumPy, Pandas, SciPy; no GPU or cloud credentials required.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp


SEED = 260314
AIRPORTS = {
    "HKG": (22.31, 113.92), "SIN": (1.36, 103.99),
    "NRT": (35.77, 140.39), "ICN": (37.46, 126.44),
    "BKK": (13.69, 100.75), "LHR": (51.47, -0.45),
    "FRA": (50.04, 8.56), "TPE": (25.08, 121.23),
}


def cvar(losses, probabilities, alpha=0.85):
    """Finite-distribution CVaR, including atoms at the VaR threshold."""
    losses = np.asarray(losses, dtype=float)
    probabilities = np.asarray(probabilities, dtype=float)
    assert len(losses) == len(probabilities) and abs(probabilities.sum()-1) < 1e-8
    return min(float(t + np.dot(probabilities, np.maximum(losses-t, 0)) / (1-alpha))
               for t in sorted(set(losses.tolist())))


def risk_score(losses, probabilities, alpha=0.85, expected_weight=0.30):
    return cvar(losses, probabilities, alpha) + expected_weight * float(np.dot(losses, probabilities))


def make_world(seed=SEED, days=14, shipments_per_flight=11):
    """Large normalized data fixture with explicit, reproducible assumptions."""
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-11-14T00:00:00Z")
    routes = [("HKG", d) for d in ("SIN", "NRT", "ICN", "BKK", "LHR", "FRA", "TPE")]
    routes += [("SIN", "HKG"), ("NRT", "HKG")]
    durations = {"SIN": 4, "NRT": 5, "ICN": 4, "BKK": 3, "LHR": 14, "FRA": 13, "TPE": 2}
    flights, shipments, pieces, events, ulds = [], [], [], [], []
    for day in range(days):
        for ri, (origin, dest) in enumerate(routes):
            fid = f"SIM-F{day:02d}-{ri:02d}"
            departure = start + pd.Timedelta(days=day, hours=2+ri*2)
            duration = durations[dest if origin == "HKG" else origin]
            cap = int(rng.integers(4200, 13500))
            booked = int(cap * rng.uniform(.58, .91))
            flights.append(dict(flight_id=fid, origin=origin, destination=dest,
                operating_carrier="SIMULATED", service_type="belly" if ri%3 else "freighter",
                aircraft_type="SIM-WB" if ri%3 else "SIM-FR", scheduled_departure_utc=departure.isoformat(),
                scheduled_arrival_utc=(departure+pd.Timedelta(hours=duration)).isoformat(),
                published_cargo_capacity_kg=cap, booked_cargo_kg=booked,
                simulated_remaining_kg=cap-booked, status="scheduled",
                source="SYNTHETIC_OAG_LIKE", source_version=1))
            for j in range(shipments_per_flight):
                sid = f"SIM-S{day:02d}-{ri:02d}-{j:02d}"
                category = rng.choice(["GEN", "PER", "PHR", "DGR_EXCLUDED"], p=[.74,.15,.09,.02])
                weight = int(rng.integers(45, 650))
                priority = int(rng.choice([1,2,3], p=[.44,.42,.14]))
                w, d, h = [int(x) for x in rng.integers([35,40,30], [95,110,90])]
                shipments.append(dict(shipment_id=sid, flight_id=fid, origin=origin,
                    destination=dest, service_priority=priority, commodity=category,
                    weight_kg=weight, piece_count=1, latest_delivery_utc=(departure+
                    pd.Timedelta(hours=duration+int(rng.integers(4,22)))).isoformat(),
                    special_handling="COLD" if category in ["PHR","PER"] else "NONE",
                    split_allowed=False, booking_state="CONFIRMED_SIMULATED",
                    source="SIMULATED_CARGO_BOOKING", record_version=1))
                pieces.append(dict(piece_id=f"P-{sid}", shipment_id=sid, length_cm=d,
                    width_cm=w, height_cm=h, mass_kg=weight, orientation_rule="UPRIGHT",
                    certified_for_real_aircraft=False, source="SYNTHETIC_PIECE_MANIFEST"))
                for event_type,lead_hours in [("booking_created",44),("freight_received",10)]:
                    et=departure-pd.Timedelta(hours=lead_hours,minutes=int(rng.integers(0,70)))
                    events.append(dict(event_id=f"EV-{sid}-{event_type}",entity_type="shipment",
                        entity_id=sid,attribute=event_type,value="RECORDED_SIMULATED",
                        event_time_utc=et.isoformat(),
                        received_time_utc=(et+pd.Timedelta(minutes=int(rng.integers(0,55)))).isoformat(),
                        source="SIMULATED_ONE_RECORD_LIKE",revision=1,verification="SIM_CONFIRMED"))
            if ri % 2 == 0:
                uid = f"SIM-ULD-{day:02d}-{ri:02d}"
                ulds.append(dict(uld_id=uid, uld_type="DEMO-LANE3", aircraft_type="SIM-WB",
                    usable_length_cm=330, usable_width_cm=110, usable_height_cm=120,
                    tare_kg=95, simulated_max_payload_kg=1100,
                    serviceability="SERVICEABLE_SIMULATED", lifecycle="PRE_BUILD",
                    source="SYNTHETIC_ULD_MASTER", operational_certificate=False))
            # Events have event time, receipt time, revision and independent source metadata.
            if rng.uniform() < .48:
                evt_time = departure - pd.Timedelta(minutes=int(rng.integers(70,300)))
                receive_delay = int(rng.integers(0,36))
                event_type = str(rng.choice(["departure_delay", "capacity_revision", "aircraft_change"]))
                value = str(int(rng.integers(25,150))) if event_type == "departure_delay" else "REVIEW_REQUIRED"
                evt = dict(event_id=f"EV-{fid}", entity_type="flight", entity_id=fid,
                    attribute=event_type, value=value, event_time_utc=evt_time.isoformat(),
                    received_time_utc=(evt_time+pd.Timedelta(minutes=receive_delay)).isoformat(),
                    source=str(rng.choice(["SIM_OAG_ALERT", "SIM_OPS_FEED"])),
                    revision=1, verification="UNVERIFIED" if rng.uniform()<.20 else "SIM_CONFIRMED")
                events.append(evt)
                if rng.uniform() < .14:
                    events.append(dict(evt, event_id=evt["event_id"]+"-DUP"))
    tables = {"flights":pd.DataFrame(flights), "shipments":pd.DataFrame(shipments),
              "pieces":pd.DataFrame(pieces), "ulds":pd.DataFrame(ulds),
              "events":pd.DataFrame(events)}
    return tables


def save_world(tables, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {"synthetic": True, "seed": SEED, "airline": "NONE - all flight IDs are invented",
        "reference_standards": ["IATA ONE Record classes as conceptual guidance", "OAG flight info fields as conceptual guidance"],
        "warning": "Not actual operational data, not an IATA ULDR or aircraft loading certificate",
        "units": {"mass":"kg", "dimensions":"cm", "times":"UTC ISO8601", "cost":"synthetic cost units"},
        "tables":{k:len(v) for k,v in tables.items()}}
    for name, df in tables.items():
        df.to_csv(directory / f"{name}.csv", index=False)
    (directory / "dataset_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def replay_events(events, received_by):
    """As-known-at-time replay: never leak future messages into an earlier decision."""
    e = events.copy()
    e["received_time_utc"] = pd.to_datetime(e["received_time_utc"], utc=True)
    e["event_time_utc"] = pd.to_datetime(e["event_time_utc"], utc=True)
    cutoff = pd.Timestamp(received_by)
    visible = e[e.received_time_utc <= cutoff].copy()
    unique = visible.drop_duplicates(subset=["entity_type","entity_id","attribute",
                                                    "event_time_utc","value","source","revision"])
    latest = (unique.sort_values(["event_time_utc","received_time_utc","revision"])
              .groupby(["entity_type","entity_id","attribute"], as_index=False).tail(1))
    return {"visible_count":len(visible), "deduplicated_count":len(unique),
            "latest":latest.reset_index(drop=True), "cutoff":cutoff.isoformat()}


class OfflineCargoFeed:
    """Read-only adapter simulating API pagination, snapshots and received-time events.

    Interface is intentionally NOT a claim of wire compatibility with OAG,
    Cathay Cargo APIs, or IATA ONE Record. Real adapters must map contracts.
    """
    def __init__(self,tables):
        self.tables=tables

    def flights(self,origin=None,date=None,limit=40,offset=0):
        out=self.tables["flights"]
        if origin:out=out[out.origin==origin]
        if date:out=out[out.scheduled_departure_utc.str.startswith(str(date))]
        return out.iloc[offset:offset+limit].copy().reset_index(drop=True)

    def shipment(self,shipment_id):
        hits=self.tables["shipments"].query("shipment_id == @shipment_id")
        return None if hits.empty else hits.iloc[0].to_dict()

    def event_batch(self,as_of,after=None):
        ev=self.tables["events"].copy()
        t=pd.to_datetime(ev.received_time_utc,utc=True)
        ok=t<=pd.Timestamp(as_of)
        if after is not None:ok &= t>pd.Timestamp(after)
        return ev[ok].sort_values("received_time_utc").reset_index(drop=True)


def make_recovery_events():
    """Fictional operations messages scoped to the small recovery network.

    These are separate from the 14-day macro fixture's unrelated flight IDs.
    Their `SIM_CONFIRMED` labels are not real airline safety authorisations.
    """
    return pd.DataFrame([
        dict(event_id='SIM-CAP-001',entity_type='flight',entity_id='HK-LON',
            attribute='slots',value='0',event_time_utc='2026-11-14T00:02:00Z',
            received_time_utc='2026-11-14T00:20:00Z',source='SIM_AUTHORISED_INVENTORY',
            revision=1,verification='SIM_CONFIRMED'),
        dict(event_id='SIM-CAP-002',entity_type='flight',entity_id='HK-SIN',
            attribute='slots',value='0',event_time_utc='2026-11-14T00:03:00Z',
            received_time_utc='2026-11-14T00:12:00Z',source='SIM_PUBLIC_ALERT',
            revision=1,verification='UNVERIFIED'),
        dict(event_id='SIM-CAP-001-RETRY',entity_type='flight',entity_id='HK-LON',
            attribute='slots',value='0',event_time_utc='2026-11-14T00:02:00Z',
            received_time_utc='2026-11-14T00:21:00Z',source='SIM_AUTHORISED_INVENTORY',
            revision=1,verification='SIM_CONFIRMED'),
    ])


def recovery_asof(network,events,cutoff):
    """Replay vetted capacity changes and output a re-optimisable snapshot.

    Never use an as-yet-unreceived or unverified message as a hard constraint.
    The mock source is only 'authorised' *within this fictional simulation*.
    """
    snapshot=copy.deepcopy(network)
    visible=replay_events(events,cutoff)
    indices={f['id']:f for f in snapshot['flights']}
    accepted=[];ignored=[]
    for _,e in visible['latest'].iterrows():
        key=(e['entity_type'],e['entity_id'],e['attribute'])
        allowed=(e['source']=='SIM_AUTHORISED_INVENTORY' and
                 e['verification']=='SIM_CONFIRMED' and e['entity_type']=='flight'
                 and e['entity_id'] in indices and e['attribute'] in ('slots','cold_slots'))
        try:
            value=int(e['value']);allowed=allowed and value>=0
        except (TypeError,ValueError):allowed=False
        if allowed:
            indices[e['entity_id']][e['attribute']]=value
            accepted.append((key,value))
        else:ignored.append(key)
    # A published route remains only a proposal; this demonstrates when
    # capacity-reduction messages reach the optimiser, not actual booking.
    return snapshot,dict(cutoff=visible['cutoff'],visible=visible['visible_count'],
        accepted=accepted,ignored=ignored)


def make_packing_case():
    """Two 3-slot, floor-only, front-access ULD lanes; no stacking is modeled."""
    preferred = [0,1,2,0,1,2]
    inspect_w = np.array([.04,.08,.39,.04,.08,.37])
    pieces = []
    for i in range(6):
        pieces.append(dict(id=f"C{i+1}", mass_kg=[155,170,190,160,175,185][i],
            length_cm=[88,86,93,90,82,91][i], width_cm=[74,78,80,82,73,79][i],
            height_cm=[68,72,77,75,70,74][i], preferred_uld=i//3,
            preferred_position=preferred[i], inspect_weight=float(inspect_w[i])))
    ulds = [dict(id="ULD-A",slot_length_cm=110,slot_width_cm=100,slot_height_cm=110,
                 max_payload_kg=600,stage_spaces=2),
            dict(id="ULD-B",slot_length_cm=110,slot_width_cm=100,slot_height_cm=110,
                 max_payload_kg=600,stage_spaces=2)]
    scenarios = [{"name":"No inspection","prob":.58,"target":None}]
    for p in pieces:
        scenarios.append(dict(name=f"Inspect {p['id']}", prob=.42*p["inspect_weight"],target=p["id"]))
    assert abs(sum(s["prob"] for s in scenarios)-1)<1e-10
    return dict(pieces=pieces,ulds=ulds,scenarios=scenarios,alpha=.85,
                expected_weight=.30,nominal_budget=5.0,blocker_cycle_cost=2.0)


def _run_milp(c, integer_indices, lower, upper, rows, row_lb, row_ub, time_limit=10):
    n = len(c)
    integ = np.zeros(n, dtype=int)
    integ[list(integer_indices)] = 1
    opts = {"time_limit":float(time_limit),"mip_rel_gap":0.0001}
    t0 = time.perf_counter()
    res = milp(c=np.asarray(c,dtype=float),integrality=integ,
               bounds=Bounds(lower,upper),
               constraints=LinearConstraint(np.asarray(rows,dtype=float),row_lb,row_ub),
               options=opts)
    elapsed = time.perf_counter()-t0
    if res.x is None or res.status not in [0,1]:
        raise RuntimeError(f"MILP has no feasible incumbent: {res.message}")
    return res,elapsed


def solve_packing(case):
    P,U,S = case["pieces"],case["ulds"],case["scenarios"]
    candidates=[]
    for i,p in enumerate(P):
        for u,uld in enumerate(U):
            if p["length_cm"]>uld["slot_length_cm"] or p["width_cm"]>uld["slot_width_cm"] or p["height_cm"]>uld["slot_height_cm"]: continue
            for slot in range(3): candidates.append((i,u,slot))
    n=len(candidates)
    cost=np.array([1.10*abs(s-P[i]["preferred_position"])+
                   (1.50 if u!=P[i]["preferred_uld"] else 0.0) for i,u,s in candidates])
    L=np.zeros((len(S),n))
    for k,sc in enumerate(S):
        for j,(i,u,slot) in enumerate(candidates):
            if sc["target"]==P[i]["id"]: L[k,j]=case["blocker_cycle_cost"]*slot
    pomega=np.array([s["prob"] for s in S])
    rows=[]; lb=[];ub=[]
    def add(row,lo,hi): rows.append(row);lb.append(lo);ub.append(hi)
    for i in range(len(P)):
        add([int(ii==i) for ii,u,s in candidates],1,1)
    for u in range(len(U)):
        for slot in range(3):add([int(uu==u and ss==slot) for ii,uu,ss in candidates],1,1)
        add([P[ii]["mass_kg"] if uu==u else 0 for ii,uu,ss in candidates],0,U[u]["max_payload_kg"])
    baseline,tb=_run_milp(cost,range(n),np.zeros(n),np.ones(n),rows,lb,ub)
    nominal_best=float(np.dot(cost,baseline.x))
    # Scenario loss is the EXACT local extraction/re-staging cost under this
    # specified full, three-slot front-access lane with two safe staging spaces.
    m=len(S);nn=n+1+m; eta=n; h0=n+1
    rrows=[list(r)+[0.0]*(m+1) for r in rows]; rlb=list(lb);rub=list(ub)
    rrows.append(list(cost)+[0.0]*(m+1)); rlb.append(-np.inf);rub.append(nominal_best+case["nominal_budget"]+1e-7)
    for k in range(m):
        r=np.zeros(nn);r[:n]=L[k];r[eta]=-1;r[h0+k]=-1
        rrows.append(r.tolist());rlb.append(-np.inf);rub.append(0)
    obj=np.zeros(nn);obj[:n]=case["expected_weight"]*(pomega@L)
    obj[eta]=1.;obj[h0:]=pomega/(1-case["alpha"])
    low=np.zeros(nn);high=np.concatenate([np.ones(n),[np.inf],np.full(m,np.inf)])
    aware,ta=_run_milp(obj,range(n),low,high,rrows,rlb,rub)
    def decode(x):
        assign={P[i]["id"]:(U[u]["id"],int(slot)) for j,(i,u,slot) in enumerate(candidates) if x[j]>.5}
        loss=L@x[:n]
        return dict(assignments=assign, nominal_cost=float(cost@x[:n]),
                    scenario_losses=loss,expected=float(pomega@loss),
                    cvar=cvar(loss,pomega,case["alpha"]),
                    risk_score=risk_score(loss,pomega,case["alpha"],case["expected_weight"]))
    base=decode(baseline.x); opt=decode(aware.x)
    for plan in [base,opt]:
        assert len(plan["assignments"])==len(P)
        assert len(set(plan["assignments"].values()))==len(P)
        for u in U:
            mass=sum(p["mass_kg"] for p in P if plan["assignments"][p["id"]][0]==u["id"])
            assert mass<=u["max_payload_kg"]+1e-6
    assert opt["nominal_cost"]<=nominal_best+case["nominal_budget"]+1e-5
    assert opt["risk_score"]<=base["risk_score"]+1e-6
    return dict(baseline=base,aware=opt,scenarios=S,probabilities=pomega,
                nominal_budget=case["nominal_budget"],case=case,
                runtime_s=tb+ta,status=(baseline.message,aware.message),
                objective_bound=getattr(aware,"mip_dual_bound",None))


def make_network_case():
    """Time-expanded flight legs, toy slot units, shared capacity and cold resources."""
    legs=[("HK-LON","HKG","LHR",7,21,2,1),
          ("HK-SIN","HKG","SIN",4,8,3,2),
          ("SIN-LON","SIN","LHR",11,23,2,1),
          ("HK-NRT","HKG","NRT",5,10,3,1),
          ("NRT-LON","NRT","LHR",13,26,2,1),
          ("HK-ICN","HKG","ICN",5,9,3,1),
          ("ICN-LON","ICN","LHR",12,25,2,1),
          ("HK-BKK","HKG","BKK",3,7,2,1),
          ("BKK-SIN","BKK","SIN",10,13,1,1),
          ("SIN-NRT","SIN","NRT",12,18,1,1)]
    flights=[dict(id=a,origin=b,destination=c,depart_h=d,arrive_h=e,
                  slots=f,cold_slots=g,confirmed_state="AVAILABLE_SIMULATED")
             for a,b,c,d,e,f,g in legs]
    dests=["LHR"]*5+["SIN"]*2+["NRT"]*2+["ICN"]*2+["BKK"]
    cases=[]
    for i,d in enumerate(dests):
        cases.append(dict(id=f"JOB-{i+1:02d}",origin="HKG",destination=d,
            priority=1+(i%3),cold_chain=i in (2,6,9),
            deadline_h=(21+(i%4)*2) if d=="LHR" else (10+(i%3)*3),
            current_flight="HK-LON" if i==0 else None,
            protected_service=i==0))
    scenarios=[dict(id="normal",prob=.66,delay_h=0,cancelled=[]),
               dict(id="hub_delay",prob=.25,delay_h=4,cancelled=[]),
               dict(id="major_disruption",prob=.09,delay_h=3,cancelled=["HK-LON"])]
    return dict(flights=flights,cases=cases,scenarios=scenarios,alpha=.85,expected_weight=.40)


def build_routes(network):
    """Enumerate certified-within-simulator paths, max 2 legs, min 2h connection."""
    flights=network["flights"]
    routes={}
    for case in network["cases"]:
        options=[]
        for f in flights:
            if f["origin"]!=case["origin"]:continue
            chains=[[f]] if f["destination"]==case["destination"] else []
            if f["destination"]!=case["destination"]:
                chains += [[f,g] for g in flights if g["origin"]==f["destination"]
                           and g["destination"]==case["destination"] and g["depart_h"]>=f["arrive_h"]+2]
            for chain in chains:
                if case["cold_chain"] and any(g["cold_slots"]<1 for g in chain):continue
                ids=tuple(g["id"] for g in chain)
                arrival=chain[-1]["arrive_h"]
                rid=case["id"]+"/"+"+".join(ids)
                options.append(dict(id=rid,case_id=case["id"],legs=ids,kind="FLY",
                    arrival_h=arrival,cold_chain=case["cold_chain"],priority=case["priority"],
                    deadline_h=case["deadline_h"],
                    base_cost=4.0+3.7*len(ids)+1.8*(len(ids)-1),
                    authoritative_certificate=False))
        options.append(dict(id=case["id"]+"/UNRESOLVED",case_id=case["id"],
            legs=(),kind="UNRESOLVED",arrival_h=None,cold_chain=case["cold_chain"],
            priority=case["priority"],deadline_h=case["deadline_h"],
            base_cost=35+9*case["priority"]+(65 if case["protected_service"] else 0),
            authoritative_certificate=False))
        routes[case["id"]]=sorted(options,key=lambda x:(x["kind"]=="UNRESOLVED",len(x["legs"])))
    assert all(routes.values())
    return routes


def route_loss(route,scenario):
    if route["kind"]=="UNRESOLVED":return float(route["base_cost"])
    if any(a in scenario["cancelled"] for a in route["legs"]):
        return float(route["base_cost"]+46+12*route["priority"])
    arrival=route["arrival_h"]+scenario["delay_h"]
    tardy=max(0,arrival-route["deadline_h"])
    return float(route["base_cost"]+tardy*(2.2+1.5*route["priority"]))


def _is_network_feasible(selection,network,allowed=None):
    flights={f["id"]:f for f in network["flights"]}
    slots={k:0 for k in flights};cold={k:0 for k in flights}
    for c in network["cases"]:
        r=selection.get(c["id"])
        if r is None:return False
        if allowed and c["id"] in allowed and r["id"] not in allowed[c["id"]]:return False
        for k in r["legs"]:
            slots[k]+=1;cold[k]+=int(r["cold_chain"])
    return all(slots[k]<=flights[k]["slots"] and cold[k]<=flights[k]["cold_slots"] for k in slots)


def evaluate_network(selection,network):
    scenarios=network["scenarios"]
    losses=[sum(route_loss(selection[c["id"]],s) for c in network["cases"]) for s in scenarios]
    p=np.array([s["prob"] for s in scenarios])
    return dict(losses=np.array(losses),expected=float(np.dot(losses,p)),
                cvar=cvar(losses,p,network["alpha"]),
                score=risk_score(losses,p,network["alpha"],network["expected_weight"]))


def solve_network(network,routes=None,allowed=None,time_limit=12):
    if routes is None:routes=build_routes(network)
    candidates=[r for c in network["cases"] for r in routes[c["id"]]
                if allowed is None or c["id"] not in allowed or r["id"] in allowed[c["id"]]]
    n=len(candidates);m=len(network["scenarios"]);N=n+1+m
    if any(not any(r["case_id"]==c["id"] for r in candidates) for c in network["cases"]):
        raise ValueError("A case has no allowed options")
    coeff=np.array([[route_loss(r,s) for r in candidates] for s in network["scenarios"]])
    p=np.array([s["prob"] for s in network["scenarios"]])
    rows=[];lb=[];ub=[]
    def add(a,lo,hi):rows.append(a);lb.append(lo);ub.append(hi)
    for c in network["cases"]:
        add([float(r["case_id"]==c["id"]) for r in candidates]+[0]*(m+1),1,1)
    for f in network["flights"]:
        for col,capacity in [("slots",f["slots"]),("cold",f["cold_slots"])]:
            add([float(f["id"] in r["legs"] and (col=="slots" or r["cold_chain"])) for r in candidates]
                +[0]*(m+1),0,capacity)
    for k in range(m):
        a=np.zeros(N);a[:n]=coeff[k];a[n]=-1;a[n+1+k]=-1
        add(a.tolist(),-np.inf,0)
    objective=np.zeros(N);objective[:n]=network["expected_weight"]*(p@coeff)
    objective[n]=1;objective[n+1:]=p/(1-network["alpha"])
    lo=np.zeros(N);hi=np.concatenate([np.ones(n),[np.inf],np.full(m,np.inf)])
    res,elapsed=_run_milp(objective,range(n),lo,hi,rows,lb,ub,time_limit)
    selection={r["case_id"]:r for j,r in enumerate(candidates) if res.x[j]>.5}
    assert _is_network_feasible(selection,network,allowed)
    out=evaluate_network(selection,network)
    return dict(selection=selection,**out,runtime_s=elapsed,status=res.message,
                mip_gap=getattr(res,"mip_gap",None),dual_bound=getattr(res,"mip_dual_bound",None))


def greedy_network(network,routes=None,allowed=None):
    if routes is None:routes=build_routes(network)
    selection={}
    p=np.array([s["prob"] for s in network["scenarios"]])
    for case in network["cases"]:
        options=[r for r in routes[case["id"]]
                 if allowed is None or case["id"] not in allowed or r["id"] in allowed[case["id"]]]
        options.sort(key=lambda r:float(p@np.array([route_loss(r,s) for s in network["scenarios"]])))
        chosen=None
        for r in options:
            trial=dict(selection);trial[case["id"]]=r
            # Partial assignments are validated on capacities without completeness.
            counts={f["id"]:[0,0] for f in network["flights"]}
            for rr in trial.values():
                for leg in rr["legs"]:
                    counts[leg][0]+=1;counts[leg][1]+=int(rr["cold_chain"])
            if all(z[0]<=next(f["slots"] for f in network["flights"] if f["id"]==k)
               and z[1]<=next(f["cold_slots"] for f in network["flights"] if f["id"]==k)
               for k,z in counts.items()):
                chosen=r;break
        if chosen is None:raise RuntimeError("No feasible baseline option")
        selection[case["id"]]=chosen
    assert _is_network_feasible(selection,network,allowed)
    return dict(selection=selection,**evaluate_network(selection,network))


def improve_sparse_exchanges(network,initial,routes=None,max_passes=10):
    """Exact feasibility-checked 1/2-case neighbourhood; NOT a full Graver oracle."""
    if routes is None:routes=build_routes(network)
    sel=dict(initial["selection"]);start_score=evaluate_network(sel,network)["score"]
    steps=[];caseids=[c["id"] for c in network["cases"]]
    for _ in range(max_passes):
        best_score=evaluate_network(sel,network)["score"]-1e-8
        best=None
        for ia,a in enumerate(caseids):
            for b in [None]+caseids[ia+1:]:
                for ra in routes[a]:
                    if ra["id"]==sel[a]["id"]:continue
                    rb_choices=[None] if b is None else routes[b]
                    for rb in rb_choices:
                        if b is not None and rb["id"]==sel[b]["id"]:continue
                        trial=dict(sel);trial[a]=ra
                        if b is not None:trial[b]=rb
                        if not _is_network_feasible(trial,network):continue
                        score=evaluate_network(trial,network)["score"]
                        if score<best_score:best_score=score;best=trial
        if best is None:break
        before=evaluate_network(sel,network)["score"]
        sel=best;steps.append(before-best_score)
    out=evaluate_network(sel,network)
    assert out["score"]<=start_score+1e-8
    return dict(selection=sel,**out,improvements=steps,passes=len(steps),
                guarantee="Local neighbourhood only; no global guarantee")


def cluster_exchange_certificate():
    """Literal Model-III rank-one Graver encoding for the documented 2-case instance."""
    M=np.array([[1,1,0,0,0],[0,0,1,1,0],[1,0,1,0,1]],dtype=int)
    v=np.array([1,0,0,1,0]);g=np.array([-1,1,1,-1,0]);w=np.array([1,4,1,8,0])
    assert (M@g==0).all() and (M@v==M@(v+g)).all()
    assert ((v+g)>=0).all() and ((v+g)<=1).all()
    original=int(w@v); improved=int(w@(v+g))
    ratio=math.exp(float(-w@g))
    assert original==9 and improved==5 and abs(ratio-math.exp(4))<1e-8
    # For g in {-1,0,1}^m, every conformal nonzero sub-kernel vector is g.
    conformal=[]
    from itertools import product
    coords=[([0,int(z)] if z>0 else [int(z),0]) if z else [0] for z in g]
    for t in product(*coords):
        h=np.array(t)
        if np.any(h) and np.all(M@h==0):conformal.append(h)
    assert len(conformal)==1 and np.array_equal(conformal[0],g)
    return dict(original_cost=original,new_cost=improved,gain=original-improved,
                graver_vector=g,exchange_ratio=ratio,
                exchange_equation="X_g X'_g = U_AF U_BD + U_AD U_BF",
                guarantee="Exact for this finite 2-case MILP; not general speed-up")


def pivot_exact(costs=None,prior=.30,sensitivity=.90,false_positive=.20,
                expiry_given_state=(.10,.34),verification_cost=3.,delay_cost=.0):
    """Exact regret-option-delay identity, with state-correlated expiry."""
    if costs is None: costs={"keep":(0.,100.),"switch":(18.,22.)}
    states=[0,1];actions=["keep","switch"]
    probs=np.array([1-prior,prior]);loss=lambda a,x:float(costs[a][x])
    immediate={a:sum(probs[x]*loss(a,x) for x in states) for a in actions}
    d0=min(actions,key=lambda a:immediate[a]);R0=immediate[d0]
    outcomes=[];I=A=B=J_without_cost=0.
    for positive in [False,True]:
        for expired in [False,True]:
            masses=[]
            for x in states:
                obs=(sensitivity if x else false_positive)
                exp=expiry_given_state[x]
                masses.append(probs[x]*(obs if positive else 1-obs)*(exp if expired else 1-exp))
            pz=sum(masses)
            if pz<1e-12:continue
            posterior=np.array(masses)/pz
            avail=["keep"] if expired else actions
            r0={a:sum(posterior[x]*loss(a,x) for x in states) for a in actions}
            pre_min=min(r0[a] for a in actions)
            after_min=min(r0[a] for a in avail)
            aopt=min(avail,key=lambda a:r0[a])
            I+=pz*(r0[d0]-pre_min)
            A+=pz*(after_min-pre_min)
            B+=pz*delay_cost
            J_without_cost+=pz*(after_min+delay_cost)
            outcomes.append(dict(observation="positive" if positive else "negative",
                expired=expired,probability=pz,posterior_misalignment=float(posterior[1]),
                recommended=aopt,conditional_cost=after_min+delay_cost))
    J=verification_cost+J_without_cost
    decomposition=I-A-B-verification_cost
    assert abs((R0-J)-decomposition)<1e-8
    return dict(immediate_action=d0,immediate_cost=R0,verification_cost_total=J,
        recommended="verify" if J<R0 else d0,information_value=I,
        option_attrition=A,delay_effect=B,check_cost=verification_cost,
        identity_residual=(R0-J)-decomposition,outcomes=outcomes,
        model="Two-epoch finite belief controller; stochastic expiry correlated with true state")


def simulated_pivot_trials(n=700,seed=SEED,**kwargs):
    """Paired Monte Carlo evaluation with actual latent truth and noisy observations."""
    rng=np.random.default_rng(seed)
    prior=kwargs.get("prior",.30);sens=kwargs.get("sensitivity",.90)
    fp=kwargs.get("false_positive",.20);expiry=kwargs.get("expiry_given_state",(.10,.34))
    costs=kwargs.get("costs",{"keep":(0.,100.),"switch":(18.,22.)})
    cc=kwargs.get("verification_cost",3.);dc=kwargs.get("delay_cost",0.)
    base=pivot_exact(**kwargs)
    records=[]
    for k in range(n):
        state=int(rng.random()<prior)
        obs=bool(rng.random()<(sens if state else fp))
        expired=bool(rng.random()<expiry[state])
        matching=[o for o in base["outcomes"] if o["observation"]==("positive" if obs else "negative") and o["expired"]==expired]
        choice=matching[0]["recommended"]
        records.append(dict(trial=k,hidden_misalignment=state,observed_positive=obs,
            expired=expired,immediate_loss=costs[base["immediate_action"]][state],
            verify_loss=cc+dc+costs[choice][state],verify_choice=choice,
            posterior=matching[0]["posterior_misalignment"]))
    return pd.DataFrame(records),base


def make_integrated_pivot_costs(network,routes=None):
    """Global master computes downstream PIVOT losses for one affected case."""
    if routes is None:routes=build_routes(network)
    case=network["cases"][0]["id"]
    direct=[r for r in routes[case] if r["legs"]==("HK-LON",)]
    alternatives=[r for r in routes[case] if r["kind"]=="FLY" and r["legs"]!=("HK-LON",)]
    hold=[r for r in routes[case] if r["kind"]=="UNRESOLVED"]
    assert direct and alternatives and hold
    keep=solve_network(network,routes,allowed={case:{direct[0]["id"]}})
    switch=solve_network(network,routes,allowed={case:{r["id"] for r in alternatives}})
    fallback=solve_network(network,routes,allowed={case:{hold[0]["id"]}})
    # Each cost is EXPECTED SYSTEM loss under the globally risk-optimised plan.
    # A controller must not reuse a CVaR-adjusted score as if it were an
    # additional realised cost; that would double count the risk adjustment.
    # The 18-unit switching/coordination charge is NOT counted inside route costs.
    costs={"keep":(keep["expected"],fallback["expected"]),
           "switch":(switch["expected"]+18.,switch["expected"]+18.)}
    return dict(costs=costs,plans={"keep":keep,"switch":switch,"fallback":fallback},target_case=case)


def benchmark_network(network,seed=SEED,n=180):
    """Same joint scenario stream for greedy, exact MILP, and local exchanges."""
    routes=build_routes(network)
    t0=time.perf_counter();greedy=greedy_network(network,routes);greedy_s=time.perf_counter()-t0
    exact=solve_network(network,routes)
    t0=time.perf_counter();local=improve_sparse_exchanges(network,greedy,routes)
    local_s=time.perf_counter()-t0
    assert exact["score"]<=local["score"]+1e-6
    assert local["score"]<=greedy["score"]+1e-6
    rng=np.random.default_rng(seed)
    types=rng.choice(len(network["scenarios"]),size=n,
        p=[s["prob"] for s in network["scenarios"]])
    records=[]
    for k,t in enumerate(types):
        for label,out in [("Case-wise greedy",greedy),("Sparse exchanges",local),("Global risk MILP",exact)]:
            actual=sum(route_loss(out["selection"][c["id"]],network["scenarios"][t])
                       for c in network["cases"])
            records.append(dict(episode=k,scenario=network["scenarios"][t]["id"],
                                policy=label,realized_loss=actual))
    return dict(greedy=greedy,local=local,exact=exact,
                runtime_s={"Case-wise greedy":greedy_s,"Sparse exchanges":local_s,
                           "Global risk MILP":exact["runtime_s"]},
                episodes=pd.DataFrame(records),network=network)


def simulate_integrated_episodes(network,packing,n=600,seed=SEED):
    """Common-random-number end-to-end research simulation.

    Cost ledger has *disjoint* categories: ULD inspection rehandling, network
    transport/SLA cost, PIVOT verification cost, and switching coordination.
    Global portfolio is re-solved under each first-class target-route lock.
    The two-case latent state only affects target physical validity, never
    authorises unsafe loading. No historical/Cathay performance is inferred.
    """
    rng=np.random.default_rng(seed)
    routes=build_routes(network)
    target=network["cases"][0]["id"]
    direct={r["id"] for r in routes[target] if r["legs"]==("HK-LON",)}
    alternative={r["id"] for r in routes[target] if r["kind"]=="FLY" and r["id"] not in direct}
    held={r["id"] for r in routes[target] if r["kind"]=="UNRESOLVED"}
    allowed={"keep":{target:direct},"switch":{target:alternative},"fallback":{target:held}}
    full={k:solve_network(network,routes,allowed=v) for k,v in allowed.items()}
    baseline={k:greedy_network(network,routes,allowed=v) for k,v in allowed.items()}
    costs={"keep":(full["keep"]["expected"],full["fallback"]["expected"]),
           "switch":(full["switch"]["expected"]+18,)*2}
    controller=pivot_exact(costs=costs,expiry_given_state=(.04,.10),verification_cost=2)
    p_scenarios=packing["scenarios"]
    p_local=np.array([s["prob"] for s in p_scenarios])
    p_global=np.array([s["prob"] for s in network["scenarios"]])
    def make_action(controller_action,state,positive,expired):
        if controller_action=="verify":
            outcome=next(o for o in controller["outcomes"] if o["observation"]==("positive" if positive else "negative") and o["expired"]==expired)
            return outcome["recommended"],2.0
        return controller_action,0.0
    records=[]
    for k in range(n):
        physical_idx=int(rng.choice(len(p_scenarios),p=p_local))
        shock_idx=int(rng.choice(len(network["scenarios"]),p=p_global))
        state=int(rng.random()<.30)
        positive=bool(rng.random()<(.90 if state else .20))
        expired=bool(rng.random()<(.10 if state else .04))
        sc=network["scenarios"][shock_idx]
        row={"episode":k,"shock":sc["id"],"hidden_misalignment":state,
             "physical_event":p_scenarios[physical_idx]["name"],"verification_observation":positive,
             "option_expired":expired}
        for label,root,portfolio,plan in [
            ("Myopic baseline",controller["immediate_action"],baseline,packing["baseline"]),
            ("Integrated RELAY",controller["recommended"],full,packing["aware"])]:
            action,inspect=make_action(root,state,positive,expired)
            chosen_key="fallback" if action=="keep" and state==1 else action
            global_loss=sum(route_loss(portfolio[chosen_key]["selection"][c["id"]],sc)
                            for c in network["cases"])
            physical=float(plan["scenario_losses"][physical_idx])
            coordination=18.0 if action=="switch" else 0.0
            total=global_loss+physical+inspect+coordination
            prefix="base" if label=="Myopic baseline" else "relay"
            row[f"{prefix}_loss"]=total
            row[f"{prefix}_route_loss"]=global_loss
            row[f"{prefix}_rehandling"]=physical
            row[f"{prefix}_inspection"]=inspect
            row[f"{prefix}_coordination"]=coordination
            row[f"{prefix}_action"]=action
            row[f"{prefix}_resolved"]=chosen_key!="fallback" and all(
                rr["kind"]!="UNRESOLVED" for rr in portfolio[chosen_key]["selection"].values())
        records.append(row)
    df=pd.DataFrame(records)
    df["paired_saving"]=df.base_loss-df.relay_loss
    return dict(episodes=df,controller=controller,global_portfolios=full,
                baseline_portfolios=baseline,
                source="SYNTHETIC: common-random-number simulation; not a Cathay forecast")

