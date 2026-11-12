/* RELAY V10 · cinematic but evidence-bounded synthetic scene & multi-route globe.
   Visual tempo is independent of actual solver throughput. Every cargo-work representation
   is derived from observed waiting/active/done; decorative aircraft are explicitly illustrative.
   No certified aircraft or GSE kinematics are represented. Offline, no external assets. */
(()=>{'use strict';
const clip=(v,a,b)=>Math.min(b,Math.max(a,v));
const PreviousWorld=window.RelayV6.GroundScene;
class FlowWorld extends PreviousWorld {
  constructor(canvas,name){super(canvas,name);this.motionTime=0;this.lastMotionFrame=null;this.visualTempo=1;this.bursts=[];this.previousCompleted=null;this.lastObjectIds=new Set();this.flowParticles=[];this.fxSeq=0;this.shiftPhase=0;
     if(this.airport&&this.gl)return;
     const layer=document.createElement('canvas');layer.className='v10-kinetic';layer.setAttribute('aria-hidden','true');
     canvas.parentElement.appendChild(layer);this.kineticLayer=layer;
  }
  render(t){
    const dt=clip((t-(this.lastMotionFrame??t))/1000,0,.075);this.lastMotionFrame=t;
    const measured=Number(this.actualTicksPerSecond)||0,requested=this.requestedSpeed||1;
    // At 100x, the visualized work moves faster, but never claims the solver completed 100x work.
    this.visualTempo=this.running?clip(1+.82*Math.log2(requested)+.25*Math.log2(1+measured),1,8.2):0;
    this.motionTime+=dt*this.visualTempo;
    if(this.fallback){super.render(t);this.drawFallbackFlow(t);return;}
    // Original world camera/renderer retained. V10 overlays bounded, state-coupled kinematics.
    super.render(t);
    this.drawFallbackFlow(t);
  }
  drawFallbackFlow(t){
    const canvas=this.kineticLayer;if(!canvas)return;const rect=this.canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    let dpi=Math.min(window.devicePixelRatio||1,2),tw=Math.round(w*dpi),th=Math.round(h*dpi);if(canvas.width!==tw||canvas.height!==th){canvas.width=tw;canvas.height=th;}
    const c=canvas.getContext('2d');c.setTransform(dpi,0,0,dpi,0,0);c.clearRect(0,0,w,h);
    // Native WebGL renders physical work-item geometry. 2D fallback uses small transparent
    // motion trails only when simulator is running, never fake successful processing.
    if(!this.fallback||!this.running)return;
    const jobs=this.state?.objects||[],active=jobs.filter(j=>j.status==='MOVING'),waiting=jobs.filter(j=>j.status==='WAIT');
    const m=this.motionTime,renderBox=(x,y,col)=>{c.fillStyle=col;c.fillRect(x-4,y-4,8,8);c.fillStyle='rgba(255,255,255,.8)';c.fillRect(x-4,y-4,8,1.5);};
    c.save();c.lineWidth=1.8;
    for(let k=0;k<Math.min(12,waiting.length);k++){let f=(m*.22+k*.14)%1,x=w*(.27+.21*f),y=h*(.58+(k%3)*.018);renderBox(x,y,waiting[k].blocked?'rgba(224,116,92,.85)':'rgba(29,178,153,.82)');}
    for(let k=0;k<Math.min(12,active.length);k++){let f=(m*.14+k*.21)%1,x,y;if(f<.55){x=w*(.35+.35*f/.55);y=h*(.72-.13*f/.55)}else{x=w*(.70+.19*(f-.55)/.45);y=h*(.59-.15*(f-.55)/.45)}
      c.strokeStyle=this.name==='relay'?'rgba(23,157,129,.65)':'rgba(190,155,86,.65)';c.beginPath();c.moveTo(x-10,y+6);c.lineTo(x-1,y+2);c.stroke();renderBox(x,y,active[k].cold?'rgba(41,165,211,.94)':'rgba(24,145,120,.92)');}
    c.restore();
  }
  slotCargo(objects,simTime){
    super.slotCargo(objects,simTime);
    if(!this.gl||this.airport)return;
    const jobs=Array.isArray(objects)?objects:[],waiting=jobs.filter(j=>j.status==='WAIT'),active=jobs.filter(j=>j.status==='MOVING'),done=Number(this.state?.completed||0);
    const m=this.motionTime,s=Math.sin,pi=Math.PI;
    // Conveyor queue: visible only with actual outstanding work. Cargo circulates within staging;
    // these visual work-in-process movements do not assert a service completion.
    const n=Math.min(waiting.length,32);
    for(let i=0;i<n;i++){
      const j=waiting[i],h=((i*.13+m*.16)%1),track=i%3;
      const x=-20.2+h*12.2,z=5.0+track*1.0;
      this.box(x,.43,z,.78,.72,.70,j.blocked?[.83,.33,.27]:j.cold?[.24,.72,.84]:this.name==='relay'?[.19,.71,.56]:[.88,.68,.41]);
      this.box(x,.81,z,.8,.035,.71,[.92,.95,.92]);
    }
    // Forklifts and towing tractors traverse fixed apron aisles, never arbitrary random x/y jitter.
    // Number of visible transfer paths is bounded by ACTUAL active work-order population.
    for(let i=0;i<Math.min(active.length,10);i++){
      const j=active[i],speed=.12+(j.priority===3?.07:0),p=(m*speed+i*.37)%1,row=i%4;
      let x,z,heading;
      if(p<.34){x=-20+28*(p/.34);z=12.1+row*.65;heading=0;}
      else if(p<.60){x=8+row*.35;z=12.1-22*((p-.34)/.26);heading=-pi/2;}
      else {x=8+12*((p-.60)/.4);z=-9.9-row*.85;heading=0;}
      this.tug(x,z,heading,this.name==='relay'?[.045,.68,.54]:[.70,.51,.31],true);
      if(i<5){let u=(m*.14+i*.21)%1;this.box(-7+u*11,1.0,-11+i*.3,.78,.9,.8,j.cold?[.24,.73,.80]:[.88,.72,.49]);}
    }
    // Work completion celebratory lights are triggered ONLY by a larger completed count.
    if(this.previousCompleted===null)this.previousCompleted=done;
    if(done<this.previousCompleted){this.bursts.length=0;}
    else if(done>this.previousCompleted){
      let increase=Math.min(10,done-this.previousCompleted);
      for(let i=0;i<increase;i++)this.bursts.push({born:m,x:7.5+(i%5)*2.0,z:-3.5+Math.floor(i/5)*1.5});
    }
    this.previousCompleted=done;
    this.bursts=this.bursts.filter(b=>m-b.born<1.2);
    for(let b of this.bursts){const a=(m-b.born)/1.2;for(let j=0;j<5;j++){let ang=j*2*pi/5;this.box(b.x+Math.cos(ang)*a*1.2,.35+a*2,b.z+Math.sin(ang)*a*1.2,.17,.18,.17,[.22+.5*a,.93-.3*a,.63]);}}
  }
}
// Rough airport centroids for an illustrative route globe. No actual live aircraft geolocation.
const ports={HKG:[114.17,22.31],NRT:[140.39,35.77],LHR:[-0.454,51.47],SIN:[103.99,1.36],SYD:[151.18,-33.95],FRA:[8.57,50.04],BKK:[100.75,13.69],LAX:[-118.41,33.94],DXB:[55.36,25.25]};
const toRad=Math.PI/180;
function vector(ll){let lon=ll[0]*toRad,lat=ll[1]*toRad;return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)]}
function arcVec(a,b,f,alt){let va=vector(a),vb=vector(b),dot=clip(va.reduce((s,v,i)=>s+v*vb[i],0),-.9999,.9999),ang=Math.acos(dot),den=Math.sin(ang),u=den<.00001?1-f:Math.sin((1-f)*ang)/den,v=den<.00001?f:Math.sin(f*ang)/den,h=1+alt*Math.sin(Math.PI*f);return [(va[0]*u+vb[0]*v)*h,(va[1]*u+vb[1]*v)*h,(va[2]*u+vb[2]*v)*h]}
class NetworkGlobe extends window.RelayV6.CustomerGlobe{
 constructor(canvas){super(canvas);this.routes=[];this.selected=null;this.targetLon=null;this.targetLat=null;this.lastPointer=0;this.animStart=performance.now();this.renderClock=0;this.lastRenderFrame=null;this.running=false;this.requestedSpeed=1;canvas.addEventListener('pointerdown',()=>{this.targetLon=null;this.lastPointer=performance.now()});}
 focusAirport(code){const p=ports[code];if(!p)return;this.targetLon=p[0]-16;this.targetLat=clip(p[1]+4,-55,60);}
 setRoute(a,b){this.route=[ports[a]?a:'HKG',ports[b]?b:'NRT'];if(this.selected!==b){this.selected=b;this.focusAirport(b)}}
 setRoutes(shipments,selected){
   const list=(shipments||[]).filter(j=>ports[j.destination]&&j.destination!=='HKG');
   this.routes=list.slice(0,50).map((j,i)=>({awb:j.awb,destination:j.destination,priority:Number(j.priority)>=3?'CRITICAL':Number(j.priority)>=2?'PRIORITY':'STANDARD',cold:j.handling==='COL',
     blocked:Boolean(j.blocked_reason||j.dimension_conflict||j.customs_hold),phase:j.stage_relay||'WAIT',
     selected:j.awb===selected,index:i,assignedFlight:j.assigned_flight_id||null}));
   this.selectedAwb=selected;
 }
 routeColor(q){return q.blocked||q.phase==='HOLD'?'#e57363':q.phase==='DONE'?'#20ad78':q.phase==='WORK'?'#18a991':q.priority==='CRITICAL'?'#e98736':q.cold?'#179ed0':'#8aa5b1'}
 render(time){
  if(this.targetLon!==null&&!this.drag){let dl=((this.targetLon-this.lon+540)%360)-180;this.lon+=dl*.07;this.lat+=(this.targetLat-this.lat)*.07;if(Math.abs(dl)<.07&&Math.abs(this.targetLat-this.lat)<.07)this.targetLon=null;}
  const dt=clip((time-(this.lastRenderFrame??time))/1000,0,.08);this.lastRenderFrame=time;
  if(this.running)this.renderClock+=dt*1000*clip(1+.83*Math.log2(this.requestedSpeed||1),1,7);
  const animationTime=this.renderClock;
  super.render(animationTime);
  const c=this.c,R=this.r,drawn=this.routes||[];let selectedRoute=null;
  // Draw EVERY currently admitted route (up to explicit visual cap), with altitude and
  // correct hemisphere occlusion. These are synthetic route previews, NOT live flight paths.
  const drawRoute=(q)=>{
    let origin=ports.HKG,dest=ports[q.destination];if(!dest)return;
    const lift=.13+((q.index%5)*.032),N=84,col=this.routeColor(q),pts=[];
    for(let k=0;k<=N;k++){
      const f=k/N,v=arcVec(origin,dest,f,lift),point=this.project(v),cam=this.xyz(v);
      // A backside point is hidden if the sphere intersects the view ray between it and camera.
      const occluded=cam[1]<0 && cam[0]*cam[0]+cam[2]*cam[2]<1.005;
      pts.push({...point,visible:!occluded,f,depth:cam[1]});
    }
    c.save();c.beginPath();let drawing=false;
    pts.forEach(p=>{if(p.visible){drawing?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);drawing=true}else drawing=false});
    c.lineWidth=q.selected?3.7:1.5;c.globalAlpha=q.selected?.98:.30;
    if(q.selected){c.shadowBlur=16;c.shadowColor=col;}
    c.strokeStyle=col;c.stroke();c.restore();
    // A moving light pulse travels along the actual plotted arc. This is a data-flow marker,
    // not a claim about current aircraft location.
    const phase=((animationTime*.000092*(1+(q.index%4)*.08)+q.index*.137)%1),ix=Math.floor(phase*N),p=pts[ix];
    if(p?.visible){c.save();c.shadowColor=col;c.shadowBlur=q.selected?17:11;c.fillStyle=col;c.globalAlpha=q.selected?1:.78;c.beginPath();c.arc(p.x,p.y,q.selected?5.1:2.7,0,Math.PI*2);c.fill();c.restore();}
    if(q.selected)selectedRoute={route:q,points:pts};
  };
  drawn.filter(x=>!x.selected).forEach(drawRoute);
  const s=drawn.find(x=>x.selected);if(s)drawRoute(s);
  // Labels are only drawn on the visible hemisphere, avoiding stickers on rear geography.
  const uniq=[...new Set(drawn.map(q=>q.destination))];
  c.save();c.font='700 10px Segoe UI,Arial,sans-serif';
  for(let code of uniq){let p=this.geo(ports[code]);if(!p.visible||p.depth<.07)continue;
    const highlight=s?.destination===code;
    c.fillStyle=highlight?'#0b786f':'rgba(255,255,255,.87)';c.strokeStyle=highlight?'#0b786f':'#8eb6b1';
    c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,highlight?5.5:3.5,0,Math.PI*2);c.fill();c.stroke();
    if(highlight){c.fillStyle='#123f45';c.textAlign='center';c.fillText(code,p.x,p.y-14);}
  }
  c.restore();
 }
}
window.RelayV6={...window.RelayV6,GroundScene:FlowWorld,CustomerGlobe:NetworkGlobe};
window.RELAY_V10_SCENE={version:'10.0',ground:'state-coupled-kinematic-visualization',globe:'all-routes-occluded-elevated-arcs',certified:false};
})();
