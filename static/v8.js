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
const {run:withRequestButton,setDisabled,replaceContents}=window.RelayRequestButton;
async function api(path,method='GET',payload){let c=new AbortController(),tm=setTimeout(()=>c.abort(),25000);try{let r=await fetch(path,{method,signal:c.signal,cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});let t=await r.text();let o;try{o=JSON.parse(t)}catch{o={detail:t.slice(0,250)}}if(!r.ok)throw Error(typeof o.detail==='string'?o.detail:JSON.stringify(o.detail||o).slice(0,270));return o}finally{clearTimeout(tm)}}
function showTab(name){if(!['ground','tower','customer'].includes(name))return;currentTab=name;$$('.screen').forEach(x=>x.classList.toggle('active',x.id===name+'-screen'));function requestClick(button,request){
 button.addEventListener('click',()=>withRequestButton(button,request));
}
$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));try{history.replaceState(null,'','#'+name)}catch{/* embedded QA / file origin */}if(state)render(state);}
function drawer(title,html){txt('drawerTitle',title);$('drawerContent').innerHTML=html;$('drawer').hidden=false;$('backdrop').hidden=false;$('closeDrawer').focus()}
function closeDrawer(){$('drawer').hidden=true;$('backdrop').hidden=true}
function statusLabel(d){if(!d)return 'Preparing model';if(d.stale)return 'Recalculation required';if(d.approval_blocked_external_evidence)return 'Verify flight observation';if(d.model_ii?.cases?.some(x=>x.action==='HOLD'))return 'Hold & verify dimensions';let n=d.proposed_actions?.length||0;if(n)return 'Review '+n+' recovery option'+(n!==1?'s':'');return 'Continue current plan'}
function render(s){state=s;const v=s.v8||{},d=s.decision||{},baseline=s.policies?.fcfs||{},relay=s.policies?.relay||{};
 txt('clock',when(s.clock));txt('simTime',when(s.clock));txt('liveState',v.running?'RUNNING':'PAUSED');$('statusPulse').classList.toggle('on',v.running);
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
 renderTower(s,baseline,relay,delta);renderCustomer(s);if(v.worker_error)toast('Simulation stopped: '+v.worker_error,true);
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
 for(const id of ['approveBtn','rejectBtn'])setDisabled($(id),!can||v.mode==='ADVISORY');
 txt('taskCounter',s.tasks?.length||0);
 replaceContents($('taskCards'),(s.tasks||[]).length?(s.tasks||[]).slice(0,7).map(t=>`<div class="task-row"><b>${esc(t.shipment_id)} · ${esc(t.task_type||t.type||'Team handoff')}</b><small>${esc(t.status||'PENDING')} · synthetic task</small>${['PENDING','ACKNOWLEDGED','READY','OPEN','QUEUED_SIMULATED'].includes(t.status)?`<button data-task="${esc(t.id)}">Mark done</button>`:''}</div>`).join(''):'<div class="empty-card">Auto-approved synthetic work orders appear here after the decision gate.</div>',button=>button.dataset.task);
}
function renderCustomer(s){let list=s.shipment_objects||[];if(!selectedAwb||!list.some(x=>x.awb===selectedAwb))selectedAwb=list[0]?.awb||null;
 txt('portfolioCount',list.length);let q=$('filterShipments').value.toLowerCase().trim();let shown=list.filter(x=>(x.awb+' '+x.destination).toLowerCase().includes(q));
 replaceContents($('portfolioItems'),shown.length?shown.map(x=>{let risk=x.blocked_reason||x.dimension_conflict||x.customs_hold;return `<button type="button" class="shipment-card ${x.awb===selectedAwb?'active':''}" data-awb="${esc(x.awb)}"><span class="ship-top"><b>${esc(x.awb)}</b><span class="ship-marker ${risk?'risk':''}"></span></span><p>HKG → ${esc(x.destination)} · ${esc(x.handling)} · ${num(x.weight_kg)} kg</p><small>${esc(x.stage_relay||'RECEIVED')} ${risk?'· Needs attention':''}</small></button>`}).join(''):'<div class="empty-card">No matching shipments.</div>',button=>button.dataset.awb);
 let customer=s.customer_projection;
 if(!customer||customer.awb!==selectedAwb){if(selectedAwb&&!pollBusy)fetchState();return;}
 txt('shipAwb',customer.awb);txt('shipRoute',`${customer.origin} → ${customer.destination}`);txt('globeRoute',`${customer.origin} → ${customer.destination}`);txt('shipStatus',customer.status||'SIMULATED');
 let eta=customer.estimated_arrival_utc;txt('shipEta',customer.eta_past_due_without_arrival_confirmation?'Original ETA overdue · verification required':'Recorded ETA: '+when(eta));
 if(globe.route[0]!==customer.origin||globe.route[1]!==customer.destination)globe.setRoute(customer.origin,customer.destination);
 let phase=customer.ground_twin?.phase||'NOT_IN_STAGING',rd=customer.route_decision||{};
 const stages=[['Request received',true,'Synthetic accepted order'],['Ground processing',['WORK','DONE'].includes(phase)||phase==='HOLD',phase.replaceAll('_',' ')],['Recovery decision',Boolean(rd.tentative_alternative_flights?.length),rd.review_status?.replaceAll('_',' ')||'No recovery proposed'],['Carrier confirmed',Boolean(rd.carrier_confirmed),rd.carrier_confirmed?'Confirmed by carrier':'External approval missing']];
 let currentIndex=stages.findIndex(x=>!x[1]);if(currentIndex<0)currentIndex=stages.length;
 $('journeySteps').innerHTML=stages.map(([n,done,sub],i)=>`<div class="stepnode ${done?'done':i===currentIndex?'now':''}"><b>${esc(n)}</b><small>${esc(sub)}</small></div>`).join('');
 let last=customer.journey_events?.at(-1);
 txt('shipHeadline',last?.kind?.replaceAll('_',' ')||customer.ground_twin?.phase_label||'Order observed');
 txt('shipUpdate',last?.message||customer.customer_service_message||'No new synthetic milestones recorded yet.');
 txt('shipWarning',rd.tentative_alternative_flights?.length?`Candidate: ${rd.tentative_alternative_flights.join(' → ')} · ${rd.review_status.replaceAll('_',' ')}. This is NOT a confirmed carrier route.`:'No carrier confirmation or real customer notification is performed by RELAY.');
}
let poll;
async function fetchState(){
 if(pollBusy)return poll;
 pollBusy=true;
 poll=loadState();
 return poll;
}
async function loadState(){try{const d=await api('/v11/api/state'+(selectedAwb?'?awb='+encodeURIComponent(selectedAwb):''));if(d.v8.sequence!==lastSeq){lastSeq=d.v8.sequence;render(d)}else{render(d)}}catch(e){txt('liveState','OFFLINE');$('statusPulse').classList.remove('on');console.error(e)}finally{pollBusy=false}}
async function action(path,body,success){if(actionBusy)return;actionBusy=true;try{const d=await api(path,'POST',body);render(d.state||d);if(success)toast(success)}catch(e){toast(e.message,true)}finally{actionBusy=false}}
async function ctrl(actionName,more={}){await action('/v11/api/control',{action:actionName,...more},actionName==='start'?'All three Twins are now running on one clock':actionName==='pause'?'Shared simulation paused':null)}
function advanceConfig(){return {rate:+$('rate').value,chaos:+$('chaos').value,handlers:+$('crew').value,cold_bays:+$('cold').value,stands:+$('stands').value}}
function closePops(){for(let id of ['settingsPop','incidentPop'])$(id).hidden=true}
function showPop(id){let was=$(id).hidden;closePops();$(id).hidden=!was}
function explainIntro(){return '<p><b>Scope:</b> 30 days of generated data; staging queue + finite MILP + one-step Bayesian model. No airline inventory booking, ULD safety certificate or real customer notifications.</p>'}
function details(title,body){drawer(title,explainIntro()+body)}
async function showEvidence(kind){if(kind==='events'){details('Live input → process → output',`<h3>Unified conductor</h3>${(state?.unified_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind)} · Tick ${e.tick}</b>${esc(e.message)}<br><small>${esc(e.at)} · sequence ${e.seq}</small></div>`).join('')}`);return}
 if(kind==='journey'){let c=state?.customer_projection;details('Customer journey · '+(c?.awb||'—'),`<p>Observed synthetic milestones stay separate from simulated ground actions and tentative routing.</p>${(c?.journey_events||[]).slice().reverse().map(e=>`<div class="ledger-row"><b>${esc(e.kind||e.code)} · ${e.observed?'Recorded synthetic source':'Simulated overlay'}</b>${esc(e.message)}<br><small>${esc(when(e.at))} · ${esc(e.authority)}</small></div>`).join('')}`);return}
 if(kind==='math'||['model_i','model_ii','model_iii'].includes(kind)){let d=state?.decision||{},k=kind==='math'?'model_iii':kind;details(kind==='math'?'Mathematical decision trace':'Inspect '+k.toUpperCase(),`<p>Model I = bounded 2D arrangement; Model II = one-step Bayesian verification; Model III = finite-column capacity MILP.</p><pre>${esc(JSON.stringify(kind==='math'?d:d[k]||{},null,2))}</pre><button class="btn soft" id="fullEvidence">Load source provenance ↗</button>`);return}
 if(kind==='audit'||kind==='source'){if(kind==='audit')details('Runtime integrity audit','<p>Running audit against the canonical synthetic event store…</p>');try{let r=await api(kind==='audit'?'/v11/api/audit':'/v11/api/evidence');if(kind==='source')txt('drawerTitle','OAG / dataset provenance');$('drawerContent').innerHTML=explainIntro()+'<pre>'+esc(JSON.stringify(r,null,2))+'</pre>'}catch(e){$('drawerContent').textContent=e.message}return}
 if(kind==='tasks'){details('Simulated team handoffs',(state?.tasks||[]).map(t=>`<div class="ledger-row"><b>${esc(t.shipment_id)} · ${esc(t.task_type||'Ground handoff')}</b>${esc(t.status)}</div>`).join('')||'No simulated tasks.');return}
}
function newOrderForm(){drawer('New synthetic cargo request',`<p>This form adds a request to the SAME event-sourced catalog used by Ground and Control. It does not create an airline booking.</p><form id="orderForm"><label>Destination<select name="destination"><option value="NRT">Tokyo · NRT</option><option value="LHR">London · LHR</option><option value="SIN">Singapore · SIN</option><option value="SYD">Sydney · SYD</option><option value="FRA">Frankfurt · FRA</option><option value="BKK">Bangkok · BKK</option><option value="LAX">Los Angeles · LAX</option><option value="DXB">Dubai · DXB</option></select></label><label>Weight (kg)<input name="weight_kg" type="number" required min="10" max="450" value="125"></label><label>Service<select name="service"><option value="PRIORITY">Priority</option><option value="STANDARD">Standard</option><option value="CRITICAL">Critical</option></select></label><label>Handling<select name="handling"><option value="GENERAL">General</option><option value="COL">Cold chain</option></select></label><div class="fieldgrid"><label>Length cm<input name="length_cm" type="number" value="70" min="15" max="180"></label><label>Width cm<input name="width_cm" type="number" value="55" min="15" max="180"></label><label>Height cm<input name="height_cm" type="number" value="45" min="15" max="180"></label></div><button type="submit" class="btn primary full">Create & send to all Twins</button></form>`)}
$$('.tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
requestClick($('globalPlay'),()=>ctrl(state?.v8.running?'pause':'start'));
$('speed').addEventListener('change',()=>ctrl('speed',{speed:+$('speed').value}));
requestClick($('stepOnce'),()=>ctrl('step',{count:1}));
$('resetBtn').addEventListener('click',()=>{if(confirm('Reset synthetic orders, decisions and ground states for all three Twins?'))withRequestButton($('resetBtn'),()=>ctrl('reset',{seed:2048}))});
$('settingsBtn').addEventListener('click',()=>showPop('settingsPop'));
$('injectBtn').addEventListener('click',()=>showPop('incidentPop'));
$$('[data-close]').forEach(x=>x.addEventListener('click',()=>$(x.dataset.close).hidden=true));
for(let id of ['rate','crew','cold','stands','chaos']){$(id).addEventListener('input',()=>txt(({rate:'rateN',crew:'crewN',cold:'coldN',stands:'standsN',chaos:'chaosN'})[id],id==='chaos'?Math.round(+$('chaos').value*100)+'%':$(''+id).value))}
$('applySettings').addEventListener('click',()=>withRequestButton($('applySettings'),async()=>{await ctrl('tune',advanceConfig());closePops()}));
$$('[data-incident]').forEach(b=>requestClick(b,async()=>{await action('/v11/api/incident',{kind:b.dataset.incident},'Disruption propagated to all three views');closePops()}));
$('seeDecision').addEventListener('click',()=>showTab('tower'));
$('whyGround').addEventListener('click',()=>showEvidence('math'));
$('logsBtn').addEventListener('click',()=>showEvidence('events'));
$('allEvents').addEventListener('click',()=>showEvidence('events'));
$('viewMath').addEventListener('click',()=>showEvidence('math'));
requestClick($('auditBtn'),()=>showEvidence('audit'));
requestClick($('recalculate'),()=>ctrl('recalculate'));
$('autonomy').addEventListener('change',()=>ctrl('mode',{mode:$('autonomy').value}));
$$('[data-inspect]').forEach(b=>b.addEventListener('click',()=>showEvidence(b.dataset.inspect)));
$('taskCards').addEventListener('click',e=>{const b=e.target.closest('[data-task]');if(b)withRequestButton(b,()=>action('/v11/api/tasks/'+encodeURIComponent(b.dataset.task)+'/done',{},'Synthetic team task acknowledged'))});
function review(button,choice){let d=state?.decision;if(!d)return;let n=d.proposed_actions?.length||0;if(!confirm(`${choice==='approve'?'Approve':'Reject'} ${n} tentative simulated route change(s)?\n\nNo actual airline booking or cargo movement will occur.`))return;withRequestButton(button,()=>action('/v11/api/review',{decision_id:d.id,choice,expected_snapshot_version:d.snapshot_version},'Simulation-only review recorded'))}
$('approveBtn').addEventListener('click',e=>review(e.currentTarget,'approve'));
$('rejectBtn').addEventListener('click',e=>review(e.currentTarget,'reject'));
$('portfolioItems').addEventListener('click',event=>{
 const card=event.target.closest('button[data-awb]');
 if(card)withRequestButton(card,async()=>{
  selectedAwb=card.dataset.awb;
  if(pollBusy)await poll;
  await fetchState();
 });
});
$('filterShipments').addEventListener('input',()=>{if(state)renderCustomer(state)});
$('newOrderBtn').addEventListener('click',newOrderForm);
$('fullJourney').addEventListener('click',()=>showEvidence('journey'));
$('backdrop').addEventListener('click',closeDrawer);$('closeDrawer').addEventListener('click',closeDrawer);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closePops()}});
$('drawerContent').addEventListener('click',async e=>{if(e.target.id==='fullEvidence')withRequestButton(e.target,()=>showEvidence('source'))});
$('drawerContent').addEventListener('submit',async e=>{if(e.target.id!=='orderForm')return;e.preventDefault();return withRequestButton(e.submitter||e.target.querySelector('button'),async()=>{const raw=Object.fromEntries(new FormData(e.target).entries());for(let k of ['weight_kg','length_cm','width_cm','height_cm'])raw[k]=+raw[k];try{let out=await api('/v11/api/order','POST',raw);selectedAwb=out.awb;render(out.state);closeDrawer();toast('New synthetic order '+out.awb+' linked to all three Twins')}catch(x){toast(x.message,true)}})});
function animate(t){const dt=Math.min(t-drawStart,250);drawStart=t;if(state?.v8.running)lightHour=(lightHour+dt*.0020*Math.min(state.v8.actual_ticks_per_second||1,12))%24;
 worlds.forEach(w=>{w.hour=lightHour;if(currentTab==='ground')w.render(t)});if(currentTab==='customer')globe.render(t);requestAnimationFrame(animate)}
requestAnimationFrame(animate);
showTab(['ground','tower','customer'].includes(location.hash.slice(1))?location.hash.slice(1):'ground');
fetchState().then(()=>{toast('Synchronized synthetic engine connected')});setInterval(fetchState,950);
})();
