"""Headless Chromium browser QA against an actual local ASGI process.
No external sites or airline APIs; screenshots are evidence, not photo-real certification.
"""
import os,sys,time,subprocess
from pathlib import Path
import urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
port=18765
base=f'http://127.0.0.1:{port}'
env={**os.environ,'RELAY_NO_BROWSER':'1','RELAY_PORT':str(port)}
proc=subprocess.Popen([sys.executable,'launch.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
try:
    for _ in range(100):
        try:
            with urllib.request.urlopen(base+'/v11/api/health',timeout=2) as r:
                if r.status==200:break
        except Exception:time.sleep(.2)
    else:raise RuntimeError('local ASGI server did not start')
    errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--use-gl=angle','--use-angle=swiftshader'])
        page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
        page.on('pageerror',lambda exc:errors.append(str(exc)))
        r=page.goto(base+'/',wait_until='domcontentloaded',timeout=30000)
        assert r.status==200
        page.wait_for_timeout(1600)
        page.screenshot(path=str(ROOT/'reports/V11_BROWSER_GROUND.png'),full_page=False)
        print('Root title:',page.title())
        tabs=page.locator('[data-tab]').all()
        print('Main tabs:',[(x.get_attribute('data-tab'),x.inner_text()[:30]) for x in tabs])
        assert len(tabs)==3
        for tab in tabs:
            tab.click(timeout=5000)
            page.wait_for_timeout(450)
            print('Tabbed:',tab.get_attribute('data-tab'))
        evidence=browser.new_page(viewport={'width':1440,'height':900})
        evidence.on('pageerror',lambda exc:errors.append(str(exc)))
        r=evidence.goto(base+'/v11/evidence',wait_until='domcontentloaded',timeout=30000)
        assert r.status==200
        evidence.wait_for_function("document.querySelector('#kpiRows')?.children.length === 6",timeout=30000)
        print('Evidence table rows:',evidence.locator('#kpiRows tr').count())
        assert evidence.locator('#kpiRows tr').count()==6
        evidence.screenshot(path=str(ROOT/'reports/V11_BROWSER_EVIDENCE.png'),full_page=True)
        evidence.get_by_role('button',name='v10 original policy').click()
        evidence.wait_for_timeout(200)
        evidence.get_by_role('button',name='v11 adaptive').click()
        evidence.locator('#episodes').fill('40')
        evidence.get_by_role('button',name='Run fresh test').click()
        evidence.wait_for_function("document.querySelector('#sampleLabel')?.textContent.includes('40 × 6')",timeout=60000)
        assert evidence.locator('#sampleLabel').inner_text()=='40 × 6 paired episodes'
        print('Recompute via actual frontend passed')
        print('Browser JS exceptions:',errors)
        assert not errors,errors
        browser.close()
finally:
    proc.terminate()
    try:proc.wait(timeout=8)
    except subprocess.TimeoutExpired:proc.kill()
