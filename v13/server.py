"""RELAY v13 localhost server. Standard library only; binds 127.0.0.1.

The simulation clock runs on a background thread: one engine tick = 1 simulated
minute, executed at `tps × speed` ticks per real second while playing.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from relay13.aircraft import AirportConfig  # noqa: E402
from relay13.engine import ROLES, SCENARIOS, Simulation, generate  # noqa: E402

STATIC = ROOT / 'static'
mimetypes.add_type('model/gltf-binary', '.glb')
mimetypes.add_type('text/javascript', '.js')


class Clock:
    """Owns the live simulation and its play/pause/speed state."""

    def __init__(self):
        self.lock = threading.RLock()
        self.playing = False; self.tps = 1.0; self.speed = 1.0; self.autopilot = False
        self.measured = 0.0; self._ticks = []
        self.params = dict(seed=2026, days=3, load=1.0, scenario='mixed', stands=5, role='novice_assisted')
        self.reset()
        threading.Thread(target=self._loop, daemon=True).start()

    def reset(self, **kw):
        with self.lock:
            self.params.update({k: v for k, v in kw.items() if v is not None})
            p = self.params
            cfg = AirportConfig(stands=p['stands'])
            self.world = generate(p['seed'], days=p['days'], load=p['load'], scenario=p['scenario'], config=cfg)
            self.sim = Simulation(self.world, p['role'])
            self.playing = False

    def tick(self, n=1):
        with self.lock:
            for _ in range(n):
                if self.sim.done:
                    self.playing = False; break
                self.sim.step(self.autopilot)
                self._ticks.append(time.monotonic())

    def _loop(self):
        acc = 0.0; last = time.monotonic()
        while True:
            time.sleep(0.01)
            now = time.monotonic(); dt = now - last; last = now
            if not self.playing:
                acc = 0.0
            else:
                acc += dt * self.tps * self.speed
                n = int(acc)
                if n:
                    acc -= n; self.tick(min(n, 240))
            cut = now - 2.0
            self._ticks = [x for x in self._ticks if x > cut]
            self.measured = len(self._ticks) / 2.0

    def state(self, since=0):
        with self.lock:
            snap = self.sim.snapshot(since)
            snap['control'] = {'playing': self.playing, 'tps': self.tps, 'speed': self.speed, 'autopilot': self.autopilot,
                               'effective_tps': self.tps * self.speed, 'measured_tps': round(self.measured, 1),
                               'params': self.params, 'server_time': time.time()}
            return snap


CLOCK = None


def num(v, default, lo, hi, cast=float):
    try:
        return max(lo, min(hi, cast(v)))
    except (TypeError, ValueError):
        return default


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return

    def send(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers(); self.wfile.write(payload)

    def body(self):
        n = num(self.headers.get('Content-Length', '0'), 0, 0, 200000, int)
        try:
            return json.loads(self.rfile.read(n)) if n else {}
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path); q = urllib.parse.parse_qs(url.query)
        route = url.path
        if route == '/api/state':
            self.send(CLOCK.state(num(q.get('since', [0])[0], 0, 0, 10 ** 9, int))); return
        if route == '/api/check':
            cargo = q.get('cargo', [''])[0]
            with CLOCK.lock:
                sim = CLOCK.sim; i = sim.index.get(cargo, -1); out = {}
                for f in sim.snapshot()['flights']:
                    ok, code, msg = sim.check(i, sim.findex[f['id']])
                    out[f['id']] = {'ok': ok, 'code': code, 'message': msg}
            self.send({'cargo': cargo, 'flights': out}); return
        if route == '/api/meta':
            self.send({'scenarios': ['mixed', *SCENARIOS], 'roles': list(ROLES)}); return
        if route in ('/', '/index.html'):
            route = '/index.html'
        path = (STATIC / route.lstrip('/')).resolve()
        if STATIC not in path.parents or not path.is_file():
            self.send({'error': 'not found'}, 404); return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'max-age=86400' if path.suffix == '.glb' or 'vendor' in path.parts else 'no-cache')
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        route = urllib.parse.urlsplit(self.path).path; d = self.body()
        if route == '/api/control':
            with CLOCK.lock:
                if 'playing' in d: CLOCK.playing = bool(d['playing']) and not CLOCK.sim.done
                if 'tps' in d: CLOCK.tps = num(d['tps'], CLOCK.tps, .1, 60)
                if 'speed' in d: CLOCK.speed = num(d['speed'], CLOCK.speed, .25, 32)
                if 'autopilot' in d: CLOCK.autopilot = bool(d['autopilot'])
                if 'demand' in d: CLOCK.sim.set_demand(num(d['demand'], CLOCK.sim.demand, .2, 3.))
                if 'demand' in d: CLOCK.params['load'] = CLOCK.sim.demand  # keep it across New world
            self.send(CLOCK.state(num(d.get('since', 0), 0, 0, 10 ** 9, int))); return
        if route == '/api/step':
            CLOCK.tick(num(d.get('n', 1), 1, 1, 1440, int))
            self.send(CLOCK.state(num(d.get('since', 0), 0, 0, 10 ** 9, int))); return
        if route == '/api/reset':
            scenario = d.get('scenario'); scenario = scenario if scenario in SCENARIOS or scenario == 'mixed' else None
            CLOCK.reset(seed=num(d.get('seed'), None, 1, 10 ** 7, int) if 'seed' in d else None,
                        load=num(d.get('load'), None, .3, 2.5) if 'load' in d else None,
                        stands=num(d.get('stands'), None, 1, 12, int) if 'stands' in d else None,
                        scenario=scenario)
            self.send(CLOCK.state(0)); return
        if route in ('/api/load', '/api/offload'):
            with CLOCK.lock:
                sim = CLOCK.sim
                if route == '/api/load':
                    r = sim.request(str(d.get('cargo', '')), str(d.get('flight', '')), actor='operator')
                else:
                    r = sim.revoke(str(d.get('cargo', '')), actor='operator')
            self.send({**r, 'state': CLOCK.state(num(d.get('since', 0), 0, 0, 10 ** 9, int))}); return
        self.send({'ok': False, 'error': 'unknown endpoint'}, 404)


def main():
    global CLOCK
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8813)
    ap.add_argument('--open', action='store_true')
    a = ap.parse_args()
    CLOCK = Clock()
    url = f'http://127.0.0.1:{a.port}'
    server = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print('RELAY v13 live apron', url, flush=True)
    if a.open:
        threading.Timer(.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
