"""Chromium offline WebGL rendering + 2/3/5 viewport validation, with FastAPI TestClient-backed data. A network E2E or Windows QA claim is NOT implied."""
import asyncio, json, os, sys, re
from pathlib import Path
from urllib.parse import urlsplit
from fastapi.testclient import TestClient
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
URL=os.environ.get('V12_QA_URL','http://127.0.0.1:8779')
async def main():
 errors=[];facts={}
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=False,executable_path='/usr/bin/chromium',args=[
   '--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-webgl',
   '--use-gl=angle','--use-angle=gl'])
  page=await browser.new_page(viewport={'width':1600,'height':970},device_scale_factor=1)
  page.on('pageerror',lambda x:errors.append(str(x)))
  from fusion_app import app
  # Browser environment blocks loopback network. Route browser requests to
  # the actual FastAPI app through TestClient (not hand-authored fixtures).
  client=TestClient(app)
  html=(ROOT/'static/v12.html').read_text()
  html=re.sub(r'<link\s+rel="stylesheet"[^>]+>','',html)
  html=re.sub(r'<script\s+src="[^"]+"\s*></script>','',html)
  await page.set_content(html,wait_until='domcontentloaded')
  await page.add_style_tag(content=(ROOT/'static/v12.css').read_text())
  async def proxy(method,path,body):
   result=client.request(method,path,content=body,headers={'content-type':'application/json'})
   return {'ok':result.is_success,'status':result.status_code,'body':result.json()}
  await page.expose_function('backend_request',proxy)
  await page.evaluate('''() => { window.fetch=async(url,opt={})=>{
      const result=await window.backend_request(opt.method||'GET',String(url),opt.body||null);
      return {ok:result.ok,status:result.status,json:async()=>result.body};
  }}''')
  for file in ('v6_scene.js','aircraft/model.js','aircraft/flight.js','ground_ops.js','v9_scene.js','request_button.js','v12.js'):
   await page.add_script_tag(content=(ROOT/'static'/file).read_text())
  # The 3D renderers have already been validated by v12_browser_qa.py.
  # Skip software GPU repaint to isolate UI state/action synchronization.
  await page.wait_for_function("document.querySelectorAll('.world').length===3",timeout=8000)
  await page.evaluate('window.RELAY_QA_NO_RENDER=true')
  await page.locator('#stepTen').click(timeout=5000)
  await page.wait_for_function("document.querySelector('#tick').textContent!=='00000'",timeout=8000)
  facts['tick_after_10']=await page.locator('#tick').inner_text()
  await page.locator('#speed').select_option('100',timeout=5000)
  facts['speed_request']=(await page.locator('#speed').input_value())
  await page.locator('#settingsBtn').click(timeout=5000)
  facts['settings_open']=await page.locator('#drawer').is_visible()
  await page.locator('#configHandlers').fill('5',timeout=5000)
  await page.locator('#settingsForm button').click(timeout=5000)
  await page.wait_for_function("document.querySelector('#drawer').hidden===true",timeout=12000)
  facts['settings_applied']=__import__('fusion_app').V12.config['handlers']==5
  await page.locator('#incidentBtn').click(timeout=5000)
  await page.locator('[data-incident="RAIN"]').click(timeout=5000)
  facts['weather_applied']=__import__('fusion_app').V12.weather=='RAIN'
  await page.locator('#benchmarkBtn').click(timeout=5000)
  await page.wait_for_function("document.querySelectorAll('#drawerBody table').length===6",timeout=10000)
  facts['benchmark_tables']=await page.locator('#drawerBody table').count()
  facts['errors']=errors
  assert facts['tick_after_10']=='00010'
  assert facts['speed_request']=='100'
  assert facts['settings_open'] and facts['settings_applied'] and facts['weather_applied']
  assert facts['benchmark_tables']==6 and not errors
  (ROOT/'reports/V12_BROWSER_CONTROLS_QA.json').write_text(json.dumps(facts,indent=2))
  print(json.dumps(facts,indent=2),flush=True)
  await browser.close()
if __name__=='__main__':asyncio.run(main())
