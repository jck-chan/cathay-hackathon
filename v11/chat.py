"""AI chat harness for the three-twin simulation.

A LangChain agent drives the same MCP tools that external harnesses use, plus a
local ``create_artifact`` tool. Responses stream to the browser in the Vercel
AI SDK UI message stream protocol (SSE), so any AI SDK ``useChat`` client can
consume ``POST /v11/api/chat`` as well as the bundled chat tab.
"""
from __future__ import annotations

import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langchain_mcp_adapters.tools import load_mcp_tools
from mcp.shared.memory import create_connected_server_and_client_session
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
GATEWAY_URL = 'https://ai-gateway.vercel.sh'   # Vercel AI Gateway, Anthropic Messages format
GATEWAY_MODEL = 'google/gemini-4-hydrogen'
DIRECT_MODEL = 'claude-opus-5-5'
DEMO_MODEL = 'demo'
MAX_ARTIFACT_BYTES = 200_000
MAX_THREADS = 64
# History is only cut once it passes HISTORY_LIMIT characters (~4 per token), and
# then in whole HISTORY_BLOCK steps, so the cut point stays put for many turns.
HISTORY_LIMIT = 600_000
HISTORY_BLOCK = 300_000

SYSTEM_PROMPT = """You are the operations copilot inside RELAY, a local synthetic air-cargo simulation at Hong Kong (HKG). All sandboxes share one playback clock. Each sandbox has its own data store for three views: the Ground Twin (3D apron and staging), Control Tower (decisions and handoffs) and Customer Twin (shipments on a route globe). The person you are talking to is operating that simulation and sees your reply in a chat tab next to the twins.

Everything here is synthetic. Nothing you do books a flight, moves real cargo or notifies a real customer, so act on requests directly instead of asking for confirmation, and describe results as simulated.

Read the relevant sandbox state before acting. Use ground_list_sandboxes to resolve names to IDs. For a request about one sandbox, pass scope="sandboxes" and its ID in sandbox_ids on reads, orders, incidents, configuration and reviews. Resolve decision and task IDs within the sandbox that owns them. Batch responses put snapshots in results[].result, keyed by results[].sandbox_id. Check complete and failed before reporting success.

Start, pause, step and speed affect every sandbox. On playback tools, scope filters the returned snapshots. Pause before stepping. One tick is 10 simulated minutes. Animation uses the selected multiplier. Use actual_ticks_per_second when reporting how fast ticks progressed. Costs are unitless modelled penalties.

# Showing a twin
Write a twin tag on its own line when a live view helps:
<relay-twin view="ground" />                                 first two sandboxes
<relay-twin view="ground" sandbox_id="..." />                 one ground pane
<relay-twin view="tower" sandbox_id="..." />                  decisions and handoffs
<relay-twin view="customer" sandbox_id="..." awb="..." />     shipment tracking
Use the actual sandbox ID and AWB from the tool result. The AWB is optional. A tag for a specific order or decision should carry its sandbox ID so the embed and Open tab show the same records.

# Artifacts
create_artifact renders a small interactive panel in the chat. Use it when the person would benefit from something to click or watch: a control panel, a live monitor, an order form, a what-if switchboard. Answer plain questions in text.

An artifact is one HTML fragment (markup, <style>, <script>) shown in a sandboxed frame with no network access. It reaches the simulation only through the injected `relay` object:
- await relay.call(name, args) runs one of your simulation tools by name, with exactly the arguments object you would pass when calling it yourself, and resolves to the tool response. A batch can resolve with complete=false and per-sandbox errors in failed. It rejects on a tool or transport error.
- relay.onState(fn) calls fn(state) with the default sandbox snapshot now and about once a second afterwards. Check state.sandbox_id before displaying sandbox-local data. Use a scoped control_get_state call to read a different sandbox.
- relay.send(text) posts text into the chat as the person's next message.
The frame already styles body text, headings, button, button.primary, input, select, table, .card, .row (flex row), .grid (auto-fit grid), .muted, .pill, .kpi (big number with a <small> label) and exposes --ink, --soft, --line, --teal, --warn, --bad. Build on those, keep the layout compact and plain, disable buttons while a call is pending, and show failures inline. Do not load external scripts, fonts or images.
"""


def load_env_file(path: Path = ROOT / '.env') -> None:
    """Read KEY=VALUE lines so a local .env can supply the model credentials."""
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        key, sep, value = line.strip().partition('=')
        if sep and key and not key.startswith('#'):
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))


