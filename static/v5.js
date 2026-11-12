/* RELAY v5 single-world UI; all underlying decisions originate from Python. */
(()=>{'use strict';
const el=id=>document.getElementById(id);
let state=null,playing=false,inFlight=false,timer=null,currentDelay=950;
const twins=[new window.RelayIsometricTwin(el('baselineCanvas'),'fcfs'),new window.RelayIsometricTwin(el('relayCanvas'),'relay')];
function esc(v){return String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(n,d=1){return Number.isFinite(Number(n))?Number(n).toFixed(d):'—';}
function text(id,val){if(el(id))el(id).textContent=val??'—';}
function report(msg,error=false){el('feedback').textContent=msg;el('feedback').classList.toggle('error',error);}
async function api(url,method='GET',body){const args={method,headers:{'Content-Type':'application/json'}};if(body!==undefined)args.body=JSON.stringify(body);
 const r=await fetch(url,args);let d;try{d=await r.json()}catch{throw Error('Server did not return JSON (HTTP '+r.status+')');}
 if(!r.ok)throw Error(d.detail||d.error||'HTTP '+r.status);return d;}
async function perform(fn,success){if(inFlight)return;inFlight=true;try{const v=await fn();render(v);if(success)report(success);return v}catch(e){report(e.message||String(e),true);if(playing)stop();}finally{inFlight=false}}
function stop(){playing=false;clearInterval(timer);timer=null;el('playBtn').disabled=false;el('pauseBtn').disabled=true;}
function start(){if(playing)return;playing=true;el('playBtn').disabled=true;el('pauseBtn').disabled=false;report('Live simulation running: same canonical work orders feed both policies and the three-model engine.');
 timer=setInterval(async()=>{if(!inFlight)await stepOnce()},currentDelay);}
function updateControls(){text('rateOut',fmt(el('rate').value,2));text('chaosOut',Math.round(100*Number(el('chaos').value))+'%');
 text('crewOut',el('crew').value);text('coldOut',el('coldBays').value);
 text('speedOut',{1800:'0.5×',950:'1×',450:'2×'}[el('speed').value]);currentDelay=Number(el('speed').value);if(playing){stop();start();}}
function stepOnce(){return perform(()=>api('/v5/api/step','POST',{count:1,rate:+el('rate').value,chaos:+el('chaos').value,handlers:+el('crew').value,cold_bays:+el('coldBays').value,stands:3}),
 'Advanced the ONE synthetic clock, dispatched observed work orders, and recalculated Models I–III.');}
function incident(kind){stop();return perform(()=>api('/v5/api/incident','POST',{kind}),
 'Accepted an authoritative SYNTHETIC '+kind+' event; reran all 3 mathematical models on the new snapshot.');}
function runEval(){stop();return perform(()=>api('/v5/api/evaluate','POST',{}),'All 3 mathematical models recalculated from the current canonical state.');}
function reset(){stop();return perform(()=>api('/v5/api/reset','POST',{seed:2048}),'Reset to a clean, reproducible 30-day synthetic history.');}
function mapLogs(logs){let input=logs.filter(e=>['INPUT','SYSTEM'].includes(e.category)),
 process=logs.filter(e=>['MODEL','DISPATCH','ERROR'].includes(e.category)),
 decision=logs.filter(e=>['DECISION','REVIEW'].includes(e.category));
 for(const [id,arr] of [['inputLogs',input],['processLogs',process],['decisionLogs',decision]]){
  el(id).innerHTML=arr.slice(-6).reverse().map(x=>`<div class="logline"><span>T${esc(x.tick)} · ${esc(x.category)} · ${esc(x.source)}</span>${esc(x.message)}</div>`).join('')||'<p class="microtext">No entries yet.</p>';
 }}
function renderPacking(m){const root=el('packing');const placements=m?.placements||[];
 if(!placements.length){root.innerHTML='<span class="microtext">No candidate-library placement for this snapshot.</span>';return;}
 let maxX=Math.max(...placements.map(p=>p.x_cm+p.length_cm),280),maxY=Math.max(...placements.map(p=>p.y_cm+p.width_cm),210);
 const sx=300/Math.max(1,maxX),sy=165/Math.max(1,maxY);let shapes=`<rect x="8" y="8" width="302" height="167" rx="8" fill="#112f38" stroke="#5b9a99" stroke-width="2"/>`;
 const colors=['#5bdac3','#84cce1','#e4be80','#9fbbda','#dba293','#88e3b2'];
 placements.forEach((p,i)=>{const x=9+p.x_cm*sx,y=9+p.y_cm*sy,w=p.length_cm*sx,h=p.width_cm*sy;
 shapes+=`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(3,w).toFixed(2)}" height="${Math.max(3,h).toFixed(2)}" rx="3" fill="${colors[i%colors.length]}" stroke="#12333a" stroke-width="1.3"/><text x="${(x+w/2).toFixed(2)}" y="${(y+h/2+3).toFixed(2)}" font-size="9" text-anchor="middle" font-weight="bold" fill="#14303a">P${i+1}</text>`;
 });root.innerHTML=`<svg viewBox="0 0 320 185" role="img" aria-label="2D candidate library packing placements">${shapes}</svg>`;
 text('packingMetric',`2D diagnostic coverage ${m.coverage_fraction==null?'unknown':fmt(m.coverage_fraction*100,1)+'%'} · model improvement ${fmt(m.risk_improvement_units,2)} synthetic units · CERTIFICATE: NO`);
}
function renderDecision(d){if(!d){text('decisionAction','No eligible decision');return;}
 text('decisionAction',d.action.replaceAll('_',' '));
 text('decisionText',d.status==='PENDING_REVIEW'?'Proposed route changes require a local human review and independently confirmed airline capacity.':'Advisory only. An optimised plan is not a booking or a load certificate.');
 text('decisionFlag',d.stale?'STALE SNAPSHOT':d.status);text('decisionId',d.id);
 text('solverMs',fmt(d.solver_runtime_ms,1)+' ms');text('networkStatus',d.model_iii?.status||'—');
 text('unresolved',d.model_iii?.unresolved??'—');text('proposals',d.proposed_actions?.length??0);
 renderPacking(d.model_i);const cases=d.model_ii?.cases||[];
 el('pivotCases').innerHTML=cases.length?cases.map(c=>`<div class="case-card"><strong>${esc(c.shipment_id)}</strong><small>${esc(c.action)} · value of verification ${fmt(c.verification_net_value,2)} units</small></div>`).join(''):'<p class="microtext">No shipment has conflicting evidence right now. Model II correctly remains inactive rather than inventing a verification need.</p>';
 const routes=d.model_iii?.routes||[];
 el('routes').innerHTML=routes.slice(0,9).map(p=>`<div class="route-card"><strong>${esc(p.shipment_id)}</strong><small>${esc((p.airports||[]).join(' → '))} · ${esc(p.kind)} ${p.arrival_utc?'· '+esc(p.arrival_utc.slice(0,16))+' UTC':''}</small></div>`).join('')||'<p class="microtext">No route candidates.</p>';
 renderReview(d);
}
function renderReview(d){const ready=d?.status==='PENDING_REVIEW'&&!d.stale&&!d.approval_blocked_external_evidence&&(d.proposed_actions||[]).length>0;
 text('reviewState',d?.stale?'STALE':d?.status||'—');el('approveBtn').disabled=!ready;el('rejectBtn').disabled=!ready;
 el('reviewList').innerHTML=(d?.proposed_actions||[]).slice(0,12).map(p=>`<div class="action-row"><div><strong>${esc(p.shipment_id)}</strong><small class="microtext" style="display:block">${esc((p.route||[]).join(' → '))} · ${esc(p.route_status)}</small></div><span class="microtext">requires confirmation</span></div>`).join('')||'<p class="microtext">No route changes to review. This can be a valid result, not a failure.</p>';
}
function renderTasks(tasks){text('taskCount',tasks.length+' tasks');const byId=Object.fromEntries(tasks.map(t=>[t.id,t]));
 el('taskList').innerHTML=tasks.length?tasks.slice(0,60).map(t=>{
 let dep=t.depends_on_task_id?byId[t.depends_on_task_id]:null;
 let ready=['QUEUED_SIMULATED','ACKNOWLEDGED'].includes(t.status)&&(!dep||dep.status==='DONE');
 return `<div class="task-row"><div><strong>${esc(t.team)}</strong><small class="microtext" style="display:block">${esc(t.shipment_id)} · ${esc(t.task_type||'')} · ${esc(t.status)} ${dep&&dep.status!=='DONE'?'(waiting for dependency)':''}</small></div><button class="secondary task-done" data-id="${esc(t.id)}" ${ready?'':'disabled'}>Mark done</button></div>`;
 }).join(''):'<p class="microtext">No simulated crew handoffs yet. Only a fresh approved proposal creates them.</p>';
 document.querySelectorAll('.task-done').forEach(b=>b.addEventListener('click',async()=>{stop();await perform(async()=>{
 await api('/v5/api/tasks/'+encodeURIComponent(b.dataset.id)+'/ack','POST',{});return api('/v5/api/state');},'Simulated task updated; no ground-crew instruction was sent.');}));
}
function render(s){state=s;const d=s.decision;
 text('clock',s.clock);text('tick',s.tick);text('orders',s.work_orders_total);text('snapshot',s.snapshot_version);
 text('baseDone',s.policies.fcfs.completed);text('baseWaiting',s.policies.fcfs.waiting);text('baseCost',fmt(s.policies.fcfs.cost_units));
 text('relayDone',s.policies.relay.completed);text('relayWaiting',s.policies.relay.waiting);text('relayCost',fmt(s.policies.relay.cost_units));
 const delta=s.policies.fcfs.cost_units-s.policies.relay.cost_units;
 text('diffNote',`Same ${s.work_orders_total} canonical work orders; only ${s.decision_scope?.evaluated??0}/${s.decision_scope?.eligible??0} eligible shipments were included in the MILP; staging cost difference FCFS − RELAY = ${fmt(delta,2)} synthetic units. Neither world's task completion implies cargo movement, airline booking or real-world ROI.`);
 twins[0].state={...s.policies.fcfs,active:s.policies.fcfs.active,completed:s.policies.fcfs.completed,objects:s.policies.fcfs.objects};
 twins[1].state={...s.policies.relay,active:s.policies.relay.active,completed:s.policies.relay.completed,objects:s.policies.relay.objects};
 twins.forEach(t=>t.incidentActive=Boolean(s.latest_event));renderDecision(d);renderTasks(s.tasks||[]);mapLogs(s.logs||[]);text('scopeInfo',`${s.decision_scope?.evaluated??0} of ${s.decision_scope?.eligible??0} eligible shipments considered in the current 3-paper solve. Remaining shipments are OUTSIDE this optimization; no whole-network optimality is claimed.`);
 el('conn').innerHTML='<span class="pulse"></span> LIVE · ONE WORLD';el('conn').classList.remove('offline');
}
async function review(choice){stop();if(!state?.decision)return;
 const d=state.decision;const textPrompt=`${choice==='approve'?'Approve':'Reject'} ${d.proposed_actions.length} SIMULATED route proposals? No booking, aircraft or customer notifications will be sent.`;
 if(!confirm(textPrompt))return;await perform(async()=>{
 await api('/v5/api/review','POST',{decision_id:d.id,choice,expected_snapshot_version:d.snapshot_version});
 return api('/v5/api/state');},'Supervisor action recorded in isolated synthetic event store.');}
function customerHTML(c){let stages=(c.observed_milestones||[]).slice(-6);
 return `<div><div class="hero">${esc(c.origin)} → ${esc(c.destination)} · ${esc(c.status)}</div><p>${esc(c.customer_service_message)}</p>
 <div class="fields"><div><small>AIR WAYBILL</small><strong>${esc(c.awb)}</strong></div><div><small>ESTIMATED ARRIVAL</small><strong>${esc(c.estimated_arrival_utc||'Unknown')}</strong></div><div><small>STATUS OF FORECAST</small><strong>${esc(c.eta_status)}</strong></div></div>
 <p class="microtext">Observed milestone events: ${stages.map(m=>esc(m.code)+' at '+esc(m.event_time)).join(' · ')||'none yet'}.</p>
 <p class="microtext">${(c.recovery_updates||[]).map(x=>esc(x.message)).join(' · ')||'No internally approved route changes to report.'}</p>
 <p class="microtext">Internal approval is NEVER presented as a carrier-confirmed booking.</p></div>`;}
async function track(){const awb=el('awb').value.trim();if(!awb){report('Choose a sample or enter synthetic AWB.',true);return;}
 try{const c=await api('/v5/api/customer?awb='+encodeURIComponent(awb));el('customerResult').innerHTML=customerHTML(c);report('Customer projection loaded from the same canonical store.')}catch(e){report(e.message,true)}}
async function benchmark(){if(inFlight)return;inFlight=true;el('benchmarkBtn').disabled=true;el('benchmarkResult').textContent='Computing matched episodes on CPU…';
 try{const n=Number(el('episodes').value);const r=await api('/v5/api/benchmark?episodes='+n+'&seed=707');
 el('benchmarkResult').innerHTML=`<small>PAIRED SYNTHETIC STAGING EPISODES</small><p><strong class="benchmark-big">${fmt(r.paired_saving_units,2)}</strong> units saved / episode (FCFS − RELAY)</p>
 <p>Monte Carlo 95% interval: ${r.ci_95_mc.map(x=>fmt(x,2)).join(' to ')}</p><p>Episodes worse for RELAY: ${fmt(r.regression_fraction*100,1)}%</p>
 <p>Missed staging targets: FCFS ${r.missed_staging_targets_fcfs} · RELAY ${r.missed_staging_targets_relay}</p><p class="microtext">${esc(r.scope)}. Not real airline revenue or financial savings.</p>`;
 report('Computed '+n+' paired simulations; no performance numbers were hardcoded.');
 }catch(e){el('benchmarkResult').textContent=e.message;report(e.message,true)}finally{inFlight=false;el('benchmarkBtn').disabled=false}}
const handlers=[['playBtn','click',start],['pauseBtn','click',stop],['stepBtn','click',()=>{stop();stepOnce()}],['resetBtn','click',reset],
 ['flightBtn','click',()=>incident('flight_cancelled')],['capacityBtn','click',()=>incident('capacity_changed')],['dimensionBtn','click',()=>incident('shipment_dimension_conflict')],['verifyBtn','click',()=>incident('shipment_dimension_verified')],
 ['evaluateBtn','click',runEval],['approveBtn','click',()=>review('approve')],['rejectBtn','click',()=>review('reject')],
 ['sampleBtn','click',async()=>{try{const v=await api('/v5/api/sample');el('awb').value=v.awb||'';await track()}catch(e){report(e.message,true)}}],
 ['trackBtn','click',track],['benchmarkBtn','click',benchmark]];
handlers.forEach(([id,event,fn])=>el(id).addEventListener(event,fn));
['rate','chaos','crew','coldBays'].forEach(id=>el(id).addEventListener('input',updateControls));el('speed').addEventListener('change',updateControls);
el('awb').addEventListener('keydown',e=>{if(e.key==='Enter')track()});
function animation(t){if(state){twins.forEach(twin=>twin.render(t));}requestAnimationFrame(animation)}requestAnimationFrame(animation);
updateControls();api('/v5/api/state').then(s=>{render(s);report('Canonical synthetic state loaded. Click Step once or Start streaming.');})
.catch(e=>{report('Backend connection failed: '+e.message,true);el('conn').classList.add('offline');el('conn').textContent='Backend unavailable';});
})();
