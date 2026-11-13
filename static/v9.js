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
function showTab(name){if(!['ground','tower','customer','chat'].includes(name))return;currentTab=name;if($('simulationControls'))closePops();$$('.screen').forEach(x=>x.classList.toggle('active',x.id===name+'-screen'));$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));try{history.replaceState(null,'','#'+name)}catch{/* embedded QA / file origin */}if(state)render(state);}
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
 (window.RELAY_TOWER?.render||renderTower)(s,baseline,relay,delta,statusLabel);renderCustomer(s);v9Render(s);window.RELAY_V10?.render(s,{selectedAwb,currentTab,globe,worlds});if(v.worker_error)toast('Simulation stopped: '+v.worker_error,true);
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
 if(window.RELAY_CUSTOMER){window.RELAY_CUSTOMER.render(s,selectedAwb,globe);return;}
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
const disruptionScenarios = {
 crew: {handlers:1},
 cold: {cold_bays:0},
 demand: {rate:5},
 normal: {rate:2,handlers:3,cold_bays:1,stands:3,chaos:.2,weather:'CLEAR'},
 peak: {rate:5,handlers:3,cold_bays:1,stands:5,chaos:.35,weather:'CLEAR'},
 storm: {rate:4,handlers:4,cold_bays:1,stands:5,chaos:.5,weather:'STORM'},
};
function advanceConfig(){
 const config = {rate:+$('rate').value,chaos:+$('chaos').value,handlers:+$('crew').value,cold_bays:+$('cold').value,stands:+$('stands').value};
 if(!$('applyWeather'))config.weather=$('weather').value;
 return config;
}
function applyDisruptionSettings(settings,message){
 closePops();
 $('injectBtn').focus();
 action('/v11/api/control',{action:'tune',...settings},message);
}
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
const EVENT_STREAM_TITLE='Event stream';
const STREAM_ICONS={
 play:'<path d="M7 4.8c0-.93 1.02-1.5 1.81-1.01l11.4 7.2c.73.46.73 1.55 0 2.01l-11.4 7.2A1.19 1.19 0 0 1 7 19.2V4.8z"/>',
 pause:'<line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>',
 reset:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
 gauge:'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
 swap:'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
 sliders:'<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
 cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
 zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
 trendUp:'<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
 package:'<path d="M11 21.73a2 2 0 0 0 2 0l7.5-4.06a2 2 0 0 0 1-1.74V7.82a2 2 0 0 0-1-1.74L13 2.03a2 2 0 0 0-2 0L3.5 6.08a2 2 0 0 0-1 1.74v8.11a2 2 0 0 0 1 1.74z"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/>',
 plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
 check:'<path d="M20 6 9 17l-5-5"/>',
 refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
 shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
 eye:'<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
 arrow:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
 x:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
 ready:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
 dot:'<circle cx="12" cy="12" r="9"/>',
};
const streamIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STREAM_ICONS[name]||STREAM_ICONS.dot}</svg>`;
const EVENT_TYPES=new Map([
 ['READY',['Simulation ready','ready','neutral']],
 ['PLAY',['Simulation started','play','neutral']],
 ['PAUSE',['Simulation paused','pause','neutral']],
 ['RESET',['Simulation reset','reset','neutral']],
 ['SPEED',['Speed changed','gauge','neutral']],
 ['MODE',['Review mode changed','swap','neutral']],
 ['TUNE',['Scenario adjusted','sliders','neutral']],
 ['WEATHER',['Weather changed','cloud','blue']],
 ['DISRUPTION',['Disruption','zap','red']],
 ['RECOVERY_WINDOW',['Recovery window','trendUp','green']],
 ['ARRIVAL',['Cargo inbound','package','blue']],
 ['ORDER',['New shipment','plus','blue']],
 ['COMPLETED',['Ground work completed','check','green']],
 ['MODEL',['Decision recalculated','refresh','purple']],
 ['AUTO_SHADOW',['Auto-approved in sandbox','shield','purple']],
 ['REVIEW_REQUIRED',['Review needed','eye','amber']],
 ['REVIEW',['Supervisor review','eye','amber']],
 ['TASK',['Handoff updated','arrow','green']],
 ['ERROR',['Engine error','x','red']],
]);
function streamEvents(s){return (s?.unified_events||[]).filter(e=>e.kind!=='CLOCK')}
function eventStreamMarkup(events){
 const rows=events.slice().reverse().map(e=>{
  const [label,icon,tone]=EVENT_TYPES.get(e.kind)||[String(e.kind||'Event').replaceAll('_',' '),'dot','neutral'];
  return `<li class="event-stream-row ledger-row">
    <span class="event-stream-icon" data-tone="${tone}" aria-hidden="true">${streamIcon(icon)}</span>
    <div><b>${esc(label)}</b><p>${esc(e.message)}</p>
      <small><time datetime="${esc(e.at||'')}">${esc(when(e.at))}</time> · Tick ${esc(e.tick)}</small>
    </div>
  </li>`;
 });
 return '<p>Times use the simulation clock.</p>'+(rows.length
  ? '<ul class="event-stream-list">'+rows.join('')+'</ul>'
  : '<p>No events recorded yet.</p>');
}
async function showEvidence(kind){if(kind==='events'){
 const events=streamEvents(state);
 drawer(EVENT_STREAM_TITLE,eventStreamMarkup(events));
 $('drawerContent').dataset.seq=String(events.at(-1)?.seq||0);
 return;
}
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
if($('simulationControls')){
 document.addEventListener('click',event=>{
  if(!event.target.closest('.control-anchor'))closePops();
 });
 document.querySelector('#ground-screen .worlds').addEventListener('pointerdown',closePops);
}
for(let id of ['rate','crew','cold','stands','chaos']){$(id).addEventListener('input',()=>txt(({rate:'rateN',crew:'crewN',cold:'coldN',stands:'standsN',chaos:'chaosN'})[id],id==='chaos'?Math.round(+$('chaos').value*100)+'%':$(''+id).value))}
$('applySettings').addEventListener('click',()=>{closePops();ctrl('tune',advanceConfig())});
$('applyWeather')?.addEventListener('click',()=>applyDisruptionSettings({weather:$('weather').value},'Weather scenario updated'));
$$('[data-scenario]').forEach(b=>b.addEventListener('click',()=>{
 applyDisruptionSettings(disruptionScenarios[b.dataset.scenario],b.textContent+' applied to both ground simulations');
}));
$$('[data-incident]').forEach(b=>b.addEventListener('click',()=>{
 closePops();
 $('injectBtn').focus();
 action('/v11/api/incident',{kind:b.dataset.incident},b.textContent.trim()+' recorded in the shared simulation');
}));
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
$('portfolioItems').addEventListener('click',e=>{const p=e.target.closest('[data-awb]');if(!p)return;selectedAwb=p.dataset.awb;if(state)renderCustomer(state);fetchState()});
$('portfolioItems').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName!=='BUTTON'){let p=e.target.closest('[data-awb]');if(p){selectedAwb=p.dataset.awb;if(state)renderCustomer(state);fetchState()}}});
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
 const selectedWeather=v.weather_mode==='AUTO'?'AUTO':(cfg.weather||'CLEAR');
 const editingWeather=$('applyWeather')&&!$('incidentPop').hidden;
 if(!editingWeather&&document.activeElement!==$('weather'))$('weather').value=selectedWeather;
 const editingResources=$('applyWeather')&&!$('settingsPop').hidden;
 if(!editingResources)for(let [id,key] of [['rate','rate'],['crew','handlers'],['cold','cold_bays'],['stands','stands'],['chaos','chaos']]){
   const el=$(id), value=cfg[key];
   if(!el||document.activeElement===el||value==null)continue;
   el.value=value;
   el.dispatchEvent(new Event('input'));
 }
 let t9=new Date(s.clock);if(!Number.isNaN(+t9))lightHour=(t9.getUTCHours()+8+t9.getUTCMinutes()/60+t9.getUTCSeconds()/3600)%24;worlds.forEach(w=>{w.state=p[w.name]||{objects:[]};w.sceneControls={...cfg,handlers:s.resources?.handlers??cfg.handlers,stands:s.resources?.stands??cfg.stands,cold_bays:s.resources?.cold_bays??cfg.cold_bays,configured:cfg,...v9VisualSettings};w.weather=cfg.weather||'CLEAR';w.simTick=s.tick;w.running=!!v.running;w.requestedSpeed=v.speed_target||1;w.actualTicksPerSecond=tps;w.incident=Boolean(s.latest_event&&s.tick>=0);w.autoOrbit=v9Orbit});
 let events=streamEvents(s);let last=events.at(-1)?.seq||0;
 if(last>v9LastEvent){const arrivals=events.filter(e=>e.seq>v9LastEvent);v9LastEvent=last;const mount=$('eventLive');const fresh=arrivals.slice(-3);if(mount)for(let e of fresh){const el=document.createElement('div');el.innerHTML=v9LogCard(e);el.className='v9-event-animation';mount.prepend(el);while(mount.children.length>3)mount.lastElementChild.remove();setTimeout(()=>{el.classList.add('aging')},4800)}}
 // Live drawers must re-render IN PLACE, without requiring close/reopen.
 if(!$('drawer').hidden&&$('drawerTitle').textContent===EVENT_STREAM_TITLE){
  const content=$('drawerContent'),seq=String(last);
  if(content.dataset.seq!==seq){content.innerHTML=eventStreamMarkup(events);content.dataset.seq=seq}
 }
 if(!$('drawer').hidden&&$('drawerTitle').textContent.startsWith('Customer journey')){const c=s.customer_projection;if(c&&$('drawerContent').dataset.journeySeq!==String(c.journey_events?.length||0)){let box=$('drawerContent');box.innerHTML='<p>Live synthetic customer milestones; internal approval does not confirm an airline route.</p>'+((c.journey_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind)}</b>${esc(e.message)}<br><small>${esc(when(e.at))} · ${esc(e.authority)}</small></div>`).join(''));box.dataset.journeySeq=String(c.journey_events?.length||0)}}
 if(s.tick!==v9LastTick){v9LastTick=s.tick;$('tickPill').classList.remove('tick-flash');void $('tickPill').offsetWidth;$('tickPill').classList.add('tick-flash')}
}
function v9View(mode){worlds.forEach(w=>w.setMode?.(mode));$('view3D').classList.toggle('selected',mode==='3D');$('view2D').classList.toggle('selected',mode==='2D');$('view3D').setAttribute('aria-pressed',mode==='3D');$('view2D').setAttribute('aria-pressed',mode==='2D')}
$('fleet')?.addEventListener('input',()=>{v9VisualSettings.ambientVehicles=+$('fleet').value;txt('fleetN',String(v9VisualSettings.ambientVehicles));worlds.forEach(w=>w.sceneControls={...w.sceneControls,...v9VisualSettings})});
$('floors')?.addEventListener('input',()=>{v9VisualSettings.warehouseLevels=+$('floors').value;txt('floorsN',String(v9VisualSettings.warehouseLevels));worlds.forEach(w=>w.sceneControls={...w.sceneControls,...v9VisualSettings})});
$('view3D').addEventListener('click',()=>v9View('3D'));$('view2D').addEventListener('click',()=>v9View('2D'));
$('orbitBtn').addEventListener('click',()=>{v9Orbit=!v9Orbit;worlds.forEach(w=>w.autoOrbit=v9Orbit);$('orbitBtn').classList.toggle('selected',v9Orbit);$('orbitBtn').setAttribute('aria-pressed',String(v9Orbit))});
$('cameraReset').addEventListener('click',()=>{worlds.forEach(w=>{w.canvas.dispatchEvent(new Event('dblclick'))});toast('Ground camera reset')});
function setPreset({handlers,cold_bays,...values}){
 for(const [id,value] of Object.entries({...values,crew:handlers,cold:cold_bays})){
   $(id).value=value;
   $(id).dispatchEvent(new Event('input'));
 }
}
$('presetNormal')?.addEventListener('click',()=>setPreset(disruptionScenarios.normal));
$('presetPeak')?.addEventListener('click',()=>setPreset(disruptionScenarios.peak));
$('presetStorm')?.addEventListener('click',()=>setPreset(disruptionScenarios.storm));

requestAnimationFrame(animate);
{const q=new URLSearchParams(location.search),embed=document.documentElement.dataset.embed;if(embed)selectedAwb=q.get('awb');showTab(embed||(['ground','tower','customer','chat'].includes(location.hash.slice(1))?location.hash.slice(1):'ground'));}
fetchState().then(()=>{toast('Synchronized synthetic engine connected')});setInterval(fetchState,950);
})();
