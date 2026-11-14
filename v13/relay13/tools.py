"""Simulation tools shared by the MCP endpoint (external agents) and the in-app chat agent.

Every tool is a JSON-schema-described function over the live `Clock`. Arguments are
validated here, so an MCP client and the chat model get the same checks and errors.
"""
from __future__ import annotations

from typing import Any, Callable

from .engine import SCENARIOS, STATE_NAMES

STATE_FILTER = {'line': (2,), 'staging': (3,), 'loading': (4,), 'ready': (5,), 'exception': (7,), 'actionable': (2, 3),
                'all': (2, 3, 4, 5, 7)}


class ToolError(ValueError):
    """Bad arguments or a refused action; reported to the caller as a tool error."""


def _check(schema: dict, args: Any) -> dict:
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ToolError('arguments must be an object')
    props = schema.get('properties', {})
    extra = set(args) - set(props)
    if extra:
        raise ToolError(f'unknown argument(s): {", ".join(sorted(extra))}')
    for name in schema.get('required', []):
        if name not in args:
            raise ToolError(f'missing required argument: {name}')
    for name, value in args.items():
        spec = props[name]; kind = spec.get('type')
        ok = {'string': isinstance(value, str), 'boolean': isinstance(value, bool),
              'integer': isinstance(value, int) and not isinstance(value, bool),
              'number': isinstance(value, (int, float)) and not isinstance(value, bool)}.get(kind, True)
        if not ok:
            raise ToolError(f'{name} must be a {kind}')
        if 'enum' in spec and value not in spec['enum']:
            raise ToolError(f'{name} must be one of {spec["enum"]}')
        if 'minimum' in spec and value < spec['minimum'] or 'maximum' in spec and value > spec['maximum']:
            raise ToolError(f'{name} must be between {spec.get("minimum")} and {spec.get("maximum")}')
        if kind == 'string' and len(value) > spec.get('maxLength', 200):
            raise ToolError(f'{name} is too long')
    return args


def _obj(props: dict, required=()) -> dict:
    return {'type': 'object', 'properties': props, 'required': list(required), 'additionalProperties': False}


# ---- views -----------------------------------------------------------------------------
def _flight_row(f: dict) -> dict:
    return {k: f[k] for k in ('id', 'number', 'type', 'type_name', 'route', 'city', 'status', 'cutoff', 'departure',
                              'delay', 'slots', 'used', 'kg_left', 'max_piece_kg', 'categories')} | {'stand': f['stand'] + 1}


def _summary(clock, events=15) -> dict:
    s = clock.state(0)
    parked = [f for f in s['flights'] if f['on_stand'] <= s['t'] < f['departure']]
    return {
        'clock': f"Day {s['day']} {s['clock']}", 't': s['t'], 'done': s['done'], 'scenario': s['scenario'], 'seed': s['seed'],
        'control': {k: s['control'][k] for k in ('playing', 'tps', 'autopilot', 'measured_tps')} | {'cargo_rate': s['demand']},
        'staging': {k: v for k, v in s['staging'].items() if k != 'history'},
        'counts': s['counts'], 'kpis': s['kpis'],
        'aircraft_on_stand': [_flight_row(f) for f in parked],
        'priority_ranking': [{k: r[k] for k in ('rank', 'cargo', 'intensity', 'slack', 'flight', 'flight_no', 'stand', 'tier',
                                                  'category', 'kg', 'flags')} for r in s['ranking'][:10]],
        'ranking_updated': s['rank_t'], 'recent_events': [{k: e[k] for k in ('clock', 'kind', 'title', 'detail', 'actor')}
                                                          for e in s['events'][-events:]],
        'units': 'times are simulated minutes since day 1 00:00; one tick = 1 simulated minute',
    }


# ---- handlers ----------------------------------------------------------------------------
def get_state(clock, a):
    out = _summary(clock)
    if a.get('detail') == 'full':
        out['cargo'] = clock.state(0)['cargo'][:200]
    return out


