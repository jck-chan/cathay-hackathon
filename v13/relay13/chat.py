"""In-app agent for the Agent tab, modelled on the v11 chat harness.

The model is reached through the Vercel AI Gateway (Anthropic Messages wire format, like v11);
the default model is google/gemini-4-hydrogen. It drives the same tools the MCP endpoint exposes
(relay13.tools) plus `create_artifact`. Replies stream to the browser in the AI SDK UI message
stream protocol (SSE), so the v11 chat client renders them unchanged.

Standard library only: the gateway is called with urllib and its SSE stream parsed here.
RELAY_CHAT_MODEL=demo runs a scripted offline agent that needs no credentials.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Iterator

from . import tools as T

GATEWAY_URL = 'https://ai-gateway.vercel.sh'
GATEWAY_MODEL = 'google/gemini-4-hydrogen'
DEMO_MODEL = 'demo'
MAX_STEPS = 16
MAX_ARTIFACT_BYTES = 200_000
MAX_THREADS = 64
HISTORY_LIMIT = 600_000   # characters before the oldest turns are dropped
HISTORY_BLOCK = 300_000

SYSTEM_PROMPT = """You are the operations copilot inside RELAY v13, a local synthetic air-cargo simulation of a Hong Kong (HKG) apron. The person you are talking to operates it and sees your reply in the Agent tab; the Live apron tab shows the 3D view, the Evidence tab shows the paired role study.

Everything here is synthetic. Nothing you do books a flight, moves real cargo or notifies a real customer, so act on requests directly instead of asking for confirmation, and describe results as simulated.

Read the state before acting. Before loading cargo, check it and pick a flight whose check is ok; never invent IDs — copy cargo and flight IDs from tool results. A refused load changes nothing: report the reason. Times are simulated minutes; one tick is one simulated minute. Costs are unitless modelled penalties.

# Showing the apron
Write <relay-twin view="apron" /> on its own line when the person should look at the live 3D apron; it renders a button that opens that tab.

# Artifacts
create_artifact renders a small interactive panel in the chat. Use it when the person would benefit from something to click or watch: a control panel, a live monitor, a loading board. Answer plain questions in text.

An artifact is one HTML fragment (markup, <style>, <script>) shown in a sandboxed frame with no network access. It reaches the simulation only through the injected `relay` object:
- await relay.call(name, args) runs one of your simulation tools by name with exactly the arguments object you would pass yourself, and resolves to the tool result. It rejects on a tool error.
- relay.onState(fn) calls fn(state) with the live apron snapshot now and about once a second afterwards (fields: t, clock, day, control, staging, counts, kpis, flights, cargo, ranking, demand).
- relay.send(text) posts text into the chat as the person's next message.
The frame already styles body text, headings, button, button.primary, input, select, table, .card, .row (flex row), .grid (auto-fit grid), .muted, .pill, .kpi (big number with a <small> label) and exposes --ink, --soft, --line, --teal, --warn, --bad. Keep the layout compact, disable buttons while a call is pending, and show failures inline. Do not load external scripts, fonts or images.

