import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
from relay13 import mcp, tools  # noqa: E402
from relay13.chat import from_ui  # noqa: E402


class FakeClock(server.Clock):
    """A Clock without its background thread."""

    def __init__(self):
        import threading
        self.lock = threading.RLock(); self.playing = False; self.tps = 1.0; self.autopilot = False
        self.measured = 0.0; self._ticks = []
        self.params = dict(seed=7, days=1, load=1.0, scenario='normal', stands=5, role='novice_assisted')
        self.reset()


def rpc(clock, method, params=None, id_=1):
    status, body = mcp.handle(clock, json.dumps({'jsonrpc': '2.0', 'id': id_, 'method': method, 'params': params or {}}).encode())
    return status, body


class TestMcp(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def test_initialize_negotiates_version(self):
        _, b = rpc(self.clock, 'initialize', {'protocolVersion': '2025-03-26'})
        self.assertEqual(b['result']['protocolVersion'], '2025-03-26')
        self.assertIn('tools', b['result']['capabilities'])
        _, b = rpc(self.clock, 'initialize', {'protocolVersion': '1999-01-01'})
        self.assertEqual(b['result']['protocolVersion'], mcp.SUPPORTED_VERSIONS[0])

    def test_notification_gets_202(self):
        status, body = mcp.handle(self.clock, b'{"jsonrpc":"2.0","method":"notifications/initialized"}')
        self.assertEqual((status, body), (202, None))

    def test_tools_list_matches_registry(self):
        _, b = rpc(self.clock, 'tools/list')
        names = [t['name'] for t in b['result']['tools']]
        self.assertEqual(names, [t['name'] for t in tools.TOOLS])
        self.assertTrue(all(t['inputSchema']['type'] == 'object' for t in b['result']['tools']))

    def test_call_returns_structured_content(self):
        _, b = rpc(self.clock, 'tools/call', {'name': 'get_state', 'arguments': {}})
        self.assertFalse(b['result']['isError'])
        self.assertIn('staging', b['result']['structuredContent'])

    def test_step_moves_clock(self):
        t = self.clock.sim.t
        _, b = rpc(self.clock, 'tools/call', {'name': 'step_simulation', 'arguments': {'ticks': 30}})
        self.assertEqual(self.clock.sim.t, t + 30)
        self.assertEqual(b['result']['structuredContent']['advanced_minutes'], 30)

    def test_event_cursor_recovers_after_reset_with_same_seed(self):
        self.clock.sim.log('arrival', 'Before reset', '')
        before = self.clock.state()
        self.assertEqual(self.clock.state(before['event_seq'], before['world_id'])['events'], [])

        self.clock.reset()
        self.clock.sim.log('arrival', 'After reset', '')
        after = self.clock.state(before['event_seq'], before['world_id'])
        self.assertNotEqual(after['world_id'], before['world_id'])
        self.assertEqual(after['seed'], before['seed'])
        self.assertEqual(after['events'][-1]['title'], 'After reset')

    def test_bad_arguments_are_tool_errors(self):
        for args in ({'ticks': 0}, {'ticks': 'ten'}, {}, {'ticks': 5, 'extra': 1}):
            _, b = rpc(self.clock, 'tools/call', {'name': 'step_simulation', 'arguments': args})
            self.assertTrue(b['result']['isError'], args)

    def test_agent_load_uses_guard(self):
        _, b = rpc(self.clock, 'tools/call', {'name': 'load_cargo', 'arguments': {'cargo_id': 'nope', 'flight_id': 'nope'}})
        self.assertFalse(b['result']['structuredContent']['ok'])
        self.assertEqual(b['result']['structuredContent']['reason'], 'UNKNOWN_OBJECT')

    def test_unknown_method_and_parse_error(self):
        _, b = rpc(self.clock, 'does/not/exist')
        self.assertEqual(b['error']['code'], -32601)
        status, b = mcp.handle(self.clock, b'{not json')
        self.assertEqual((status, b['error']['code']), (400, -32700))

    def test_batch(self):
        status, b = mcp.handle(self.clock, json.dumps([{'jsonrpc': '2.0', 'id': 1, 'method': 'ping'},
                                                       {'jsonrpc': '2.0', 'method': 'notifications/initialized'}]).encode())
        self.assertEqual(status, 200); self.assertEqual(len(b), 1)


class TestOriginGuard(unittest.TestCase):
    def test_hosts(self):
        for h in ('127.0.0.1:8813', 'localhost:8813', 'localhost', '[::1]:8813'):
            self.assertTrue(server.host_allowed(h), h)
        for h in ('evil.example', 'evil.example:8813', '127.0.0.1.nip.io:8813', '', None):
            self.assertFalse(server.host_allowed(h), h)

    def test_origins(self):
        for o in (None, 'http://127.0.0.1:8813', 'http://localhost:6274', 'https://localhost', 'http://[::1]:3000'):
            self.assertTrue(server.origin_allowed(o), o)
        for o in ('null', 'https://evil.example', 'http://localhost.evil.example', 'file://', 'http://127.0.0.1.nip.io'):
            self.assertFalse(server.origin_allowed(o), o)


class TestChatHistory(unittest.TestCase):
    def test_ui_messages_rebuild_tool_turns(self):
        ui = [{'id': 'u', 'role': 'user', 'parts': [{'type': 'text', 'text': 'hi'}]},
              {'id': 'a', 'role': 'assistant', 'parts': [{'type': 'step-start'}, {'type': 'text', 'text': 'reading'},
               {'type': 'tool-get_state', 'toolCallId': 'c1', 'state': 'output-available', 'input': {}, 'output': {'x': 1}},
               {'type': 'step-start'}, {'type': 'text', 'text': 'done'}]}]
        h = from_ui(ui)
        self.assertEqual([m['role'] for m in h], ['user', 'assistant', 'user', 'assistant'])
        self.assertEqual(h[1]['content'][1]['type'], 'tool_use')
        self.assertEqual(h[2]['content'][0]['tool_use_id'], 'c1')


if __name__ == '__main__':
    unittest.main()
