"""Check the MCP wire protocol and its shared state with the dashboard API."""
import asyncio

import httpx
from fastapi.testclient import TestClient
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from fusion_app import app
from v11 import api
from v11.conductor import Conductor
from v11.sandboxes import Sandbox, SandboxManager
from v12.policies import LABELS


def test_delete_sandbox_stops_playback_and_updates_default(monkeypatch):
    default = Conductor()
    registry = SandboxManager(Sandbox(api.DEFAULT_SANDBOX_ID, 'RELAY', default))
    monkeypatch.setattr(api, 'sandboxes', registry)
    with TestClient(app) as client:
        base = '/v11/api'
        created = client.post(base+'/sandboxes', json={'name': 'Shift', 'policy': 'fcfs'})
        assert created.status_code == 201
        sandbox = created.json()
        assert sandbox['policy'] == 'fcfs'
        default.start()
        assert client.delete(base+'/sandboxes/relay').status_code == 204
        assert not default.running and not default._thread.is_alive()
        assert client.get(base+'/sandboxes').json() == [sandbox]
        assert client.get(base+'/state').json()['sandbox_id'] == sandbox['id']
        assert client.delete(base+'/sandboxes/relay').status_code == 404
        assert client.delete(base+'/sandboxes/'+sandbox['id']).status_code == 204
        assert client.get(base+'/state').status_code == 404
        assert client.get(base+'/sandboxes').json() == []


def test_v11_sandboxes_run_all_v12_dispatch_models(monkeypatch):
    monkeypatch.setattr(api, 'sandboxes', SandboxManager())
    monkeypatch.setenv('RELAY_V11_DISPATCH', '0')
    expected = {
        'FCFS': 'FCFS_FEASIBLE',
        'RELAY_V10': 'OPTIMAL_OBSERVABLE_URGENCY',
        'RELAY_V11': 'V11_EXACT_SINGLE_TICK_TWO_CLASS_TRIAGE',
        'A_CRITICAL': 'CRITICAL',
        'A_EDF': 'EDF',
    }
    with TestClient(app) as client:
        base = '/v11/api'
        assert client.get(base+'/sandbox-models').json() == LABELS
        for model, name in LABELS.items():
            created = client.post(base+'/sandboxes', json={'name': name, 'policy': model})
            assert created.status_code == 201
            sandbox = created.json()
            assert sandbox['model_name'] == name
            params = {'sandbox_id': sandbox['id']}
            state = client.post(base+'/control', params=params, json={
                'action': 'tune', 'weather': 'CLEAR', 'chaos': 0,
            }).json()
            assert list(state['policies']) == [model]
            stepped = client.post(base+'/control', params=params, json={'action': 'step'})
            assert stepped.status_code == 200
            solver = stepped.json()['policies'][model]['solver']
            if model.startswith('A_'):
                assert solver['variant'] == expected[model]
            else:
                assert solver['status'] == expected[model]


