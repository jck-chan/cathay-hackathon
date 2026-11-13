/* RELAY 8 · one server-owned clock, one canonical synthetic store, three projections.
   Never animates a confirmed aircraft position or presents a proposal as a booking. */
(()=>{'use strict';
const $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)],
 esc=x=>String(x??'—').replace(/[&<>"']/g,t=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[t])),
 num=(x,d=0)=>Number.isFinite(Number(x))?Number(x).toLocaleString('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d}):'—',
 when=s=>{if(!s)return 'Not available';const d=new Date(s);return isNaN(d)?s:d.toLocaleString('en-GB',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC'},
 txt=(id,value)=>{const e=$(id);if(e)e.textContent=value??'—';};
let state=null,selectedAwb=null,currentTab='ground',pollBusy=false,actionBusy=false,toastTimer=0,drawStart=performance.now(),lightHour=11;
const query=new URLSearchParams(location.search), embed=document.documentElement.dataset.embed;
const sandboxPickers=$$('[data-sandbox-picker]'), sandboxDialog=$('createSandbox');
const embeddedSandbox=embed&&(query.get('sandbox_id')||(embed==='ground'&&query.get('world')))||null;
const singleGround=embed==='ground'&&embeddedSandbox;
const sandboxIds=singleGround?[embeddedSandbox]:[null,null];
const groundStates=new Map(), groundErrors=new Map();
let sandboxList=[], createSlot=0, creatingSandbox=false, refreshPending=false, sandboxRevision=0, dashboardSandboxId=embeddedSandbox;
const worlds=[new RelayV6.GroundScene($('baselineWorld'),'fcfs')];
if(!singleGround)worlds.push(new RelayV6.GroundScene($('relayWorld'),'relay'));
const globe=new RelayV6.CustomerGlobe($('customerGlobe'));
function toast(message,bad=false){let t=$('toast');t.textContent=message;t.classList.toggle('error',bad);t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3700)}
// Capture network-initiating buttons, including dynamically inserted controls.
let requestOrigin=null;
const requestsPerButton=new WeakMap(),buttonWasDisabled=new WeakMap();
function setRequestOrigin(button){
 if(!button||button.disabled)return;
 requestOrigin=button;
 queueMicrotask(()=>{if(requestOrigin===button)requestOrigin=null});
}
document.addEventListener('click',event=>setRequestOrigin(event.target.closest('button')),true);
document.addEventListener('submit',event=>setRequestOrigin(event.submitter),true);
function pendingButton(button,start){
 if(!button)return;
 const count=requestsPerButton.get(button)||0;
 if(start){
  if(!count){buttonWasDisabled.set(button,button.disabled);button.disabled=true;button.dataset.requestPending='true';button.setAttribute('aria-busy','true')}
  requestsPerButton.set(button,count+1);
 }else if(count<=1){
  requestsPerButton.delete(button);delete button.dataset.requestPending;button.removeAttribute('aria-busy');
  button.disabled=buttonWasDisabled.get(button)??false;buttonWasDisabled.delete(button);
 }else requestsPerButton.set(button,count-1);
}
async function api(path,method='GET',payload){const button=requestOrigin;pendingButton(button,true);let c=new AbortController(),tm=setTimeout(()=>c.abort(),25000);try{let r=await fetch(path,{method,signal:c.signal,cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});let t=await r.text();let o;try{o=JSON.parse(t)}catch{o={detail:t.slice(0,250)}}if(!r.ok)throw Error(typeof o.detail==='string'?o.detail:JSON.stringify(o.detail||o).slice(0,270));return o}finally{clearTimeout(tm);pendingButton(button,false)}}
function showTab(name){if(!['ground','tower','customer','chat'].includes(name))return;currentTab=name;if($('simulationControls'))closePops();$$('.screen').forEach(x=>x.classList.toggle('active',x.id===name+'-screen'));$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));try{history.replaceState(null,'','#'+name)}catch{/* embedded QA / file origin */}if(state)render(state);if(sandboxDialog)refreshState();}
let returnFocus=null;
function drawer(title,html,{popup=false}={}){
 returnFocus=document.activeElement;const panel=$('drawer');panel.classList.toggle('order-popup',popup);
 const eyebrow=$('drawerEyebrow');if(eyebrow)eyebrow.textContent=popup?'NEW REQUEST':'DETAILED EVIDENCE';
 txt('drawerTitle',title);$('drawerContent').innerHTML=html;panel.hidden=false;$('backdrop').hidden=false;
 (popup?$('drawerContent').querySelector('select,input'):$('closeDrawer'))?.focus();
}
function closeDrawer(){const panel=$('drawer'),open=!panel.hidden;panel.hidden=true;$('backdrop').hidden=true;panel.classList.remove('order-popup');if(open&&returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}
const JOURNEY_EVENT_LABELS = {
 INTERNAL_APPROVE: 'Internal approval (simulated)',
 GROUND_QUEUED: 'Ground processing queued',
 RECOVERY_PROPOSED: 'Recovery proposed',
 RCS: 'Cargo received',
};
function journeyEventLabel(e) {
 const kind = String(e.kind || e.code || '');
 return JOURNEY_EVENT_LABELS[kind] || (kind ? kind.toLowerCase().replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Shipment update');
}
function journeyEventRows(events) {
 return (events || []).slice().reverse().map(e => `<div class="ledger-row"><b>${esc(journeyEventLabel(e))}</b>${esc(e.message)}<br><small>${esc(when(e.at))}</small></div>`).join('');
}
function statusLabel(d){if(!d)return 'Preparing model';if(d.stale)return 'Recalculation required';if(d.approval_blocked_external_evidence)return 'Verify flight observation';if(d.model_ii?.cases?.some(x=>x.action==='HOLD'))return 'Hold & verify dimensions';let n=d.proposed_actions?.length||0;if(n)return 'Review '+n+' recovery option'+(n!==1?'s':'');return 'Continue current plan'}
function render(s){state=s;window.dispatchEvent(new CustomEvent('relay:state',{detail:s}));const v=s.v8||{},d=s.decision||{},baseline=s.policies?.fcfs||{},relay=s.policies?.relay||{};
 renderPlayback(groundReference()||s);
 txt('ordersNumber',s.work_orders_total);txt('queuesNumber',relay.waiting);txt('crewNumber',s.resources.handlers);
 $('autonomy').value=v.mode||'AUTO_SHADOW';txt('navCount',(d.proposed_actions||[]).length);txt('groundNarrative',v.worker_error?'Simulation error: '+v.worker_error:'One operational clock · Three synchronized perspectives · Scenario version '+s.snapshot_version);
 let evt=s.latest_event;txt('incidentSummary',evt?`${evt.event_type.replaceAll('_',' ')} · ${evt.entity_id}`:document.querySelector('.v11-workspace')?'No material disruption recorded':'◉ No material disruption recorded');
 let costA=baseline.cost_units||0,costB=relay.cost_units||0,delta=costA-costB;
 txt('costBefore',num(costA,1));txt('costAfter',num(costB,1));txt('costDelta',(delta>=0?'+':'')+num(delta,1));txt('decisionHeadline',statusLabel(d));
 txt('decisionExplain',d?.proposed_actions?.length?`${d.proposed_actions.length} tentative route change(s). Internal review is not carrier confirmation.`:d?.model_ii?.affected_shipments?.length?'Verification decisions are gating uncertain shipments.':'Network and ground queue recomputed from shared synthetic events.');
 if($('ctCompareTitle'))$('ctCompareTitle').closest('article').hidden=!(s.policies?.fcfs&&s.policies?.relay);
 (window.RELAY_TOWER?.render||renderTower)(s,baseline,relay,delta,statusLabel);renderCustomer(s);v9Render(s);window.RELAY_V10?.render(s,{selectedAwb,currentTab,globe,worlds});if(v.worker_error)toast('Simulation stopped: '+v.worker_error,true);
}
function renderPlayback(s){
 const v=s.v8||{}, running=sandboxDialog&&currentTab==='ground'?
   sandboxIds.some(id=>groundStates.get(id)?.v8.running):v.running;
 txt('clock',when(s.clock));if(s.clock&&$('simulationControls'))$('clock').dateTime=s.clock;txt('simTime',when(s.clock));txt('liveState',running?'RUNNING':'PAUSED');$('statusPulse').classList.toggle('on',running);
 txt('achieved',`${num(v.actual_ticks_per_second,1)} ticks/s actual`);$('speed').value=String(v.speed_target||1);
 const play=$('globalPlay'),playLabel=play.querySelector('.control-label');
 if(playLabel){play.dataset.running=String(Boolean(running));playLabel.textContent=sandboxDialog&&currentTab!=='ground'?(running?'Pause':'Start'):(running?'Pause all':'Start all')}
 else{play.textContent=running?'❚❚ Pause all':'▶ Start all'}
 txt('tickPill','TICK '+s.tick);
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
function scopedPath(path,id=embeddedSandbox,params={}){
 const search=new URLSearchParams(params);
 if(id)search.set('sandbox_id',id);
 return search.size?path+'?'+search:path;
}
function visibleSandboxIds(){return [...new Set(sandboxIds.filter(Boolean))]}
function groundReference(){return currentTab==='ground'?groundStates.get(sandboxIds[0]):null}
function refreshState(){
 if(pollBusy||actionBusy)refreshPending=true;
 else fetchState();
}
function updateSandboxOptions(){
 sandboxPickers.slice(0,sandboxIds.length).forEach((picker,slot)=>{
  const selectedId=sandboxIds[slot];
  const trigger=picker.querySelector('.sandbox-trigger');
  const options=picker.querySelector('.sandbox-options');
  const focused=document.activeElement;
  const focusedId=options.contains(focused)?focused.dataset.sandboxId:null;
  const rows=sandboxList.map(s=>{
   const row=document.createElement('div');
   row.className='sandbox-row';
   row.innerHTML='<button type="button" class="sandbox-option"><span></span><small></small></button>'+
    '<button type="button" class="sandbox-delete"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4m2-4v4"/></svg></button>';
   const [option,remove]=row.children;
   option.dataset.sandboxId=remove.dataset.sandboxId=s.id;
   option.setAttribute('aria-current',String(s.id===selectedId));
   option.querySelector('span').textContent=s.name;
   option.querySelector('small').textContent=s.model_name;
   remove.setAttribute('aria-label','Delete '+s.name);
   remove.title='Delete '+s.name;
   return row;
  });
  options.replaceChildren(...rows);
  const selected=sandboxList.find(s=>s.id===selectedId);
  trigger.querySelector('[data-sandbox-name]').textContent=selected?.name||'Choose sandbox';
  const model=trigger.querySelector('[data-sandbox-model]');
  model.textContent=selected?.model_name||'';
  model.hidden=!selected;
  trigger.disabled=false;
  if(focusedId){
   const replacement=[...options.querySelectorAll('button')].find(b=>b.dataset.sandboxId===focusedId&&b.className===focused.className);
   (replacement||picker.querySelector('[data-create-sandbox]')).focus();
  }
 });
}
function syncSandboxList(list){
 const changed=JSON.stringify(list)!==JSON.stringify(sandboxList);
 sandboxList=list;
 sandboxIds.forEach((id,slot)=>{
  if(!list.some(s=>s.id===id))sandboxIds[slot]=list[slot]?.id||list[0]?.id||null;
 });
 if(changed||sandboxPickers[0].querySelector('.sandbox-trigger').disabled)updateSandboxOptions();
}
function selectSandbox(slot,id){
 sandboxIds[slot]=id;
 updateSandboxOptions();
 renderGround();
 refreshState();
}
async function pollGround(){
 const revision=sandboxRevision;
 const list=await api('/v11/api/sandboxes');
 if(revision!==sandboxRevision)return;
 syncSandboxList(list);
 const ids=visibleSandboxIds();
 const results=await Promise.allSettled(ids.map(id=>api('/v11/api/sandboxes/'+encodeURIComponent(id)+'/ground')));
 groundStates.clear();
 groundErrors.clear();
 results.forEach((result,index)=>{
  if(result.status==='fulfilled')groundStates.set(ids[index],result.value);
  else groundErrors.set(ids[index],result.reason.message);
 });
 renderGround();
}
async function fetchState(){
 if(pollBusy||actionBusy)return;
 pollBusy=true;
 try{
  const ground=sandboxDialog&&currentTab==='ground';
  const [dashboard]=await Promise.allSettled([
   ground&&embed?null:api(scopedPath('/v11/api/state',dashboardSandboxId,selectedAwb?{awb:selectedAwb}:{})),
   ground?pollGround().catch(e=>{console.error(e);if(!sandboxList.length)sandboxPickers.forEach(picker=>{picker.querySelector('[data-sandbox-name]').textContent='Sandboxes unavailable'})}):null,
  ]);
  if(dashboard.status==='rejected')throw dashboard.reason;
  if(dashboard.value)render(dashboard.value);
  else if(groundReference())renderPlayback(groundReference());
 }catch(e){txt('liveState','OFFLINE');$('statusPulse').classList.remove('on');console.error(e)}
 finally{
  pollBusy=false;
  if(refreshPending){refreshPending=false;refreshState()}
 }
}
async function action(path,body,success,ids=[dashboardSandboxId]){
 if(actionBusy)return;
 actionBusy=true;
 try{
  const results=await Promise.allSettled(ids.map(id=>api(scopedPath(path,id),'POST',body)));
  if(!sandboxDialog&&results[0]?.status==='fulfilled'){
   const data=results[0].value;
   render(data.state||data);
  }
  const failure=results.find(r=>r.status==='rejected');
  if(failure)toast(failure.reason.message,true);
  else if(success)toast(success);
 }finally{
  actionBusy=false;
  if(sandboxDialog)refreshState();
 }
}
function groundTargets(){return sandboxDialog&&currentTab==='ground'?visibleSandboxIds():[embeddedSandbox]}
async function ctrl(actionName,more={}){
 const ids=['mode','recalculate'].includes(actionName)?[dashboardSandboxId]:groundTargets();
 const message=sandboxDialog?null:({start:'All three Twins are now running on one clock',pause:'Shared simulation paused'})[actionName];
 await action('/v11/api/control',{action:actionName,...more},message,ids);
}
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
 action('/v11/api/control',{action:'tune',...settings},message,groundTargets());
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
 const events=streamEvents(groundReference()||state);
 drawer(EVENT_STREAM_TITLE,eventStreamMarkup(events));
 $('drawerContent').dataset.seq=String(events.at(-1)?.seq||0);
 return;
}
 if(kind==='journey'){let c=state?.customer_projection;details('Customer journey · '+(c?.awb||'—'),`<p>Observed synthetic milestones stay separate from simulated ground actions and tentative routing.</p>${journeyEventRows(c?.journey_events)}`);return}
 if(kind==='math'||['model_i','model_ii','model_iii'].includes(kind)){let d=state?.decision||{},k=kind==='math'?'model_iii':kind;details(kind==='math'?'Mathematical decision trace':'Inspect '+k.toUpperCase(),`<p>Model I = bounded 2D arrangement; Model II = one-step Bayesian verification; Model III = finite-column capacity MILP.</p><pre>${esc(JSON.stringify(kind==='math'?d:d[k]||{},null,2))}</pre><button class="btn soft" id="fullEvidence">Load source provenance ↗</button>`);return}
 if(kind==='audit'||kind==='source'){details(kind==='audit'?'Runtime integrity audit':'OAG / dataset provenance','<p>Running audit against the canonical synthetic event store…</p>');try{let r=await api(scopedPath(kind==='audit'?'/v11/api/audit':'/v11/api/evidence',groundReference()?sandboxIds[0]:embeddedSandbox));$('drawerContent').innerHTML=explainIntro()+'<pre>'+esc(JSON.stringify(r,null,2))+'</pre>'}catch(e){$('drawerContent').textContent=e.message}return}
 if(kind==='tasks'){details('Simulated team handoffs',(state?.tasks||[]).map(t=>`<div class="ledger-row"><b>${esc(t.shipment_id)} · ${esc(t.task_type||'Ground handoff')}</b>${esc(t.status)}</div>`).join('')||'No simulated tasks.');return}
}
function newOrderForm(){const currentId=dashboardSandboxId||state?.sandbox_id||embeddedSandbox||sandboxIds[0]||'relay';const currentName=sandboxList.find(s=>s.id===currentId)?.name||'current sandbox';drawer('New synthetic cargo request',`<p>This creates a synthetic cargo request, not a real airline booking. Choose one sandbox or all existing sandboxes.</p><form id="orderForm"><label>Destination<select name="destination"><option value="NRT">Tokyo · NRT</option><option value="LHR">London · LHR</option><option value="SIN">Singapore · SIN</option><option value="SYD">Sydney · SYD</option><option value="FRA">Frankfurt · FRA</option><option value="BKK">Bangkok · BKK</option><option value="LAX">Los Angeles · LAX</option><option value="DXB">Dubai · DXB</option></select></label><label>Weight (kg)<input name="weight_kg" type="number" required min="10" max="450" value="125"></label><label>Service<select name="service"><option value="PRIORITY">Priority</option><option value="STANDARD">Standard</option><option value="CRITICAL">Critical</option></select></label><label>Handling<select name="handling"><option value="GENERAL">General</option><option value="COL">Cold chain</option></select></label><div class="fieldgrid"><label>Length cm<input name="length_cm" type="number" value="70" min="15" max="180"></label><label>Width cm<input name="width_cm" type="number" value="55" min="15" max="180"></label><label>Height cm<input name="height_cm" type="number" value="45" min="15" max="180"></label></div><p id="orderError" class="order-error" role="alert" hidden></p><div class="order-actions"><button type="submit" class="btn soft" name="scope" value="current">Create order in ${esc(currentName)}</button><button type="submit" class="btn primary" name="scope" value="all">Create order in all sandboxes</button></div></form>`,{popup:true});$('orderForm').dataset.sandboxId=currentId;}
$$('.tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
$('globalPlay').addEventListener('click',()=>ctrl($('globalPlay').dataset.running==='true'||!sandboxDialog&&state?.v8.running?'pause':'start'));
$('speed').addEventListener('change',()=>ctrl('speed',{speed:+$('speed').value}));
$('stepOnce').addEventListener('click',()=>ctrl('step',{count:1}));
$('resetBtn').addEventListener('click',()=>{if(confirm(sandboxDialog&&currentTab==='ground'?'Reset the displayed sandboxes?':'Reset synthetic orders, decisions and ground states for all three Twins?'))ctrl('reset')});
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
 applyDisruptionSettings(disruptionScenarios[b.dataset.scenario],b.textContent+' applied');
}));
$$('[data-incident]').forEach(b=>b.addEventListener('click',()=>{
 closePops();
 $('injectBtn').focus();
 action('/v11/api/incident',{kind:b.dataset.incident},b.textContent.trim()+' recorded',groundTargets());
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
$('drawerContent').addEventListener('submit',async event=>{
 const form=event.target;if(form.id!=='orderForm')return;event.preventDefault();
 const buttons=[...form.querySelectorAll('button[type="submit"]')];if(buttons.some(button=>button.disabled))return;
 const scope=event.submitter?.value==='all'?'all':'current',currentId=form.dataset.sandboxId;
 const data=Object.fromEntries(new FormData(form).entries());
 for(const key of ['weight_kg','length_cm','width_cm','height_cm'])data[key]=Number(data[key]);
 buttons.forEach(button=>{button.disabled=true;button.dataset.requestPending='true';button.setAttribute('aria-busy','true')});
 const error=$('orderError');error.hidden=true;
 try{
  const out=await api(scope==='all'?'/v11/api/order/all':scopedPath('/v11/api/order',currentId),'POST',data);
  if(scope==='all'&&!out.complete){
   error.textContent=`Created in ${out.created_count}/${out.target_count} sandboxes. ${out.failed.map(item=>`${item.sandbox_name}: ${item.error}`).join('; ')}. Check results before retrying to avoid duplicates.`;
   error.hidden=false;toast('Order partially created; inspect the details',true);return;
  }
  selectedAwb=out.awb;dashboardSandboxId=currentId;closeDrawer();await fetchState();
  toast(scope==='all'?`Order ${out.awb} created in all ${out.created_count} sandboxes`:`Order ${out.awb} created in ${sandboxList.find(item=>item.id===currentId)?.name||'current sandbox'}`);
 }catch(err){error.textContent=err.message;error.hidden=false;toast(err.message,true)}
 finally{buttons.forEach(button=>{button.disabled=false;delete button.dataset.requestPending;button.removeAttribute('aria-busy')})}
});
if(sandboxDialog){
 window.addEventListener('relay:show-ground-sandbox',event=>{
  selectSandbox(0,event.detail);
  showTab('ground');
 });
 const form=sandboxDialog.querySelector('form');
 const input=$('sandboxName'), error=$('sandboxError'), cancel=$('cancelSandbox'), models=$('sandboxModels');
 const submit=form.querySelector('[type="submit"]');
 async function openCreate(slot){
  createSlot=slot;
  form.reset();
  error.hidden=true;
  sandboxDialog.showModal();
  if(models.childElementCount)return;
  submit.disabled=true;
  try{
   const available=await api('/v11/api/sandbox-models');
   models.replaceChildren(...Object.entries(available).map(([id,name])=>{
    const label=document.createElement('label'), radio=document.createElement('input');
    radio.type='radio';
    radio.name='policy';
    radio.value=id;
    radio.required=true;
    label.append(radio,' '+name);
    return label;
   }));
   submit.disabled=false;
  }catch(e){error.textContent=e.message;error.hidden=false}
 }
 $$('[data-create-empty-sandbox]').forEach((button,slot)=>{
  button.addEventListener('click',()=>openCreate(slot));
 });
 function setMenu(picker,open){
  picker.querySelector('.sandbox-trigger').setAttribute('aria-expanded',String(open));
  picker.querySelector('.sandbox-menu').hidden=!open;
 }
 document.addEventListener('click',event=>{
  sandboxPickers.forEach(picker=>{if(!picker.contains(event.target))setMenu(picker,false)});
 });
 sandboxPickers.forEach((picker,slot)=>{
  const trigger=picker.querySelector('.sandbox-trigger');
  const menu=picker.querySelector('.sandbox-menu');
  trigger.addEventListener('click',()=>setMenu(picker,menu.hidden));
  picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget))setMenu(picker,false)});
  picker.addEventListener('keydown',event=>{
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();
    const buttons=[...menu.querySelectorAll('button:not(:disabled)')];
    const step=event.key==='ArrowDown'?1:-1;
    const index=buttons.indexOf(document.activeElement);
    setMenu(picker,true);
    buttons[index<0?(step===1?0:buttons.length-1):(index+step+buttons.length)%buttons.length]?.focus();
   }
   if(event.key==='Escape'&&!menu.hidden){
    event.preventDefault();
    event.stopPropagation();
    setMenu(picker,false);
    trigger.focus();
   }
  });
  menu.addEventListener('click',async event=>{
   const button=event.target.closest('button');
   if(!button)return;
   const id=button.dataset.sandboxId;
   if(button.matches('.sandbox-delete')){
    const sandbox=sandboxList.find(s=>s.id===id);
    if(!sandbox||!confirm(`Delete “${sandbox.name}” and its simulation state?`))return;
    button.disabled=true;
    try{
     await api('/v11/api/sandboxes/'+encodeURIComponent(id),'DELETE');
     sandboxRevision++;
     if(!menu.hidden)picker.querySelector('[data-create-sandbox]').focus();
     syncSandboxList(sandboxList.filter(s=>s.id!==id));
     renderGround();
     if(!sandboxIds[slot])picker.parentElement.querySelector('[data-create-empty-sandbox]').focus();
     refreshState();
    }catch(e){toast(e.message,true)}
    finally{button.disabled=false}
    return;
   }
   setMenu(picker,false);
   trigger.focus();
   if(id){selectSandbox(slot,id);return}
   openCreate(slot);
  });
 });
 cancel.addEventListener('click',()=>sandboxDialog.close());
 sandboxDialog.addEventListener('cancel',event=>{if(creatingSandbox)event.preventDefault()});
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(creatingSandbox||submit.disabled)return;
  creatingSandbox=true;
  const fields=[...form.elements];
  const payload=Object.fromEntries(new FormData(form));
  fields.forEach(field=>{field.disabled=true});
  error.hidden=true;
  try{
   const sandbox=await api('/v11/api/sandboxes','POST',payload);
   sandboxRevision++;
   if(!sandboxList.some(s=>s.id===sandbox.id))sandboxList.push(sandbox);
   selectSandbox(createSlot,sandbox.id);
   sandboxDialog.close();
   sandboxPickers[createSlot].querySelector('.sandbox-trigger').focus();
  }catch(e){error.textContent=e.message;error.hidden=false}
  finally{creatingSandbox=false;fields.forEach(field=>{field.disabled=false});if(sandboxDialog.open)input.focus()}
 });
}
function animate(t){const dt=Math.min(Math.max(t-drawStart,0),250);drawStart=t;recordV9Fps(dt);if(state?.v8.running)lightHour=(lightHour+dt/1000*Math.max(0,state.v8.actual_ticks_per_second||0)/6)%24;
 worlds.forEach(w=>{if(!sandboxDialog)w.hour=lightHour;if(currentTab==='ground'&&!w.canvas.hidden)w.render(t)});if(currentTab==='customer')globe.render(t);window.RELAY_V10?.frame(t,{currentTab,worlds,globe});requestAnimationFrame(animate)}

