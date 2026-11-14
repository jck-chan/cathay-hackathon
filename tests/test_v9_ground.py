"""V9 targeted regression: visual controls do not modify V5 math; weather scenarios
are explicit effective-capacity inputs applied equally to both staging policies."""
import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from v11.conductor import Conductor

def test_weather_capacity_is_explicit_and_symmetric():
    c=Conductor(seed=2048)
    try:
        assert c.snapshot()['v8']['config']['weather']=='CLEAR'
        c.configure({'weather':'STORM','handlers':6,'stands':6,'rate':2})
        c.step(1)
        s=c.snapshot()
        assert s['resources']['handlers']==5
        assert s['resources']['stands']==4
        assert set(s['policies'])=={'fcfs','relay'}
        assert s['view_clock_contract']['ground_tick']==s['view_clock_contract']['customer_tick']==s['view_clock_contract']['tower_tick']
        assert s['v8']['config']['stands']==6
        assert s['v8']['config']['handlers']==6
        c.configure({'weather':'CLEAR'});c.step(1)
        assert c.snapshot()['resources']['stands']==6
    finally:c.lab._tmp.cleanup()

def test_weather_input_validation():
    c=Conductor(seed=2048)
    try:
        with pytest.raises(ValueError):c.configure({'weather':'RAINBOW'})
        assert c.snapshot()['v8']['config']['weather']=='CLEAR'
    finally:c.lab._tmp.cleanup()

def test_shared_ground_assets_support_webgl_and_2d():
    root=Path(__file__).resolve().parents[1]
    for name in ['scene/ground.js','v9.js','v9.css']:
        assert (root/'static'/name).stat().st_size>1000
    s=(root/'static/scene/ground.js').read_text()
    assert 'webgl2' in s and 'getContext' in s and 'renderFallback2D' in s
    js=(root/'static/v9.js').read_text()
    assert 'v9Render' in js and 'v9View' in js
    assert "'/v11/api/control'" in js
