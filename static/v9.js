/* RELAY 8 · one server-owned clock, one canonical synthetic store, three projections.
   Never animates a confirmed aircraft position or presents a proposal as a booking. */
(()=>{'use strict';
const $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)],
 esc=x=>String(x??'—').replace(/[&<>"']/g,t=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[t])),
 num=(x,d=0)=>Number.isFinite(Number(x))?Number(x).toLocaleString('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d}):'—',
 when=s=>{if(!s)return 'Not available';const d=new Date(s);return isNaN(d)?s:d.toLocaleString('en-GB',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC'},
 txt=(id,value)=>{const e=$(id);if(e)e.textContent=value??'—';};
let state=null,selectedAwb=null,currentTab='ground',pollBusy=false,actionBusy=false,lastSeq=-1,toastTimer=0,drawStart=performance.now(),lightHour=11;
const worlds=[new RelayV6.GroundScene($('baselineWorld'),'fcfs'),new RelayV6.GroundScene($('relayWorld'),'relay')],globe=new RelayV6.CustomerGlobe($('customerGlobe'));
function toast(message,bad=false){let t=$('toast');t.textContent=message;t.classList.toggle('error',bad);t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3700)}
async function api(path,method='GET',payload){let c=new AbortController(),tm=setTimeout(()=>c.abort(),25000);try{let r=await fetch(path,{method,signal:c.signal,cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});let t=await r.text();let o;try{o=JSON.parse(t)}catch{o={detail:t.slice(0,250)}}if(!r.ok)throw Error(typeof o.detail==='string'?o.detail:JSON.stringify(o.detail||o).slice(0,270));return o}finally{clearTimeout(tm)}}
function showTab(name){if(!['ground','tower','customer','chat'].includes(name))return;currentTab=name;const controls=$('groundControls');if(controls){closePops();controls.hidden=name!=='ground'}$$('.screen').forEach(x=>x.classList.toggle('active',x.id===name+'-screen'));$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));try{history.replaceState(null,'','#'+name)}catch{/* embedded QA / file origin */}if(state)render(state);}
function drawer(title,html){txt('drawerTitle',title);$('drawerContent').innerHTML=html;$('drawer').hidden=false;$('backdrop').hidden=false;$('closeDrawer').focus()}
function closeDrawer(){$('drawer').hidden=true;$('backdrop').hidden=true}
function statusLabel(d){if(!d)return 'Preparing model';if(d.stale)return 'Recalculation required';if(d.approval_blocked_external_evidence)return 'Verify flight observation';if(d.model_ii?.cases?.some(x=>x.action==='HOLD'))return 'Hold & verify dimensions';let n=d.proposed_actions?.length||0;if(n)return 'Review '+n+' recovery option'+(n!==1?'s':'');return 'Continue current plan'}
function render(s){state=s;window.dispatchEvent(new CustomEvent('relay:state',{detail:s}));const v=s.v8||{},d=s.decision||{},baseline=s.policies?.fcfs||{},relay=s.policies?.relay||{};
 txt('clock',when(s.clock));if(s.clock&&$('simulationControls'))$('clock').dateTime=s.clock;txt('simTime',when(s.clock));txt('liveState',v.running?'RUNNING':'PAUSED');$('statusPulse').classList.toggle('on',v.running);
 txt('achieved',`${num(v.actual_ticks_per_second,1)} ticks/s actual`);$('speed').value=String(v.speed_target||1);
 $('globalPlay').textContent=v.running?'❚❚ Pause all':'▶ Start all';txt('tickPill','TICK '+s.tick);txt('ordersNumber',s.work_orders_total);txt('queuesNumber',relay.waiting);txt('crewNumber',s.resources.handlers);
 $('autonomy').value=v.mode||'AUTO_SHADOW';txt('navCount',(d.proposed_actions||[]).length);txt('groundNarrative',v.worker_error?'Simulation error: '+v.worker_error:'One operational clock · Three synchronized perspectives · Scenario version '+s.snapshot_version);
 let evt=s.latest_event;txt('incidentSummary',evt?`${evt.event_type.replaceAll('_',' ')} · ${evt.entity_id}`:'◉ No material disruption recorded');
 let costA=baseline.cost_units||0,costB=relay.cost_units||0,delta=costA-costB;
 txt('costBefore',num(costA,1));txt('costAfter',num(costB,1));txt('costDelta',(delta>=0?'+':'')+num(delta,1));txt('decisionHeadline',statusLabel(d));
 txt('decisionExplain',d?.proposed_actions?.length?`${d.proposed_actions.length} tentative route change(s). Internal review is not carrier confirmation.`:d?.model_ii?.affected_shipments?.length?'Verification decisions are gating uncertain shipments.':'Network and ground queue recomputed from shared synthetic events.');
 txt('baselineFooter',`${baseline.active||0} moving · ${baseline.completed||0} completed · ${baseline.blocked||0} blocked`);
 txt('relayFooter',`${relay.active||0} moving · ${relay.completed||0} completed · ${relay.blocked||0} blocked`);
 worlds[0].state=baseline;worlds[1].state=relay;worlds.forEach(x=>x.incident=Boolean(evt && s.tick>=0));
 renderTower(s,baseline,relay,delta);renderCustomer(s);v9Render(s);window.RELAY_V10?.render(s,{selectedAwb,currentTab,globe,worlds});if(v.worker_error)toast('Simulation stopped: '+v.worker_error,true);
}
function renderTower(s,a,b,delta){const d=s.decision||{},v=s.v8||{};
 let cards=(s.unified_events||[]).filter(x=>!['CLOCK','READY','PAUSE','PLAY','SPEED','MODE'].includes(x.kind)).slice(-3).reverse();
 $('eventsGrid').innerHTML=cards.length?cards.map(e=>`<article class="event-card ${['DISRUPTION','REVIEW_REQUIRED','ERROR'].includes(e.kind)?'alert':''}"><small>${esc(e.kind)} · TICK ${e.tick}</small><h4>${esc(e.message.split(' · ')[0].slice(0,72))}</h4><p>${esc(e.message.slice(0,115))}</p></article>`).join(''):'<div class="empty-card">The clock is ready. Start the simulation or create an order.</div>';
 txt('eventCounter',s.unified_events?.length+' RECENT');txt('towerDecision',statusLabel(d));txt('towerStatus',d.status||'NO DECISION');
 txt('towerRationale',d.stale?'Source data changed after this calculation. Recompute before approval.':`${d.proposed_actions?.length||0} tentative route changes · ${d.solver_runtime_ms?num(d.solver_runtime_ms,1):'—'}ms solve · ${v.mode==='AUTO_SHADOW'?'Auto-shadow active':'Human review mode'}`);
 txt('towerBefore',num(a.cost_units||0,1));txt('towerAfter',num(b.cost_units||0,1));txt('towerBeforeDone',a.completed||0);txt('towerAfterDone',b.completed||0);
 txt('towerBeforeMiss',a.missed_work_order_targets||0);txt('towerAfterMiss',b.missed_work_order_targets||0);
 txt('towerImpact',delta>0?'RELAY saved '+num(delta,1)+' synthetic staging cost units':delta<0?'RELAY costs '+num(-delta,1)+' more than FCFS in this run':'Policies currently tied · Keep monitoring');
 txt('iSummary',`2D · ${d.model_i?.status||'Not available'}`);txt('iiSummary',`${d.model_ii?.cases?.length||0} cases · one-step Bayes`);txt('iiiSummary',`${d.model_iii?.candidate_columns||0} route candidates · scoped MILP`);
 txt('actionTitle',statusLabel(d));txt('actionText',d.stale?'The decision has become stale and cannot be approved.':v.mode==='AUTO_SHADOW'?'The engine automatically evaluates and may simulate low-risk internal approval. It never books cargo or loads aircraft.':v.mode==='ADVISORY'?'Observe recommendations without accepting changes.':'A supervisor must choose whether to simulate the proposed work orders.');
 txt('impactedCount',d.proposed_actions?.length||0);txt('scopeCount',`${s.decision_scope?.evaluated??0} / ${s.decision_scope?.eligible??0}`);
 txt('reviewState',(d.stale?'STALE':d.status||'NONE').replaceAll('_',' '));
 const can=Boolean(d.id&&d.status==='PENDING_REVIEW'&&!d.stale&&!d.approval_blocked_external_evidence&&(d.proposed_actions||[]).length);
 $('approveBtn').disabled=!can||v.mode==='ADVISORY';$('rejectBtn').disabled=!can||v.mode==='ADVISORY';
 txt('taskCounter',s.tasks?.length||0);
 $('taskCards').innerHTML=(s.tasks||[]).length?(s.tasks||[]).slice(0,7).map(t=>`<div class="task-row"><b>${esc(t.shipment_id)} · ${esc(t.task_type||t.type||'Team handoff')}</b><small>${esc(t.status||'PENDING')} · synthetic task</small>${['PENDING','ACKNOWLEDGED','READY','OPEN','QUEUED_SIMULATED'].includes(t.status)?`<button data-task="${esc(t.id)}">Mark done</button>`:''}</div>`).join(''):'<div class="empty-card">Auto-approved synthetic work orders appear here after the decision gate.</div>';
}
function renderCustomer(s){let list=s.shipment_objects||[];if(!selectedAwb||!list.some(x=>x.awb===selectedAwb))selectedAwb=list[0]?.awb||null;
 txt('portfolioCount',list.length);let q=$('filterShipments').value.toLowerCase().trim();let shown=list.filter(x=>(x.awb+' '+x.destination).toLowerCase().includes(q));
 $('portfolioItems').innerHTML=shown.length?shown.map(x=>{let risk=x.blocked_reason||x.dimension_conflict||x.customs_hold;return `<div class="shipment-card ${x.awb===selectedAwb?'active':''}" data-awb="${esc(x.awb)}" role="button" tabindex="0"><div class="ship-top"><b>${esc(x.awb)}</b><span class="ship-marker ${risk?'risk':''}"></span></div><p>HKG → ${esc(x.destination)} · ${esc(x.handling)} · ${num(x.weight_kg)} kg</p><small>${esc(x.stage_relay||'RECEIVED')} ${risk?'· Needs attention':''}</small></div>`}).join(''):'<div class="empty-card">No matching shipments.</div>';
 let customer=s.customer_projection;
 if(!customer||customer.awb!==selectedAwb){if(selectedAwb&&!pollBusy)fetchState();return;}
 txt('shipAwb',customer.awb);txt('shipRoute',`${customer.origin} → ${customer.destination}`);txt('globeRoute',`${customer.origin} → ${customer.destination}`);txt('shipStatus',customer.status||'SIMULATED');
 let eta=customer.estimated_arrival_utc;txt('shipEta',customer.eta_past_due_without_arrival_confirmation?'Original ETA overdue · verification required':'Recorded ETA: '+when(eta));
 if(globe.route[0]!==customer.origin||globe.route[1]!==customer.destination)globe.setRoute(customer.origin,customer.destination);globe.setRoutes?.(list,selectedAwb);
 let phase=customer.ground_twin?.phase||'NOT_IN_STAGING',rd=customer.route_decision||{};
 const stages=[['Request received',true,'Synthetic accepted order'],['Ground processing',['WORK','DONE'].includes(phase)||phase==='HOLD',phase.replaceAll('_',' ')],['Recovery decision',Boolean(rd.tentative_alternative_flights?.length),rd.review_status?.replaceAll('_',' ')||'No recovery proposed'],['Carrier confirmed',Boolean(rd.carrier_confirmed),rd.carrier_confirmed?'Confirmed by carrier':'External approval missing']];
 let currentIndex=stages.findIndex(x=>!x[1]);if(currentIndex<0)currentIndex=stages.length;
 $('journeySteps').innerHTML=stages.map(([n,done,sub],i)=>`<div class="stepnode ${done?'done':i===currentIndex?'now':''}"><b>${esc(n)}</b><small>${esc(sub)}</small></div>`).join('');
 let last=customer.journey_events?.at(-1);
 txt('shipHeadline',last?.kind?.replaceAll('_',' ')||customer.ground_twin?.phase_label||'Order observed');
 txt('shipUpdate',last?.message||customer.customer_service_message||'No new synthetic milestones recorded yet.');
 txt('shipWarning',rd.tentative_alternative_flights?.length?`Candidate: ${rd.tentative_alternative_flights.join(' → ')} · ${rd.review_status.replaceAll('_',' ')}. This is NOT a confirmed carrier route.`:'No carrier confirmation or real customer notification is performed by RELAY.');
}
async function fetchState(){if(pollBusy)return;pollBusy=true;try{const d=await api('/v11/api/state'+(selectedAwb?'?awb='+encodeURIComponent(selectedAwb):''));if(d.v8.sequence!==lastSeq){lastSeq=d.v8.sequence;render(d)}else{render(d)}}catch(e){txt('liveState','OFFLINE');$('statusPulse').classList.remove('on');console.error(e)}finally{pollBusy=false}}
async function action(path,body,success){if(actionBusy)return;actionBusy=true;try{const d=await api(path,'POST',body);render(d.state||d);if(success)toast(success)}catch(e){toast(e.message,true)}finally{actionBusy=false}}
async function ctrl(actionName,more={}){await action('/v11/api/control',{action:actionName,...more},actionName==='start'?'All three Twins are now running on one clock':actionName==='pause'?'Shared simulation paused':null)}
function advanceConfig(){return {rate:+$('rate').value,chaos:+$('chaos').value,handlers:+$('crew').value,cold_bays:+$('cold').value,stands:+$('stands').value,weather:$('weather').value}}
function setPop(id, open) {
 const panel = $(id);
 if (!panel) return;
 panel.hidden = !open;
 document.querySelector(`[aria-controls="${id}"]`)?.setAttribute('aria-expanded',String(open));
}
function closePops() {
 for (const id of ['settingsPop','incidentPop','viewSettingsPop']) setPop(id,false);
}
function showPop(id) {
 const open = $(id).hidden;
 closePops();
 setPop(id,open);
}
function explainIntro(){return '<p><b>Scope:</b> 30 days of generated data; staging queue + finite MILP + one-step Bayesian model. No airline inventory booking, ULD safety certificate or real customer notifications.</p>'}
function details(title,body){drawer(title,explainIntro()+body)}
async function showEvidence(kind){if(kind==='events'){details('Live input → process → output',`<h3>Unified conductor</h3>${(state?.unified_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind)} · Tick ${e.tick}</b>${esc(e.message)}<br><small>${esc(e.at)} · sequence ${e.seq}</small></div>`).join('')}`);return}
 if(kind==='journey'){let c=state?.customer_projection;details('Customer journey · '+(c?.awb||'—'),`<p>Observed synthetic milestones stay separate from simulated ground actions and tentative routing.</p>${(c?.journey_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind||e.code)} · ${e.observed?'Recorded synthetic source':'Simulated overlay'}</b>${esc(e.message)}<br><small>${esc(when(e.at))} · ${esc(e.authority)}</small></div>`).join('')}`);return}
 if(kind==='math'||['model_i','model_ii','model_iii'].includes(kind)){let d=state?.decision||{},k=kind==='math'?'model_iii':kind;details(kind==='math'?'Mathematical decision trace':'Inspect '+k.toUpperCase(),`<p>Model I = bounded 2D arrangement; Model II = one-step Bayesian verification; Model III = finite-column capacity MILP.</p><pre>${esc(JSON.stringify(kind==='math'?d:d[k]||{},null,2))}</pre><button class="btn soft" id="fullEvidence">Load source provenance ↗</button>`);return}
 if(kind==='audit'||kind==='source'){details(kind==='audit'?'Runtime integrity audit':'OAG / dataset provenance','<p>Running audit against the canonical synthetic event store…</p>');try{let r=await api(kind==='audit'?'/v11/api/audit':'/v11/api/evidence');$('drawerContent').innerHTML=explainIntro()+'<pre>'+esc(JSON.stringify(r,null,2))+'</pre>'}catch(e){$('drawerContent').textContent=e.message}return}
 if(kind==='tasks'){details('Simulated team handoffs',(state?.tasks||[]).map(t=>`<div class="ledger-row"><b>${esc(t.shipment_id)} · ${esc(t.task_type||'Ground handoff')}</b>${esc(t.status)}</div>`).join('')||'No simulated tasks.');return}
}
function newOrderForm(){drawer('New synthetic cargo request',`<p>This form adds a request to the SAME event-sourced catalog used by Ground and Control. It does not create an airline booking.</p><form id="orderForm"><label>Destination<select name="destination"><option value="NRT">Tokyo · NRT</option><option value="LHR">London · LHR</option><option value="SIN">Singapore · SIN</option><option value="SYD">Sydney · SYD</option><option value="FRA">Frankfurt · FRA</option><option value="BKK">Bangkok · BKK</option><option value="LAX">Los Angeles · LAX</option><option value="DXB">Dubai · DXB</option></select></label><label>Weight (kg)<input name="weight_kg" type="number" required min="10" max="450" value="125"></label><label>Service<select name="service"><option value="PRIORITY">Priority</option><option value="STANDARD">Standard</option><option value="CRITICAL">Critical</option></select></label><label>Handling<select name="handling"><option value="GENERAL">General</option><option value="COL">Cold chain</option></select></label><div class="fieldgrid"><label>Length cm<input name="length_cm" type="number" value="70" min="15" max="180"></label><label>Width cm<input name="width_cm" type="number" value="55" min="15" max="180"></label><label>Height cm<input name="height_cm" type="number" value="45" min="15" max="180"></label></div><button type="submit" class="btn primary full">Create & send to all Twins</button></form>`)}
$$('.tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
$('globalPlay').addEventListener('click',()=>ctrl(state?.v8.running?'pause':'start'));
$('speed').addEventListener('change',()=>ctrl('speed',{speed:+$('speed').value}));
$('stepOnce').addEventListener('click',()=>ctrl('step',{count:1}));
$('resetBtn').addEventListener('click',()=>{if(confirm('Reset synthetic orders, decisions and ground states for all three Twins?'))ctrl('reset',{seed:2048})});
$('settingsBtn').addEventListener('click',()=>showPop('settingsPop'));
$('injectBtn').addEventListener('click',()=>showPop('incidentPop'));
$('viewSettingsBtn')?.addEventListener('click',()=>showPop('viewSettingsPop'));
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>{
 setPop(button.dataset.close,false);
 document.querySelector(`[aria-controls="${button.dataset.close}"]`)?.focus();
}));
$('simulationControls')?.addEventListener('click',event=>{
 if(!event.target.closest('.control-anchor'))closePops();
});
if($('simulationControls'))$('ground-screen').addEventListener('pointerdown',closePops);
for(let id of ['rate','crew','cold','stands','chaos']){$(id).addEventListener('input',()=>txt(({rate:'rateN',crew:'crewN',cold:'coldN',stands:'standsN',chaos:'chaosN'})[id],id==='chaos'?Math.round(+$('chaos').value*100)+'%':$(''+id).value))}
$('applySettings').addEventListener('click',()=>{closePops();ctrl('tune',advanceConfig())});
$$('[data-incident]').forEach(b=>b.addEventListener('click',()=>{closePops();action('/v11/api/incident',{kind:b.dataset.incident},'Disruption propagated to all three views')}));
$('seeDecision')?.addEventListener('click',()=>showTab('tower'));
$('whyGround')?.addEventListener('click',()=>showEvidence('math'));
$('logsBtn').addEventListener('click',()=>showEvidence('events'));
$('allEvents').addEventListener('click',()=>showEvidence('events'));
$('viewMath').addEventListener('click',()=>showEvidence('math'));
$('auditBtn').addEventListener('click',()=>showEvidence('audit'));
$('recalculate').addEventListener('click',()=>ctrl('recalculate'));
$('autonomy').addEventListener('change',()=>ctrl('mode',{mode:$('autonomy').value}));
$$('[data-inspect]').forEach(b=>b.addEventListener('click',()=>showEvidence(b.dataset.inspect)));
$('taskCards').addEventListener('click',e=>{const b=e.target.closest('[data-task]');if(b)action('/v11/api/tasks/'+encodeURIComponent(b.dataset.task)+'/done',{},'Synthetic team task acknowledged')});
async function review(choice){let d=state?.decision;if(!d)return;let n=d.proposed_actions?.length||0;if(!confirm(`${choice==='approve'?'Approve':'Reject'} ${n} tentative simulated route change(s)?\n\nNo actual airline booking or cargo movement will occur.`))return;await action('/v11/api/review',{decision_id:d.id,choice,expected_snapshot_version:d.snapshot_version},'Simulation-only review recorded')}
$('approveBtn').addEventListener('click',()=>review('approve'));
$('rejectBtn').addEventListener('click',()=>review('reject'));
$('portfolioItems').addEventListener('click',e=>{const p=e.target.closest('[data-awb]');if(!p)return;selectedAwb=p.dataset.awb;fetchState()});
$('portfolioItems').addEventListener('keydown',e=>{if(e.key==='Enter'){let p=e.target.closest('[data-awb]');if(p){selectedAwb=p.dataset.awb;fetchState()}}});
$('filterShipments').addEventListener('input',()=>{if(state)renderCustomer(state)});
$('newOrderBtn').addEventListener('click',newOrderForm);
$('fullJourney').addEventListener('click',()=>showEvidence('journey'));
$('backdrop').addEventListener('click',closeDrawer);$('closeDrawer').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{
 if(e.key!=='Escape')return;
 const open = document.querySelector('.control-popover:not([hidden])');
 closeDrawer();
 closePops();
 if(open)document.querySelector(`[aria-controls="${open.id}"]`)?.focus();
});
$('drawerContent').addEventListener('click',async e=>{if(e.target.id==='fullEvidence')showEvidence('source')});
$('drawerContent').addEventListener('submit',async e=>{if(e.target.id!=='orderForm')return;e.preventDefault();const raw=Object.fromEntries(new FormData(e.target).entries());for(let k of ['weight_kg','length_cm','width_cm','height_cm'])raw[k]=+raw[k];try{let out=await api('/v11/api/order','POST',raw);selectedAwb=out.awb;render(out.state);closeDrawer();toast('New synthetic order '+out.awb+' linked to all three Twins')}catch(x){toast(x.message,true)}});
function animate(t){const dt=Math.min(Math.max(t-drawStart,0),250);drawStart=t;recordV9Fps(dt);if(state?.v8.running)lightHour=(lightHour+dt/1000*Math.max(0,state.v8.actual_ticks_per_second||0)/6)%24;
 worlds.forEach(w=>{w.hour=lightHour;if(currentTab==='ground')w.render(t)});if(currentTab==='customer')globe.render(t);window.RELAY_V10?.frame(t,{currentTab,worlds,globe});requestAnimationFrame(animate)}

