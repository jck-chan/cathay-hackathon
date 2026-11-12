"""Check the chat harness end to end with the scripted model: MCP tool discovery,
the AI SDK UI message stream, artifacts, and the artifact tool bridge."""
import asyncio
import json

import httpx

from fusion_app import app
from v11 import api
from v11.chat import to_langchain
from v11.conductor import Conductor


def test_chat_streams_ui_messages_and_runs_mcp_tools(monkeypatch):
    conductor = Conductor(seed=2048)
    monkeypatch.setattr(api, 'conductor', conductor)
    monkeypatch.setenv('RELAY_CHAT_MODEL', 'demo')

    async def exercise():
        async with app.router.lifespan_context(app) as state:
            async def asgi_with_lifespan(scope, receive, send):
                scope['state'] = dict(state)
                await app(scope, receive, send)

            transport = httpx.ASGITransport(app=asgi_with_lifespan)
            async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8765') as client:
                config = (await client.get('/v11/api/chat/config')).json()
                assert config['configured'] and {'control_get_state', 'create_artifact'} <= set(config['tools'])

                user = {'id': 'u1', 'role': 'user', 'parts': [{'type': 'text', 'text': 'Build a panel'}]}
                response = await client.post('/v11/api/chat', json={'id': 'c1', 'messages': [user]})
                assert response.headers['x-vercel-ai-ui-message-stream'] == 'v1'
                frames = response.text.strip().split('\n\n')
                assert frames[-1] == 'data: [DONE]'
                events = [json.loads(frame[6:]) for frame in frames[:-1]]
                kinds = [event['type'] for event in events]
                assert kinds[0] == 'start' and kinds[-1] == 'finish' and 'error' not in kinds
                for kind in ('reasoning-delta', 'text-delta', 'tool-input-delta', 'tool-output-available'):
                    assert kind in kinds

                inputs = {e['toolName']: e for e in events if e['type'] == 'tool-input-available'}
                outputs = {e['toolCallId']: e['output'] for e in events if e['type'] == 'tool-output-available'}
                assert outputs[inputs['control_get_state']['toolCallId']]['tick'] == conductor.snapshot()['tick']
                assert '<script>' in inputs['create_artifact']['input']['html']
                text = ''.join(e['delta'] for e in events if e['type'] == 'text-delta')
                assert '<relay-twin view="ground" />' in text

                stepped = await client.post('/v11/api/chat/tool', json={'name': 'ground_step_simulation', 'arguments': {'count': 2}})
                assert stepped.json()['result']['tick'] == 2 == conductor.snapshot()['tick']
                assert (await client.post('/v11/api/chat/tool', json={'name': 'create_artifact'})).status_code == 404
                assert (await client.post('/v11/api/chat/tool', json={'name': 'ground_step_simulation', 'arguments': {'count': 0}})).status_code == 422
                denied = await client.post('/v11/api/chat/tool', json={'name': 'control_get_state'}, headers={'Origin': 'null'})
                assert denied.status_code == 403

    try:
        asyncio.run(exercise())
    finally:
        conductor.pause()
        conductor.lab._tmp.cleanup()


def test_ui_history_replays_tool_calls_without_reasoning():
    history = to_langchain([
        {'role': 'user', 'parts': [{'type': 'text', 'text': 'hi'}]},
        {'role': 'assistant', 'parts': [
            {'type': 'step-start'}, {'type': 'reasoning', 'text': 'hidden'}, {'type': 'text', 'text': 'Reading.'},
            {'type': 'tool-get_state', 'toolCallId': 't1', 'state': 'output-available', 'input': {}, 'output': {'tick': 3}},
            {'type': 'tool-place_order', 'toolCallId': 't2', 'state': 'input-available', 'input': {}},
            {'type': 'step-start'}, {'type': 'text', 'text': 'Done.'}]},
    ])
    assert [m.type for m in history] == ['human', 'ai', 'tool', 'ai']
    assert [c['id'] for c in history[1].tool_calls] == ['t1']
    assert json.loads(history[2].content) == {'tick': 3}
    assert 'hidden' not in json.dumps([m.content for m in history])
