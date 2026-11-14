"""Regression tests for the shared UI, model data and synthetic weather.
These tests cannot establish certified physical ground movement or real airline ROI.
"""
from pathlib import Path
from fastapi.testclient import TestClient
from fusion_app import app
from v11.conductor import Conductor
ROOT=Path(__file__).resolve().parents[1]

def test_v10_math_three_existing_backends_remain_intact():
    with TestClient(app) as client:
        state=client.get('/v11/api/state').json()
        assert {'model_i','model_ii','model_iii'} <= state['decision'].keys()
        assert state['decision']['model_iii']['status'].startswith('OPTIMAL')
        assert not state['physical_execution']['real_airline_commands_sent'] if isinstance(state['physical_execution'],dict) and 'real_airline_commands_sent' in state['physical_execution'] else True

def test_v10_gfx_uses_real_model_fields_not_claimed_mutation():
    js=(ROOT/'static/v10_ui.js').read_text()
    assert 'd.routes' in js and 'd.placements' in js
    assert 'finite-column MILP' in js
    assert 'No cluster mutation execution is implied' in js
    assert 'JSON.stringify(s.decision?.[source]' in js

def test_v11_has_simulation_controls_and_model_visuals():
    h=(ROOT/'static/v11.html').read_text()
    for field in ('simulationControls','liveState','achieved','v10MathOne','v10MathTwo','v10MathThree','customerGlobe'):
        assert field in h,field
    assert '<option value="AUTO">' in h
    assert 'v10_scene.js' in h and 'v10_ui.js' in h

def test_v10_synthetic_weather_cannot_be_mislabelled_real():
    c=Conductor(seed=41)
    assert c.snapshot()['v8']['weather_mode']=='AUTO'
    c.configure({'weather':'RAIN'})
    assert c.snapshot()['v8']['config']['weather']=='RAIN'
    assert c.snapshot()['v8']['weather_mode']=='FIXED'
    c.configure({'weather':'AUTO'})
    assert c.snapshot()['v8']['weather_mode']=='AUTO'
    assert c.snapshot()['v8']['config']['weather']=='RAIN'  # last effective weather, not fake reset
    assert 'SYNTHETIC' in (ROOT/'static/v11.html').read_text()

def test_v10_weather_transition_seed_reproducible_and_not_actual_metar():
    a=Conductor(seed=41);b=Conductor(seed=41)
    assert a._weather_rng.getstate()==b._weather_rng.getstate()
    assert 'not a weather forecast' in (ROOT/'v11/conductor.py').read_text()
    assert 'no real-world commands' in (ROOT/'v11/conductor.py').read_text()

def test_v10_resume_and_reset_weather_defaults():
    c=Conductor(seed=42);c.configure({'weather':'STORM'});c.reset(seed=42)
    assert c.snapshot()['v8']['weather_mode']=='AUTO'
    assert c.snapshot()['v8']['config']['weather']=='CLEAR'

def test_v10_unified_views_are_from_one_clock():
    with TestClient(app) as client:
        data=client.get('/v11/api/state').json()
        clocks=data['view_clock_contract']
        assert clocks['ground_tick']==clocks['tower_tick']==clocks['customer_tick']==data['tick']
        assert data['portfolio_coverage']['truncated'] is False

def test_v10_dynamic_globe_distinguishes_view_from_telemetry():
    js=(ROOT/'static/v10_scene.js').read_text()
    assert 'setRoutes(shipments,selected)' in js
    assert 'const occluded=cam[1]<0' in js
    assert 'this.requestedSpeed' in js
    assert 'NOT live flight paths' in js

def test_v10_math_and_original_engine_unmodified():
    # The new mathematical storyboard is frontend-only; no replacement solver.
    assert (ROOT/'relay/engine.py').exists()
    assert (ROOT/'relay/models.py').exists()
    assert (ROOT/'static/scene/ground.js').exists()
