import itertools
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from relay13.aircraft import AIRCRAFT_TYPES, AirportConfig, type_refusal  # noqa: E402
from relay13.engine import (LAND_TO_STAND, RANK_EVERY, ROLES, Simulation, exact_subset,  # noqa: E402
                            generate, snake_dp)


class TestWorld(unittest.TestCase):
    def test_deterministic(self):
        self.assertEqual(generate(23, 1, 1., 'normal'), generate(23, 1, 1., 'normal'))

    def test_stand_count_is_configurable(self):
        for n in (1, 3, 5, 8):
            w = generate(4, 1, config=AirportConfig(stands=n))
            self.assertEqual({f.stand for f in w.flights}, set(range(n)))

    def test_stand_rotations_never_overlap(self):
        w = generate(5, 3, config=AirportConfig(stands=5))
        for s in range(5):
            fl = sorted((f for f in w.flights if f.stand == s), key=lambda f: f.on_stand)
            for a, b in zip(fl, fl[1:]):
                self.assertGreaterEqual(b.on_stand, a.departure + 18)
            self.assertTrue(all(f.on_stand - f.land == LAND_TO_STAND for f in fl))

    def test_shipments_fit_their_aircraft_type(self):
        cfg = AirportConfig(enabled_types=tuple(AIRCRAFT_TYPES))
        w = generate(11, 2, config=cfg)
        self.assertGreater(len({f.type for f in w.flights}), 1)
        for c in w.cargo:
            t = AIRCRAFT_TYPES[w.flights[c.booked].type]
            self.assertIsNone(type_refusal(t, c.category, c.kg))
            self.assertEqual(c.route, w.flights[c.booked].route)

    def test_default_fleet_flies_every_type(self):
        self.assertEqual({f.type for f in generate(3, 5).flights}, set(AIRCRAFT_TYPES))

    def test_every_type_has_a_model_file(self):
        root = Path(__file__).resolve().parents[1] / 'static' / 'assets' / 'aircraft'
        for t in AIRCRAFT_TYPES.values():
            self.assertTrue((root / t.model).is_file(), f'{t.code}: {t.model}')

    def test_cargo_rate_changes_admissions(self):
        w = generate(5, days=1)
        low, high = Simulation(w, trace=False), Simulation(w, trace=False)
        low.set_demand(.5); high.set_demand(2.)
        self.assertLess(low.run()['admitted'], high.run()['admitted'])


