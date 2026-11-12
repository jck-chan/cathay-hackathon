"""Event-driven, paired cargo-terminal operations research simulator.

Synthetic logical minutes, no flight safety authority. The two dispatch policies
see IDENTICAL new orders and disruptions. RELAY uses an exact capacity-specialized dispatch optimizer per tick;
the separate network recovery model still uses SciPy/HiGHS MILP.
The baseline is feasible first-come/first-served.

This is a small operational queue twin layered on the separately tested three
RELAY paper models, not a purported high-fidelity HKIA calibrated simulator.
"""
from __future__ import annotations

import math
import sys
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import relay_core as R


DESTINATIONS = ("LHR", "SIN", "NRT", "ICN", "BKK")


def bounded(x, low, high, default):
    try:
        f = float(x)
        return f if math.isfinite(f) and low <= f <= high else default
    except (TypeError, ValueError):
        return default


def _policy():
    return {"queue": [], "active": [], "completed": 0,
            "late": 0, "exceptions": 0, "total_cost": 0.,
            "total_flow_ticks": 0., "total_rehandles": 0.,
            "started": 0, "solver_ms": 0., "last_selected": [],
            "last_objective": None, "last_gap": None,
            "last_solver_status": "NOT_RUN"}


class LiveCargoWorld:
    def __init__(self, seed=260314, arrivals=1.65, handlers=3,
                 cold_bays=1, stands=3, chaos=.20):
        self.seed = int(bounded(seed, 0, 2**31-1, 260314))
        self.arrivals = bounded(arrivals, .1, 5., 1.65)
        self.handlers = int(bounded(handlers, 1, 6, 3))
        self.cold_bays = int(bounded(cold_bays, 0, 3, 1))
        self.stands = int(bounded(stands, 1, 5, 3))
        self.chaos = bounded(chaos, 0, 1., .20)
        self.rng = np.random.default_rng(self.seed)
        self.tick = 0
        self.next_id = 1
        self.generated = 0
        self.events = []
        self.logs = []
        self.policies = {"baseline": _policy(), "relay": _policy()}
        self.pack = R.solve_packing(R.make_packing_case())
        self.scenarios = self.pack["scenarios"]
        self.probabilities = np.array([s["prob"] for s in self.scenarios])
        self.net = R.make_network_case()
        self.route_normal = R.solve_network(self.net)
        self.route_shock = None
        costs = R.make_integrated_pivot_costs(self.net)["costs"]
        self.pivot = R.pivot_exact(costs=costs, expiry_given_state=(.04,.10),
                                  verification_cost=2, delay_cost=.7)
        self.logs.append({"tick":0,"kind":"MODEL","text":
            "Initialized: ULD recovery CVaR %.3f vs nominal %.3f; PIVOT = %s" %
            (self.pack["aware"]["risk_score"], self.pack["baseline"]["risk_score"],
             self.pivot["recommended"].upper())})

    def _log(self, kind, message):
        self.logs.append({"tick":self.tick,"kind":kind,"text":message})
        if len(self.logs) > 170:
            del self.logs[:40]

    def reconfigure_arrivals(self, arrivals=None, chaos=None):
        """Change the event law mid-flight without resetting accepted work."""
        if arrivals is not None:
            self.arrivals = bounded(arrivals, .1, 5., self.arrivals)
        if chaos is not None:
            self.chaos = bounded(chaos, 0, 1., self.chaos)
        self._log("CONTROL", "Runtime generator adjusted: λ=%.2f/tick, chaos=%.2f; "
                  "existing jobs and resource locks preserved" %
                  (self.arrivals, self.chaos))
        return self.snapshot()

    def _event(self, typ, message, job=None):
        self.events.append({"tick":self.tick,"kind":typ,"text":message,
                            "job":job})
        if len(self.events) > 130:
            del self.events[:30]

    def _new_job(self):
        i = self.next_id
        self.next_id += 1
        scenario_i = int(self.rng.choice(len(self.scenarios), p=self.probabilities))
        priority = int(self.rng.choice([1,2,3],p=[.52,.34,.14]))
        cold = bool(self.rng.random() < .19)
        check = bool(self.rng.random() < .22 + .1*self.chaos)
        mismatch = bool(self.rng.random() < .28) if check else False
        deadline = self.tick + int(self.rng.integers(4, 13)) - (2 if priority==3 else 0)
        deadline = max(deadline, self.tick+2)
        base_duration = int(self.rng.integers(1, 4))
        d = str(self.rng.choice(DESTINATIONS))
        return {
            "id":"CX-SIM-%04d"%i, "arrival":self.tick, "deadline":deadline,
            "priority":priority, "cold":cold, "destination":d,
            "check":check, "mismatch":mismatch, "scenario":scenario_i,
            "duration":base_duration,
            "blockers_baseline":float(self.pack["baseline"]["scenario_losses"][scenario_i])/2.,
            "blockers_relay":float(self.pack["aware"]["scenario_losses"][scenario_i])/2.,
        }

    def _avail(self, p):
        active=p["active"]
        return {"handlers":max(0,self.handlers-len(active)),
                "cold":max(0,self.cold_bays-sum(a["job"]["cold"] for a in active)),
                "stands":max(0,self.stands-len(active))}

    def _baseline(self, waiting, avail):
        chosen=[]
        for j in sorted(waiting,key=lambda j:(j["arrival"],j["id"])):
            if len(chosen)>=min(avail["handlers"],avail["stands"]):break
            if j["cold"] and sum(q["cold"] for q in chosen)>=avail["cold"]:continue
            chosen.append(j)
        return chosen,dict(status="FEASIBLE_FCFS",gap=None,objective=None,runtime_ms=0.)

    def _relay(self, waiting, avail):
        """Exact optimizer for the LIVE QUEUE's special two-resource constraints.

        Each job consumes one handler and one stand slot, while cold-chain jobs
        additionally consume one cold bay. The optimum is found by sorting the
        two classes by benefit, then enumerating how many cold jobs to take.
        This is *exact* for THIS dispatch master (not a replacement for the
        separate general network-recovery MILP or aircraft safety rules).

        No timeout is involved. In particular, with zero remaining cold bays,
        cold-only queues correctly produce an empty optimal set rather than
        crashing when a generic MILP has no incumbent.
        """
        t = time.perf_counter()
        n = len(waiting)
        slots = max(0, min(int(avail["handlers"]), int(avail["stands"])))
        cold_cap = max(0, int(avail["cold"]))
        if n == 0 or slots == 0:
            return [], dict(status="IDLE" if n == 0 else "RESOURCE_BLOCKED",
                            gap=0., objective=0., runtime_ms=(time.perf_counter()-t)*1000,
                            vars=n, algorithm="EXACT_TWO_CLASS_ENUMERATION")

        def urgency(job):
            return (6.*job["priority"]
                    + 18.*max(0, 3-(job["deadline"]-self.tick))
                    + 2.2*(self.tick-job["arrival"])
                    + 4.*int(job["cold"]) + 2.*int(job["check"]))

        cold, general = [], []
        for j in waiting:
            score = urgency(j)
            if not math.isfinite(score):
                raise ValueError("Non-finite cargo urgency for " + str(j.get("id")))
            (cold if j["cold"] else general).append((score, j))

        # A score, an arrival timestamp and a stable ID define a deterministic
        # selection even when two shipments have identical urgency.
        sortkey = lambda item: (-item[0], item[1]["arrival"], item[1]["id"])
        cold.sort(key=sortkey)
        general.sort(key=sortkey)

        # We never need to examine jobs outside the top ``slots`` of a class.
        # Nonpositive benefit jobs are never taken if the slot can stay empty.
        cold = [x for x in cold[:min(len(cold),slots,cold_cap)] if x[0] > 0]
        general = [x for x in general[:min(len(general),slots)] if x[0] > 0]
        cold_prefix = [0.]
        general_prefix = [0.]
        for score, _ in cold:
            cold_prefix.append(cold_prefix[-1]+score)
        for score, _ in general:
            general_prefix.append(general_prefix[-1]+score)

        best_score = -math.inf
        best_cold = best_general = 0
        for nc in range(len(cold)+1):
            ng = min(len(general), slots-nc)
            if ng < 0:
                continue
            score = cold_prefix[nc] + general_prefix[ng]
            if score > best_score + 1e-9:
                best_score, best_cold, best_general = score, nc, ng

        chosen = [job for _,job in cold[:best_cold]] + [job for _,job in general[:best_general]]
        chosen.sort(key=lambda j:(j["arrival"], j["id"]))
        assert len(chosen) <= slots
        assert sum(int(j["cold"]) for j in chosen) <= cold_cap
        return chosen, dict(
            status="OPTIMAL_EXACT_DISPATCH" if chosen else "NO_ELIGIBLE_CAPACITY",
            gap=0., objective=float(best_score),
            runtime_ms=(time.perf_counter()-t)*1000, vars=n,
            algorithm="EXACT_TWO_CLASS_ENUMERATION",
            optimality_scope="Live queue: one slot/job, one cold bay/cold job",
            resource_duals="Not applicable: exact discrete capacity enumeration")

    def _advance_active(self, p, label):
        remaining=[]
        for item in p["active"]:
            item["remaining"]-=1
            if item["remaining"]>0:
                remaining.append(item)
                continue
            j=item["job"]
            p["completed"]+=1
            flow=self.tick-j["arrival"]
            p["total_flow_ticks"]+=flow
            p["late"]+=int(self.tick>j["deadline"])
            # Demo exceptions are safe holds / SLA misses, not unsafe loadings.
            mismatch_exception=int(j["mismatch"] and label=="baseline")
            p["exceptions"]+=int(self.tick>j["deadline"] or mismatch_exception)
            p["total_cost"]+=item["duration"]*.85 + item["blockers"]*1.6
            p["total_rehandles"]+=item["blockers"]
            if mismatch_exception:p["total_cost"]+=9.
            if self.tick>j["deadline"]:
                p["total_cost"]+=(self.tick-j["deadline"])*2.2*j["priority"]
        p["active"]=remaining

    def _schedule(self, p, label):
        available=self._avail(p)
        q=p["queue"]
        if label=="relay":
            chosen,meta=self._relay(q,available)
        else:
            chosen,meta=self._baseline(q,available)
        p["solver_ms"]+=meta["runtime_ms"]
        p["last_selected"]=[j["id"] for j in chosen]
        p["last_objective"]=meta["objective"]
        p["last_gap"]=meta["gap"]
        p["last_solver_status"]=meta["status"]
        for j in chosen:
            blockers=j["blockers_relay"] if label=="relay" else j["blockers_baseline"]
            # Physically mismatched cargo is safely held/reworked; never loaded
            # despite a failed check. A RELAY verification carries explicit time.
            verified=label=="relay" and j["check"] and self.pivot["recommended"]=="verify"
            extra=int(round(blockers))+int(verified)+int(
                label=="baseline" and j["mismatch"])
            duration=j["duration"]+extra
            p["active"].append({"job":j,"remaining":duration,
                                "duration":duration,"blockers":blockers,
                                "verified":verified})
            p["started"]+=1
            if verified:p["total_cost"]+=1.8
        selected={j["id"] for j in chosen}
        p["queue"]=[j for j in q if j["id"] not in selected]
        if label=="relay" and not chosen and q and self.tick%3==0:
            cold_only=all(j["cold"] for j in q)
            self._log("CAPACITY", "t=%02d | hold %d jobs | free handlers=%d, "
                "stands=%d, cold-bays=%d | %s" %
                (self.tick,len(q),available["handlers"],available["stands"],
                 available["cold"],
                 "all waiters require cold bays" if cold_only else
                 "resource gate / no eligible job"))
        if label=="relay" and chosen:
            self._log("DISPATCH","t=%02d | n=%d queued | handler≤%d, cold≤%d, stand≤%d | "
                "status=%s | gain=%.1f | gap=%s | solve=%.1fms | %s" %
                (self.tick,meta.get("vars",0),available["handlers"],available["cold"],
                 available["stands"],meta["status"],meta["objective"],
                 str(meta["gap"]),meta["runtime_ms"],
                 ",".join(p["last_selected"][:3])))
        return meta

    def step(self, count=1):
        count=int(bounded(count,1,12,1))
        for _ in range(count):
            self.tick+=1
            for label,p in self.policies.items():
                self._advance_active(p,label)
            rate=self.arrivals*(1+.8*self.chaos if self.tick%17 in (7,8,9) else 1)
            arrivals=int(self.rng.poisson(rate))
            new=[self._new_job() for _ in range(arrivals)]
            self.generated+=len(new)
            for p in self.policies.values():p["queue"].extend(new)
            for j in new:
                self._event("ARRIVAL",j["id"]+" · HKG → "+j["destination"]+
                    (" · COLD" if j["cold"] else "")+" · due T+"+str(j["deadline"]),j["id"])
            for label,p in self.policies.items():
                for j in p["queue"]:
                    p["total_cost"]+=.34*j["priority"]+(.18 if j["cold"] else 0)
                    if self.tick>j["deadline"]:p["total_cost"]+=1.8*j["priority"]
                self._schedule(p,label)
            if self.tick==8:
                net,meta=R.recovery_asof(self.net,R.make_recovery_events(),
                                           "2026-11-14T00:25:00Z")
                self.route_shock=R.solve_network(net)
                self._event("INCIDENT","Authoritative simulated direct-route closure; "
                    "network portfolio re-solved")
                self._log("MODEL III","Verified HKG–LHR slots 2→0; global CVaR objective %.3f→%.3f; "
                    "protected shipment requires new route" %
                    (self.route_normal["score"],self.route_shock["score"]))
            if arrivals or self.tick%4==0:
                self._log("EVENT","Poisson λ=%.2f: +%d shipments; queues FCFS=%d RELAY=%d" %
                    (rate,arrivals,len(self.policies["baseline"]["queue"]),
                     len(self.policies["relay"]["queue"])))
        return self.snapshot()

    def snapshot(self):
        data={}
        for label,p in self.policies.items():
            done=p["completed"]
            objects=[]
            for j in p["queue"][-34:]:
                objects.append(dict(id=j["id"],status="WAIT",cold=j["cold"],
                    priority=j["priority"],destination=j["destination"],
                    age=self.tick-j["arrival"]))
            for a in p["active"]:
                j=a["job"]
                objects.append(dict(id=j["id"],status="MOVING",cold=j["cold"],
                    priority=j["priority"],destination=j["destination"],
                    progress=1-a["remaining"]/a["duration"]))
            data[label]={
                "completed":done,"waiting":len(p["queue"]),"active":len(p["active"]),
                "late":p["late"],"exceptions":p["exceptions"],
                "exception_rate":p["exceptions"]/done if done else 0.,
                "average_flow_ticks":p["total_flow_ticks"]/done if done else 0.,
                "cost":round(p["total_cost"],3),
                "rehandles":p["total_rehandles"],
                "solver_total_ms":p["solver_ms"],
                "selected":p["last_selected"],
                "objective":p["last_objective"],"gap":p["last_gap"],
                "solver_status":p["last_solver_status"],
                "objects":objects}
        # Client projection uses the SAME solved route selection as Model III.
        # It is an illustrative shadow state, never a booking confirmation.
        route_solver = self.route_shock if self.route_shock is not None else self.route_normal
        case = self.net["cases"][0]
        route = route_solver["selection"][case["id"]]
        flight_lookup = {f["id"]: f for f in self.net["flights"]}
        route_names = [flight_lookup[f]["origin"] + "→" + flight_lookup[f]["destination"]
                       for f in route["legs"]]
        pending = self.route_shock is not None
        customer = {"shipment_id": case["id"], "origin": case["origin"],
                    "destination": case["destination"], "flight_legs":route_names,
                    "route_kind":route["kind"], "route_id":route["id"],
                    "pending_confirmation":pending,
                    "status": "Recovery proposal · human confirmation pending" if pending
                               else "Monitored planned itinerary · simulated",
                    "reason": ("Authoritative demo closure set direct HKG→LHR slots to zero. "
                               "The globally constrained portfolio solver selected "
                               +(" via ".join(route_names) if route_names else "a no-flight hold")+
                               "; operator approval remains mandatory.") if pending
                              else "Current solved route respects the shared synthetic flight capacities."}
        return {"tick":self.tick,"seed":self.seed,"generated":self.generated,
            "arrivals_per_tick":self.arrivals,"chaos":self.chaos,
            "resources":{"handlers":self.handlers,"cold_bays":self.cold_bays,
                         "stands":self.stands},
            "policies":data,"events":self.events[-16:],"logs":self.logs[-26:],
            "incident_active":self.tick>=8,"customer":customer,
            "source":"DEMO SYNTHETIC POISSON + MILP; NOT ACTUAL AIRPORT TELEMETRY",
            "decision":{"packing_risk_base":self.pack["baseline"]["risk_score"],
                        "packing_risk_relay":self.pack["aware"]["risk_score"],
                        "pivot":self.pivot["recommended"].upper(),
                        "network_risk":(self.route_shock["score"] if self.route_shock
                                        else self.route_normal["score"])}}