// V9 presentation-only integration: observable ticks are server-authoritative.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
let v9LastEvent=0,v9LastTick=-1,v9VisualSettings={ambientVehicles:4,warehouseLevels:7},v9FrameStart=performance.now(),v9FrameCount=0,v9Fps=0,v9Orbit=false;
function recordV9Fps(dt){v9FrameCount++;if(performance.now()-v9FrameStart>=1000){v9Fps=Math.round(v9FrameCount*1000/(performance.now()-v9FrameStart));v9FrameCount=0;v9FrameStart=performance.now();txt('renderFps',v9Fps)}}
function v9LogCard(e){let label=({'DISRUPTION':'Disruption','MODEL':'Decision recalculated','AUTO_SHADOW':'Auto review','ORDER':'New order','TASK':'Handoff','CLOCK':'Clock advance','TUNE':'Resources updated','ERROR':'Simulation error'})[e.kind]||e.kind;return `<div class="v9-toast-item ${e.kind==='ERROR'||e.kind==='DISRUPTION'?'warn':''}"><span class="v9-event-dot"></span><div><strong>${esc(label)}</strong><small>${esc(e.message).slice(0,100)}</small></div><span class="v9-event-tick">T${e.tick}</span></div>`}
function v9Render(s){let badge=document.querySelector('.brand small');if(badge&&!$('simulationControls'))badge.textContent=worlds[0].gl?'DIGITAL TWIN / V10 · WebGL2':'DIGITAL TWIN / V10 · Canvas fallback';let v=s.v8||{},cfg=v.config||{},p=s.policies||{},tps=Math.max(0,Number(v.actual_ticks_per_second||0)),req=Math.max(1,Number(v.target_ticks_per_second||.5));
 const actual=tps/.5;txt('speedActual',num(actual,1)+'×');txt('speedRequested',String(v.speed_target||1)+'×');txt('speedScope',`Tick ${s.tick} · ${num(tps,2)} completed ticks/s · ${v.running?'running':'paused'}`);
 let bar=$('speedBar');if(bar)bar.style.width=clamp(100*tps/req,0,100)+'%';$('simHeartbeat')?.classList.toggle('on',Boolean(v.running));
 txt('flowArrivals',s.work_orders_total||0);txt('flowActive',(p.fcfs?.active||0)+(p.relay?.active||0));txt('flowFinished',p.relay?.completed||0);
 const selectedWeather=v.weather_mode==='AUTO'?'AUTO':(cfg.weather||'CLEAR');if($('weather').value!==selectedWeather&&document.activeElement!==$('weather'))$('weather').value=selectedWeather;
 for(let [id,key] of [['rate','rate'],['crew','handlers'],['cold','cold_bays'],['stands','stands'],['chaos','chaos']]){let el=$(id);if(!el||document.activeElement===el)continue;let n=cfg[key];if(n!=null&&String(el.value)!==String(n))el.value=n}
 let t9=new Date(s.clock);if(!Number.isNaN(+t9))lightHour=(t9.getUTCHours()+8+t9.getUTCMinutes()/60+t9.getUTCSeconds()/3600)%24;worlds.forEach(w=>{w.state=p[w.name]||{objects:[]};w.sceneControls={...cfg,handlers:s.resources?.handlers??cfg.handlers,stands:s.resources?.stands??cfg.stands,...v9VisualSettings};w.weather=cfg.weather||'CLEAR';w.simTick=s.tick;w.running=!!v.running;w.requestedSpeed=v.speed_target||1;w.actualTicksPerSecond=tps;w.incident=Boolean(s.latest_event&&s.tick>=0);w.autoOrbit=v9Orbit});
 let events=(s.unified_events||[]).filter(e=>!['CLOCK'].includes(e.kind));let last=events.at(-1)?.seq||0;
 if(last>v9LastEvent){const arrivals=events.filter(e=>e.seq>v9LastEvent);v9LastEvent=last;const mount=$('eventLive');const fresh=arrivals.slice(-3);if(mount)for(let e of fresh){const el=document.createElement('div');el.innerHTML=v9LogCard(e);el.className='v9-event-animation';mount.prepend(el);while(mount.children.length>3)mount.lastElementChild.remove();setTimeout(()=>{el.classList.add('aging')},4800)}}
 // Live drawers must re-render IN PLACE, without requiring close/reopen.
 if(!$('drawer').hidden&&$('drawerTitle').textContent.startsWith('Live input')){let html='<h3>Latest source → decision → task events</h3>'+((s.unified_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind)} · tick ${e.tick}</b>${esc(e.message)}<br><small>${esc(e.at)} · #${e.seq}</small></div>`).join(''));let c=$('drawerContent');if(c.dataset.seq!==String(v9LastEvent)){c.innerHTML=html;c.dataset.seq=String(v9LastEvent)}}
 if(!$('drawer').hidden&&$('drawerTitle').textContent.startsWith('Customer journey')){const c=s.customer_projection;if(c&&$('drawerContent').dataset.journeySeq!==String(c.journey_events?.length||0)){let box=$('drawerContent');box.innerHTML='<p>Live synthetic customer milestones; internal approval does not confirm an airline route.</p>'+((c.journey_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind)}</b>${esc(e.message)}<br><small>${esc(when(e.at))} · ${esc(e.authority)}</small></div>`).join(''));box.dataset.journeySeq=String(c.journey_events?.length||0)}}
 if(s.tick!==v9LastTick){v9LastTick=s.tick;$('tickPill').classList.remove('tick-flash');void $('tickPill').offsetWidth;$('tickPill').classList.add('tick-flash')}
}
function v9View(mode){worlds.forEach(w=>w.setMode?.(mode));$('view3D').classList.toggle('selected',mode==='3D');$('view2D').classList.toggle('selected',mode==='2D');$('view3D').setAttribute('aria-pressed',mode==='3D');$('view2D').setAttribute('aria-pressed',mode==='2D')}
$('fleet')?.addEventListener('input',()=>{v9VisualSettings.ambientVehicles=+$('fleet').value;txt('fleetN',String(v9VisualSettings.ambientVehicles));worlds.forEach(w=>w.sceneControls={...w.sceneControls,...v9VisualSettings})});
$('floors')?.addEventListener('input',()=>{v9VisualSettings.warehouseLevels=+$('floors').value;txt('floorsN',String(v9VisualSettings.warehouseLevels));worlds.forEach(w=>w.sceneControls={...w.sceneControls,...v9VisualSettings})});
$('view3D').addEventListener('click',()=>v9View('3D'));$('view2D').addEventListener('click',()=>v9View('2D'));
$('orbitBtn').addEventListener('click',()=>{v9Orbit=!v9Orbit;worlds.forEach(w=>w.autoOrbit=v9Orbit);$('orbitBtn').classList.toggle('selected',v9Orbit);$('orbitBtn').setAttribute('aria-pressed',String(v9Orbit))});
$('cameraReset').addEventListener('click',()=>{worlds.forEach(w=>{w.interaction.yaw=-.69;w.interaction.pitch=.72;w.interaction.zoom=1;w.interaction.panX=0;w.interaction.panZ=0;w.interaction.lastInput=performance.now()});toast('Ground camera reset')});
function setPreset(values){for(let [k,v] of Object.entries(values))$(k).value=v;for(let x of ['rate','crew','cold','stands','chaos'])$(x).dispatchEvent(new Event('input'));}
$('presetNormal').addEventListener('click',()=>setPreset({rate:2,crew:3,cold:1,stands:3,chaos:.2,weather:'CLEAR'}));
$('presetPeak').addEventListener('click',()=>setPreset({rate:5,crew:3,cold:1,stands:5,chaos:.35,weather:'CLEAR'}));
$('presetStorm').addEventListener('click',()=>setPreset({rate:4,crew:4,cold:1,stands:5,chaos:.5,weather:'STORM'}));

requestAnimationFrame(animate);
{const q=new URLSearchParams(location.search),embed=document.documentElement.dataset.embed;if(embed)selectedAwb=q.get('awb');showTab(embed||(['ground','tower','customer','chat'].includes(location.hash.slice(1))?location.hash.slice(1):'ground'));}
fetchState().then(()=>{toast('Synchronized synthetic engine connected')});setInterval(fetchState,950);
})();
