/* User-flow smoke against the actual local Python v5 HTTP service. No Chromium visual claims. */
const fs=require('fs'),path=require('path'),assert=require('assert');
const base='http://127.0.0.1:'+(process.env.TEST_PORT||'8765');
const html=fs.readFileSync(path.join(__dirname,'../static/v5.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
assert.strictEqual(ids.length,new Set(ids).size,'duplicate IDs');
let m=new Map();
function el(id){if(!m.has(id))m.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,options:[],dataset:{},listeners:{},
 classList:{add(){},remove(){},toggle(){}},addEventListener(n,fn){this.listeners[n]=fn},click(){return this.listeners.click?.()},scrollIntoView(){},
 replaceChildren(...xs){this.options=xs;this.value=xs[0]?.value??''},getContext(){return {}},getBoundingClientRect(){return {width:630,height:320}},setPointerCapture(){}});return m.get(id)}
ids.forEach(el);
Object.assign(el('rate'),{value:'2'});Object.assign(el('chaos'),{value:'0.2'});Object.assign(el('speed'),{value:'950'});el('episodes').value='100';el('crew').value='3';el('coldBays').value='1';el('oagStatus').value='Canceled';
global.document={getElementById:el,querySelectorAll(){return []},createElement(tag){return {...el('ephemeral'+Math.random()),tagName:tag}}};
global.window={RelayIsometricTwin:class{constructor(){this.state=null}render(){}}};
global.requestAnimationFrame=()=>1;global.confirm=()=>true;
const nativeFetch=global.fetch;global.fetch=(url,opts)=>nativeFetch(url.startsWith('http')?url:base+url,opts);
let errors=[];process.on('unhandledRejection',e=>errors.push(e));
eval(fs.readFileSync(path.join(__dirname,'../static/v5.js'),'utf8'));
eval(fs.readFileSync(path.join(__dirname,'../static/v5_extra.js'),'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function click(id){let e=el(id);assert(e.listeners.click,'no listener '+id);await e.listeners.click();await sleep(400)}
async function waitFor(fn,desc,ms=9000){const start=Date.now();while(Date.now()-start<ms){if(fn())return;await sleep(200)}throw Error('Timed out waiting for '+desc+'; feedback='+el('feedback').textContent)}
(async()=>{
 await waitFor(()=>el('conn').innerHTML.includes('LIVE'),'canonical v5 connected',15000);
 await click('guideStep');await waitFor(()=>Number(el('tick').textContent)>=1,'guided operation advanced',15000);
 await click('guideIncident');assert(el('feedback').textContent.length>10,'guided disruption handled');
 await click('evaluateBtn');assert(el('networkStatus').textContent.length>4,'MILP rendered');
 assert(el('packing').innerHTML.includes('svg'),'2D placement drawn');
 assert(el('scopeInfo').textContent.includes('eligible shipments'),'scope disclosed');
 await click('sampleBtn');assert(el('awb').value.startsWith('SYN-'),'same-catalog AWB');
 assert(el('customerResult').innerHTML.includes('ESTIMATED ARRIVAL'),'customer projection');
 await click('oagPreviewBtn');assert(el('oagPreview').innerHTML.includes('CARGO INVENTORY: NOT AVAILABLE'),'mock OAG clearly no capacity');
 assert(el('oagFlight').value,'OAG crosswalk selected');
 await click('oagObserveBtn');assert(el('oagImpact').innerHTML.includes('NOT changed'),'OAG observation no capacity mutation');
 await click('auditBtn');assert(el('auditPass').textContent.includes('passed'),'audit executed');
 await click('evidenceBtn');assert(el('evidenceRaw').textContent.includes('process_logs'),'structured provenance displayed');
 await click('benchmarkBtn');assert(el('benchmarkResult').innerHTML.includes('PAIRED'),'benchmark executed');
 assert(errors.length===0,errors.join('\n'));
 console.log('PASS v5: guided 4-step + live 3-model + scope + OAG + audit + evidence + customer + benchmark');
})().catch(e=>{console.error(e);process.exitCode=1});