@lru_cache(maxsize=8)
def ten_thousand_benchmark(seed=20261101):
    """Real 10k paired samples of the integrated three-model source simulator."""
    seed=int(seed)
    start=time.perf_counter()
    network=R.make_network_case()
    packing=R.solve_packing(R.make_packing_case())
    out=R.simulate_integrated_episodes(network,packing,n=10000,seed=seed)
    df=out["episodes"]
    mean_base=float(df.base_loss.mean())
    mean_relay=float(df.relay_loss.mean())
    savings=df.paired_saving.to_numpy(dtype=float)
    rng=np.random.default_rng(seed+73)
    boot=np.array([savings[rng.integers(0,len(savings),len(savings))].mean()
                   for _ in range(600)])
    return {
        "n":len(df),"seed":seed,"mean_cost_baseline":mean_base,
        "mean_cost_relay":mean_relay,"mean_paired_saving":float(savings.mean()),
        "relative_improvement_percent":100*float(savings.mean())/mean_base,
        "ci95":[float(x) for x in np.percentile(boot,[2.5,97.5])],
        "unresolved_rate_baseline":float(1-df.base_resolved.mean()),
        "unresolved_rate_relay":float(1-df.relay_resolved.mean()),
        "regression_fraction":float(np.mean(savings<0)),
        "cost_ledger":{"baseline":{"network":float(df.base_route_loss.mean()),
                    "rehandling":float(df.base_rehandling.mean()),
                    "verification":float(df.base_inspection.mean()),
                    "switching":float(df.base_coordination.mean())},
               "relay":{"network":float(df.relay_route_loss.mean()),
                    "rehandling":float(df.relay_rehandling.mean()),
                    "verification":float(df.relay_inspection.mean()),
                    "switching":float(df.relay_coordination.mean())}},
        "duration_s":time.perf_counter()-start,
        "scope":"10,000 actual paired synthetic episodes using Model I, PIVOT and "
            "Model III. No real-time queue speed result, historical calibration, "
            "aircraft safety result, or real Cathay ROI is claimed."
    }
