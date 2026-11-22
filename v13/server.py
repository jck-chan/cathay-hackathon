"""RELAY v13 server. Standard library only; binds 127.0.0.1 by default.

The simulation clock runs on a background thread: one engine tick = 1 simulated
minute, executed at the target `tps` (ticks per real second) while playing.

Endpoints: the app (/), its REST API (/api/*), the Agent tab's chat stream (/api/chat),
and an MCP server for external agents (/mcp). Every request is checked against
DNS-rebinding (Host) and cross-site (Origin) attacks before it is handled: only loopback
hosts/origins are accepted unless RELAY_ALLOWED_HOSTS / RELAY_ALLOWED_ORIGINS add more.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import threading
import time
import urllib.parse
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from relay13.aircraft import AirportConfig  # noqa: E402
from relay13 import evidence, mcp, tools  # noqa: E402
from relay13.chat import ChatRuntime  # noqa: E402
from relay13.engine import ROLES, SCENARIOS, Simulation, generate  # noqa: E402

STATIC = ROOT / 'static'
mimetypes.add_type('model/gltf-binary', '.glb')
mimetypes.add_type('text/javascript', '.js')


class Clock:
    """Owns the live simulation and its play/pause/speed state."""

    def __init__(self):
        self.lock = threading.RLock()
        self.playing = False
        self.tps = 32.0
        self.autopilot = True
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
            self.world_id = uuid.uuid4().hex
            self.playing = False
            self.measured = 0.0; self._ticks.clear()

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
            with self.lock:
                if not self.playing:
                    acc = 0.0
                else:
                    acc += dt * self.tps
                    n = int(acc)
                    if n:
                        acc -= n; self.tick(min(n, 4))
                cut = now - 2.0
                self._ticks = [x for x in self._ticks if x > cut]
                self.measured = len(self._ticks) / 2.0

    def state(self, since=0, world_id=None):
        with self.lock:
            if world_id is not None and world_id != self.world_id:
                since = 0
            snap = self.sim.snapshot(since)
            snap['world_id'] = self.world_id
            snap['control'] = {'playing': self.playing, 'tps': self.tps, 'autopilot': self.autopilot,
                               'effective_tps': self.tps, 'measured_tps': round(self.measured, 1),
                               'params': self.params.copy(), 'server_time': time.time()}
            return snap


CLOCK = None
CHAT = None
LOOPBACK = {'127.0.0.1', 'localhost', '::1', '[::1]'}
PUBLIC_DOMAINS = {
    'cathay.ckchan.com',
    os.environ.get('RELAY_PUBLIC_DOMAIN', '').strip().lower(),
    os.environ.get('RAILWAY_PUBLIC_DOMAIN', '').strip().lower(),
} - {''}
EXTRA_HOSTS = PUBLIC_DOMAINS | {
    h.strip().lower() for h in os.environ.get('RELAY_ALLOWED_HOSTS', '').split(',') if h.strip()
}
EXTRA_ORIGINS = {f'https://{domain}' for domain in PUBLIC_DOMAINS} | {
    o.strip().rstrip('/').lower() for o in os.environ.get('RELAY_ALLOWED_ORIGINS', '').split(',') if o.strip()
}
CORS_HEADERS = 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID'


def host_name(value: str) -> str:
    """'127.0.0.1:8813' -> '127.0.0.1', '[::1]:8813' -> '[::1]'."""
    value = value.strip().lower()
    if value.startswith('['):
        return value[:value.find(']') + 1]
    return value.rsplit(':', 1)[0] if value.count(':') == 1 else value


def host_allowed(host: str | None) -> bool:
    if not host:
        return False
    name = host_name(host)
    return name in LOOPBACK or name in EXTRA_HOSTS or host.strip().lower() in EXTRA_HOSTS


def origin_allowed(origin: str | None) -> bool:
    """No Origin (curl, MCP clients, same-origin GET) is fine; 'null' and foreign sites are not."""
    if origin is None:
        return True
    o = origin.strip().rstrip('/').lower()
    if o in EXTRA_ORIGINS:
        return True
    parts = urllib.parse.urlsplit(o)
    return parts.scheme in ('http', 'https') and host_name(parts.netloc) in LOOPBACK


def num(v, default, lo, hi, cast=float):
    try:
        return max(lo, min(hi, cast(v)))
    except (TypeError, ValueError):
        return default


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return

    # ---- security -------------------------------------------------------------------
    def cors(self):
        origin = self.headers.get('Origin')
        if origin and origin_allowed(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version')

    def guard(self) -> bool:
        """Reject DNS-rebinding (foreign Host) and cross-site (foreign Origin) requests."""
        if not host_allowed(self.headers.get('Host')):
            self.send({'error': 'host not allowed'}, 421); return False
        if not origin_allowed(self.headers.get('Origin')):
            self.send({'error': 'origin not allowed'}, 403); return False
        return True

    def json_body_ok(self) -> bool:
        # A JSON content type forces a CORS preflight for browsers, closing the simple-POST CSRF hole.
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if ctype != 'application/json':
            self.send({'error': 'Content-Type must be application/json'}, 415); return False
        return True

    def do_OPTIONS(self):
        if not self.guard():
            return
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', CORS_HEADERS)
        self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def send(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.cors()
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

    def do_DELETE(self):
        if self.guard():
            self.send({'error': 'stateless MCP server: no session to delete'}, 405)

    def do_GET(self):
        if not self.guard():
            return
        url = urllib.parse.urlsplit(self.path); q = urllib.parse.parse_qs(url.query)
        route = url.path
        if route == '/mcp':  # stateless server: no server-initiated SSE stream
            self.send_response(405); self.cors(); self.send_header('Allow', 'POST'); self.send_header('Content-Length', '0')
            self.end_headers(); return
        if route == '/api/evidence':
            g = lambda k, d: q.get(k, [d])[0]
            scenario = g('scenario', 'mixed'); scenario = scenario if scenario in SCENARIOS or scenario == 'mixed' else 'mixed'
            self.send(evidence.run(seeds=num(g('seeds', 6), 6, 2, 16, int), days=num(g('days', 1), 1, 1, 2, int),
                                   scenario=scenario, demand=num(g('rate', 1), 1., .2, 3.), stands=CLOCK.params['stands'])); return
        if route == '/api/chat/config':
            self.send(CHAT.config() | {'mcp_path': '/mcp'}); return
        if route == '/api/state':
            self.send(CLOCK.state(num(q.get('since', [0])[0], 0, 0, 10 ** 9, int), q.get('world_id', [None])[0])); return
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
        if route in ('/cockpit', '/cockpit/'):
            route = '/cockpit.html'
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
        if not self.guard() or not self.json_body_ok():
            return
        route = urllib.parse.urlsplit(self.path).path
        if route == '/mcp':
            n = num(self.headers.get('Content-Length', '0'), 0, 0, 1_000_000, int)
            status, out = mcp.handle(CLOCK, self.rfile.read(n))
            if out is None:
                self.send_response(status); self.cors(); self.send_header('Content-Length', '0'); self.end_headers()
            else:
                self.send(out, status)
            return
        d = self.body()
        if route == '/api/chat':
            msgs = d.get('messages')
            if not isinstance(msgs, list) or not msgs:
                self.send({'error': 'messages required'}, 422); return
            self.send_response(200); self.cors()
            self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache')
            self.send_header('x-vercel-ai-ui-message-stream', 'v1'); self.send_header('Connection', 'close')
            self.end_headers(); self.close_connection = True
            try:
                for chunk in CHAT.stream(d.get('id'), msgs):
                    self.wfile.write(chunk); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass  # the browser pressed Stop
            return
        if route == '/api/chat/tool':  # artifact panels call simulation tools through here
            try:
                self.send({'result': tools.call(CLOCK, str(d.get('name', '')), d.get('arguments') or {})})
            except tools.ToolError as exc:
                self.send({'detail': str(exc)}, 422)
            return
        if route == '/api/control':
            with CLOCK.lock:
                if 'playing' in d: CLOCK.playing = bool(d['playing']) and not CLOCK.sim.done
                if 'tps' in d: CLOCK.tps = num(d['tps'], CLOCK.tps, .1, 60)
                if 'autopilot' in d: CLOCK.autopilot = bool(d['autopilot'])
                if 'demand' in d: CLOCK.sim.set_demand(num(d['demand'], CLOCK.sim.demand, .2, 3.))
                if 'demand' in d: CLOCK.params['load'] = CLOCK.sim.demand  # keep it across New world
            self.send(CLOCK.state(num(d.get('since', 0), 0, 0, 10 ** 9, int), d.get('world_id'))); return
        if route == '/api/step':
            CLOCK.tick(num(d.get('n', 1), 1, 1, 1440, int))
            self.send(CLOCK.state(num(d.get('since', 0), 0, 0, 10 ** 9, int), d.get('world_id'))); return
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
            self.send({**r, 'state': CLOCK.state(num(d.get('since', 0), 0, 0, 10 ** 9, int), d.get('world_id'))}); return
        self.send({'ok': False, 'error': 'unknown endpoint'}, 404)


def main():
    global CLOCK, CHAT
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8813)
    ap.add_argument('--open', action='store_true')
    a = ap.parse_args()
    CLOCK = Clock()
    CHAT = ChatRuntime(CLOCK, ROOT)
    # warm the default evidence study so the Evidence tab opens instantly
    threading.Thread(target=lambda: evidence.run(stands=CLOCK.params['stands']), daemon=True).start()
    url = f'http://127.0.0.1:{a.port}'
    server = ThreadingHTTPServer((a.host, a.port), Handler)
    print('RELAY v13 live apron', url, flush=True)
    print(f'MCP server        {url}/mcp', flush=True)
    print(f'Agent model       {CHAT.model} via Vercel AI Gateway' + ('' if CHAT.configured else ' (no AI_GATEWAY_API_KEY found)'), flush=True)
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
