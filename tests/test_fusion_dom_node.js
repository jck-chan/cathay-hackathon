/* Browser-free UI wiring check; real REST calls to a running local test server.
 * The sandbox's Chromium executable is policy-blocked; no visual QA is claimed.
 * Usage: node tests/test_fusion_dom_node.js (server on TEST_PORT or 8765).
 */
const fs=require('fs');const path=require('path');const assert=require('assert');
const url='http://127.0.0.1:'+(process.env.TEST_PORT||'8765');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
const nativeFetch=global.fetch;global.fetch=(p,args)=>nativeFetch(p.startsWith('http')?p:url+p,args);
const E=new Map();
function elem(id){
 if(!E.has(id)) E.set(id,{
   id,value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},className:'',
   listeners:{},classList:{add(){},remove(){},toggle(){}},
   addEventListener(name,fn){this.listeners[name]=fn},
   closest(){return {remove(){}}},setAttribute(){},
 });
 return E.get(id);
}
ids.forEach(elem);
for(const [id,v] of Object.entries({alphaControl:'90',weightControl:'0.12',limitControl:'3',
  autonomySelect:'HUMAN_APPROVAL',awbInput:''}))elem(id).value=v;
let appended=[];
global.document={getElementById:elem,createElement:()=>elem('toast-generated'),querySelectorAll:()=>[],
   body:{appendChild(x){appended.push(x)}},visibilityState:'visible'};
global.window={RelayIsometricTwin:class {constructor(){this.state=null;this.incidentActive=false} render(){}},confirm:()=>true};
global.IntersectionObserver=class{observe(){}};
global.requestAnimationFrame=()=>1;
global.crypto=require('crypto').webcrypto;
let errors=[];process.on('unhandledRejection',e=>errors.push(e));
const code=fs.readFileSync(path.join(__dirname,'../static/fusion.js'),'utf8');
eval(code);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function click(id){const el=elem(id);assert(el.listeners.click,'no listener for '+id);await el.listeners.click();await sleep(100)}
(async()=>{
 await sleep(400);
 assert(elem('connectionBadge').innerHTML.includes('CONNECTED'),'backend connection label');
 await click('evaluateBtn');
 assert(elem('ftShipments').textContent>0,'math engine shipment count updated');
 assert(elem('modelIView').innerHTML.includes('risk units saved'),'Model I details rendered');
 assert(elem('modelIIIView').innerHTML.includes('MILP solver status'),'Model III details rendered');
 assert(elem('reviewProposal').innerHTML.includes('Simulated')||elem('reviewProposal').innerHTML.includes('simulated'),'review microcopy rendered');
 await click('loadSampleAWB');
 assert(elem('awbInput').value.startsWith('SYN-'),'sample AWB from v2 API');
 assert(elem('customerResult').innerHTML.includes('estimated arrival'),'customer projection loaded');
 await click('approveBtn');
 assert(elem('tasksCount').textContent>0,'simulated department tasks created');
 await click('advanceBtn');
 assert(elem('engineVersion').textContent.startsWith('v'),'snapshot version updated');
 assert(errors.length===0,'Unhandled JS errors '+errors.map(String).join('\n'));
 console.log('PASS: DOM event handlers + real same-origin HTTP calls + model render + review + customer + event tick');
})().catch(e=>{console.error(e);process.exitCode=1})