@tool
def create_artifact(title: str, html: str) -> dict[str, Any]:
    """Render an interactive HTML panel in the chat. `html` is one fragment with
    its own <style> and <script>; it talks to the simulation through `relay`."""
    if len(html.encode()) > MAX_ARTIFACT_BYTES:
        raise ValueError(f'Artifact is larger than {MAX_ARTIFACT_BYTES} bytes; make it smaller')
    return {'rendered': True, 'title': title}


# Stream the HTML as it is written instead of in one burst at the end.
create_artifact.extras = {'eager_input_streaming': True}


def gateway_key() -> str | None:
    return os.environ.get('AI_GATEWAY_API_KEY') or os.environ.get('VERCEL_OIDC_TOKEN')


def build_model(name: str):
    if name == DEMO_MODEL:
        from .chat_demo import ScriptedChatModel
        return ScriptedChatModel()
    from langchain_anthropic import ChatAnthropic
    # With a gateway key every call goes through Vercel AI Gateway; without one,
    # ChatAnthropic falls back to ANTHROPIC_API_KEY and Anthropic's own endpoint.
    route = {'api_key': gateway_key(), 'base_url': GATEWAY_URL} if gateway_key() else {}
    if is_claude(name):
        thinking = {'thinking': {'type': 'adaptive', 'display': 'summarized'},
                    'output_config': {'effort': os.environ.get('RELAY_CHAT_EFFORT', 'medium')}}
    else:  # the gateway maps a thinking budget onto other providers' reasoning controls
        thinking = {'thinking': {'type': 'enabled', 'budget_tokens': 4096}}
    return ChatAnthropic(model=name, max_tokens=32000, **route, **thinking)


def is_claude(name: str) -> bool:
    return 'claude' in name


def message_size(message: BaseMessage) -> int:
    return len(str(message.content)) + len(str(getattr(message, 'tool_calls', '')))


