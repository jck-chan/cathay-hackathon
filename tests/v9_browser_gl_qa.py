"""Chromium WebGL + UI fixtures; browser localhost navigation restricted, API separately tested."""
from pathlib import Path
import sys,json,re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from v11.conductor import Conductor
c=Conductor(seed=2048)
s=c.snapshot();s2=c.step(2);c.configure({'weather':'RAIN','rate':5,'handlers':6,'stands':6})
s3=c.step(2)
html=(root/'static/v9.html').read_text();html=re.sub(r'<script src="/[^"]+"></script>','',html);html=re.sub(r'<link rel="stylesheet" href="/[^"]+">','',html)
css=(root/'static/v8.css').read_text()+'\n'+(root/'static/v9.css').read_text()
scene0=(root/'static/v6_scene.js').read_text();scene1=(root/'static/v9_scene.js').read_text();script=(root/'static/v9.js').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(headless=False,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist','--enable-webgl'])
 page=b.new_page(viewport={'width':1440,'height':900},device_scale_factor=1);errs=[];messages=[]
 page.on('pageerror',lambda e:errs.append(str(e)));page.on('console',lambda m:messages.append((m.type,m.text)))
 page.set_content(html,wait_until='domcontentloaded');page.add_style_tag(content=css)
 page.evaluate("""d=>{window.fixture={s:d.initial,next:d.next,rain:d.rain};window.fetch=async(path,opt={})=>{let data=window.fixture.s;if(path.startsWith('/v11/api/state'))data=window.fixture.s;else if(path==='/v11/api/control'){let b=JSON.parse(opt.body||'{}');data=window.fixture.s= (b.action==='step'?window.fixture.next:b.action==='tune'?window.fixture.rain:{...window.fixture.s,v8:{...window.fixture.s.v8,running:b.action==='start'?true:b.action==='pause'?false:window.fixture.s.v8.running,speed_target:b.action==='speed'?b.speed:window.fixture.s.v8.speed_target}})};return {ok:true,status:200,text:async()=>JSON.stringify(data)};}}""",{'initial':s,'next':s2,'rain':s3})
 page.add_script_tag(content=scene0)
 for file in ('aircraft/model.js', 'aircraft/flight.js', 'ground_ops.js'):
  page.add_script_tag(content=(root/'static'/file).read_text())
 page.add_script_tag(content=scene1);page.add_script_tag(content=script)
 page.wait_for_timeout(800)
 print('SCENE',page.evaluate('window.RELAY_V9_SCENE'),'errors',errs,'console',messages[:10]);
 print('CANVAS',page.evaluate('document.querySelector("#baselineWorld").getContext("webgl2")!=null'))
 page.screenshot(path=str(root/'tests/v9_ground_webgl.png'),full_page=True)
 page.locator('#view2D').click();page.wait_for_timeout(350);page.screenshot(path=str(root/'tests/v9_ground_2d_webgl.png'),full_page=True)
 page.locator('#view3D').click();page.locator('#settingsBtn').click();page.locator('#weather').select_option('RAIN');page.locator('#rate').fill('5');page.locator('#crew').fill('6');page.locator('#stands').fill('6');page.locator('#applySettings').click();page.wait_for_timeout(350)
 page.screenshot(path=str(root/'tests/v9_ground_rush_webgl.png'),full_page=True)
 page.locator('#stepOnce').click();page.wait_for_timeout(320)
 assert 'TICK 2' in page.locator('#tickPill').inner_text(),page.locator('#tickPill').inner_text()
 print('STEPS',page.locator('#tickPill').inner_text(),'events',page.locator('.v9-event-animation').count())
 page.locator('#speed').select_option('100');page.locator('#globalPlay').click();page.wait_for_timeout(350)
 assert 'RUNNING' in page.locator('#liveState').inner_text()
 page.locator('[data-tab="tower"]').click();page.wait_for_timeout(300);page.screenshot(path=str(root/'tests/v9_tower.png'),full_page=True)
 page.locator('[data-tab="customer"]').click();page.wait_for_timeout(400);page.screenshot(path=str(root/'tests/v9_customer.png'),full_page=True)
 assert page.locator('.shipment-card').count()>0
 print('JAVASCRIPT ERRORS',errs,'PAGE MESSAGES',messages[:10],'screens customer',page.locator('.shipment-card').count())
 print('SCROLL',page.evaluate('document.documentElement.scrollHeight'),page.evaluate('window.innerHeight'))
 assert not errs,errs
 b.close()
c.lab._tmp.cleanup()