def test_mcp_tools_share_dashboard_state(monkeypatch):
    conductor = Conductor(seed=2048)
    registry = SandboxManager(Sandbox(api.DEFAULT_SANDBOX_ID, 'RELAY', conductor))
    monkeypatch.setattr(api, 'sandboxes', registry)

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
                        advertised = (await session.list_tools()).tools
                        tools = {tool.name for tool in advertised}
                        descriptions = {tool.name: tool.description or '' for tool in advertised}
                        # Agents should learn the end-to-end workflow from MCP
                        # initialization and individual tool metadata alone.
                        for phrase in ('customer_place_order', 'ground_inject_incident',
                                       'control_review_decision', 'ground_step_simulation',
                                       'AUTO_SHADOW', 'MANUAL_REVIEW', 'ADVISORY',
                                       'Model I', 'Model II', 'Model III', 'v12'):
                            assert phrase in initialized.instructions
                        for name, description in descriptions.items():
                            assert len(description) >= 100, name
                            assert 'synthetic' in description.lower() or 'simulated' in description.lower(), name
                        assert 'expected_snapshot_version' in descriptions['control_review_decision']
                        assert 'depends_on_task_id' in descriptions['control_mark_task_done']
                        assert 'PAUSED' in descriptions['ground_step_simulation']
                        assert all(name.startswith(('ground_', 'control_', 'customer_')) for name in tools)
                        assert tools == {
                            'control_get_state', 'customer_track_shipment', 'customer_place_order', 'ground_inject_incident',
                            'control_review_decision', 'control_mark_task_done', 'ground_start_simulation',
                            'ground_pause_simulation', 'ground_step_simulation', 'ground_set_playback_speed',
                            'ground_configure_environment', 'control_set_review_mode', 'control_recalculate_decision',
                            'ground_list_sandboxes', 'ground_create_sandbox', 'ground_delete_sandbox',
                            'customer_place_order_all_sandboxes',
                        }
                        schemas = {tool.name: tool.inputSchema for tool in advertised}
                        for name in tools - {'ground_list_sandboxes', 'ground_create_sandbox', 'ground_delete_sandbox', 'customer_place_order_all_sandboxes'}:
                            assert 'scope' in schemas[name]['properties']
                            assert 'sandbox_ids' in schemas[name]['properties']


                        legacy = await client.post('/v11/mcp', json={
                            'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list',
                        }, headers={'Accept': 'application/json, text/event-stream'})
                        assert legacy.status_code == 200

                        async def call(tool_name, **arguments):
                            result = await session.call_tool(tool_name, arguments)
                            assert not result.isError, result.content
                            return result.structuredContent

                        initial_batch = await call('control_get_state')
                        assert initial_batch['target_count'] == 1
                        assert initial_batch['complete']
                        initial = initial_batch['results'][0]['result']
                        created = await call('ground_create_sandbox', name='Independent shift', policy='fcfs')
                        sandbox_id = created['id']
                        try:
                            listed = (await call('ground_list_sandboxes'))['result']
                            assert listed[-1] == created
                            assert (await client.get('/v11/api/sandboxes')).json() == listed

                            # Default scope targets BOTH independent sandboxes.
                            both = await call('control_get_state')
                            assert {entry['sandbox_id'] for entry in both['results']} == {'relay', sandbox_id}
                            assert both['complete'] and both['target_count'] == 2
                            assert all(entry['result']['tick'] == 0 for entry in both['results'])

                            selected = {'scope': 'sandboxes', 'sandbox_ids': [sandbox_id]}
                            stepped = await call('ground_step_simulation', count=2, **selected)
                            assert stepped['complete'] and stepped['results'][0]['result']['tick'] == 2
                            assert (await client.get(f'/v11/api/sandboxes/{sandbox_id}/ground')).json()['tick'] == 2
                            response = await client.get('/v11/api/state', params={'sandbox_id': sandbox_id})
                            assert list(response.json()['policies']) == ['fcfs']
                            assert (await call('control_get_state', **selected))['results'][0]['result']['tick'] == 2
                            assert (await client.get('/v11/api/state')).json()['tick'] == initial['tick']
                            assert (await client.get('/v11/api/state', params={'sandbox_id': 'missing'})).status_code == 404

                            # Clock, shipment, and flight stores are sandbox-local.
                            relay_before = (await call('control_get_state', scope='sandboxes', sandbox_ids=['relay']))['results'][0]['result']
                            assert relay_before['tick'] == 0
                            assert relay_before['clock'] != response.json()['clock']
                            order = await call('customer_place_order', order={'destination': 'NRT'})
                            assert order['complete'] and order['created_count'] == 2
                            assert {entry['sandbox_id'] for entry in order['created']} == {'relay', sandbox_id}
                            tracked = await call('customer_track_shipment', awb=order['awb'])
                            assert tracked['complete'] and tracked['success_count'] == 2
                            assert all(entry['result']['awb'] == order['awb'] for entry in tracked['results'])

                            only_fcfs = await call('ground_configure_environment', settings={'cold_bays': 2}, **selected)
                            assert only_fcfs['complete']
                            assert only_fcfs['results'][0]['result']['config']['cold_bays'] == 2
                            relay_state = (await call('control_get_state', scope='sandboxes', sandbox_ids=['relay']))['results'][0]['result']
                            assert relay_state['v8']['config']['cold_bays'] != 2

                            all_speed = await call('ground_set_playback_speed', speed=4)
                            assert all_speed['complete'] and all_speed['success_count'] == 2
                            assert all(entry['result']['speed_target'] == 4 for entry in all_speed['results'])
                            assert (await call('ground_start_simulation', **selected))['complete']
                            assert (await call('ground_pause_simulation', **selected))['complete']
                            assert (await call('ground_step_simulation', count=1, **selected))['complete']

                            # All-scope reads, and deletion of only one sandbox.
                            deleted = await call('ground_delete_sandbox', sandbox_id=sandbox_id)
                            assert deleted == {'deleted': True, 'sandbox_id': sandbox_id}
                            assert (await call('control_get_state'))['target_count'] == 1
                            assert (await call('ground_list_sandboxes'))['result'][0]['id'] == 'relay'
                        finally:
                            if sandbox_id in [s.id for s in api.sandboxes.list()]:
                                api.sandboxes.delete(sandbox_id)

                        # Review and work orders still operate on the remaining sandbox.
                        await call('control_set_review_mode', mode='MANUAL_REVIEW')
                        await call('control_recalculate_decision')
                        decision = (await call('control_get_state'))['results'][0]['result']['decision']
                        if decision and decision['status'] == 'PENDING_REVIEW':
                            reviewed = await call('control_review_decision', review={
                                'decision_id': decision['id'],
                                'expected_snapshot_version': decision['snapshot_version'],
                                'choice': 'reject',
                            })
                            assert reviewed['complete']
                        event = await call('ground_inject_incident', incident={'kind': 'flight_cancelled'})
                        assert event['complete'] and event['success_count'] == 1

    try:
        asyncio.run(exercise())
    finally:
        conductor.pause()
        conductor.lab._tmp.cleanup()