# Simulation tool guide
""" + T.INSTRUCTIONS

ARTIFACT_TOOL = {
    'name': 'create_artifact',
    'description': 'Render an interactive HTML panel in the chat. `html` is one fragment with its own <style> and <script>; '
                   'it talks to the simulation through `relay`.',
    'input_schema': {'type': 'object', 'additionalProperties': False, 'required': ['title', 'html'],
                     'properties': {'title': {'type': 'string', 'maxLength': 120}, 'html': {'type': 'string'}}},
}


def load_env_files(start: Path) -> None:
    """Read KEY=VALUE lines from the nearest .env at or above `start` (a worktree finds its main checkout's)."""
    for folder in [start, *start.parents]:
        f = folder / '.env'
        if f.is_file():
            for line in f.read_text(encoding='utf-8').splitlines():
                key, sep, value = line.strip().partition('=')
                if sep and key and not key.startswith('#'):
                    os.environ.setdefault(key.strip(), value.strip().strip('"\''))
            return


def gateway_key() -> str | None:
    return os.environ.get('AI_GATEWAY_API_KEY') or os.environ.get('VERCEL_OIDC_TOKEN')


def sse(event: dict | str) -> bytes:
    return f'data: {event if isinstance(event, str) else json.dumps(event, default=str)}\n\n'.encode()


# ---- gateway client (Anthropic Messages wire format) -----------------------------------------
class GatewayError(RuntimeError):
    pass


def stream_messages(model: str, system: str, messages: list, tools: list) -> Iterator[dict]:
    body = {'model': model, 'max_tokens': 32000, 'system': system, 'messages': messages, 'tools': tools, 'stream': True}
    if 'claude' in model:
        body['thinking'] = {'type': 'adaptive', 'display': 'summarized'}
        body['output_config'] = {'effort': os.environ.get('RELAY_CHAT_EFFORT', 'medium')}
    else:  # as in v11: the gateway maps a thinking budget onto other providers' reasoning controls
        body['thinking'] = {'type': 'enabled', 'budget_tokens': 4096}
    key = gateway_key()
    req = urllib.request.Request(
        os.environ.get('RELAY_GATEWAY_URL', GATEWAY_URL).rstrip('/') + '/v1/messages', data=json.dumps(body).encode(),
        method='POST', headers={'Content-Type': 'application/json', 'Accept': 'text/event-stream',
                                'anthropic-version': '2023-06-01', 'x-api-key': key, 'Authorization': f'Bearer {key}'})
    try:
        resp = urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:400]
        raise GatewayError(f'AI Gateway returned HTTP {e.code}: {detail}') from None
    except urllib.error.URLError as e:
        raise GatewayError(f'Cannot reach the AI Gateway: {e.reason}') from None
    with resp:
        data = []
        for raw in resp:
            line = raw.decode('utf-8').rstrip('\r\n')
            if line.startswith('data:'):
                data.append(line[5:].lstrip())
            elif not line and data:
                payload = '\n'.join(data); data = []
                if payload and payload != '[DONE]':
                    yield json.loads(payload)


class Turn:
    """One model call: forwards stream events to the UI and rebuilds the assistant content blocks."""

    def __init__(self, emit: Callable[[dict], None]):
        self.emit = emit; self.blocks: dict[int, dict] = {}; self.part_ids: dict[int, str] = {}
        self.json_buf: dict[int, str] = {}; self.stop_reason = None

    def feed(self, ev: dict):
        kind = ev.get('type')
        if kind == 'error':
            raise GatewayError(json.dumps(ev.get('error', ev))[:400])
        if kind == 'content_block_start':
            i = ev['index']; block = dict(ev['content_block']); self.blocks[i] = block
            if block['type'] == 'tool_use':
                block['input'] = {}; self.json_buf[i] = ''
                self.emit({'type': 'tool-input-start', 'toolCallId': block['id'], 'toolName': block['name']})
            elif block['type'] in ('text', 'thinking'):
                ui = 'text' if block['type'] == 'text' else 'reasoning'
                self.part_ids[i] = uuid.uuid4().hex[:12]
                self.emit({'type': f'{ui}-start', 'id': self.part_ids[i]})
                first = block.get('text') or block.get('thinking')
                if first:
                    self.emit({'type': f'{ui}-delta', 'id': self.part_ids[i], 'delta': first})
        elif kind == 'content_block_delta':
            i = ev['index']; d = ev['delta']; block = self.blocks.get(i)
            if block is None:
                return
            if d['type'] == 'text_delta':
                block['text'] = block.get('text', '') + d['text']
                self.emit({'type': 'text-delta', 'id': self.part_ids[i], 'delta': d['text']})
            elif d['type'] == 'thinking_delta':
                block['thinking'] = block.get('thinking', '') + d['thinking']
                if d['thinking']:
                    self.emit({'type': 'reasoning-delta', 'id': self.part_ids[i], 'delta': d['thinking']})
            elif d['type'] == 'signature_delta':
                block['signature'] = block.get('signature', '') + d['signature']
            elif d['type'] == 'input_json_delta':
                self.json_buf[i] += d['partial_json']
                self.emit({'type': 'tool-input-delta', 'toolCallId': block['id'], 'inputTextDelta': d['partial_json']})
        elif kind == 'content_block_stop':
            i = ev['index']; block = self.blocks.get(i)
            if block is None:
                return
            if block['type'] == 'tool_use':
                try:
                    block['input'] = json.loads(self.json_buf[i] or '{}')
                except json.JSONDecodeError:
                    block['input'] = None  # reported as an invalid-input tool error
            elif i in self.part_ids:
                self.emit({'type': ('text' if block['type'] == 'text' else 'reasoning') + '-end', 'id': self.part_ids[i]})
        elif kind == 'message_delta':
            self.stop_reason = ev.get('delta', {}).get('stop_reason') or self.stop_reason

    def content(self) -> list[dict]:
        out = []
        for i in sorted(self.blocks):
            b = self.blocks[i]
            if b['type'] == 'tool_use':
                out.append({'type': 'tool_use', 'id': b['id'], 'name': b['name'], 'input': b['input'] or {}})
            elif b['type'] == 'text':
                if b.get('text'):
                    out.append({'type': 'text', 'text': b['text']})
            elif b['type'] == 'thinking':
                out.append({'type': 'thinking', 'thinking': b.get('thinking', ''), 'signature': b.get('signature', '')})
            else:
                out.append(b)  # redacted thinking and anything else: echo unchanged
        return out


