"""Check the MCP wire protocol and its shared state with the dashboard API."""
import asyncio

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from fusion_app import app
from v11 import api
from v11.conductor import Conductor


def test_mcp_tools_share_dashboard_state(monkeypatch):
    conductor = Conductor(seed=2048)
    monkeypatch.setattr(api, 'conductor', conductor)

    async def exercise():
        async with app.router.lifespan_context(app) as state:
            async def asgi_with_lifespan(scope, receive, send):
                scope['state'] = dict(state)
                await app(scope, receive, send)

            base_url = 'http://127.0.0.1:8765'
            transport = httpx.ASGITransport(app=asgi_with_lifespan)
            async with httpx.AsyncClient(transport=transport, base_url=base_url) as client:
                denied = await client.post('/mcp', headers={'Origin': 'https://example.com'})
                assert denied.status_code == 403
                async with streamable_http_client(f'{base_url}/mcp', http_client=client) as (reader, writer, _):
                    async with ClientSession(reader, writer) as session:
                        initialized = await session.initialize()
                        assert initialized.serverInfo.name == 'RELAY Three Twins'
                        for prefix in ('ground_*', 'control_*', 'customer_*'):
                            assert prefix in initialized.instructions
                        tools = {tool.name for tool in (await session.list_tools()).tools}
                        assert all(name.startswith(('ground_', 'control_', 'customer_')) for name in tools)
                        assert tools == {
                            'control_get_state', 'customer_track_shipment', 'customer_place_order', 'ground_inject_incident',
                            'control_review_decision', 'control_mark_task_done', 'ground_start_simulation',
                            'ground_pause_simulation', 'ground_step_simulation', 'ground_set_playback_speed',
                            'ground_configure_environment', 'control_set_review_mode', 'control_recalculate_decision',
                        }

                        legacy = await client.post('/v11/mcp', json={
                            'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list',
                        }, headers={'Accept': 'application/json, text/event-stream'})
                        assert legacy.status_code == 200

                        async def call(name, **arguments):
                            result = await session.call_tool(name, arguments)
                            assert not result.isError, result.content
                            return result.structuredContent

                        initial = await call('control_get_state')
                        await call('control_mark_task_done', task_id=initial['tasks'][0]['id'])
                        await call('control_set_review_mode', mode='MANUAL_REVIEW')
                        await call('control_recalculate_decision')
                        decision = (await call('control_get_state'))['decision']
                        reviewed = await call('control_review_decision', review={
                            'decision_id': decision['id'],
                            'expected_snapshot_version': decision['snapshot_version'],
                            'choice': 'reject',
                        })
                        assert reviewed['status'] == 'REJECTED'

                        order = await call('customer_place_order', order={'destination': 'NRT'})
                        tracking = await call('customer_track_shipment', awb=order['awb'])
                        assert tracking['awb'] == order['awb']
                        response = await client.get('/v11/api/state', params={'awb': order['awb']})
                        assert response.json()['customer_projection']['awb'] == order['awb']
                        event = await call('ground_inject_incident', incident={'kind': 'flight_cancelled'})
                        assert event['event_type'] == 'flight_cancelled'

                        configured = await call('ground_configure_environment', settings={'cold_bays': 2})
                        assert configured['config']['cold_bays'] == 2
                        assert (await call('ground_set_playback_speed', speed=4))['speed_target'] == 4
                        assert (await call('ground_start_simulation'))['running']
                        paused = await call('ground_pause_simulation')
                        assert not paused['running']
                        stepped = await call('ground_step_simulation', count=2)
                        assert stepped['tick'] == paused['tick'] + 2
                        response = await client.get('/v11/api/state')
                        assert response.json()['tick'] == stepped['tick']

    try:
        asyncio.run(exercise())
    finally:
        conductor.pause()
        conductor.lab._tmp.cleanup()
