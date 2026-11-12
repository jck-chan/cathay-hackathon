/* RELAY V10 product experience / pure presentation; backend remains the decision authority.
   Visual mathematics draws only observed model result fields. No synthetic mutations are
   presented as executed cluster-algebra transitions. */
(()=>{'use strict';
const id=n=>document.getElementById(n),clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),safe=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lastSeq=-1,lastTick=-1,prev={orders:0,completed:0},now=null,selected='',start=performance.now(),kinds={WEATHER:'Weather shifted',DISRUPTION:'Flight / cargo incident',ARRIVAL:'Cargo inbound',COMPLETED:'Ground work completed',MODEL:'New model solution',AUTO_SHADOW:'Sandbox decision approved',REVIEW_REQUIRED:'Review needed',ORDER:'New shipment',TASK:'Task updated',TUNE:'Scenario adjusted',ERROR:'Engine warning'},history=[];
const ICON={WEATHER:'☁',DISRUPTION:'⚠',ARRIVAL:'▣',COMPLETED:'✓',MODEL:'◈',AUTO_SHADOW:'✦',REVIEW_REQUIRED:'!',ORDER:'⊕',TASK:'↗',TUNE:'⚙',ERROR:'!'};
function message(e){return `${kinds[e.kind]||e.kind} · ${(e.message||'').slice(0,95)}`}
function pushEvent(e){
 if(['CLOCK','SPEED','MODE','PLAY','PAUSE','READY'].includes(e.kind))return;
 history.unshift(e);history=history.slice(0,65);
 const box=id('v10ActivityStream');if(box){const node=document.createElement('div');node.className='v10-event-row';
 node.innerHTML=`<span>${safe(ICON[e.kind]||'•')}</span><div><b>${safe(kinds[e.kind]||e.kind)}</b><small>${safe((e.message||'').slice(0,78))}</small></div><time>T${e.tick}</time>`;
 box.prepend(node);while(box.children.length>7)box.lastChild.remove();}
 // Raised toast only for MATERIAL, non-clock events. They do not cover interaction targets.
 if(['DISRUPTION','WEATHER','REVIEW_REQUIRED','ERROR','AUTO_SHADOW'].includes(e.kind)){
   const stack=id('v10EventFlash');if(!stack)return;const n=document.createElement('div');n.className='v10-notification'+(['ERROR','DISRUPTION','REVIEW_REQUIRED'].includes(e.kind)?' danger':'');
   n.innerHTML=`<span class="notify-symbol">${safe(ICON[e.kind]||'◉')}</span><div><b>${safe(kinds[e.kind]||'Update')}</b><small>${safe((e.message||'').slice(0,94))}</small></div>`;
   stack.prepend(n);while(stack.children.length>2)stack.lastChild.remove();setTimeout(()=>n.remove(),4500);
 }
}
function bump(el){if(!el)return;el.classList.remove('v10-flash-number');void el.offsetWidth;el.classList.add('v10-flash-number')}
function counts(s){const a=s.policies?.fcfs||{},b=s.policies?.relay||{},v=s.v8||{};
 const orders=s.work_orders_total||0,done=b.completed||0,active=b.active||0,waiting=b.waiting||0;
 if(prev.orders&&orders!==prev.orders)bump(id('ordersNumber'));if(prev.completed!==done)bump(id('flowFinished'));
 prev={orders,completed:done};
 id('v10CargoMeter').style.width=clamp(100*active/Math.max(1,active+waiting),0,100)+'%';
 id('v10Tempo').textContent=(v.running?Math.min(8.2,1+.82*Math.log2(v.speed_target||1)+.25*Math.log2(1+(v.actual_ticks_per_second||0))):0).toFixed(1)+'×';
 id('v10Throughput').textContent=`${(v.actual_ticks_per_second||0).toFixed(2)} ticks/s verified`;
 id('v10Tick').textContent='TICK '+s.tick;
 id('v10Weather').textContent=(v.config?.weather||'CLEAR')+(v.weather_mode==='AUTO'?' · AUTO':'');
 id('v10Incoming').textContent=orders.toLocaleString();id('v10Working').textContent=active.toLocaleString();id('v10Completed').textContent=done.toLocaleString();
 id('v10ActivityCount').textContent=history.length.toString();
 const delta=(a.cost_units||0)-(b.cost_units||0);
 id('v10Delta').textContent=(delta>=0?'+':'')+delta.toFixed(1)+' units';
 id('v10Delta').className=delta<0?'cost-negative':'cost-positive';
}
function formatStatus(s){const d=s.decision||{};if(d.stale)return 'STALE · RECOMPUTE';if(d.status)return String(d.status).replaceAll('_',' ');return 'READY FOR EVALUATION'}
function paintMath(s){if(!s)return;const d=s.decision||{};
  id('v10CaseState').textContent=formatStatus(s);
  let models=['model_i','model_ii','model_iii'];models.forEach((key,i)=>{
    const canvas=id(['v10MathOne','v10MathTwo','v10MathThree'][i]);if(!canvas)return;
    const w=Math.max(80,canvas.clientWidth),h=Math.max(70,canvas.clientHeight),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.lineWidth=1;
    c.fillStyle='#ecf4f4';c.fillRect(0,0,w,h);
    if(i===0)mathPhysical(c,w,h,d.model_i||{});
    if(i===1)mathBelief(c,w,h,d.model_ii||{});
    if(i===2)mathNetwork(c,w,h,d.model_iii||{},performance.now());
  });
}
function mathPhysical(c,w,h,d){const place=d.risk_aware?.placements||d.baseline?.placements||d.placements||[],pad=10;
 c.fillStyle='#537982';c.font='700 10px Segoe UI';c.fillText('BOUNDED ULD OPTIONS',pad,15);
 c.strokeStyle='#7da7a6';c.lineWidth=1;c.strokeRect(pad,24,w-2*pad,h-37);
 if(!place.length){c.font='11px Segoe UI';c.fillStyle='#7f9a9d';c.fillText('Awaiting placement evidence',pad+7,h/2);return;}
 let maxX=Math.max(...place.map(p=>(p.x_cm||0)+(p.length_cm||30)),1),maxY=Math.max(...place.map(p=>(p.y_cm||0)+(p.width_cm||30)),1);
 for(let i=0;i<Math.min(28,place.length);i++){let p=place[i],x=pad+3+(p.x_cm||0)/maxX*(w-2*pad-6),y=27+(p.y_cm||0)/maxY*(h-55),ww=Math.max(5,(p.length_cm||25)/maxX*(w-2*pad-6)),hh=Math.max(5,(p.width_cm||25)/maxY*(h-55));c.fillStyle=i%3===0?'#54b8ab':i%3===1?'#b3d4d0':'#e9b981';c.fillRect(x,y,ww,hh);c.strokeStyle='#f5fffb';c.strokeRect(x,y,ww,hh);}
 c.fillStyle='#376b6b';c.font='700 9px Segoe UI';c.fillText(`${place.length} illustrated 2D placements · not certified`,pad+2,h-3);
}
function mathBelief(c,w,h,d){c.fillStyle='#537982';c.font='700 10px Segoe UI';c.fillText('BAYESIAN VERIFY / HOLD',10,15);
 const cases=Array.isArray(d.cases)?d.cases:[],selected=cases[0]||d,prior=Number(selected.prior_misalignment??d.prior_misalignment),net=Number(selected.verification_net_value??d.verification_net_value);
 const px=10,by=37,bh=17;
 if(!Number.isFinite(prior)){c.fillStyle='#81999c';c.font='11px Segoe UI';c.fillText('Awaiting posterior evidence',10,h/2);return;}
 c.fillStyle='#dbe9e8';c.fillRect(px,by,w-20,bh);c.fillStyle='#dc906b';c.fillRect(px,by,(w-20)*clamp(prior,0,1),bh);
 c.font='10px Segoe UI';c.fillStyle='#42696c';c.fillText(`P(discrepancy) ${(prior*100).toFixed(1)}%`,px,by+30);
 const option=selected.action||d.action||'—';c.fillStyle='#d6ebe6';c.fillRect(px,h-34,w-20,25);c.font='700 11px Segoe UI';c.fillStyle='#0b7368';c.fillText(`${String(option).slice(0,15)}${Number.isFinite(net)?' · VOI '+net.toFixed(1):''}`,px+8,h-18);
}
function mathNetwork(c,w,h,d,t){c.fillStyle='#537982';c.font='700 10px Segoe UI';c.fillText('COUPLED ROUTE NETWORK',10,15);
 const plan=Array.isArray(d.routes)?d.routes:Array.isArray(d.plan)?d.plan:[],routes=plan.filter(x=>Array.isArray(x.route)&&x.route.length);
 if(!routes.length){c.fillStyle='#829b9d';c.font='11px Segoe UI';c.fillText('Awaiting feasible network assignments',10,h/2);return;}
 const hubs=[...new Set(routes.flatMap(x=>x.airports||[]))].slice(0,9),pos={};hubs.forEach((k,i)=>pos[k]={x:23+(i%4)*(w-44)/3,y:35+Math.floor(i/4)*Math.min(31,(h-65)/2)});
 for(let i=0;i<routes.length;i++){let p=routes[i],stops=p.airports||[];for(let j=1;j<stops.length;j++){let a=pos[stops[j-1]],b=pos[stops[j]];if(!a||!b)continue;c.lineWidth=1.2;c.strokeStyle='#9bc6bc';c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}}
 for(let k of hubs){let p=pos[k];c.fillStyle=k==='HKG'?'#0c8e81':'#73b8af';c.beginPath();c.arc(p.x,p.y,4,0,Math.PI*2);c.fill();c.fillStyle='#446f70';c.font='700 9px Segoe UI';c.fillText(k,p.x+5,p.y-4);}
 // Moving marker is a visual traversal of a SOLVED assignment, not an executed Graver mutation.
 const f=(t*.00015)%1,r=routes[Math.floor(t/1000)%routes.length],ends=(r.airports||[]);if(ends.length>=2&&pos[ends[0]]&&pos[ends.at(-1)]){let a=pos[ends[0]],b=pos[ends.at(-1)];c.fillStyle='#f1a855';c.beginPath();c.arc(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,4,0,Math.PI*2);c.fill()}
 c.fillStyle='#597d7f';c.font='9px Segoe UI';c.fillText(`${routes.length} assigned routes · MILP / finite candidates`,10,h-4);
}
function updateMathText(s){const d=s.decision||{},i=d.model_i||{},ii=d.model_ii||{},iii=d.model_iii||{};
 id('v10MathHeadlineOne').textContent=`${i.placements?.length||0} placements · ${i.certificate?'certified':'uncertified'}`;
 id('v10MathHeadlineTwo').textContent=(ii.action||ii.cases?.[0]?.action||'No verification triggered').replaceAll('_',' ');
 id('v10MathHeadlineThree').textContent=`${iii.candidate_columns??0} candidate paths`;
 const gap=iii.gap??iii.solver?.mip_gap;
 id('v10MathCaption').textContent=`Model I is bounded 2D, II is one-step Bayesian, III uses finite-column MILP${Number.isFinite(gap)?' (gap '+(gap*100).toFixed(2)+'%)':''}. No cluster mutation execution is implied.`;
}
function render(s,context={}){now=s;selected=context.selectedAwb||selected;
 const v=s.v8||{};
 const heartbeat=id('v10Heartbeat');
 if(heartbeat){
  const seq=v.sequence||0;
  const events=(s.unified_events||[]).filter(x=>x.seq>lastSeq).sort((a,b)=>a.seq-b.seq);
  if(lastSeq<0){ // Don't replay a backlog as a surprise notification when opening the app.
    lastSeq=seq;
  } else {for(let e of events.slice(-13))pushEvent(e);lastSeq=seq;}
  if(s.tick!==lastTick){lastTick=s.tick;heartbeat.classList.remove('v10-beat');void heartbeat.offsetWidth;heartbeat.classList.add('v10-beat');}
  counts(s);
 }
 updateMathText(s);if(context.globe?.setRoutes)context.globe.setRoutes(s.shipment_objects||[],selected);if(context.globe){context.globe.running=Boolean(v.running);context.globe.requestedSpeed=Number(v.speed_target)||1;}
 if(!id('drawer').hidden){const title=id('drawerTitle')?.textContent||'';if(title.startsWith('Inspect MODEL')||title.startsWith('Mathematical decision trace')){
  const source=title.includes('MODEL I')?'model_i':title.includes('MODEL II')?'model_ii':'model_iii',content=id('drawerContent');
  if(content.dataset.version!==String(s.snapshot_version)+'/'+(s.decision?.id||'')){
    content.innerHTML=`<p>Latest version ${safe(s.snapshot_version)} · numerical evidence refreshed automatically. Models remain simulation-only.</p><pre>${safe(JSON.stringify(s.decision?.[source]||{},null,2))}</pre>`;
    content.dataset.version=String(s.snapshot_version)+'/'+(s.decision?.id||'');
  }
 }}
}
function frame(t,ctx){if(!now)return;if(ctx.currentTab==='tower')paintMath(now);}
function wire(){const ground=id('ground-screen');
 id('v10InsightToggle')?.addEventListener('click',()=>{ground.classList.toggle('insight-open');id('v10InsightToggle').setAttribute('aria-pressed',String(ground.classList.contains('insight-open')))});
 id('v10ActivityToggle')?.addEventListener('click',()=>id('v10ActivityPanel').classList.toggle('expanded'));
 id('v10GroundSettings')?.addEventListener('click',()=>id('settingsBtn').click());
 id('v10GroundIncident')?.addEventListener('click',()=>id('injectBtn').click());
 id('v10GroundLog')?.addEventListener('click',()=>id('logsBtn').click());
 id('v10GroundOps')?.addEventListener('click',()=>id('v10InsightToggle').click());
}
wire();window.RELAY_V10={render,frame,version:'10.0',truth:'state-coupled-synthetic-cinematics'};
})();
