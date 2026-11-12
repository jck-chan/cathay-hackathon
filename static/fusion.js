/* RELAY Fusion workflow UI — all effects are real same-origin localhost calls.
 * The network optimizer has a different synthetic dataset from the live 3D queue twin.
 * Never equate either with real Cathay decisions, confirmation or ROI.
 */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (v,n=1) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n});
  const safeTime = s => s ? String(s).replace('T',' ').replace('Z',' UTC') : 'Unconfirmed';
  let current=null, version=null, busy=false, toastTimer=null;
  let networkTwin=null, networkVisible=false;
  if(window.RelayIsometricTwin){
    networkTwin=new window.RelayIsometricTwin($('networkCanvas'),'relay');
    const watch=new IntersectionObserver(items=>{networkVisible=items[0].isIntersecting},{rootMargin:'150px'});
    watch.observe($('networkCanvas'));
    const loop=t=>{if(networkVisible&&networkTwin&&document.visibilityState!=='hidden')networkTwin.render(t);requestAnimationFrame(loop)};
    requestAnimationFrame(loop);
  }
  const notice=document.createElement('div');notice.className='fusion-toast';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');document.body.appendChild(notice);
  function say(message,error=false){ notice.textContent=message;notice.className='fusion-toast visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>notice.className='fusion-toast',5200); }
  async function request(path,method='GET',payload=null){
    const args={method,headers:{'Accept':'application/json'},cache:'no-store'};
    if(payload!==null){args.headers['Content-Type']='application/json';args.body=JSON.stringify(payload)}
    let res;
    try {res=await fetch(path,args)}catch(e){throw new Error('Server disconnected. Is the RELAY terminal window still running?')}
    let data;try{data=await res.json()}catch(e){throw new Error('Backend sent an unreadable response')}
    if(!res.ok){const detail=data.detail||data.error||res.statusText;throw new Error(typeof detail==='string'?detail:JSON.stringify(detail))}
    return data;
  }
  function setWaiting(button,loading,caption){if(!button)return;if(loading){button.dataset.caption=button.textContent;button.disabled=true;button.innerHTML='<i class="inline-loader"></i>'+esc(caption||'Working…')}else{button.disabled=false;button.textContent=button.dataset.caption||'Ready'}}
  function setText(id,value){if($(id))$(id).textContent=value}
  function row(label,value){return `<div class="model-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`}
  function safeList(items){return (items||[]).slice(0,6).map(x=>esc(x)).join(' · ')}
  function uiVersion(s){version=s.snapshot_version;setText('engineClock',safeTime(s.v2_clock));setText('engineVersion','v'+s.snapshot_version);$('autonomySelect').value=(s.policy||{}).mode||'HUMAN_APPROVAL';}
  function drawFloor(p){
    const bounds={maxX:320,maxY:210};if(!p||!p.length)return '';
    return `<div class="uld-floor" aria-label="Schematic 2D ULD candidate placements">${p.slice(0,8).map((x,i)=>{
      const x0=Math.max(0,Math.min(99,100*(Number(x.x_cm)||0)/bounds.maxX));
      const y0=Math.max(0,Math.min(99,100*(Number(x.y_cm)||0)/bounds.maxY));
      const w=Math.max(9,Math.min(100-x0,100*(Number(x.length_cm)||45)/bounds.maxX));
      const h=Math.max(12,Math.min(100-y0,100*(Number(x.width_cm)||50)/bounds.maxY));
      return `<div class="uld-piece" title="${esc(x.piece_id)}" style="left:${x0}%;top:${y0}%;width:${w}%;height:${h}%">${esc((x.piece_id||'').slice(-5))}</div>`;
    }).join('')}</div>`;
  }
  function renderDecision(d){
    if(!d)return;
    current=d;
    setText('engineLatency',fmt(d.engine_runtime_ms,1)+' ms');
    setText('engineStatus',d.action+' · '+d.status);
    const mi=d.model_i||{},mii=d.model_ii||{},miii=d.model_iii||{};
    const m=miii.metrics||{},base=miii.baseline_fcfs||{},solver=miii.solver||{};
    setText('ftShipments',(d.input_evidence?.shipment_ids||[]).length);
    setText('ftRoutes',miii.candidate_columns??'—');
    setText('ftUnresolved',m.unresolved_count??'—');
    setText('ftRisk',fmt(m.risk_adjusted_objective,0));
    setText('ftGap',solver.mip_gap == null?'Not certified':fmt(100*solver.mip_gap,2)+'%');
    const batches=mi.batches||[];
    const ok=batches.filter(b=>b.risk_aware&&b.baseline),b=ok[0]||{};
    const agg=Number(mi.aggregate_risk_improvement_units)||0;
    $('modelIView').innerHTML=`<div class="model-num">${fmt(agg,2)} <small class="model-unit">risk units saved</small></div>`+
      row('Placement batches checked',batches.length)+row('Pieces assessed',mi.candidate_piece_count??'—')+
      row('2D footprint coverage',mi.coverage_fraction===null?'—':fmt((mi.coverage_fraction||0)*100,1)+'%')+
      (b.risk_aware?drawFloor(b.risk_aware.placements):'')+
      `<p class="model-caption">${esc(mi.scope_note||'Candidate 2D floor positions only, not certified aircraft loading.')} The drawing shows the first successful independent batch.</p>`;
    const cases=mii.cases||[];
    $('modelIIView').innerHTML=cases.length?`<div class="model-num">${cases.length} <span class="model-unit">uncertain shipment(s)</span></div>`+
      cases.slice(0,5).map(c=>row(c.shipment_id,(c.action||'CHECK')+' · value '+fmt(c.verification_net_value,1))).join('')+
      `<p class="model-caption">These cases are blocked from route changes until independent physical verification. Action recommendations do not certify loading.</p>`:
      `<div class="model-num">0 <span class="model-unit">verification triggers</span></div><p class="model-caption">No active dimension conflict in this decision. This does NOT certify physical packing.</p>`;
    const routes=(miii.plan||[]).filter(p=>p.kind==='TENTATIVE_ROUTING');
    const difference=(Number(base.risk_adjusted_objective)||0)-(Number(m.risk_adjusted_objective)||0);
    $('modelIIIView').innerHTML=`<div class="model-num">${fmt(difference,1)} <span class="model-unit">vs FCFS · risk units</span></div>`+
      row('MILP solver status',miii.status||'—')+
      row('Planned vs unresolved',routes.length+' / '+(m.unresolved_count??0))+
      row('Capacity constraints',miii.constraints_checked?.flight_remaining_kg?'Enforced (synthetic)':'Unknown')+
      `<div class="fusion-route-list">${routes.slice(0,5).map(p=>`<div class="fusion-route"><b>${esc(p.shipment_id)}</b><span>${esc((p.airports||[]).join(' → '))}</span></div>`).join('')}</div>`+
      `<p class="model-caption">FCFS and optimized objectives can be identical. 'Optimal' means only within generated routes and modeled hard constraints.</p>`;
    const proposals=d.proposed_actions||[], reasons=d.reason_codes||[];
    const stale=d.status==='PENDING_REVIEW' && version!==null && d.snapshot_version!==version;
    const label=$('decisionTag');label.textContent=stale?'STALE':d.status;label.classList.toggle('warning',stale||d.status==='PENDING_REVIEW');
    $('decisionSummary').innerHTML=`<div class="model-row"><span>Recommendation</span><strong>${esc(d.action)}</strong></div>`+
      row('Recovery change requests',proposals.length)+row('Model III unresolved',m.unresolved_count??'—')+
      row('Review needed',d.review_required?'Yes':'No')+
      (stale?`<p class="model-caption model-warn">New evidence arrived after evaluation. Re-run the solver before approval.</p>`:'')+
      `<div class="fusion-route-list">${proposals.slice(0,7).map(p=>`<div class="fusion-route"><b>${esc(p.shipment_id)}</b><span>${esc((p.route||[]).join(' → '))} · NOT BOOKED</span></div>`).join('')}</div>`+
      `<p class="model-caption">${esc(reasons.slice(0,3).map(r=>r.reason).join(' · ')||'No additional reason codes')}. Simulated proposals only; no real ground commands.</p>`;
    renderProcess(d.process_logs||[]);
    renderReview(d,stale);
  }
  function renderProcess(logs){
    $('networkLogs').innerHTML=logs.length?logs.map((entry,i)=>`<div class="fusion-log-line"><b class="log-stage">${esc(entry.stage||'STEP '+i)}</b><span class="log-message">${esc(entry.message||'')}</span><small>${esc(Object.entries(entry).filter(([k,v])=>k!=='stage'&&k!=='message'&&typeof v!=='object').slice(0,5).map(([k,v])=>k+'='+v).join(' · '))}</small></div>`).join(''):'<div class="fusion-empty">No mathematical trace yet.</div>';
  }
  function renderReview(d,stale){
    const queue=d.status==='PENDING_REVIEW'&&!stale&&(d.proposed_actions||[]).length>0;
    setText('reviewState',stale?'STALE':d.status);
    $('reviewState').classList.toggle('warning',stale);
    $('approveBtn').disabled=!queue;$('rejectBtn').disabled=!queue;
    $('reviewProposal').innerHTML=`<div class="recovery-row"><span>Decision</span><strong>${esc(d.id)}</strong></div>`+
      row('Status',stale?'STALE — rerun analysis':d.status)+row('Proposed amendments',(d.proposed_actions||[]).length)+
      `<p class="model-caption">${queue?'Supervisor approval produces only a simulated, ordered departmental task list.':'There is no currently approvable physical change. No hidden action is taken.'}</p>`;
  }
  function renderTasks(tasks){
    setText('tasksCount',tasks.length);
    const byId=Object.fromEntries(tasks.map(t=>[t.id,t]));
    $('tasksView').innerHTML=tasks.length?tasks.map(t=>{
      const prereq=t.depends_on_task_id?byId[t.depends_on_task_id]:null;
      const allowed=(t.status==='QUEUED_SIMULATED'||t.status==='ACKNOWLEDGED')&&(!prereq||prereq.status==='DONE');
      return `<div class="task-item"><div><strong>${esc(t.team)} · ${esc(t.shipment_id)}</strong><p>${esc((t.task_type||'').replaceAll('_',' '))}</p><small>${esc(t.status)}${prereq&&prereq.status!=='DONE'?' · Wait for preceding task':''}</small></div><button class="fusion-secondary-button task-ack" data-task="${esc(t.id)}" ${allowed?'':'disabled'}>${t.status==='DONE'?'Complete':'Mark done'}</button></div>`;
    }).join(''):'<div class="fusion-empty">No simulated tasks yet. Approve a fresh recovery proposal to create them.</div>';
    document.querySelectorAll('.task-ack').forEach(button=>button.addEventListener('click',()=>ackTask(button.dataset.task,button)));
  }
  async function refreshOverview(options={draw:true}){
    const o=await request('/fusion/overview');uiVersion(o);
    if(o.latest_decision && options.draw)renderDecision(o.latest_decision);
    renderTasks(o.tasks||[]);
    if(networkTwin){networkTwin.state=o.network_scene;networkTwin.incidentActive=false;}
    setText('nsProposed',(o.latest_decision?.model_iii?.plan||[]).filter(p=>p.kind==='TENTATIVE_ROUTING').length);
    setText('nsUnresolved',o.latest_decision?.model_iii?.metrics?.unresolved_count??'—');
    setText('nsTasks',(o.tasks||[]).length);
    if(!o.latest_decision){setText('engineStatus','Ready for first evaluation')}
    $('connectionBadge').innerHTML='<i></i>ONE LOCAL SERVER · CONNECTED';$('connectionBadge').classList.remove('offline');
    return o;
  }
  async function evaluateFull(){
    if(busy)return;busy=true;const button=$('evaluateBtn');setWaiting(button,true,'Solving all 3 models…');
    try{
      const d=await request('/fusion/evaluate','POST',{
        risk_alpha:Number($('alphaControl').value)/100,risk_weight:Number($('weightControl').value),
        time_limit_s:Number($('limitControl').value)
      });
      await refreshOverview({draw:false});renderDecision(d);await refreshLogs();
      say('Three mathematical models completed. Review the decision and evidence below.');
    }catch(e){say('Could not evaluate: '+e.message,true)}finally{busy=false;setWaiting(button,false)}
  }
  async function advance(){
    if(busy)return;busy=true;const button=$('advanceBtn');setWaiting(button,true,'Generating event + replanning…');
    try{
      const next=await request('/fusion/advance','POST',{advance_seconds:300,seed:27,auto_evaluate:true});
      const o=await refreshOverview();await refreshLogs();
      say('Network clock advanced 5 minutes. '+(next.event?'Observed: '+next.event.event_type+'.':'No active entity this step.')+' Prior decisions are now stale.');
    }catch(e){say('Event simulation failed: '+e.message,true)}finally{busy=false;setWaiting(button,false)}
  }
  async function refreshLogs(){
    try{const data=await request('/fusion/logs?limit=28');
      const items=data.items||[];if(!items.length)return;
      $('networkLogs').innerHTML=items.slice(-20).reverse().map(e=>`<div class="fusion-log-line"><span class="log-stage">${esc(e.category||'LOG')}</span><span class="log-message">${esc(e.stage||e.message||e.ref||'Recorded engine event')}</span><small>${esc(e.at||'')} ${esc(e.action||e.event_type||'')}</small></div>`).join('');
    }catch(e){say('Cannot read engine logs: '+e.message,true)}
  }
  async function doReview(choice){
    if(!current||busy)return;
    const n=current.proposed_actions?.length||0;
    if(!window.confirm(`${choice==='approve'?'APPROVE':'REJECT'} ${n} simulated route change(s)?\n\nNo real airline booking, warehouse command, or customer notification will be sent.`))return;
    busy=true;const button=$(choice==='approve'?'approveBtn':'rejectBtn');setWaiting(button,true,'Recording decision…');
    try{
      const out=await request('/fusion/review','POST',{decision_id:current.id,choice,reviewer:'Local demo supervisor',reason:'Reviewed in Fusion UI',expected_snapshot_version:current.snapshot_version,idempotency_key:'fusion-'+crypto.randomUUID()});
      await refreshOverview();say(`${choice==='approve'?'Simulated approval':'Rejection'} recorded. ${out.task_ids?.length||0} simulated tasks created.`);
    }catch(e){say('Review rejected: '+e.message+' Re-run analysis if snapshot is stale.',true);await refreshOverview()}
    finally{busy=false;setWaiting(button,false);if(current){const allowed=current.status==='PENDING_REVIEW'&&current.snapshot_version===version; $('approveBtn').disabled=!allowed; $('rejectBtn').disabled=!allowed;}}
  }
  async function ackTask(id,button){
    if(busy)return;busy=true;setWaiting(button,true,'Saving…');
    try{await request('/fusion/tasks/'+encodeURIComponent(id)+'/ack','POST',{worker:'Local demo ground staff',status:'DONE',idempotency_key:'fusion-task-'+crypto.randomUUID()});
      await refreshOverview();say('Simulated task marked done; dependent tasks are now eligible.');
    }catch(e){say('Cannot complete task: '+e.message,true)}finally{busy=false;setWaiting(button,false)}
  }
  async function policy(){
    if(busy)return;busy=true;setWaiting($('savePolicy'),true,'Saving…');
    try{const mode=$('autonomySelect').value;await request('/fusion/policy','PUT',{mode,max_auto_cost_units:0,allow_simulated_dispatch:true});
      await refreshOverview();say('Policy saved: '+mode+'. Run new analysis because policy changes invalidate old snapshots.');
    }catch(e){say('Could not update policy: '+e.message,true)}finally{busy=false;setWaiting($('savePolicy'),false)}
  }
  function renderCustomer(c){
    const milestones=c.observed_milestones||[], updates=c.recovery_updates||[];
    const state=c.customer_service_message||'No explanatory message available';
    $('customerResult').innerHTML=`<div class="cust-header"><strong>${esc(c.awb)}</strong><span>${esc(c.origin)} → ${esc(c.destination)} · ${esc(c.status)}</span></div>`+
      `<p class="cust-message">${esc(state)}</p>`+
      `<div class="recovery-row"><span>Latest estimated arrival</span><strong>${esc(safeTime(c.estimated_arrival_utc))}</strong></div>`+
      `<div class="recovery-row"><span>ETA uncertainty window</span><strong>${esc((c.eta_uncertainty_window_utc||[]).map(safeTime).join(' — ')||'Unknown')}</strong></div>`+
      `<div class="recovery-row"><span>Verified observation milestones</span><strong>${milestones.length}</strong></div>`+
      `<div class="cust-stages">${['BOOKED','RECEIVED','IN TRANSIT','DELIVERED'].map((v,i)=>`<div class="cust-stage ${i<Math.min(milestones.length+1,4)?'complete':''}">${v}<small>${i===1?esc((milestones.at(-1)||{}).event_time?.slice(0,16)||'Unconfirmed'):'Customer-safe view'}</small></div>`).join('')}</div>`+
      `<p class="model-caption">${esc(updates.slice(-1)[0]?.message||'No approved recovery update to communicate yet.')} · ${esc(c.eta_status||'Synthetic forecast')} · No real AWB or booking.</p>`;
  }
  async function loadSample(){
    try{const out=await request('/fusion/customer/sample');if(!out.awb)throw Error('No eligible synthetic shipments');$('awbInput').value=out.awb;await track()}catch(e){say(e.message,true)}
  }
  async function track(){
    const awb=$('awbInput').value.trim();if(!awb){say('Enter a synthetic AWB or click Use sample.',true);return;}
    const button=$('trackBtn');setWaiting(button,true,'Retrieving customer projection…');
    try{const c=await request('/fusion/customer?awb='+encodeURIComponent(awb));renderCustomer(c);say('Loaded customer-safe v2 tracking projection.');}
    catch(e){$('customerResult').innerHTML='<div class="fusion-empty">No matching synthetic shipment. Use the sample button, or check your AWB.</div>';say('Tracking failed: '+e.message,true)}
    finally{setWaiting(button,false)}
  }
  function wire(){
    [['alphaControl','alphaRead',v=>v+'%'],['weightControl','weightRead',v=>Number(v).toFixed(2)],['limitControl','limitRead',v=>v+'s']].forEach(([id,read,fn])=>{$(id).addEventListener('input',()=>setText(read,fn($(id).value))) });
    $('evaluateBtn').addEventListener('click',evaluateFull);$('advanceBtn').addEventListener('click',advance);$('refreshLogs').addEventListener('click',refreshLogs);
    $('approveBtn').addEventListener('click',()=>doReview('approve'));$('rejectBtn').addEventListener('click',()=>doReview('reject'));
    $('savePolicy').addEventListener('click',policy);$('refreshReview').addEventListener('click',()=>refreshOverview().then(()=>say('Review queue refreshed.')).catch(e=>say(e.message,true)));
    $('loadSampleAWB').addEventListener('click',loadSample);$('trackBtn').addEventListener('click',track);
    $('awbInput').addEventListener('keydown',e=>{if(e.key==='Enter')track()});
    $('guideDismiss').addEventListener('click',()=>{$('guideDismiss').closest('.onboarding-guide').remove()});
  }
  wire();
  refreshOverview().catch(e=>{say('Cannot connect to v2 mathematical engine: '+e.message,true);$('connectionBadge').classList.add('offline');$('connectionBadge').innerHTML='<i></i>Disconnected';setText('engineStatus','Connection error')});
})();
