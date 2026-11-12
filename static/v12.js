/* RELAY v12: read-only projection of ONE five-policy server-owned synthetic
   experiment. Viewport selection never mutates a policy or its input tape. */
(()=>{'use strict';
const $=x=>document.getElementById(x), safe=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const names={FCFS:'FCFS',RELAY_V10:'RELAY v10',RELAY_V11:'RELAY v11',A_CRITICAL:'RELAY + Model A',A_EDF:'RELAY + EDF'};
const colors={FCFS:'#b98b40',RELAY_V10:'#517c9d',RELAY_V11:'#128d78',A_CRITICAL:'#a06dc3',A_EDF:'#d97061'};
const keys=Object.keys(names);let visible=['FCFS','RELAY_V11','A_CRITICAL'],last=null,worlds={},viewMode='3D',pending=false,latestSeq=-1,lastTick=-1,history={},toastTimer;
let flightTime=0,lastFrame=null,lastPaint=-Infinity,needsPaint=true;
function notify(txt){let el=$('toast');el.textContent=txt;el.classList.add('active');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('active'),2500)}
async function api(path,opt={}){const r=await fetch(path,{cache:'no-store',...opt});const data=await r.json();if(!r.ok)throw Error(data.detail||`HTTP ${r.status}`);return data}
let commandQueue=Promise.resolve();function act(action,options={}){const next=commandQueue.then(async()=>{const data=await api('/v12/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...options})});if(action==='reset')flightTime=0;update(data);return data});commandQueue=next.catch(()=>{});return next.catch(e=>{notify('Action failed: '+e.message);throw e})}
const csv=(v,n=0)=>Number(v||0).toLocaleString('en',{minimumFractionDigits:n,maximumFractionDigits:n});
function buildSelectors(){let host=$('policyChoices');host.replaceChildren();for(const key of keys){let lab=document.createElement('label');lab.className='choice'+(visible.includes(key)?' active':'');lab.style.setProperty('--accent',colors[key]);lab.innerHTML=`<input type="checkbox" value="${key}" ${visible.includes(key)?'checked':''}><i></i>${safe(names[key])}`;let input=lab.querySelector('input');input.disabled=visible.length===2&&visible.includes(key);input.addEventListener('change',()=>{if(input.checked)visible.push(key);else visible=visible.filter(k=>k!==key);visible=keys.filter(k=>visible.includes(k));buildSelectors();layout();if(last)update(last);});host.appendChild(lab)}$('visibleCount').textContent=`${visible.length}/5`}
function layout(){let host=$('grid');host.className=`world-grid count-${visible.length}`;for(const [key,world] of Object.entries(worlds))if(!visible.includes(key)){world.scene?.dispose();world.host.remove();delete worlds[key]}
 for(const key of visible){if(!worlds[key]){let div=document.createElement('article');div.className='world';div.style.setProperty('--accent',colors[key]);div.dataset.policy=key;div.innerHTML=`<canvas aria-label="${safe(names[key])} animated 3D ground scene"></canvas><div class="world-top"><div class="world-title"><b>${safe(names[key])}</b><span>Identical work-order stream</span></div><div class="world-rank">RANK —</div></div><button class="inspect">Inspect ↗</button><div class="world-bottom"><div class="metric"><span>Live cost*</span><b class="cost">0</b></div><div class="metric"><span>On-time cohort</span><b class="ontime">—</b></div><div class="metric"><span>Active · Queue</span><b class="queue">0 · 0</b></div></div>`;host.append(div);const canvas=div.querySelector('canvas');let scene=null;try{scene=new window.RelayV6.GroundScene(canvas,key==='FCFS'?'fcfs':'relay');scene.setMode(viewMode);scene.autoOrbit=false;}catch(e){console.error('3D context error',e);div.insertAdjacentHTML('beforeend','<div class="world-center">3D unavailable in this browser</div>')};worlds[key]={host:div,canvas,scene};div.querySelector('.inspect').addEventListener('click',()=>detailPolicy(key));}
  host.append(worlds[key].host)}
 needsPaint=true;
 $('viewSwitch').textContent=viewMode==='3D'?'2D ↑':'3D ◈';}
function update(s){
 if (last && s.tick < last.tick) flightTime=0;
 needsPaint=true;
 last=s;let active=!!s.running;$('pulse').className='pulse'+(active?' on':'');$('runText').textContent=active?'ALL RUNNING':'ALL PAUSED';$('tick').textContent=String(s.tick).padStart(5,'0');$('speedMeasured').textContent=`Verified ${csv(s.actual_ticks_per_second,2)} ticks/s`;
 $('speedStatus').textContent=`${s.speed_requested||1}× / ${csv(2*(s.actual_ticks_per_second||0),1)}×`;
 $('speed').value=s.speed_requested;$('wx').textContent=s.weather;$('orderCount').textContent=csv(s.common_orders_generated);
 $('scenario').value=s.scenario;
 let sorted=Object.values(s.worlds).slice().sort((a,b)=>a.live_censored_cost-b.live_censored_cost);
 $('bestCost').textContent=s.tick>0?`${names[sorted[0].policy]} · ${csv(sorted[0].live_censored_cost,1)}`:'—';
 let best=Object.values(s.worlds).slice().sort((a,b)=>(b.on_time_pct??0)-(a.on_time_pct??0));$('bestSla').textContent=s.common_orders_generated?`${names[best[0].policy]} · ${csv(best[0].on_time_pct,1)}%`:'—';
 let latest=s.events?.at(-1);if(latest&&latestSeq!==latest.seq){latestSeq=latest.seq;$('latestEvent').textContent=latest.kind+' · '+latest.message;$('eventDetail').textContent=`TICK ${latest.tick} · COMMON EVENT`;}
 let currentRank=1;for(let index=0;index<sorted.length;index++){if(index && sorted[index].live_censored_cost>sorted[index-1].live_censored_cost+1e-8)currentRank=index+1;let o=worlds[sorted[index].policy];if(o)o.host.querySelector('.world-rank').textContent=s.common_orders_generated?`COST RANK #${currentRank}`:'COST RANK —'}
 for(let key of visible){const w=worlds[key],p=s.worlds[key];if(!w||!p)continue;w.host.querySelector('.cost').textContent=csv(p.live_censored_cost,1);w.host.querySelector('.ontime').textContent=s.common_orders_generated?`${csv(p.on_time_pct,1)}%`:'—';w.host.querySelector('.queue').textContent=`${p.active} · ${p.waiting}`;
 if(w.scene){w.scene.state={objects:p.objects,waiting:p.waiting,active:p.active,completed:p.completed};w.scene.hour=(6+s.tick/3)%24;w.scene.weather=s.weather;w.scene.incident=['STORM','FOG'].includes(s.weather);w.scene.running=!!s.running;w.scene.actualTicksPerSecond=s.actual_ticks_per_second;w.scene.requestedSpeed=s.speed_requested;w.scene.simTick=s.tick;w.scene.sceneControls={handlers:s.config.handlers,stands:s.config.stands,cold_bays:s.config.cold_bays,warehouseLevels:6,ambientVehicles:Math.min(14,Math.ceil(s.config.handlers*1.5))};}}
 if(lastTick!==s.tick){for(const k of keys){history[k]??=[];history[k].push({t:s.tick,cost:s.worlds[k].live_censored_cost});if(history[k].length>400)history[k].shift()}lastTick=s.tick;}
 if(s.error)notify('Simulation error: '+s.error);
}
async function poll(){try{let s=await api('/v12/api/state');update(s)}catch(e){$('runText').textContent='BACKEND OFFLINE';console.warn(e)}}
function animation(t) {
 requestAnimationFrame(animation);
 const dt = Math.min(.15, (t - (lastFrame ?? t)) / 1000);
 lastFrame = t;
 if (window.RELAY_QA_NO_RENDER) return;
 if (last?.running) flightTime += dt;
 if (t - lastPaint < 32) return;
 const cameraChanged = visible.some(key => worlds[key]?.scene?.interaction.lastInput > lastPaint);
 if (!last?.running && !needsPaint && !cameraChanged) return;
 lastPaint = t;
 needsPaint = false;
 for (const key of visible) {
  const world = worlds[key];
  try { world.scene?.render(t, flightTime); }
  catch (error) {
   console.error('Scene rendering failed', key, error);
   world.scene = null;
   world.host.insertAdjacentHTML('beforeend','<div class="world-center">Scene unavailable in this browser</div>');
  }
 }
}
function reveal(title,html){$('drawerTitle').textContent=title;$('drawerBody').innerHTML=html;$('dim').hidden=false;$('drawer').hidden=false}
function hide(){$('drawer').hidden=true;$('dim').hidden=true}
function metric(label,value){return `<div class="row"><span>${safe(label)}</span><b>${safe(value)}</b></div>`}
function detailPolicy(key){if(!last)return;const p=last.worlds[key],events=last.events.filter(e=>e.policy===key).slice(-14).reverse();let h=`<h3>${safe(names[key])} · LIVE stage</h3><p>All policy worlds process the same new cargo and weather events. Live cost = accrued plus provisional unresolved penalty if the episode ended right now. Not a validated airline cost forecast.</p>`;
 h+=metric('Admitted work orders',last.common_orders_generated)+metric('Completed',p.completed)+metric('Active now',p.active)+metric('Waiting',p.waiting)+metric('On-time (full admitted cohort)',p.on_time_pct+'%')+metric('Cost if ended at this tick',csv(p.live_censored_cost,2)+' model units')+metric('Accrued cost',csv(p.accrued_cost,2)+' model units')+metric('Unresolved penalty now',csv(p.unresolved_penalty_if_ended_now,2)+' model units')+metric('Savings vs FCFS now',csv(p.saving_vs_fcfs_pct,2)+'%')+metric('Selection algorithm',p.dispatch_status||'—')+metric('Mean selection runtime',p.mean_selection_ms+' ms');
 h+='<h3>Current scheduled work</h3><p>'+(p.last_selected.length?p.last_selected.map(safe).join(', '):'No jobs selected this tick')+'</p><h3>Recent policy dispatches</h3>'+(events.length?events.map(e=>metric(`Tick ${e.tick}`,e.message)).join(''):'<p>No dispatch event yet.</p>');reveal(names[key],h)}
function eventDrawer(){if(!last)return;let ev=last.events.slice().reverse();reveal('Common input & policy event feed','<h3>Latest shared events</h3><p>One shared server clock. Some dispatch decisions are policy-specific, while arrivals/disruptions are shared.</p>'+ev.map(e=>metric(`T${e.tick} · ${e.kind}`,e.message)).join(''))}
function settingsDrawer(){if(!last)return;const c=last.config;
 reveal('Shared scenario settings',`<p>Every change applies to all five policy worlds simultaneously, not just the currently visible ones.</p><form id="settingsForm"><div class="row">Orders/tick <input id="configRate" type="number" step="any" min="0.1" max="8" value="${c.arrival_rate}"></div><div class="row">Handlers <input id="configHandlers" type="number" min="1" max="12" value="${c.handlers}"></div><div class="row">Aircraft stands <input id="configStands" type="number" min="1" max="12" value="${c.stands}"></div><div class="row">Cold bays <input id="configCold" type="number" min="0" max="6" value="${c.cold_bays}"></div><div class="row">Weather-event probability <input id="configChaos" type="number" min="0" max="1" step="any" value="${last.chaos}"></div><button class="btn primary" type="submit" style="margin-top:18px">Apply to ALL worlds</button></form>`);
 $('settingsForm').onsubmit=async e=>{e.preventDefault();try{await act('configure',{arrival_rate:+$('configRate').value,handlers:+$('configHandlers').value,stands:+$('configStands').value,cold_bays:+$('configCold').value,chaos:+$('configChaos').value});hide();notify('Shared resource settings updated')}catch{}};
}
function incidentDrawer(){let h='<p>Inject a synthetic disruption into the shared event tape. It affects every policy world on the next dispatch cycle.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
 for(let k of ['RAIN','STORM','FOG','CLEAR','CREW_SHORTAGE','COLD_OUTAGE','DEMAND_SURGE'])h+=`<button class="btn" data-incident="${k}" style="padding:16px">${k.replaceAll('_',' ')}</button>`;h+='</div>';
 reveal('Inject a common disruption',h);$('drawerBody').querySelectorAll('[data-incident]').forEach(el=>el.onclick=async()=>{try{await act('incident',{incident:el.dataset.incident});hide();notify('Event injected: '+el.dataset.incident)}catch{}})}
async function benchmarkDrawer(){reveal('Independent five-strategy holdout','<p>Loading benchmark results…</p>');try{const d=await api('/v12/api/benchmark');let h=`<p>Five strategies, six synthetic scenarios, ${d.episodes_per_scenario} matched cohorts/scenario. All strategies replay identical arrivals. This is staging-policy evidence, not airline ROI or proof of all three models.</p>`;
 for(let scenario of d.scenarios){let rows=d.results.filter(x=>x.scenario===scenario);h+=`<h3>${safe(scenario.replaceAll('_',' '))}</h3><table><thead><tr><th>Strategy</th><th>Cost Δ</th><th>On time</th><th>Worse episodes</th></tr></thead><tbody>`+rows.map(x=>`<tr><td>${safe(x.label)}</td><td>${x.cost_reduction_pct>0?'+':''}${x.cost_reduction_pct}%</td><td>${x.on_time_pct}%</td><td>${x.worse_than_fcfs_pct}%</td></tr>`).join('')+'</tbody></table>'}
 $('drawerBody').innerHTML=h}catch(e){$('drawerBody').textContent='Benchmark unavailable: '+e.message}}
$('start').onclick=()=>act('start').catch(()=>{});$('pause').onclick=()=>act('pause').catch(()=>{});$('step').onclick=()=>act('step',{count:1}).catch(()=>{});$('stepTen').onclick=()=>act('step',{count:10}).catch(()=>{});
$('reset').onclick=()=>{let was=last?.running;act('reset',{scenario:$('scenario').value}).then(()=>{if(was)act('start')}).catch(()=>{})};
$('speed').onchange=e=>act('speed',{speed:+e.target.value}).catch(()=>{});
$('scenario').onchange=async e=>{let was=last?.running;try{await act('pause');await act('reset',{scenario:e.target.value});if(was)await act('start');notify('Experiment reset to '+e.target.value)}catch{}};
$('settingsBtn').onclick=settingsDrawer;$('incidentBtn').onclick=incidentDrawer;$('eventsBtn').onclick=eventDrawer;$('benchmarkBtn').onclick=benchmarkDrawer;
$('viewSwitch').onclick=()=>{viewMode=viewMode==='3D'?'2D':'3D';for(let w of Object.values(worlds))w.scene?.setMode(viewMode);$('viewSwitch').textContent=viewMode==='3D'?'2D ↑':'3D ◈'};
$('closeDrawer').onclick=hide;$('dim').onclick=hide;document.addEventListener('keydown',e=>{if(e.key==='Escape')hide()});
window.addEventListener('resize',()=>{needsPaint=true});
buildSelectors();layout();poll();setInterval(()=>poll(),750);requestAnimationFrame(animation);
})();
