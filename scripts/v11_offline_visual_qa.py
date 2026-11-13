"""Chromium UI visual QA with real TestClient-produced data captured offline.
No browser-to-server HTTP E2E is implied; local browser traffic may be blocked by sandbox.
"""
import asyncio,base64,re,sys
from os import environ
from pathlib import Path
from fastapi.testclient import TestClient
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from fusion_app import app

async def main():
    with TestClient(app) as c:
        html=c.get('/v11').text
        styles=[c.get(url).raise_for_status().text for url in re.findall(r'<link rel="stylesheet" href="([^"]+)">',html)]
        scripts=[c.get(url).raise_for_status().text for url in re.findall(r'<script\s+src="([^"]+)"\s*></script>',html)]
        sandboxes=c.get('/v11/api/sandboxes').raise_for_status().json()
        def ground_states():
            return {f'/v11/api/sandboxes/{s["id"]}/ground':
                    c.get(f'/v11/api/sandboxes/{s["id"]}/ground').raise_for_status().json()
                    for s in sandboxes}

        c.post('/v11/api/control',json={'action':'reset','seed':2048})
        initial={'state':c.get('/v11/api/state').json(), 'ground':ground_states()}
        for sandbox in sandboxes:
            c.post('/v11/api/control',params={'sandbox_id':sandbox['id']},json={'action':'step','count':12})
        active={'state':c.get('/v11/api/state').json(), 'ground':ground_states()}
        report=c.get('/v11/api/kpis').json()
        audit=c.get('/v11/api/data-audit').json()
        trace=c.get('/v11/api/trace').json()
    error=[]
    async with async_playwright() as pw:
        system_chromium=Path('/usr/bin/chromium')
        browser=await pw.chromium.launch(
            headless=True,
            executable_path=environ.get('CHROME_EXECUTABLE') or (str(system_chromium) if system_chromium.is_file() else None),
            args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
        )
        page=await browser.new_page(viewport={'width':1440,'height':900})
        page.on('pageerror',lambda e:error.append(str(e)))
        html=re.sub(r'<link\s+[^>]*>', '', html)
        html=re.sub(r'<script\s+src="[^"]+"\s*></script>', '', html)
        await page.route('https://relay.test/v11',lambda route: route.fulfill(content_type='text/html',body=html))
        await page.goto('https://relay.test/v11',wait_until='domcontentloaded')
        for css in styles:
            await page.add_style_tag(content=css)
        await page.evaluate('''({states,sandboxes})=>{let pos=0;
            window.fetch=async(u,o={})=>{if((o.method||'GET')!=='GET')pos=1;
                const path=String(u).split('?')[0], frame=states[pos];
                const data=path==='/v11/api/sandboxes'?sandboxes:(frame.ground[path]||frame.state);
                return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};
            };}''',{'states':[initial,active],'sandboxes':sandboxes})
        for script in scripts:
            await page.add_script_tag(content=script)
        await page.wait_for_function("window.RELAY_GROUND_SCENES?.length === 2 && window.RELAY_GROUND_SCENES.every(scene => scene.engine && scene.syncedTick >= 0)")
        assert await page.locator('[data-tab]').count()==4
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
        await ev.route('https://relay.test/v11/evidence',lambda route: route.fulfill(content_type='text/html',body=raw))
        await ev.goto('https://relay.test/v11/evidence',wait_until='domcontentloaded')
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
        print('Chromium offline: four tabs, two WebGL scenes, six evidence rows, 0 JS errors')
        await browser.close()
if __name__=='__main__':asyncio.run(main())
