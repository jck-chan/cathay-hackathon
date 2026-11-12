"""Actual Chromium → local ASGI integrated smoke test. Not an airline test."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,time
ROOT='http://127.0.0.1:8787/'
base=Path(__file__).resolve().parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1460,'height':920},device_scale_factor=1)
    issues=[]
    page.on('pageerror',lambda error:issues.append(str(error)))
    page.goto(ROOT,wait_until='domcontentloaded',timeout=30000)
    page.locator('#sceneBaseline').wait_for(state='visible',timeout=10000)
    page.wait_for_timeout(1400)
    page.screenshot(path=str(base/'v7_ground_live.png'),full_page=True)
    print('GROUND',page.title(),page.locator('#simTick').inner_text(), 'js-errors',issues)
    page.locator('#stepBtn').click()
    page.wait_for_function("document.querySelector('#simTick').innerText.includes('TICK 1')",timeout=25000)
    print('STEP',page.locator('#simTick').inner_text())
    page.locator('[data-tab="tower"]').click()
    page.screenshot(path=str(base/'v7_tower_live.png'),full_page=True)
    page.locator('#geometryBtn').click()
    page.wait_for_function("document.querySelector('#geometryDetails').textContent.includes('pieces placed')",timeout=30000)
    print('GEOMETRY',page.locator('#geometryDetails').inner_text())
    page.locator('[data-tab="customer"]').click()
    page.locator('#portfolioList button.shipment').first.click()
    page.wait_for_timeout(800)
    page.screenshot(path=str(base/'v7_customer_live.png'),full_page=True)
    print('CUSTOMER',page.locator('#customerAwb').inner_text(),page.locator('#journeyStages').inner_text()[:180])
    page.locator('#orderDest').select_option('SIN')
    page.locator('#orderWeight').fill('120')
    page.locator('#newOrderForm button[type=submit]').click()
    page.wait_for_function("document.querySelector('#orderResult').textContent.includes('Created')",timeout=30000)
    print('ORDER',page.locator('#orderResult').inner_text())
    page.screenshot(path=str(base/'v7_customer_order.png'),full_page=True)
    print('JS ERRORS:',issues)
    browser.close()
    assert not issues,issues
