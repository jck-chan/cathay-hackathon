/* RELAY v5 — explainable UI additions. No hidden replay, no real airline calls. */
(()=>{'use strict';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const busy=(id,on)=>{const x=el(id);if(x)x.disabled=on;};
async function req(path,method='GET',payload){const r=await fetch(path,{method,headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});let d;try{d=await r.json()}catch{d={detail:`HTTP ${r.status}`}}if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:JSON.stringify(d.detail));return d}
function note(msg,err=false){const x=el('feedback');if(!x)return;x.textContent=msg;x.classList.toggle('error',err)}
function jump(id){el(id)?.scrollIntoView({behavior:'smooth',block:'start'})}
function wire(id,fn){el(id)?.addEventListener('click',fn)}
wire('guideStep',()=>{el('stepBtn')?.click();jump('operations')});
wire('guideIncident',()=>{el('flightBtn')?.click();jump('operations')});
wire('guideReview',()=>{el('evaluateBtn')?.click();jump('decision')});
wire('guideCustomer',()=>{el('sampleBtn')?.click();jump('customers')});
let sample=null;
async function oagPreview(){busy('oagPreviewBtn',true);try{
 sample=await req('/v5/api/oag/sample');const records=sample.normalized||[];
 const wrap=el('oagPreview');wrap.innerHTML=records.map(f=>`<div class="oag-item"><b>${esc(f.carrier_iata)} ${esc(f.flight_number)} · ${esc(f.departure_iata)} → ${esc(f.arrival_iata)}</b><span>${esc(f.flight_state)}</span><small>${esc(f.scheduled_departure_utc)} · demo map: ${esc(f.synthetic_flight_id)} · CARGO INVENTORY: NOT AVAILABLE</small></div>`).join('')||'<p>No future flight instances in the synthetic catalog.</p>';
 const sel=el('oagFlight');sel.replaceChildren(...records.map(f=>{const x=document.createElement('option');x.value=f.synthetic_flight_id;x.textContent=`${f.carrier_iata}${f.flight_number} · ${f.departure_iata}→${f.arrival_iata} (${f.synthetic_flight_id})`;return x}));
 el('oagRaw').textContent=JSON.stringify(sample,null,2);note(`Parsed ${records.length} schema-shaped SYNTHETIC flights; none is actual OAG supplied data.`);
 }catch(e){note('OAG preview failed: '+e.message,true)}finally{busy('oagPreviewBtn',false)}}
wire('oagPreviewBtn',oagPreview);
wire('oagSchemaBtn',async()=>{if(!sample)await oagPreview();const p=el('oagRaw');p.hidden=!p.hidden;el('oagSchemaBtn').textContent=p.hidden?'Show normalized JSON':'Hide JSON'});
wire('oagObserveBtn',async()=>{const f=el('oagFlight').value,s=el('oagStatus').value;if(!f){note('Select a synthetic flight first using the preview.',true);return}
 busy('oagObserveBtn',true);try{
 const d=await req('/v5/api/oag/observe','POST',{flight_id:f,status:s});const conflicts=d.external_evidence.approval_conflicts||[];
 el('oagImpact').innerHTML=`<b>Recorded:</b> ${esc(f)} → ${esc(s)}<p>This is an UNVERIFIED external observation. Operational remaining capacity and booked inventory were NOT changed.</p><p>Conflicting proposals requiring carrier confirmation: <b>${conflicts.length}</b>. Latest mathematical decision: ${d.decision?.stale?'STALE / RE-EVALUATE':'unchanged'}.</p>`;
 note('External evidence recorded. Rerun three models before considering a review; a conflicting route still needs carrier confirmation.');
 const ap=el('approveBtn');if(ap)ap.disabled=true;
 }catch(e){note(e.message,true)}finally{busy('oagObserveBtn',false)}});
wire('auditBtn',async()=>{busy('auditBtn',true);el('auditPass').textContent='Checking…';try{
 const d=await req('/v5/api/audit');el('auditPass').textContent=`${d.runtime_pass}/${d.runtime_total} passed`;
 el('auditGaps').textContent=`${d.production_gaps} open`;
 el('auditChecks').innerHTML=d.checks.map(x=>`<div class="checkline ${x.passed?'':'bad'}"><span class="check-mark">${x.passed?'✓':'!'}</span><div><strong>${esc(x.id.replaceAll('_',' '))}</strong><p>${esc(x.detail)}</p><small class="microtext">${esc(x.scope)}</small></div></div>`).join('');
 note(`Audited ${d.runtime_total} runtime/input checks; ${d.production_gaps} unsatisfied real-world certification requirements are explicitly listed.`);
 }catch(e){el('auditPass').textContent='Error';note('Audit failed: '+e.message,true)}finally{busy('auditBtn',false)}});
wire('evidenceBtn',async()=>{busy('evidenceBtn',true);try{const d=await req('/v5/api/evidence');el('evidencePanel').open=true;el('evidenceRaw').textContent=JSON.stringify(d,null,2);jump('assurance');note('Evidence includes cost provenance, solver scope and independent source boundaries.')}catch(e){note(e.message,true)}finally{busy('evidenceBtn',false)}});
})();
