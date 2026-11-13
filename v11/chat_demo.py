"""Scripted stand-in for the chat model (RELAY_CHAT_MODEL=demo).

It needs no credentials and emits chunks in the same shape langchain-anthropic
streams (indexed thinking / text blocks and tool-call chunks), so the offline
path exercises the real stream translation, tools, artifacts and twin embeds.
It does not understand the question: every turn reads the state, builds one
control panel and shows the ground twin.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncIterator

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

PANEL = """<style>
  .kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
</style>
<div class="grid kpis">
  <div class="kpi"><span id="tick">–</span><small>Tick</small></div>
  <div class="kpi"><span id="orders">–</span><small>Orders</small></div>
  <div class="kpi"><span id="fcfs">–</span><small>FCFS cost</small></div>
  <div class="kpi"><span id="relayCost">–</span><small>RELAY cost</small></div>
</div>
<div class="row">
  <button class="primary" id="play">Start</button>
  <button data-call="ground_step_simulation" data-args='{"count":6}'>Step 1 hour</button>
  <button data-call="ground_inject_incident" data-args='{"incident":{"kind":"flight_cancelled"}}'>Cancel a flight</button>
  <button data-call="ground_inject_incident" data-args='{"incident":{"kind":"capacity_changed"}}'>Cut capacity</button>
  <button data-call="customer_place_order" data-args='{"order":{"destination":"NRT","handling":"COL"}}'>Cold order to NRT</button>
</div>
<p class="muted" id="status">Connected to the shared clock.</p>
<script>
  const $ = id => document.getElementById(id), status = $('status');
  let running = false;
  async function run(button, name, args) {
    button.disabled = true;
    try { await relay.call(name, args); status.textContent = name.split('_').slice(1).join(' ') + ' done'; }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }
  $('play').onclick = e => run(e.target, running ? 'ground_pause_simulation' : 'ground_start_simulation', {});
  document.querySelectorAll('[data-call]').forEach(b =>
    b.onclick = () => run(b, b.dataset.call, JSON.parse(b.dataset.args)));
  relay.onState(s => {
    running = s.v8.running;
    $('play').textContent = running ? 'Pause' : 'Start';
    $('tick').textContent = s.tick;
    $('orders').textContent = s.work_orders_total;
    $('fcfs').textContent = s.policies.fcfs?.cost_units.toFixed(1) ?? '—';
    $('relayCost').textContent = s.policies.relay?.cost_units.toFixed(1) ?? '—';
  });
</script>"""


def words(text: str) -> list[str]:
    return [w + ' ' for w in text.split(' ')]


class ScriptedChatModel(BaseChatModel):
    delay: float = 0.012

    @property
    def _llm_type(self) -> str:
        return 'relay-scripted-demo'

    def bind_tools(self, tools: Any, **kwargs: Any) -> 'ScriptedChatModel':
        return self

    def _script(self, messages: list) -> list[tuple[str, Any]]:
        last = messages[-1]
        if not isinstance(last, ToolMessage):
            return [('thinking', 'This is the scripted offline model, so the plan is fixed: read the live '
                                 'state, build a control panel, then show the ground twin.'),
                    ('text', 'Reading the live simulation state first.'),
                    ('tool', ('control_get_state', {}))]
        if last.name == 'control_get_state':
            return [('thinking', 'State received. A small panel with playback and disruption controls fits.'),
                    ('tool', ('create_artifact', {'title': 'Simulation control panel', 'html': PANEL}))]
        return [('text', 'The panel above drives the shared clock, so the three twins follow every click. '
                         'Here is the ground twin:\n\n<relay-twin view="ground" />\n\n'
                         '**Note:** this reply came from the scripted demo model. Set `AI_GATEWAY_API_KEY` '
                         'and unset `RELAY_CHAT_MODEL` to use a real model.')]

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs) -> AsyncIterator[ChatGenerationChunk]:
        message_id = f'demo-{uuid.uuid4().hex[:10]}'

        def chunk(**fields) -> ChatGenerationChunk:
            return ChatGenerationChunk(message=AIMessageChunk(id=message_id, **fields))

        for index, (kind, value) in enumerate(self._script(messages)):
            if kind == 'tool':
                name, args = value
                raw = json.dumps(args)
                yield chunk(content=[], tool_call_chunks=[
                    {'index': index, 'id': f'call_{uuid.uuid4().hex[:10]}', 'name': name, 'args': '', 'type': 'tool_call_chunk'}])
                for start in range(0, len(raw), 90):
                    await asyncio.sleep(self.delay)
                    yield chunk(content=[], tool_call_chunks=[
                        {'index': index, 'id': None, 'name': None, 'args': raw[start:start + 90], 'type': 'tool_call_chunk'}])
            else:
                for word in words(value):
                    await asyncio.sleep(self.delay)
                    yield chunk(content=[{'type': kind, kind: word, 'index': index}])

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        merged = None
        async for part in self._astream(messages, stop, run_manager, **kwargs):
            merged = part if merged is None else merged + part
        return ChatResult(generations=[ChatGeneration(message=merged.message)])

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        calls = [{'name': v[0], 'args': v[1], 'id': f'call_{uuid.uuid4().hex[:10]}', 'type': 'tool_call'}
                 for k, v in self._script(messages) if k == 'tool']
        text = ' '.join(v for k, v in self._script(messages) if k == 'text')
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text, tool_calls=calls))])
