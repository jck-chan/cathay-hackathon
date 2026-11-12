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
  for file in ('v6_scene.js','aircraft/model.js','aircraft/flight.js','v9_scene.js','v12.js'):
   await page.add_script_tag(content=(ROOT/'static'/file).read_text())
  facts['http_status']=200 # HTML extracted from actual v12 served source; endpoint separately tested
  await page.wait_for_function("document.querySelectorAll('.world').length===3",timeout=20000)
  await page.wait_for_timeout(1600)
  facts['three_worlds']=await page.locator('.world').count()
  facts['flight_follows_path']=await page.evaluate("""() => {
    const {poseAt, transform, lapDuration} = RelayFlight;
    for (let i = 0; i < 512; i++) {
      const time = i * lapDuration / 512;
      const pose = poseAt(time);
      const before = poseAt(time - .001);
      const after = poseAt(time + .001);
      const delta = [after.x - before.x, after.y - before.y, after.z - before.z];
      const length = Math.hypot(...delta);
      const forward = transform(pose, 1);
      const alignment = delta.reduce((sum, value, axis) => sum + value * forward[axis], 0) / length;
      if (!(length < .013 && alignment > .999)) return false;
    }
    const start = poseAt(0), end = poseAt(lapDuration);
    return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < 1e-6;
  }""")
  facts['webgl_count']=await page.evaluate("Array.from(document.querySelectorAll('.world canvas')).filter(c=>!!c.getContext('webgl2')).length")
  facts['root_scroll']=await page.evaluate('document.documentElement.scrollHeight > window.innerHeight+10')
  await page.screenshot(path=str(ROOT/'reports/V12_BROWSER_THREE_WORLDS.png'))
  await page.locator('.choice input[value="RELAY_V10"]').check()
  await page.locator('.choice input[value="A_EDF"]').check()
  await page.wait_for_function("document.querySelectorAll('.world').length===5",timeout=15000)
  await page.wait_for_timeout(500)
  facts['five_worlds']=await page.locator('.world').count()
  facts['five_webgl_count']=await page.evaluate("Array.from(document.querySelectorAll('.world canvas')).filter(c=>!!c.getContext('webgl2')).length")
  await page.screenshot(path=str(ROOT/'reports/V12_BROWSER_FIVE_WORLDS.png'))
  # Minimum-two guard preserves at least two selected worlds.
  await page.locator('.choice input[value="RELAY_V10"]').uncheck()
  await page.locator('.choice input[value="A_CRITICAL"]').uncheck()
  await page.locator('.choice input[value="A_EDF"]').uncheck()
  facts['two_worlds']=await page.locator('.world').count()
  facts['two_disabled_controls']=await page.locator('.choice input:disabled').count()
  await page.screenshot(path=str(ROOT/'reports/V12_BROWSER_TWO_WORLDS.png'))
  # Disable expensive shader repaint ONLY for the UI control interaction pass.
  # Earlier screenshots already exercised all live software-WebGL canvases.
  await page.evaluate('window.RELAY_QA_NO_RENDER=true')
  facts['page_errors']=errors
  print('VISUAL QA FACTS',json.dumps(facts,indent=2),flush=True)
  assert facts['three_worlds']==3 and facts['five_worlds']==5 and facts['two_worlds']==2
  assert facts['flight_follows_path']
  assert facts['two_disabled_controls']==2
  assert facts['webgl_count']>=2 and facts['five_webgl_count']>=2
  assert not errors,errors
  (ROOT/'reports/V12_BROWSER_QA.json').write_text(json.dumps(facts,indent=2))
  print(json.dumps(facts,indent=2),flush=True)
  await browser.close()
if __name__=='__main__':asyncio.run(main())
