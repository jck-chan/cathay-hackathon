"""Browser QA with the real frontend files + deterministic API fixtures.
The build environment blocks browser access to localhost, so server-side HTTP
is tested independently with httpx. This does NOT test live in-browser HTTP."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[1]
html=(root/'static/v6.html').read_text()
html=re.sub(r'<script src="/v6(?:_scene)?\.js"></script>','',html)
html=html.replace('<link rel="stylesheet" href="/v6.css">','')
style=(root/'static/v6.css').read_text();scene=(root/'static/v6_scene.js').read_text();app=(root/'static/v6.js').read_text()
import sys
sys.path.insert(0,str(root))
from v5_lab import AuditedLab
lab=AuditedLab(seed=2048)
state=lab.snapshot()
tracked={x['awb']:lab.track(x['awb']) for x in state['shipment_objects'][:16]}
step=lab.step(1,2,.2,3,1,3)
tracked.update({x['awb']:lab.track(x['awb']) for x in step['shipment_objects'][:16]})
mock={'state':state,'step':step,'tracks':tracked,'evidence':lab.evidence()}
lab._tmp.cleanup()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1620,'height':1040},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='domcontentloaded')
 page.add_style_tag(content=style)
 page.evaluate("""(v) => {window.__fixture=v;window.__fixtureRequests=[];window.fetch=async function(path,opt={}){window.__fixtureRequests.push({path,method:opt.method||'GET'});let v=window.__fixture;let data=v.state;if(path==='/v5/api/step'){v.state=v.step;data=v.step;}else if(path.startsWith('/v5/api/customer?')){let awb=decodeURIComponent(path.split('awb=')[1]);data=v.tracks[awb]||{detail:'Missing'};}else if(path==='/v5/api/evidence')data=v.evidence;else if(path==='/v5/api/audit')data={runtime_pass:19,runtime_total:19,production_gaps:4,checks:[]};return {ok:true,status:200,json:async()=>data};};}""",mock)
 page.add_script_tag(content=scene)
 page.add_script_tag(content=app)
 page.wait_for_timeout(1000)
 page.screenshot(path=str(root/'tests/v6_ground_desktop.png'),full_page=True)
 print('First screen headline:',page.locator('#view-ground h1').inner_text())
 print('Ground 3D canvas pixel size',page.locator('#sceneBaseline').evaluate('(e)=>[e.width,e.height]'))
 print('initial server data',page.locator('#orderCount').inner_text())
 page.locator('#stepBtn').click();page.wait_for_timeout(400)
 print('after step tick',page.locator('#simTick').inner_text())
 page.locator('[data-tab=tower]').click();page.wait_for_timeout(400)
 page.screenshot(path=str(root/'tests/v6_control_tower.png'),full_page=True)
 print('tower action:',page.locator('#towerAction').inner_text())
 page.locator('#mathBtn').click();page.wait_for_timeout(400)
 print('evidence drawer populated',len(page.locator('#drawerBody').inner_text()))
 page.locator('#drawerClose').click()
 page.locator('[data-tab=customer]').click();page.wait_for_timeout(950)
 page.screenshot(path=str(root/'tests/v6_customer_globe.png'),full_page=True)
 print('customer title:',page.locator('#routeTitle').inner_text(), 'awb:',page.locator('#customerAwb').inner_text())
 page.locator('[data-tab=ground]').click();page.locator('#lightHour').fill('22');page.wait_for_timeout(200)
 page.screenshot(path=str(root/'tests/v6_ground_night.png'),full_page=True)
 mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
 mobileErrors=[];mobile.on('pageerror',lambda e:mobileErrors.append(str(e)))
 mobile.set_content(html,wait_until='domcontentloaded');mobile.add_style_tag(content=style)
 mobile.evaluate("""(v) => {window.__fixture=v;window.fetch=async function(path){let v=window.__fixture;let data=path.startsWith('/v5/api/customer?')?v.tracks[decodeURIComponent(path.split('awb=')[1])]:v.state;return {ok:true,status:200,json:async()=>data}};}""",mock)
 mobile.add_script_tag(content=scene);mobile.add_script_tag(content=app);mobile.wait_for_timeout(650)
 mobile.screenshot(path=str(root/'tests/v6_ground_mobile.png'),full_page=True)
 print('mobile horizontal overflow:',mobile.evaluate('document.documentElement.scrollWidth>window.innerWidth'))
 print('errors',errors,'mobile errors',mobileErrors)
 assert not errors and not mobileErrors,(errors,mobileErrors)
 assert page.locator('#view-ground').count()==1
 assert not mobile.evaluate('document.documentElement.scrollWidth>window.innerWidth')
 assert len(page.evaluate('window.__fixtureRequests'))>3
 browser.close()