def trim_history(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Keep the whole history while it is small; past the limit, drop the oldest
    turns up to a HISTORY_BLOCK boundary. The same turns are dropped on every
    request until the next boundary, which keeps the cached prefix stable."""
    total = sum(map(message_size, messages))
    if total <= HISTORY_LIMIT:
        return messages
    drop = -(-(total - HISTORY_LIMIT) // HISTORY_BLOCK) * HISTORY_BLOCK
    seen = 0
    for index, message in enumerate(messages):
        if seen >= drop and isinstance(message, HumanMessage):
            return messages[index:]
        seen += message_size(message)
    return messages[-1:]


class ChatRuntime:
    """Owns the MCP client session and the agent built on its tools."""

    def __init__(self, session, mcp_tools, mcp_instructions: str | None = None):
        load_env_file()
        # The MCP server's own guidance travels with its tools, so it stays current.
        self.system_prompt = SYSTEM_PROMPT + (f'\n# Simulation tool guide\n{mcp_instructions}' if mcp_instructions else '')
        self.session = session
        self.mcp_tool_names = {t.name for t in mcp_tools}
        self.tools = [*mcp_tools, create_artifact]
        self.provider = 'Vercel AI Gateway' if gateway_key() else 'Anthropic API'
        self.model_name = os.environ.get('RELAY_CHAT_MODEL') or (GATEWAY_MODEL if gateway_key() else DIRECT_MODEL)
        self._agent = None
        # chat id -> (UI message ids, exact LangChain messages). Replaying the exact
        # messages, reasoning included, makes each request extend the previous one
        # byte for byte, which is what provider prompt caches match on.
        self.threads: dict[str, tuple[list[str], list[BaseMessage]]] = {}

    def history(self, chat_id: str | None, ui_messages: list[dict[str, Any]]) -> list[BaseMessage]:
        ids, stored = self.threads.get(chat_id, ([], []))
        *earlier, last = ui_messages
        if stored and ids == [m.get('id') for m in earlier] and last.get('role') == 'user':
            return trim_history(stored + to_langchain([last]))
        return trim_history(to_langchain(ui_messages))   # new chat, restart, or edited history

    def remember(self, chat_id: str | None, ui_ids: list[str], messages: list[BaseMessage]) -> None:
        if chat_id:
            self.threads.pop(chat_id, None)
            self.threads[chat_id] = (ui_ids, messages)
            while len(self.threads) > MAX_THREADS:
                self.threads.pop(next(iter(self.threads)))

    @property
    def configured(self) -> bool:
        return self.model_name == DEMO_MODEL or bool(
            gateway_key() or os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_AUTH_TOKEN'))

    @property
    def agent(self):
        if self._agent is None:
            middleware = []
            if is_claude(self.model_name):  # Claude needs explicit cache breakpoints; Gemini caches prefixes itself
                from langchain_anthropic.middleware import AnthropicPromptCachingMiddleware
                middleware.append(AnthropicPromptCachingMiddleware(unsupported_model_behavior='ignore'))
            self._agent = create_agent(build_model(self.model_name), self.tools,
                                       system_prompt=self.system_prompt, middleware=middleware)
        return self._agent

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        if name not in self.mcp_tool_names:
            raise KeyError(name)
        result = await self.session.call_tool(name, arguments)
        text = '\n'.join(c.text for c in result.content if getattr(c, 'text', None))
        if result.isError:
            raise ValueError(text or 'Tool failed')
        return result.structuredContent if result.structuredContent is not None else parse_json(text)


@asynccontextmanager
async def chat_runtime(mcp) -> AsyncIterator[ChatRuntime]:
    async with create_connected_server_and_client_session(mcp) as session:
        yield ChatRuntime(session, await load_mcp_tools(session), getattr(mcp, 'instructions', None))


def parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return text


# --- AI SDK UI messages -> LangChain messages --------------------------------

def to_langchain(ui_messages: list[dict[str, Any]]) -> list[BaseMessage]:
    out: list[BaseMessage] = []
    for message in ui_messages:
        parts = message.get('parts') or []
        if message.get('role') == 'user':
            text = ''.join(p.get('text', '') for p in parts if p.get('type') == 'text')
            if text.strip():
                out.append(HumanMessage(text))
        elif message.get('role') == 'assistant':
            out.extend(assistant_steps(parts))
    return out


def assistant_steps(parts: list[dict[str, Any]]) -> list[BaseMessage]:
    """Rebuild each model step as AIMessage(text, tool_calls) + its ToolMessages.

    Reasoning is left out: thinking blocks are only replayable with their
    signatures, and earlier finished turns do not need them.
    """
    out: list[BaseMessage] = []
    text, calls, results = '', [], []

    def flush():
        nonlocal text, calls, results
        if text.strip() or calls:
            out.append(AIMessage(content=text, tool_calls=calls))
            out.extend(results)
        text, calls, results = '', [], []

    for part in parts:
        kind = part.get('type', '')
        if kind == 'step-start':
            flush()
        elif kind == 'text':
            if calls:
                flush()
            text += part.get('text', '')
        elif kind.startswith('tool-') and part.get('state') in ('output-available', 'output-error'):
            failed = part['state'] == 'output-error'
            content = part.get('errorText', 'Tool failed') if failed else json.dumps(part.get('output'), default=str)
            calls.append({'name': kind[5:], 'args': part.get('input') or {}, 'id': part['toolCallId'], 'type': 'tool_call'})
            results.append(ToolMessage(content, tool_call_id=part['toolCallId'], status='error' if failed else 'success'))
    flush()
    return out


# --- LangChain stream -> AI SDK UI message stream -----------------------------

class UIStream:
    """Translate (message chunk, metadata) pairs into UI message stream events."""

    def __init__(self):
        self.message_id = None
        self.block = None          # (kind, key) of the open reasoning / text / tool-input part
        self.tools: dict[Any, dict[str, str]] = {}

    def feed(self, chunk: BaseMessage):
        if isinstance(chunk, ToolMessage):
            yield from self.finish_step()
            if chunk.status == 'error':
                yield {'type': 'tool-output-error', 'toolCallId': chunk.tool_call_id, 'errorText': chunk.text}
            else:
                yield {'type': 'tool-output-available', 'toolCallId': chunk.tool_call_id, 'output': parse_json(chunk.text)}
        elif isinstance(chunk, AIMessageChunk) and (chunk.content or chunk.tool_call_chunks):
            if chunk.id != self.message_id:
                yield from self.finish_step()
                self.message_id = chunk.id
                yield {'type': 'start-step'}
            content = chunk.content
            blocks = [{'type': 'text', 'text': content}] if isinstance(content, str) else content
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                if block.get('type') == 'thinking' and block.get('thinking'):
                    yield from self.delta('reasoning', block.get('index', 0), block['thinking'])
                elif block.get('type') == 'text' and block.get('text'):
                    yield from self.delta('text', block.get('index', 0), block['text'])
            for call in chunk.tool_call_chunks:
                key = call.get('index') if call.get('index') is not None else call.get('id')
                if call.get('id') and call.get('name'):
                    yield from self.close_block()
                    self.tools[key] = {'id': call['id'], 'name': call['name'], 'args': ''}
                    self.block = ('tool', key)
                    yield {'type': 'tool-input-start', 'toolCallId': call['id'], 'toolName': call['name']}
                if call.get('args') and key in self.tools:
                    self.tools[key]['args'] += call['args']
                    yield {'type': 'tool-input-delta', 'toolCallId': self.tools[key]['id'], 'inputTextDelta': call['args']}

    def delta(self, kind: str, index: Any, text: str):
        if self.block != (kind, index):
            yield from self.close_block()
            self.block = (kind, index)
            self.part_id = uuid.uuid4().hex[:12]
            yield {'type': f'{kind}-start', 'id': self.part_id}
        yield {'type': f'{kind}-delta', 'id': self.part_id, 'delta': text}

    def close_block(self):
        if self.block is None:
            return
        kind, key = self.block
        self.block = None
        if kind == 'tool':
            call = self.tools.pop(key)
            args = parse_json(call['args'] or '{}')
            yield {'type': 'tool-input-available', 'toolCallId': call['id'], 'toolName': call['name'],
                   'input': args if isinstance(args, dict) else {}}
        else:
            yield {'type': f'{kind}-end', 'id': self.part_id}

    def finish_step(self):
        yield from self.close_block()
        if self.message_id is not None:
            self.message_id = None
            yield {'type': 'finish-step'}


def sse(event: dict[str, Any] | str) -> str:
    return f'data: {event if isinstance(event, str) else json.dumps(event, default=str)}\n\n'


async def ui_message_stream(runtime: ChatRuntime, chat_id: str | None, ui_messages: list[dict[str, Any]]) -> AsyncIterator[str]:
    reply_id = uuid.uuid4().hex
    yield sse({'type': 'start', 'messageId': reply_id})
    stream = UIStream()
    runtime.threads.pop(chat_id, None)   # stays forgotten unless this turn finishes cleanly
    final = None
    try:
        if not runtime.configured:
            raise RuntimeError(
                'No model credentials. Set AI_GATEWAY_API_KEY (environment or .env) and restart, '
                'or set RELAY_CHAT_MODEL=demo for the scripted offline model.')
        messages = runtime.history(chat_id, ui_messages)
        async for mode, payload in runtime.agent.astream({'messages': messages}, stream_mode=['messages', 'values']):
            if mode == 'values':
                final = payload['messages']
                continue
            for event in stream.feed(payload[0]):
                yield sse(event)
        for event in stream.finish_step():
            yield sse(event)
        if final:
            runtime.remember(chat_id, [m.get('id') for m in ui_messages] + [reply_id], final)
    except Exception as exc:  # surfaced in the chat instead of dropping the connection
        for event in stream.finish_step():
            yield sse(event)
        yield sse({'type': 'error', 'errorText': f'{type(exc).__name__}: {exc}'[:600]})
    yield sse({'type': 'finish'})
    yield sse('[DONE]')


# --- HTTP ----------------------------------------------------------------------

router = APIRouter(prefix='/v11/api/chat', tags=['AI chat'])


def runtime_of(request: Request) -> ChatRuntime:
    runtime = getattr(request.state, 'relay_chat', None)
    if runtime is None:
        raise HTTPException(503, 'Chat runtime is unavailable')
    return runtime


class ChatRequest(BaseModel):
    id: str | None = None
    messages: list[dict[str, Any]] = Field(min_length=1)


class ToolRequest(BaseModel):
    name: str = Field(max_length=80)
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.post('')
async def chat(body: ChatRequest, request: Request):
    """Run one agent turn. Body and response follow the AI SDK UI message stream protocol."""
    runtime = runtime_of(request)
    return StreamingResponse(
        ui_message_stream(runtime, body.id, body.messages),
        media_type='text/event-stream',
        headers={'x-vercel-ai-ui-message-stream': 'v1', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@router.get('/config')
def chat_config(request: Request):
    runtime = runtime_of(request)
    return {'model': runtime.model_name, 'provider': runtime.provider, 'configured': runtime.configured,
            'demo': runtime.model_name == DEMO_MODEL, 'tools': [t.name for t in runtime.tools]}


@router.post('/tool')
async def chat_tool(body: ToolRequest, request: Request):
    """Run one simulation tool for an artifact. Only the MCP tools are callable."""
    try:
        return {'result': await runtime_of(request).call_tool(body.name, body.arguments)}
    except KeyError as exc:
        raise HTTPException(404, f'Unknown tool {body.name}') from exc
    except Exception as exc:
        raise HTTPException(422, str(exc)[:600]) from exc
