"""Offline globe regression check. Requires Playwright and installed Chromium.
Set CHROME_EXECUTABLE to use a local Chrome binary instead.
"""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    options = {'headless': True}
    if os.environ.get('CHROME_EXECUTABLE'):
        options['executable_path'] = os.environ['CHROME_EXECUTABLE']
    browser = pw.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    html = (ROOT / 'static/v11.html').read_text()
    html = re.sub(r'<script\b[^>]*>.*?</script>|<link\b[^>]*>', '', html, flags=re.S)
    page.set_content(html)
    for name in ('v8.css', 'v9.css', 'v10.css', 'v11_customer.css'):
        page.add_style_tag(content=(ROOT / 'static' / name).read_text())
    for name in ('v6_scene.js', 'v10_scene.js'):
        page.add_script_tag(content=(ROOT / 'static' / name).read_text())
    page.evaluate('''() => {
        document.querySelector('#ground-screen').classList.remove('active');
        document.querySelector('#customer-screen').classList.add('active');
        window.globe = new RelayV6.CustomerGlobe(document.querySelector('#customerGlobe'));
        globe.setRoutes(Array.from({length:50}, (_, i) => ({awb:String(i),
            destination:['LHR','SIN','NRT','SYD','LAX'][i%5],priority:3})), '0');
        globe.setRoute('HKG', 'LHR');
        globe.targetLon=null;globe.lon=65;globe.lat=30;globe.render(1000);
    }''')
    # A frame after rotation must match a fresh render at the same orientation.
    for style in ('customer', ''):
        assert page.evaluate('''style => {
            globe.canvas.dataset.style=style;
            for(let i=0;i<30;i++){globe.lon+=8;globe.render(1000);}
            const actual=globe.canvas.toDataURL();
            globe.c.clearRect(0,0,globe.w,globe.h);globe.render(1000);
            return actual===globe.canvas.toDataURL();
        }''', style), f'Globe leaves trails: {style or "legacy"}'
    page.evaluate("globe.canvas.dataset.style='customer'")
    # Airport tags must be emitted once on the front and never on the back.
    assert page.evaluate("""() => {
        const label=globe.label, labels=[];
        globe.label=(x,y,t)=>labels.push(t);
        globe.targetLon=null;globe.lon=114;globe.lat=22;globe.render(1000);
        const front=labels.filter(x=>x==='HKG').length===1;
        labels.length=0;globe.lon=-66;globe.lat=-22;globe.render(1000);
        globe.label=label;
        return front&&!labels.includes('HKG');
    }""")
    canvas = page.locator('#customerGlobe')
    box = canvas.bounding_box()
    before = page.evaluate('globe.lon')
    page.mouse.move(box['x']+100, box['y']+100)
    page.mouse.down()
    page.mouse.move(box['x']+180, box['y']+130, steps=10)
    page.mouse.up()
    assert page.evaluate('globe.lon') != before
    assert page.evaluate('!globe.drag')
    canvas.focus()
    before = page.evaluate('globe.lon')
    page.keyboard.press('ArrowRight')
    assert page.evaluate('globe.lon') == before+8
    page.locator('#globeReset').click()
    assert page.evaluate('globe.targetLon !== null')
    for width in (1024, 390):
        page.set_viewport_size({'width': width, 'height': 844})
        canvas.scroll_into_view_if_needed()
        page.evaluate('globe.render(1000)')
        assert canvas.is_visible()
        assert page.evaluate('''() => {const s=document.querySelector('#customer-screen');
            return s.scrollWidth<=s.clientWidth;}''')
    assert not errors, errors
    page.set_viewport_size({'width':1440,'height':1000})
    page.evaluate("globe.targetLon=null;globe.lon=125;globe.lat=25;globe.render(1000)")
    canvas.screenshot(path='/tmp/relay-globe-after.png')
    browser.close()
    print('PASS: 50 routes, clean frames after rotation (both styles), drag, keyboard, reset, tablet/mobile; no JS errors.')
