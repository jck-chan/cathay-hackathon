"""Chromium JS execution through a mocked WebGL2 context.
Not a pixel test or proof of GPU/GLSL compatibility; detects runtime JS/render-flow bugs."""
from pathlib import Path
import sys,re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from v11.conductor import Conductor
c=Conductor(seed=2323);data=c.snapshot()
html=(root/'static/v9.html').read_text();html=re.sub(r'<script src="/[^"]+"></script>','',html);html=re.sub(r'<link rel="stylesheet" href="/[^"]+">','',html)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html);page.add_style_tag(content=(root/'static/v8.css').read_text()+'\n'+(root/'static/v9.css').read_text())
 page.evaluate("""() => {
  const native=HTMLCanvasElement.prototype.getContext;
  window.__v9Draws=0;
  HTMLCanvasElement.prototype.getContext=function(type,...args){
   if(type!=='webgl2')return native.call(this,type,...args);
   const gl={VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,LINK_STATUS:35714,ARRAY_BUFFER:34962,STATIC_DRAW:35044,DEPTH_TEST:2929,CULL_FACE:2884,TRIANGLES:4,FLOAT:5126,COLOR_BUFFER_BIT:16384,DEPTH_BUFFER_BIT:256};
   for(const n of ['createShader','createProgram','createBuffer','createVertexArray'])gl[n]=()=>({});
   for(const n of ['shaderSource','deleteShader','compileShader','attachShader','linkProgram','useProgram','bindVertexArray','bindBuffer','bufferData','enable','disable','cullFace','viewport','clearColor','clear','uniformMatrix4fv','uniform3f','uniform1f','enableVertexAttribArray','vertexAttribPointer'])gl[n]=()=>{};
   gl.isContextLost=()=>false;gl.getShaderParameter=()=>true;gl.getProgramParameter=()=>true;gl.getUniformLocation=()=>({});gl.drawArrays=()=>window.__v9Draws++;
   return gl;
  };
 }""")
 page.evaluate("v=>{window.fixture=v;window.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify(window.fixture)})}",data)
 for f in ['v6_scene.js','aircraft/model.js','aircraft/flight.js','v9_scene.js','v9.js']:page.add_script_tag(content=(root/'static'/f).read_text())
 page.wait_for_timeout(550)
 print('draw calls',page.evaluate('window.__v9Draws'),'errors',errors)
 assert page.evaluate('window.__v9Draws')>250
 assert not errors,errors
 page.locator('#view2D').click();page.wait_for_timeout(200)
 assert not errors,errors
 page.locator('#view3D').click();page.locator('#orbitBtn').click()
 page.locator('#settingsBtn').click();page.locator('#fleet').fill('12');page.locator('#floors').fill('5');page.wait_for_timeout(450)
 assert not errors,errors
 print('draw calls after changing scene density',page.evaluate('window.__v9Draws'))
 browser.close()
c.lab._tmp.cleanup()
