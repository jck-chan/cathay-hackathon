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
                denied = await client.post('/v11/mcp', headers={'Origin': 'https://example.com'})
                assert denied.status_code == 403
                async with streamable_http_client(f'{base_url}/v11/mcp', http_client=client) as (reader, writer, _):
                    async with ClientSession(reader, writer) as session:
                        initialized = await session.initialize()
                        assert initialized.serverInfo.name == 'RELAY Three Twins'
                        tools = {tool.name for tool in (await session.list_tools()).tools}
                        assert tools == {
                            'get_state', 'track_shipment', 'place_order', 'inject_incident',
                            'review_decision', 'mark_task_done', 'start_simulation',
                            'pause_simulation', 'step_simulation', 'set_playback_speed',
                            'configure_environment', 'set_review_mode', 'recalculate_decision',
                        }

                        async def call(name, **arguments):
                            result = await session.call_tool(name, arguments)
                            assert not result.isError, result.content
                            return result.structuredContent

                        initial = await call('get_state')
                        await call('mark_task_done', task_id=initial['tasks'][0]['id'])
                        await call('set_review_mode', mode='MANUAL_REVIEW')
                        await call('recalculate_decision')
                        decision = (await call('get_state'))['decision']
                        reviewed = await call('review_decision', review={
                            'decision_id': decision['id'],
                            'expected_snapshot_version': decision['snapshot_version'],
                            'choice': 'reject',
                        })
                        assert reviewed['status'] == 'REJECTED'

                        order = await call('place_order', order={'destination': 'NRT'})
                        tracking = await call('track_shipment', awb=order['awb'])
                        assert tracking['awb'] == order['awb']
                        response = await client.get('/v11/api/state', params={'awb': order['awb']})
                        assert response.json()['customer_projection']['awb'] == order['awb']
                        event = await call('inject_incident', incident={'kind': 'flight_cancelled'})
                        assert event['event_type'] == 'flight_cancelled'

                        configured = await call('configure_environment', settings={'cold_bays': 2})
                        assert configured['config']['cold_bays'] == 2
                        assert (await call('set_playback_speed', speed=4))['speed_target'] == 4
                        assert (await call('start_simulation'))['running']
                        paused = await call('pause_simulation')
                        assert not paused['running']
                        stepped = await call('step_simulation', count=2)
                        assert stepped['tick'] == paused['tick'] + 2
                        response = await client.get('/v11/api/state')
                        assert response.json()['tick'] == stepped['tick']

    try:
        asyncio.run(exercise())
    finally:
        conductor.pause()
        conductor.lab._tmp.cleanup()