class TestSimulation(unittest.TestCase):
    def test_roles_conserve_shipments(self):
        w = generate(39, 1, 1., 'normal')
        for role in ROLES:
            s = Simulation(w, role, trace=False).run()
            self.assertEqual(s['conservation'], 1)
            self.assertLessEqual(s['original_fulfilled'], s['due_confirmed'])
            self.assertLessEqual(s['quote_flown'], s['quote_offered'])

    def test_invariants_under_stress(self):
        for sc in ('compound_cascade', 'flight_cancel', 'equipment_breakdown', 'cold_chain_alarm', 'thunderstorm'):
            w = generate(100, days=2, load=1.4, scenario=sc)
            for role in ROLES:
                self.assertEqual(Simulation(w, role, trace=False).run()['conservation'], 1)

    def test_staging_hard_cap(self):
        w = generate(77, days=1, load=1.8, scenario='peak_burst', config=AirportConfig(staging=10))
        sim = Simulation(w, 'novice_manual')
        while not sim.done:
            sim.step(True)
            self.assertLessEqual(sim.counts()['staging'], 10)

    def test_unknown_object_rejected(self):
        sim = Simulation(generate(8, days=1))
        self.assertEqual(sim.request('nope', 'nope')['reason'], 'UNKNOWN_OBJECT')

    def test_rejected_drop_does_not_execute(self):
        sim = Simulation(generate(77, days=1))
        i = next(k for k in range(sim.n) if sim.state[k] in (2, 3))
        wrong = next(j for j, f in enumerate(sim.flights) if f.route != sim.s[i].route and f.type != 'A21N' and f.on_stand <= sim.t < f.departure)
        before = sim.state[i]
        r = sim.request(sim.s[i].id, sim.flights[wrong].id)
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'ROUTE_MISMATCH')
        self.assertIn(sim.flights[wrong].route, r['message'])
        self.assertEqual(sim.state[i], before)

    def test_accepted_drop_reserves_capacity(self):
        sim = Simulation(generate(2026, days=1))
        for _ in range(240):
            for i in range(sim.n):
                ok, _ = sim.actually_feasible(i, sim.target[i])
                if ok:
                    j = sim.target[i]; used = len(sim.reservations[j])
                    r = sim.request(sim.s[i].id, sim.flights[j].id)
                    self.assertTrue(r['ok']); self.assertEqual(sim.state[i], 4)
                    self.assertEqual(len(sim.reservations[j]), used + 1)
                    return
            sim.step(False)
        self.fail('no feasible drop found')

    def test_aircraft_type_policy(self):
        a321 = AIRCRAFT_TYPES['A21N']
        self.assertEqual(type_refusal(a321, 'DG', 100)[0], 'TYPE_CATEGORY')
        self.assertEqual(type_refusal(a321, 'PHARMA', 100)[0], 'TYPE_CATEGORY')
        self.assertEqual(type_refusal(a321, 'GEN', 350)[0], 'TYPE_PIECE_WEIGHT')
        self.assertIsNone(type_refusal(AIRCRAFT_TYPES['A333'], 'DG', 450))

    def test_type_guard_runs_before_booking_guard(self):
        cfg = AirportConfig(enabled_types=('A333', 'A21N'))
        sim = Simulation(generate(31, days=2, config=cfg))
        for _ in range(900):
            narrow = [j for j, f in enumerate(sim.flights) if f.type == 'A21N' and f.on_stand <= sim.t < f.departure]
            heavy = [i for i in range(sim.n) if sim.state[i] in (2, 3) and (sim.s[i].kg > 200 or sim.s[i].category in ('DG', 'PHARMA'))]
            if narrow and heavy:
                ok, code, msg = sim.check(heavy[0], narrow[0])
                self.assertFalse(ok); self.assertIn(code, ('TYPE_CATEGORY', 'TYPE_PIECE_WEIGHT'))
                self.assertIn('A321neo', msg)
                return
            sim.step(True)
        self.fail('no A321neo on stand with heavy/special cargo waiting')

    def test_cutoff_includes_decision_time(self):
        w = generate(1, days=1, scenario='normal'); sim = Simulation(w)
        i = next(k for k in range(sim.n) if sim.state[k] in (2, 3)); s = sim.s[i]; f = sim.flights[s.booked]
        s.ready = 0; sim.t = f.cutoff - s.handle - 1
        ok, reason = sim.actually_feasible(i, s.booked)
        self.assertFalse(ok); self.assertEqual(reason, 'CUTOFF_CANNOT_BE_MET')

    def test_cancel_only_visible_after_receipt(self):
        w = generate(7, days=1, scenario='flight_cancel'); sim = Simulation(w)
        e = next(e for e in w.incidents if e.type == 'cancel')
        while sim.t <= e.occurs:
            sim.step(False)
        self.assertNotIn(e.flight, sim.obs_cancel)
        self.assertNotEqual(sim.flight_view(e.flight)['status'], 'cancelled')
        while sim.t < e.received + 2:
            sim.step(False)
        self.assertEqual(sim.flight_view(e.flight)['status'], 'cancelled')

    def test_ranking_refreshes_every_five_minutes(self):
        sim = Simulation(generate(12, days=1))
        stamps = set()
        for _ in range(30):
            sim.step(False); stamps.add(sim.rank_t)
        self.assertTrue(all(t % RANK_EVERY == 0 for t in stamps if t != sim.w.start))
        self.assertTrue(all(r['rank'] == k + 1 for k, r in enumerate(sim.ranking)))
        self.assertTrue(all(r['intensity'] in ('critical', 'high', 'medium', 'low') for r in sim.ranking))

    def test_events_are_human_readable(self):
        sim = Simulation(generate(2026, days=1))
        for _ in range(600):
            sim.step(True)
        kinds = {e['kind'] for e in sim.events}
        self.assertTrue({'arrival', 'departure', 'landing', 'assigned'} <= kinds)
        self.assertTrue(all(e['title'] and '_' not in e['title'].split()[0] for e in sim.events))

    def test_thirty_days_conserve(self):
        self.assertEqual(Simulation(generate(9, days=30, load=1.1), trace=False).run()['conservation'], 1)


class TestMath(unittest.TestCase):
    def test_snake_dp_exhaustive(self):
        for n in range(1, 9):
            vals = [(-1) ** i * (i + .3) for i in range(n)]
            scores = [sum(vals[i] for i in range(n) if bits[i]) for bits in itertools.product((0, 1), repeat=n)
                      if all(not (bits[i] and bits[i + 1]) for i in range(n - 1))]
            best, selected = snake_dp(vals)
            self.assertAlmostEqual(best, min(scores))
            self.assertTrue(all(abs(a - b) > 1 for a, b in itertools.combinations(selected, 2)))

    def test_bounded_exact_subset(self):
        score, idx = exact_subset([(1, 5., False), (2, 10., True), (3, 9., True), (4, 4., False)], 2, 1)
        self.assertEqual(score, 15.0); self.assertEqual(set(idx), {1, 2})


if __name__ == '__main__':
    unittest.main()