def list_cargo(clock, a):
    states = STATE_FILTER[a.get('state', 'actionable')]
    rows = [c for c in clock.state(0)['cargo'] if c['state'] in states and (not a.get('flight_id') or c['target'] == a['flight_id'])]
    rows.sort(key=lambda c: (c['rank'] is None, c['rank'] or 0, c['slack']))
    limit = a.get('limit', 40)
    return {'total': len(rows), 'cargo': [{**c, 'state_name': STATE_NAMES[c['state']]} for c in rows[:limit]]}


def check_cargo(clock, a):
    with clock.lock:
        sim = clock.sim; i = sim.index.get(a['cargo_id'], -1)
        if i < 0:
            raise ToolError(f"unknown cargo {a['cargo_id']}")
        out = []
        for f in sim.snapshot()['flights']:
            ok, code, msg = sim.check(i, sim.findex[f['id']])
            out.append({'flight_id': f['id'], 'number': f['number'], 'stand': f['stand'] + 1, 'ok': ok, 'code': code, 'message': msg})
    return {'cargo_id': a['cargo_id'], 'booked_on': sim.flights[sim.target[i]].id, 'options': out}


def load_cargo(clock, a):
    with clock.lock:
        r = clock.sim.request(a['cargo_id'], a['flight_id'], actor='agent')
    return r


def offload_cargo(clock, a):
    with clock.lock:
        return clock.sim.revoke(a['cargo_id'], actor='agent')


def control_simulation(clock, a):
    if not a:
        raise ToolError('pass at least one of playing, tps, autopilot, cargo_rate')
    with clock.lock:
        if 'playing' in a: clock.playing = a['playing'] and not clock.sim.done
        if 'tps' in a: clock.tps = float(a['tps'])
        if 'autopilot' in a: clock.autopilot = a['autopilot']
        if 'cargo_rate' in a:
            clock.sim.set_demand(a['cargo_rate']); clock.params['load'] = clock.sim.demand
    return _summary(clock, events=5)


def step_simulation(clock, a):
    before = clock.sim.t
    clock.tick(a['ticks'])
    out = _summary(clock, events=12); out['advanced_minutes'] = clock.sim.t - before
    return out


def new_world(clock, a):
    clock.reset(seed=a.get('seed'), scenario=a.get('scenario'), load=a.get('cargo_rate'))
    return _summary(clock, events=5)


def run_evidence(clock, a):
    from .evidence import run
    p = clock.params
    res = run(seeds=a.get('seeds', 6), days=a.get('days', 1), scenario=a.get('scenario', p['scenario']),
              demand=a.get('cargo_rate', p['load']), stands=p['stands'])
    return {k: res[k] for k in ('params', 'roles', 'aggregate', 'paired', 'notes')}


Tool = dict  # name, description, schema, handler, read_only