// V9 presentation-only integration: observable ticks are server-authoritative.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
let v9LastEvent=0,v9LastTick=-1,v9VisualSettings={ambientVehicles:4,warehouseLevels:7},v9FrameStart=performance.now(),v9FrameCount=0,v9Fps=0,v9Orbit=false;
function recordV9Fps(dt){v9FrameCount++;if(performance.now()-v9FrameStart>=1000){v9Fps=Math.round(v9FrameCount*1000/(performance.now()-v9FrameStart));v9FrameCount=0;v9FrameStart=performance.now();txt('renderFps',v9Fps)}}
function v9LogCard(e){let label=({'DISRUPTION':'Disruption','MODEL':'Decision recalculated','AUTO_SHADOW':'Auto review','ORDER':'New order','TASK':'Handoff','CLOCK':'Clock advance','TUNE':'Resources updated','ERROR':'Simulation error'})[e.kind]||e.kind;return `<div class="v9-toast-item ${e.kind==='ERROR'||e.kind==='DISRUPTION'?'warn':''}"><span class="v9-event-dot"></span><div><strong>${esc(label)}</strong><small>${esc(e.message).slice(0,100)}</small></div><span class="v9-event-tick">T${e.tick}</span></div>`}
function renderGround(){
 if(!sandboxDialog)return;
 sandboxIds.forEach((id,slot)=>{
  const s=groundStates.get(id), ground=s?.ground, v=s?.v8, cfg=v?.config;
  const world=worlds[slot], footer=slot===0?'baselineFooter':'relayFooter';
  world.canvas.hidden=!id;
  if(world.planCanvas)world.planCanvas.hidden=!id;
  if(world.weatherCanvas)world.weatherCanvas.hidden=!id;
  $(footer).hidden=!id;
  sandboxPickers[slot].hidden=!id;
  world.canvas.parentElement.querySelector('.sandbox-empty').hidden=Boolean(id);
  if(world.sandboxId!==id){
   world.sandboxId=id;
   world.ops.reset();
  }
  world.state=ground||{objects:[]};
  world.sceneControls={...cfg,...s?.resources,configured:cfg,...v9VisualSettings};
  world.weather=cfg?.weather||'CLEAR';
  world.simTick=s?.tick??0;
  world.running=Boolean(v?.running);
  world.requestedSpeed=v?.speed_target||1;
  world.actualTicksPerSecond=v?.actual_ticks_per_second||0;
  world.incident=Boolean(s?.latest_event);
  world.autoOrbit=v9Orbit;
  const clock=new Date(s?.clock);
  if(!Number.isNaN(+clock))world.hour=(clock.getUTCHours()+8+clock.getUTCMinutes()/60)%24;
  txt(footer,groundErrors.get(id)||v?.worker_error||
   (ground?`Tick ${s.tick} · ${v.running?'Running':'Paused'} · ${ground.active} moving · ${ground.completed} completed`:'Loading sandbox…'));
 });
 const reference=groundReference();
 if(reference){
  renderPlayback(reference);
  renderEnvironment(reference.v8);
 }
}
function renderEnvironment(v){
 const cfg=v.config||{};
 const selectedWeather=v.weather_mode==='AUTO'?'AUTO':(cfg.weather||'CLEAR');
 if(!($('applyWeather')&&!$('incidentPop').hidden)&&document.activeElement!==$('weather'))$('weather').value=selectedWeather;
 if(!($('applyWeather')&&!$('settingsPop').hidden))for(const [id,key] of [['rate','rate'],['crew','handlers'],['cold','cold_bays'],['stands','stands'],['chaos','chaos']]){
  const el=$(id), value=cfg[key];
  if(!el||document.activeElement===el||value==null)continue;
  el.value=value;
  el.dispatchEvent(new Event('input'));
 }
}
function v9Render(s){let badge=document.querySelector('.brand small');if(badge&&!$('simulationControls'))badge.textContent=worlds[0].gl?'DIGITAL TWIN / V10 · WebGL2':'DIGITAL TWIN / V10 · Canvas fallback';let v=s.v8||{},cfg=v.config||{},p=s.policies||{},tps=Math.max(0,Number(v.actual_ticks_per_second||0)),req=Math.max(1,Number(v.target_ticks_per_second||.5));
 const actual=tps/.5;txt('speedActual',num(actual,1)+'×');txt('speedRequested',String(v.speed_target||1)+'×');txt('speedScope',`Tick ${s.tick} · ${num(tps,2)} completed ticks/s · ${v.running?'running':'paused'}`);
 let bar=$('speedBar');if(bar)bar.style.width=clamp(100*tps/req,0,100)+'%';$('simHeartbeat')?.classList.toggle('on',Boolean(v.running));
 txt('flowArrivals',s.work_orders_total||0);txt('flowActive',(p.fcfs?.active||0)+(p.relay?.active||0));txt('flowFinished',p.relay?.completed||0);
 if(!sandboxDialog){
  renderEnvironment(v);
  txt('baselineFooter',`${p.fcfs?.active||0} moving · ${p.fcfs?.completed||0} completed · ${p.fcfs?.blocked||0} blocked`);
  txt('relayFooter',`${p.relay?.active||0} moving · ${p.relay?.completed||0} completed · ${p.relay?.blocked||0} blocked`);
  let t9=new Date(s.clock);if(!Number.isNaN(+t9))lightHour=(t9.getUTCHours()+8+t9.getUTCMinutes()/60+t9.getUTCSeconds()/3600)%24;worlds.forEach(w=>{w.state=p[w.name]||{objects:[]};w.sceneControls={...cfg,handlers:s.resources?.handlers??cfg.handlers,stands:s.resources?.stands??cfg.stands,cold_bays:s.resources?.cold_bays??cfg.cold_bays,configured:cfg,...v9VisualSettings};w.weather=cfg.weather||'CLEAR';w.simTick=s.tick;w.running=!!v.running;w.requestedSpeed=v.speed_target||1;w.actualTicksPerSecond=tps;w.incident=Boolean(s.latest_event&&s.tick>=0);w.autoOrbit=v9Orbit});
 }
 let events=streamEvents(s);let last=events.at(-1)?.seq||0;
 if(last>v9LastEvent){const arrivals=events.filter(e=>e.seq>v9LastEvent);v9LastEvent=last;const mount=$('eventLive');const fresh=arrivals.slice(-3);if(mount)for(let e of fresh){const el=document.createElement('div');el.innerHTML=v9LogCard(e);el.className='v9-event-animation';mount.prepend(el);while(mount.children.length>3)mount.lastElementChild.remove();setTimeout(()=>{el.classList.add('aging')},4800)}}
 // Live drawers must re-render IN PLACE, without requiring close/reopen.
 if(!$('drawer').hidden&&$('drawerTitle').textContent===EVENT_STREAM_TITLE){
  const content=$('drawerContent'),reference=groundReference(),rows=reference?streamEvents(reference):events;
  const seq=JSON.stringify([reference?sandboxIds[0]:embeddedSandbox,rows.at(-1)?.seq]);
  if(content.dataset.seq!==seq){content.innerHTML=eventStreamMarkup(rows);content.dataset.seq=seq}
 }
 if(!$('drawer').hidden&&$('drawerTitle').textContent.startsWith('Customer journey')){const c=s.customer_projection;if(c&&$('drawerContent').dataset.journeySeq!==String(c.journey_events?.length||0)){let box=$('drawerContent');box.innerHTML='<p>Live synthetic customer milestones; internal approval does not confirm an airline route.</p>'+journeyEventRows(c.journey_events);box.dataset.journeySeq=String(c.journey_events?.length||0)}}
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
if(embed)selectedAwb=query.get('awb');
showTab(embed||(['ground','tower','customer','chat'].includes(location.hash.slice(1))?location.hash.slice(1):'ground'));
if(!sandboxDialog)fetchState().then(()=>{toast('Synchronized synthetic engine connected')});
setInterval(fetchState,950);
})();