# ---- history ---------------------------------------------------------------------------------
def from_ui(ui_messages: list[dict]) -> list[dict]:
    """Rebuild Messages-API history from AI SDK UI messages (reasoning is left out)."""
    out: list[dict] = []
    for m in ui_messages:
        parts = m.get('parts') or []
        if m.get('role') == 'user':
            text = ''.join(p.get('text', '') for p in parts if p.get('type') == 'text')
            if text.strip():
                out.append({'role': 'user', 'content': text})
            continue
        content, results = [], []

        def flush():
            nonlocal content, results
            if content:
                out.append({'role': 'assistant', 'content': content})
                if results:
                    out.append({'role': 'user', 'content': results})
            content, results = [], []
        for p in parts:
            kind = p.get('type', '')
            if kind == 'step-start':
                flush()
            elif kind == 'text' and p.get('text', '').strip():
                if results:
                    flush()
                content.append({'type': 'text', 'text': p['text']})
            elif kind.startswith('tool-') and p.get('state') in ('output-available', 'output-error'):
                failed = p['state'] == 'output-error'
                content.append({'type': 'tool_use', 'id': p['toolCallId'], 'name': kind[5:], 'input': p.get('input') or {}})
                results.append({'type': 'tool_result', 'tool_use_id': p['toolCallId'], 'is_error': failed,
                                'content': p.get('errorText', 'Tool failed') if failed else json.dumps(p.get('output'), default=str)})
        flush()
    return out


