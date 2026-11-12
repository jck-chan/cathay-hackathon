"""Chromium UI visual QA with real TestClient-produced data captured offline.
No browser-to-server HTTP E2E is implied; local browser traffic may be blocked by sandbox.
"""
import asyncio,base64,json,re,sys
from pathlib import Path
from fastapi.testclient import TestClient
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from fusion_app import app

async def main():
    with TestClient(app) as c:
        c.post('/v11/api/control',json={'action':'reset','seed':2048})
        initial=c.get('/v11/api/state').json()
        c.post('/v11/api/control',json={'action':'step','count':12})
        active=c.get('/v11/api/state').json()
        report=c.get('/v11/api/kpis').json()
        audit=c.get('/v11/api/data-audit').json()
        trace=c.get('/v11/api/trace').json()
    error=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-webgl','--use-gl=angle','--use-angle=gl'])
        page=await browser.new_page(viewport={'width':1440,'height':900})
        page.on('pageerror',lambda e:error.append(str(e)))
        html=(ROOT/'static/v11.html').read_text()
        html=re.sub(r'<link\s+[^>]*>', '', html)
        html=re.sub(r'<script\s+src="[^"]+"\s*></script>', '', html)
        await page.set_content(html,wait_until='domcontentloaded')
        for css in ('v8.css','v9.css','v10.css'):
            await page.add_style_tag(content=(ROOT/'static'/css).read_text())
        await page.evaluate('''(states)=>{window.__states=states;window.__pos=0;
            window.fetch=async(u,o={})=>{if((o.method||'GET')!=='GET')window.__pos=1;
                let data=window.__states[window.__pos];
                return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};
            };}''',[initial,active])
        for name in ('v6_scene.js','aircraft/model.js','aircraft/flight.js','ground_ops.js','v9_scene.js','v10_scene.js','v10_ui.js','v9.js'):
            await page.add_script_tag(content=(ROOT/'static'/name).read_text())
        await page.wait_for_timeout(850)
        assert await page.locator('[data-tab]').count()==3
        await page.screenshot(path=str(ROOT/'reports/V11_BROWSER_GROUND_OFFLINE.png'))
        for tab in ('tower','customer','ground'):
            await page.locator(f'[data-tab="{tab}"]').click()
            await page.wait_for_timeout(400)
        await page.locator('[data-tab="tower"]').click()
        await page.screenshot(path=str(ROOT/'reports/V11_BROWSER_TOWER_OFFLINE.png'))
        await page.locator('[data-tab="customer"]').click()
        await page.screenshot(path=str(ROOT/'reports/V11_BROWSER_CUSTOMER_OFFLINE.png'))
        ev=await browser.new_page(viewport={'width':1440,'height':900})
        ev.on('pageerror',lambda e:error.append(str(e)))
        raw=(ROOT/'static/v11_evidence.html').read_text()
        m=re.search(r'<script>([\s\S]+?)</script>',raw)
        assert m,'no evidence script found'
        raw=raw.replace(m.group(0),'')
        await ev.set_content(raw,wait_until='domcontentloaded')
        await ev.evaluate('''(data)=>{window.fetch=async(url)=>{
            const u=String(url);const result=u.includes('data-audit')?data.audit:
               u.includes('trace')?data.trace:data.report;
            return {ok:true,status:200,json:async()=>result};
            }}''',{'report':report,'audit':audit,'trace':trace})
        # Use original chart image bytes, not re-rendered or generated art.
        images={}
        for file in ('V11_ARRIVAL_FREQUENCY.png','V11_STATISTICAL_CONVERGENCE.png',
                     'V11_SAVINGS_DISTRIBUTION.png','V11_ROI_SENSITIVITY_HYPOTHETICAL.png'):
            images[file]='data:image/png;base64,'+base64.b64encode((ROOT/'reports'/file).read_bytes()).decode('ascii')
        await ev.evaluate('''images=>{for(let img of document.querySelectorAll('img')){
            let name=img.getAttribute('src').split('/').pop();if(images[name])img.src=images[name];
            else img.removeAttribute('src');
        }}''',images)
        await ev.add_script_tag(content=m.group(1))
        await ev.wait_for_function("document.querySelector('#kpiRows')?.children.length === 6",timeout=20000)
        await ev.screenshot(path=str(ROOT/'reports/V11_BROWSER_EVIDENCE_QA.png'),full_page=True)
        assert await ev.locator('#kpiRows tr').count()==6
        assert not error,error
        print('Chromium offline: three tabs, six evidence rows, real PNGs, 0 JS errors')
        await browser.close()
if __name__=='__main__':asyncio.run(main())
