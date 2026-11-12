/* Browser-free v4 UI control test with LIVE Python server; not visual Chrome QA. */
const fs=require('fs'),path=require('path'),assert=require('assert');
const root='http://127.0.0.1:'+(process.env.TEST_PORT||'8765');
const html=fs.readFileSync(path.join(__dirname,'../static/v4.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.strictEqual(new Set(ids).size,ids.length,'duplicate HTML ids');
let all=new Map();
function elem(id){if(!all.has(id))all.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},
 listeners:{},classList:{add(){},remove(){},toggle(){}},addEventListener(ev,fn){this.listeners[ev]=fn},
 getContext(){return {}},getBoundingClientRect(){return {width:620,height:320}},setPointerCapture(){}});return all.get(id)}
ids.forEach(elem);
Object.assign(elem('rate'),{value:'2.5'});Object.assign(elem('chaos'),{value:'0.2'});Object.assign(elem('speed'),{value:'950'});elem('episodes').value='100';elem('crew').value='3';elem('coldBays').value='1';
global.document={getElementById:elem,querySelectorAll(){return []}};
global.window={RelayIsometricTwin:class{constructor(canvas,label){this.canvas=canvas;this.policyName=label;this.state=null}render(){}}};
global.requestAnimationFrame=()=>1;global.confirm=()=>true;
const nativeFetch=global.fetch;global.fetch=(url,opts)=>nativeFetch(url.startsWith('http')?url:root+url,opts);
let errors=[];process.on('unhandledRejection',e=>errors.push(e));
const code=fs.readFileSync(path.join(__dirname,'../static/v4.js'),'utf8');eval(code);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function click(id){let e=elem(id);assert(e.listeners.click,'missing click listener for '+id);await e.listeners.click();await sleep(550)}
(async()=>{
 await sleep(500);assert(elem('conn').innerHTML.includes('LIVE'), 'backend init from canonical state');
 await click('stepBtn');assert(Number(elem('tick').textContent)>=1,'step click updated clock');
 assert(elem('decisionAction').textContent && elem('networkStatus').textContent,'model outputs rendered');
 assert(elem('packing').innerHTML.includes('<svg'),'computed ULD placements rendered');
 await click('flightBtn');assert(elem('feedback').textContent.includes('SYNTHETIC'),'simulated external incident');
 await click('sampleBtn');assert(elem('awb').value.startsWith('SYN-'),'same-catalog AWB sample');
 assert(elem('customerResult').innerHTML.includes('ESTIMATED ARRIVAL'),'customer view renders');
 await click('benchmarkBtn');assert(elem('benchmarkResult').innerHTML.includes('PAIRED'),'benchmark results are calculated');
 assert(errors.length===0,'unhandled JS errors: '+errors.map(String).join('\n'));
 console.log('PASS: real Python API + 3 models + step + incident + 2D + customer + benchmark + DOM controls');
})().catch(e=>{console.error(e);process.exitCode=1});