def trim(messages: list[dict]) -> list[dict]:
    size = lambda m: len(json.dumps(m['content'], default=str))
    total = sum(map(size, messages))
    if total <= HISTORY_LIMIT:
        return messages
    drop = -(-(total - HISTORY_LIMIT) // HISTORY_BLOCK) * HISTORY_BLOCK; seen = 0
    for i, m in enumerate(messages):
        if seen >= drop and m['role'] == 'user' and isinstance(m['content'], str):
            return messages[i:]
        seen += size(m)
    return messages[-1:]


# ---- runtime ---------------------------------------------------------------------------------
class ChatRuntime:
    def __init__(self, clock, root: Path):
        load_env_files(root)
        self.clock = clock
        self.model = os.environ.get('RELAY_CHAT_MODEL') or GATEWAY_MODEL
        self.threads: dict[str, tuple[list[str], list[dict]]] = {}
        self.lock = threading.Lock()
        self.tool_defs = [{'name': t['name'], 'description': t['description'], 'input_schema': t['schema']} for t in T.TOOLS] + [ARTIFACT_TOOL]

    @property
    def demo(self):
        return self.model == DEMO_MODEL

    @property
    def configured(self):
        return self.demo or bool(gateway_key())

    def config(self):
        return {'model': self.model, 'provider': 'Vercel AI Gateway', 'configured': self.configured, 'demo': self.demo,
                'tools': [t['name'] for t in self.tool_defs]}

    def run_tool(self, name: str, args: Any) -> Any:
        if name == 'create_artifact':
            if not isinstance(args, dict) or not isinstance(args.get('html'), str) or not isinstance(args.get('title'), str):
                raise T.ToolError('create_artifact needs a title and an html string')
            if len(args['html'].encode()) > MAX_ARTIFACT_BYTES:
                raise T.ToolError(f'Artifact is larger than {MAX_ARTIFACT_BYTES} bytes; make it smaller')
            return {'rendered': True, 'title': args['title']}
        return T.call(self.clock, name, args)

    def history(self, chat_id, ui_messages):
        with self.lock:
            ids, stored = self.threads.pop(chat_id, ([], []))
        *earlier, last = ui_messages
        if stored and ids == [m.get('id') for m in earlier] and last.get('role') == 'user':
            return trim(stored + from_ui([last]))
        return trim(from_ui(ui_messages))

    def remember(self, chat_id, ui_ids, messages):
        if not chat_id:
            return
        with self.lock:
            self.threads[chat_id] = (ui_ids, messages)
            while len(self.threads) > MAX_THREADS:
                self.threads.pop(next(iter(self.threads)))

    def stream(self, chat_id: str | None, ui_messages: list[dict]) -> Iterator[bytes]:
        reply_id = uuid.uuid4().hex
        events: list[dict] = []
        yield sse({'type': 'start', 'messageId': reply_id})
        try:
            if not self.configured:
                raise GatewayError('No model credentials. Set AI_GATEWAY_API_KEY (environment or .env) and restart, '
                                   'or set RELAY_CHAT_MODEL=demo for the scripted offline agent.')
            messages = self.history(chat_id, ui_messages)
            steps = demo_steps(self, messages) if self.demo else None
            for _ in range(MAX_STEPS):
                yield sse({'type': 'start-step'})
                turn = Turn(events.append)
                source = next(steps) if steps else stream_messages(self.model, SYSTEM_PROMPT, messages, self.tool_defs)
                for ev in source:
                    turn.feed(ev)
                    while events:
                        yield sse(events.pop(0))
                content = turn.content()
                calls = [b for b in content if b['type'] == 'tool_use']
                for b in calls:
                    yield sse({'type': 'tool-input-available', 'toolCallId': b['id'], 'toolName': b['name'], 'input': b['input']})
                if turn.stop_reason == 'refusal':
                    raise GatewayError('The model declined this request.')
                if turn.stop_reason == 'max_tokens' and calls:
                    raise GatewayError('The reply hit the token limit in the middle of a tool call.')
                messages.append({'role': 'assistant', 'content': content or [{'type': 'text', 'text': '…'}]})
                yield sse({'type': 'finish-step'})
                if not calls and turn.stop_reason != 'pause_turn':
                    break
                results = []
                for b in calls:
                    block = turn.blocks[next(i for i, x in turn.blocks.items() if x.get('id') == b['id'])]
                    try:
                        if block['input'] is None:
                            raise T.ToolError('tool input was not valid JSON')
                        out = self.run_tool(b['name'], b['input'])
                        results.append({'type': 'tool_result', 'tool_use_id': b['id'], 'content': json.dumps(out, default=str)})
                        yield sse({'type': 'tool-output-available', 'toolCallId': b['id'], 'output': out})
                    except Exception as exc:  # tool failures go back to the model, not to the HTTP layer
                        msg = str(exc)[:600]
                        results.append({'type': 'tool_result', 'tool_use_id': b['id'], 'is_error': True, 'content': msg})
                        yield sse({'type': 'tool-output-error', 'toolCallId': b['id'], 'errorText': msg})
                if results:
                    messages.append({'role': 'user', 'content': results})
            self.remember(chat_id, [m.get('id') for m in ui_messages] + [reply_id], messages)
        except Exception as exc:
            while events:
                yield sse(events.pop(0))
            yield sse({'type': 'error', 'errorText': f'{type(exc).__name__}: {exc}'[:600]})
        yield sse({'type': 'finish'})
        yield sse('[DONE]')


# ---- scripted offline agent (RELAY_CHAT_MODEL=demo) --------------------------------------------
DEMO_PANEL = """<div class="grid">
  <div class="kpi"><span id="clk">–</span><small>Clock</small></div>
  <div class="kpi"><span id="stg">–</span><small>Staging used</small></div>
  <div class="kpi"><span id="up">–</span><small>Uplifted</small></div>
  <div class="kpi"><span id="exc">–</span><small>Exceptions</small></div>
</div>
<div class="row">
  <button class="primary" id="play">Start</button>
  <button id="step">Step 15 min</button>
  <button id="auto">Autopilot</button>
  <button id="top">Load top-ranked cargo</button>
</div>
<p class="muted" id="msg">Connected to the live apron.</p>
<script>
  const $ = id => document.getElementById(id), msg = $('msg'); let s = null;
  async function run(b, name, args) { b.disabled = true; try { const r = await relay.call(name, args); msg.textContent = r.message || (name + ' done'); }
    catch (e) { msg.textContent = e.message; } finally { b.disabled = false; } }
  $('play').onclick = e => run(e.target, 'control_simulation', {playing: !(s && s.control.playing)});
  $('step').onclick = e => run(e.target, 'step_simulation', {ticks: 15});
  $('auto').onclick = e => run(e.target, 'control_simulation', {autopilot: !(s && s.control.autopilot)});
  $('top').onclick = async e => { const r = s && s.ranking[0]; if (!r) { msg.textContent = 'Nothing actionable'; return; }
    run(e.target, 'load_cargo', {cargo_id: r.cargo, flight_id: r.flight}); };
  relay.onState(x => { s = x; $('clk').textContent = x.clock; $('stg').textContent = x.staging.used + '/' + x.staging.capacity;
    $('up').textContent = x.kpis.uplifted; $('exc').textContent = x.counts.exceptions;
    $('play').textContent = x.control.playing ? 'Pause' : 'Start'; $('auto').textContent = 'Autopilot ' + (x.control.autopilot ? 'on' : 'off'); });
</script>"""


def _scripted(blocks: list[dict], stop='end_turn') -> list[dict]:
    evs = []
    for i, b in enumerate(blocks):
        if b['type'] == 'text':
            evs.append({'type': 'content_block_start', 'index': i, 'content_block': {'type': 'text', 'text': ''}})
            for w in b['text'].split(' '):
                evs.append({'type': 'content_block_delta', 'index': i, 'delta': {'type': 'text_delta', 'text': w + ' '}})
        else:
            evs.append({'type': 'content_block_start', 'index': i, 'content_block': {'type': 'tool_use', 'id': 'toolu_' + uuid.uuid4().hex[:16], 'name': b['name'], 'input': {}}})
            evs.append({'type': 'content_block_delta', 'index': i, 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(b['input'])}})
        evs.append({'type': 'content_block_stop', 'index': i})
    evs.append({'type': 'message_delta', 'delta': {'stop_reason': stop}})
    return evs


