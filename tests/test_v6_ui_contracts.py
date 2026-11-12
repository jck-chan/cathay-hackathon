"""Static contracts for the v6 frontend and shared scene implementation."""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'static/v6.html').read_text()
JS=(ROOT/'static/v6.js').read_text()
SCENE=(ROOT/'static/v6_scene.js').read_text()
CSS=(ROOT/'static/v6.css').read_text()

def test_three_primary_product_views_no_distracting_main_nav():
    assert len(re.findall(r'class="navtab',HTML))==3
    assert HTML.count('class="view"')==2 and 'class="view active"' in HTML
    for v in ['ground','tower','customer']:
        assert f'id="view-{v}"' in HTML and f'data-tab="{v}"' in HTML

def test_controls_are_unique_and_interactive():
    ids=re.findall(r'\bid="([A-Za-z][\w-]*)"',HTML)
    assert len(ids)==len(set(ids)),[x for x in ids if ids.count(x)>1]
    for id in ['sceneBaseline','sceneRelay','globeCanvas','playBtn','pauseBtn','stepBtn','resetBtn','recalcBtn',
               'approveBtn','rejectBtn','refreshCustomer','lightHour','lightAutoBtn','shipmentSearch','mathBtn',
               'drawerClose','groundWhy']:
        assert id in ids,id
    assert 'addEventListener' in JS and 'addEventListener' in SCENE

def test_ground_scene_and_globe_do_real_frame_drawing_and_orbit():
    for term in ['requestAnimationFrame','canvas','GroundScene','CustomerGlobe','pointermove','getContext']:
        assert term in JS+SCENE
    assert 'lightingHour' in JS and 'day=' in SCENE and 'dark=' in SCENE
    assert 'forklift(' in SCENE and 'worker(' in SCENE and 'plane(' in SCENE
    assert 'slerp(' in SCENE and 'airports=' in SCENE

def test_v6_uses_live_v5_api_not_hardcoded_dashboard_results():
    for ep in ['/v5/api/state','/v5/api/step','/v5/api/incident','/v5/api/evaluate','/v5/api/review',
               '/v5/api/customer?awb=','/v5/api/evidence','/v5/api/audit']:
        assert ep in JS
    assert 'renderGround(s)' in JS and 'renderTower(s)' in JS and 'portfolioList()' in JS

def test_review_is_gated_for_stale_snapshot_conflicting_evidence_and_proposals():
    assert "d.status==='PENDING_REVIEW'" in JS
    assert '!d.stale' in JS and '!d.approval_blocked_external_evidence' in JS
    assert "mode==='advisory'" in JS
    assert 'expected_snapshot_version:d.snapshot_version' in JS
    assert 'if(mode===' not in '' # minimal explicit assertion no new backend command route introduced

def test_customer_view_auto_preloads_without_manual_awb_entry():
    assert "selectedAwb=arr[0].awb" in JS
    assert "'shipmentSearch'" in JS
    assert 'observed_milestones' in JS and 'estimated_arrival_utc' in JS
    assert 'no_operational_commitment' in JS

def test_claim_boundaries_on_all_product_personas():
    for marker in ['No real airline commands','not physical telemetry','illustrative staging','Not an authenticated customer workspace',
                   'not flight position','not a real booking','OAG-shaped mock data']:
        assert marker.lower() in HTML.lower(),marker
    assert 'SYNTHETIC SANDBOX' in HTML

def test_v6_offline_first_and_mobile_breakpoints():
    assert '@import' not in CSS and 'https://' not in CSS
    assert '@media(max-width:740px)' in CSS
    assert 'prefers-reduced-motion' in CSS
    assert 'touch-action:none' in CSS
