"""Offline real Chromium rendering: injects actual authoritative snapshot captures from
FastAPI TestClient, avoiding any external network access. This does NOT exercise a
live browser HTTP connection; API contract tests cover that separately."""
from __future__ import annotations
import asyncio,json,re,os
from pathlib import Path
from fastapi.testclient import TestClient
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from playwright.async_api import async_playwright
from fusion_app import app
from v11.api import conductor
ROOT=Path(__file__).resolve().parents[1]

def build_snapshots():
 with TestClient(app) as c:
  c.post('/v11/api/control',json={'action':'reset','seed':2048})
  initial=c.get('/v11/api/state').json()
  out=c.post('/v11/api/control',json={'action':'step','count':18})
  assert out.status_code==200,out.text
  active=c.get('/v11/api/state').json()
 return initial,active

async def main():
 initial,advanced=build_snapshots()
 html=(ROOT/'static/v10.html').read_text()
 html=re.sub(r'<link\s+[^>]*>', '', html)
 html=re.sub(r'<script\s+src="[^"]+"\s*></script>', '', html)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=os.getenv('V10_HEADED','0')!='1',
   args=['--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-webgl','--use-gl=angle','--use-angle=gl'])
  page=await browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.set_content(html,wait_until='domcontentloaded')
  for file in ['v8.css','v9.css','v10.css']:
   await page.add_style_tag(content=(ROOT/'static'/file).read_text())
  await page.evaluate('''(snapshots)=>{window.__states=snapshots;window.__pos=0;
    window.fetch=async(url,options={})=>{let path=String(url);if((options.method||'GET')!=='GET')window.__pos=1;
      const value=window.__states[window.__pos];return {ok:true,status:200,text:async()=>JSON.stringify(value)};
    };
  }''',[initial,advanced])
  for file in ['v6_scene.js','aircraft/model.js','aircraft/flight.js','v9_scene.js','v10_scene.js','v10_ui.js','v9.js']:
   await page.add_script_tag(content=(ROOT/'static'/file).read_text())
  await page.wait_for_timeout(2100)
  print('V10 loaded',await page.evaluate('window.RELAY_V10?.version'),'Actual GL',await page.evaluate('!!document.querySelector("#baselineWorld").getContext("webgl2")'),'errors',errors)
  assert await page.evaluate('window.RELAY_V10?.version')=='10.0'
  assert await page.locator('#v10Tick').inner_text()=='TICK 0'
  await page.screenshot(path=str(ROOT/'tests/v10_ground_initial.png'))
  # Shared state update is mocked from actual server state at tick 18.
  await page.evaluate('''()=>{window.__pos=1;window.__states[1].v8.running=true;window.__states[1].v8.speed_target=100;window.__states[1].v8.actual_ticks_per_second=4.0;window.__states[1].v8.target_ticks_per_second=50;}''')
  await page.wait_for_timeout(1550)
  print('ground tick after',await page.locator('#v10Tick').inner_text())
  await page.screenshot(path=str(ROOT/'tests/v10_ground_animated.png'))
  print('Visual tempo under requested 100x',await page.locator('#v10Tempo').inner_text(),
        'verified speed indicator',await page.locator('#v10Throughput').inner_text())
  assert float((await page.locator('#v10Tempo').inner_text()).replace('×',''))>=5
  await page.wait_for_timeout(850)
  await page.screenshot(path=str(ROOT/'tests/v10_ground_animated_later.png'))
  await page.locator('#v10InsightToggle').click()
  await page.wait_for_timeout(250)
  await page.screenshot(path=str(ROOT/'tests/v10_ground_insights.png'))
  await page.locator('[data-tab="tower"]').click();await page.wait_for_timeout(1400)
  assert await page.locator('.v10-mathcanvas').count()==3
  print('math texts',await page.locator('#v10MathHeadlineThree').inner_text())
  await page.screenshot(path=str(ROOT/'tests/v10_tower.png'))
  await page.locator('[data-tab="customer"]').click();await page.wait_for_timeout(1400)
  print('portfolio cards',await page.locator('.shipment-card').count())
  await page.screenshot(path=str(ROOT/'tests/v10_customer_globe.png'))
  print('page errors',errors)
  if errors:raise AssertionError(errors[:5])
  await browser.close()
if __name__=='__main__':asyncio.run(main())