def demo_steps(rt: ChatRuntime, messages: list[dict]):
    """Every turn: read the state, summarise it, build the control panel and point at the apron."""
    yield _scripted([{'type': 'text', 'text': 'Reading the live apron.'}, {'type': 'tool_use', 'name': 'get_state', 'input': {}}], 'tool_use')
    s = T._summary(rt.clock, events=3); st = s['staging']
    top = ', '.join(f"#{r['rank']} {r['cargo']} → {r['flight_no']} ({r['slack']} min slack)" for r in s['priority_ranking'][:3]) or 'nothing actionable'
    text = (f"It is {s['clock']} (simulated). Staging holds {st['used']}/{st['capacity']} units "
            f"({st.get('avg_pct', '–')}% on average this run), {st['outside']} wait on the inbound line and "
            f"{st['exceptions']} sit at the exception desk. {len(s['aircraft_on_stand'])} aircraft are on stand. "
            f"Top of the ranking: {top}. Here is a control panel; this is the offline demo agent, so set "
            f"AI_GATEWAY_API_KEY for the real model.")
    yield _scripted([{'type': 'text', 'text': text},
                     {'type': 'tool_use', 'name': 'create_artifact', 'input': {'title': 'Apron control panel', 'html': DEMO_PANEL}}], 'tool_use')
    yield _scripted([{'type': 'text', 'text': '<relay-twin view="apron" />'}])
