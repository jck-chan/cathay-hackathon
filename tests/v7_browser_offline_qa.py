"""Real Chromium rendering and button testing with deterministic Python API responses.
Browser navigation to localhost is forbidden by this environment; Python ASGI
HTTP tests are separate and MUST NOT be called browser↔backend E2E tests.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,re,sys
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from v7_product import V7Lab,experiment_grid
from geometry3d import preflight
from relay.state import project
lab=V7Lab(seed=2048)
initial=lab.snapshot();track={x['awb']:lab.customer_journey(x['awb']) for x in initial['shipment_objects']}
stepped=lab.step(1,2,.2,3,1,3)
track.update({x['awb']:lab.customer_journey(x['awb']) for x in stepped['shipment_objects']})
geometry=preflight([x for x in project(lab.store,lab.store.clock())['pieces'].values() if x['shipment_id'] in lab.admitted][:6],
                  next(u for u in project(lab.store,lab.store.clock())['ulds'].values() if u['availability']=='AVAILABLE'))
study=experiment_grid(lab,100,707)
created=lab.create_order('SIN',120,'GENERAL','PRIORITY',70,55,45)
track[created['awb']]=created['tracking']
mock={'state':initial,'step':stepped,'tracks':track,'evidence':lab.evidence(),
      'order':created,'geometry':geometry,'study':study,'requests':[]}
html=(root/'static/v7.html').read_text()
html=re.sub(r'<script src="/v7(?:_scene)?\.js"></script>','',html)
html=html.replace('<link rel="stylesheet" href="/v7.css">','')
css=(root/'static/v7.css').read_text();scene=(root/'static/v6_scene.js').read_text();js=(root/'static/v7.js').read_text()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1600,'height':980},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='domcontentloaded');page.add_style_tag(content=css)
 page.evaluate("""(v) => {window.__fixture=v;window.__fixtureRequests=[];
 window.fetch=async function(path,opt={}){
  let v=window.__fixture;window.__fixtureRequests.push({path,method:opt.method||'GET'});
  let data=v.state;
  if(path==='/v7/api/step'||path==='/v7/api/fast-forward'){v.state=v.step;data=v.step;}
  else if(path==='/v7/api/customer/order'){v.state=v.order.state;data=v.order;}
  else if(path.startsWith('/v7/api/customer?')){let awb=decodeURIComponent(path.split('awb=')[1]);data=v.tracks[awb]||{detail:'Missing AWB'};}
  else if(path==='/v7/api/uld-3d'||path.startsWith('/v7/api/uld-3d?'))data=v.geometry;
  else if(path.startsWith('/v7/api/experiment?'))data=v.study;
  else if(path==='/v7/api/evidence')data=v.evidence;
  else if(path==='/v7/api/audit')data={runtime_pass:22,runtime_total:22,production_gaps:4,checks:[]};
  return {ok:true,status:200,json:async()=>data};};} """,mock)
 page.add_script_tag(content=scene);page.add_script_tag(content=js)
 page.wait_for_timeout(1100);page.screenshot(path=str(root/'tests/v7_ground_desktop.png'),full_page=True)
 assert page.locator('#orderCount').inner_text()=='4'
 page.locator('[data-preset="rush"]').click();assert page.locator('#crew').input_value()=='3'
 assert page.locator('#rate').input_value()=='4.75'
 page.locator('#stepBtn').click();page.wait_for_timeout(400)
 assert 'TICK 1' in page.locator('#simTick').inner_text()
 page.locator('[data-tab="tower"]').click();page.wait_for_timeout(200)
 page.locator('#geometryBtn').click();page.wait_for_timeout(400)
 assert 'pieces placed' in page.locator('#geometryDetails').inner_text()
 page.locator('#experimentBtn').click();page.wait_for_timeout(600)
 assert '5 scenarios completed' in page.locator('#experimentStatus').inner_text()
 page.screenshot(path=str(root/'tests/v7_tower_desktop.png'),full_page=True)
 page.locator('[data-tab="customer"]').click();page.wait_for_timeout(800)
 assert page.locator('#journeyStages span').count()==4
 page.screenshot(path=str(root/'tests/v7_customer_desktop.png'),full_page=True)
 page.locator('#newOrderForm button[type="submit"]').click();page.wait_for_timeout(700)
 assert 'Created' in page.locator('#orderResult').inner_text()
 assert page.locator('#customerAwb').inner_text().startswith('SYN-CX-D')
 page.screenshot(path=str(root/'tests/v7_customer_created_order.png'),full_page=True)
 print('Desktop screenshots captured. Actions:',page.evaluate('window.__fixtureRequests'))
 mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
 mobile_err=[];mobile.on('pageerror',lambda e:mobile_err.append(str(e)))
 mobile.set_content(html,wait_until='domcontentloaded');mobile.add_style_tag(content=css)
 mobile.evaluate("""(v)=>{window.fetch=async(path)=>{let data=v.state;if(path.startsWith('/v7/api/customer?'))data=v.tracks[decodeURIComponent(path.split('awb=')[1])];return {ok:true,status:200,json:async()=>data}};}""",mock)
 mobile.add_script_tag(content=scene);mobile.add_script_tag(content=js);mobile.wait_for_timeout(1000)
 mobile.screenshot(path=str(root/'tests/v7_ground_mobile.png'),full_page=True)
 print('MOBILE overflow',mobile.evaluate('document.documentElement.scrollWidth>window.innerWidth'))
 print('JS page errors desktop:',errors,'mobile:',mobile_err)
 assert not errors and not mobile_err,(errors,mobile_err)
 assert not mobile.evaluate('document.documentElement.scrollWidth>window.innerWidth')
 browser.close()
lab._tmp.cleanup()
