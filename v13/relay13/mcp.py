"""MCP server over Streamable HTTP (POST /mcp), stateless with JSON responses — the same mode v11's
FastMCP server ran in (stateless_http=True, json_response=True), implemented on the standard library.

External agents (Claude Code, Claude Desktop, MCP Inspector, …) connect to http://127.0.0.1:<port>/mcp
and drive the live simulation with the tools in relay13.tools. Origin/Host validation lives in the
HTTP server (server.py) and applies before a request reaches this module.
"""
from __future__ import annotations

import json
from typing import Any

from . import tools as T

SUPPORTED_VERSIONS = ('2025-06-18', '2025-03-26', '2024-11-05')
SERVER_INFO = {'name': 'relay-v13', 'title': 'RELAY v13 live apron', 'version': '13.0.0'}


def _error(id_, code, message):
    return {'jsonrpc': '2.0', 'id': id_, 'error': {'code': code, 'message': message}}


def _tool_list():
    return [{'name': t['name'], 'description': t['description'], 'inputSchema': t['schema'],
             'annotations': {'readOnlyHint': t['read_only'], 'destructiveHint': t['name'] == 'new_world',
                             'idempotentHint': t['read_only'], 'openWorldHint': False}} for t in T.TOOLS]


def _handle_one(clock, msg: Any) -> dict | None:
    if not isinstance(msg, dict) or msg.get('jsonrpc') != '2.0' or not isinstance(msg.get('method'), str):
        return _error(msg.get('id') if isinstance(msg, dict) else None, -32600, 'Invalid Request')
    method, id_, params = msg['method'], msg.get('id'), msg.get('params') or {}
    if 'id' not in msg:  # notification (e.g. notifications/initialized): no response
        return None
    if method == 'initialize':
        asked = params.get('protocolVersion')
        return {'jsonrpc': '2.0', 'id': id_, 'result': {
            'protocolVersion': asked if asked in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0],
            'capabilities': {'tools': {'listChanged': False}}, 'serverInfo': SERVER_INFO, 'instructions': T.INSTRUCTIONS}}
    if method == 'ping':
        return {'jsonrpc': '2.0', 'id': id_, 'result': {}}
    if method == 'tools/list':
        return {'jsonrpc': '2.0', 'id': id_, 'result': {'tools': _tool_list()}}
    if method == 'tools/call':
        name = params.get('name')
        if name not in T.BY_NAME:
            return _error(id_, -32602, f'Unknown tool: {name}')
        try:
            out = T.call(clock, name, params.get('arguments') or {})
            return {'jsonrpc': '2.0', 'id': id_, 'result': {
                'content': [{'type': 'text', 'text': json.dumps(out, default=str)}], 'structuredContent': out, 'isError': False}}
        except T.ToolError as exc:  # argument / guard problems are tool results the agent can read
            return {'jsonrpc': '2.0', 'id': id_, 'result': {'content': [{'type': 'text', 'text': str(exc)}], 'isError': True}}
        except Exception as exc:  # noqa: BLE001 - never drop the connection on a simulator fault
            return _error(id_, -32603, f'Internal error: {type(exc).__name__}: {exc}'[:400])
    if method in ('resources/list', 'prompts/list'):
        return {'jsonrpc': '2.0', 'id': id_, 'result': {method.split('/')[0]: []}}
    return _error(id_, -32601, f'Method not found: {method}')


def handle(clock, raw: bytes) -> tuple[int, Any]:
    """Return (HTTP status, JSON body or None). Batches (2025-03-26) are accepted."""
    try:
        msg = json.loads(raw or b'')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 400, _error(None, -32700, 'Parse error')
    if isinstance(msg, list):
        out = [r for r in (_handle_one(clock, m) for m in msg) if r is not None]
        return (200, out) if out else (202, None)
    r = _handle_one(clock, msg)
    return (200, r) if r is not None else (202, None)