TOOLS: list[Tool] = [
    dict(name='get_state', read_only=True, handler=get_state,
         description='Read the live apron: clock, playback, staging capacity (now and run average), aircraft on stand '
                     '(type, route, cutoff, ULD/kg left, accepted categories), the priority ranking (refreshed every 5 '
                     'simulated minutes) and recent events. detail="full" also returns every live shipment.',
         schema=_obj({'detail': {'type': 'string', 'enum': ['summary', 'full']}})),
    dict(name='list_cargo', read_only=True, handler=list_cargo,
         description='List live shipments by state (actionable = inbound line + accumulation area; also line, staging, '
                     'loading, ready, exception, all), optionally for one flight, ordered by priority rank.',
         schema=_obj({'state': {'type': 'string', 'enum': list(STATE_FILTER)}, 'flight_id': {'type': 'string', 'maxLength': 40},
                      'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200}})),
    dict(name='check_cargo', read_only=True, handler=check_cargo,
         description='Run the Model I guard for one shipment against every aircraft in view, without acting. Returns, per '
                     'flight, ok plus a reason code and plain-language message (type policy, route, booking, documents, '
                     'holds, capacity, crew, cutoff, cold-chain).',
         schema=_obj({'cargo_id': {'type': 'string', 'maxLength': 40}}, ['cargo_id'])),
    dict(name='load_cargo', read_only=False, handler=load_cargo,
         description='Assign a shipment to an aircraft (same as dragging it onto the plane). The guard accepts or refuses; '
                     'a refusal changes nothing and returns the reason. Call check_cargo first to pick a valid flight.',
         schema=_obj({'cargo_id': {'type': 'string', 'maxLength': 40}, 'flight_id': {'type': 'string', 'maxLength': 40}},
                     ['cargo_id', 'flight_id'])),
    dict(name='offload_cargo', read_only=False, handler=offload_cargo,
         description='Take a loading or ready shipment back to the accumulation area before its aircraft leaves. Records rework.',
         schema=_obj({'cargo_id': {'type': 'string', 'maxLength': 40}}, ['cargo_id'])),
    dict(name='control_simulation', read_only=False, handler=control_simulation,
         description='Start/pause the shared clock and set the target ticks per second (1 tick = 1 simulated minute), autopilot '
                     '(RELAY dispatches automatically) and cargo rate (share of the booking pool offered from now on).',
         schema=_obj({'playing': {'type': 'boolean'}, 'tps': {'type': 'number', 'minimum': 0.1, 'maximum': 60}, 'autopilot': {'type': 'boolean'},
                      'cargo_rate': {'type': 'number', 'minimum': 0.2, 'maximum': 3}})),
    dict(name='step_simulation', read_only=False, handler=step_simulation,
         description='Advance the simulation by n ticks (1 tick = 1 simulated minute). Works while paused.',
         schema=_obj({'ticks': {'type': 'integer', 'minimum': 1, 'maximum': 1440}}, ['ticks'])),
    dict(name='new_world', read_only=False, handler=new_world,
         description='Generate a new synthetic world (resets the live apron for every viewer). Optional seed, scenario and cargo rate.',
         schema=_obj({'seed': {'type': 'integer', 'minimum': 1, 'maximum': 10000000},
                      'scenario': {'type': 'string', 'enum': ['mixed', *SCENARIOS]},
                      'cargo_rate': {'type': 'number', 'minimum': 0.2, 'maximum': 3}})),
    dict(name='run_evidence', read_only=True, handler=run_evidence,
         description='Run the paired evidence study shown in the Evidence tab: the same synthetic worlds replayed by four '
                     'operator roles (new/senior x manual/RELAY). Returns per-role means with 95% CIs and paired RELAY '
                     'effects. Takes a few seconds.',
         schema=_obj({'seeds': {'type': 'integer', 'minimum': 2, 'maximum': 16}, 'days': {'type': 'integer', 'minimum': 1, 'maximum': 2},
                      'scenario': {'type': 'string', 'enum': ['mixed', *SCENARIOS]},
                      'cargo_rate': {'type': 'number', 'minimum': 0.2, 'maximum': 3}})),
]
BY_NAME = {t['name']: t for t in TOOLS}


def call(clock, name: str, args: Any) -> dict:
    tool = BY_NAME.get(name)
    if tool is None:
        raise ToolError(f'unknown tool {name}')
    return tool['handler'](clock, _check(tool['schema'], args))


INSTRUCTIONS = """RELAY v13 live apron — agent operating guide.

This is a local SYNTHETIC air-cargo simulation of a Hong Kong apron, not a Cathay system: nothing here
books a flight, moves real cargo or certifies a load. Describe every result as simulated.

Model: five stands; aircraft (A330-300, A350-900/-1000, 777-300ER, 747-8F, 747-400ERF, A321neo) land,
park, close cargo at cutoff (departure - 40 min) and depart. Shipments arrive on the inbound line, wait
in the accumulation area (hard capacity), are loaded onto their booked flight, and fly. Missed cargo goes
to the exception desk and is rebooked on a later authorised CX flight to the same destination.
One tick = 1 simulated minute. The priority ranking refreshes every 5 simulated minutes.

Workflow: get_state -> list_cargo (actionable) -> check_cargo -> load_cargo with a flight whose check is ok.
A refused load changes nothing; read its message instead of retrying blindly. Type policy matters: e.g. the
A321neo takes no DG or active pharma and no piece over 200 kg. Pause (control_simulation playing=false)
before multi-step planning; use step_simulation to advance deliberately. new_world resets the apron for
every viewer, so only call it when asked. run_evidence compares four operator roles on identical worlds."""
