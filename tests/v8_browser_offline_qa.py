"""Real Chromium UX checks with an in-process fixture; NOT browser-to-backend E2E.

Localhost browser navigation is forbidden in this sandbox; actual ASGI HTTP is
validated independently through TestClient and a real curl/Uvicorn server.
"""
import json,re,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from v11.conductor import Conductor
c=Conductor(seed=2048)
initial=c.snapshot()
step=c.step(2)
created=c.order(destination='SYD',weight_kg=128,handling='GENERAL',service='PRIORITY',length_cm=70,width_cm=55,height_cm=45)
order_state=c.snapshot(created['awb'])
html=(root/'static/v8.html').read_text()
html=re.sub(r'<script src="/v8(?:_scene)?\.js"></script>','',html)
html=html.replace('<link rel="stylesheet" href="/v8.css">','')
css=(root/'static/v8.css').read_text()
scene=(root/'static/v6_scene.js').read_text()
js=(root/'static/v8.js').read_text()
fixture={'initial':initial,'step':step,'order':created,'order_state':order_state,'calls':[]}
results={}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 for w,h,label in [(1440,900,'desktop'),(1366,768,'standard'),(390,844,'mobile')]:
  page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.set_content(html,wait_until='domcontentloaded')
  page.add_style_tag(content=css)
  page.evaluate("""v=>{window.__fixture=v;window.__calls=[];window.fetch=async(path,opt={})=>{
    window.__calls.push({path,method:opt.method||'GET'});let r=v.initial;
    if(path.startsWith('/v11/api/state')){r=v.initial;}
    else if(path==='/v11/api/order'){r=v.order;v.initial=v.order_state;}
    else if(path==='/v11/api/control'){const body=JSON.parse(opt.body||'{}');if(body.action==='step'){v.initial=v.step;r=v.step;}
      else if(body.action==='start'){v.initial={...v.initial,v8:{...v.initial.v8,running:true}};r=v.initial}
      else if(body.action==='pause'){v.initial={...v.initial,v8:{...v.initial.v8,running:false}};r=v.initial}
      else if(body.action==='speed'){v.initial={...v.initial,v8:{...v.initial.v8,speed_target:body.speed}};r=v.initial}
      else r=v.initial;
    } else if(path==='/v11/api/incident'){r=v.initial}
    else if(path==='/v11/api/audit'){r={runtime_pass:20,runtime_total:20,production_gaps:4,checks:[]}}
    else if(path==='/v11/api/evidence'){r={source:'Synthetic',scope:'Finite optimization'}}
    return {ok:true,status:200,text:async()=>JSON.stringify(r)}
   };}""",fixture)
  page.add_script_tag(content=scene);page.add_script_tag(content=js)
  page.wait_for_timeout(1050)
  assert page.locator('#ground-screen').is_visible()
  assert page.locator('#baselineWorld').is_visible() and page.locator('#relayWorld').is_visible()
  assert page.locator('#globalPlay').is_visible()
  results[label+'_viewport_height']=h
  results[label+'_document_height']=page.evaluate('document.documentElement.scrollHeight')
  results[label+'_overflow_x']=page.evaluate('document.documentElement.scrollWidth>window.innerWidth')
  page.screenshot(path=str(root/f'tests/v8_ground_{label}.png'),full_page=True)
  if label=='desktop':
   page.locator('#settingsBtn').click();assert page.locator('#settingsPop').is_visible()
   page.locator('[data-close=settingsPop]').click()
   page.locator('#stepOnce').click();page.wait_for_timeout(350)
   assert '2' in page.locator('#tickPill').inner_text()
   page.locator('[data-tab=tower]').click();page.wait_for_timeout(350)
   assert page.locator('#tower-screen').is_visible()
   page.screenshot(path=str(root/'tests/v8_tower_desktop.png'),full_page=True)
   page.locator('[data-tab=customer]').click();page.wait_for_timeout(500)
   assert page.locator('#customer-screen').is_visible()
   assert page.locator('.shipment-card').count()>0
   page.screenshot(path=str(root/'tests/v8_customer_desktop.png'),full_page=True)
   page.locator('#newOrderBtn').click();assert page.locator('#drawer').is_visible()
   page.locator('#orderForm button[type=submit]').click();page.wait_for_timeout(550)
   assert page.locator('#shipAwb').inner_text().startswith('SYN-CX-D')
   page.screenshot(path=str(root/'tests/v8_customer_order.png'),full_page=True)
   page.locator('[data-tab=ground]').click()
   page.locator('#speed').select_option('100');page.wait_for_timeout(300)
   assert page.locator('#speed').input_value()=='100'
   page.locator('#globalPlay').click();page.wait_for_timeout(300)
   assert page.locator('#liveState').inner_text()=='RUNNING'
   page.locator('#globalPlay').click();page.wait_for_timeout(300)
   assert page.locator('#liveState').inner_text()=='PAUSED'
   results['desktop_calls']=page.evaluate('window.__calls')
  results[label+'_js_errors']=errors
  assert not errors,errors
  assert results[label+'_document_height']==h,(label,results[label+'_document_height'],h)
  assert not results[label+'_overflow_x'],label
  page.close()
 browser.close()
(root/'tests/V8_BROWSER_QA.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
c.lab._tmp.cleanup()
