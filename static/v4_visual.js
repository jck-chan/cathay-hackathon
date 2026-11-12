/* RELAY live simulation theatre.
   A tiny dependency-free 3D world renderer over real 3D coordinates. The
   operational state is produced by the Python exact dispatch engine; network recovery uses HiGHS. */
'use strict';
const $ = id => document.getElementById(id);
const camera={yaw:-.73,pitch:.64,zoom:1};
let model=null, playing=false, busy=false, timer=null, benchmark=null;
let animationFrame=0, lastArrival=0, toastTimer=null, prevFrame=0, visualTime=0;

async function api(url,body){
  const opt=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  const r=await fetch(url,opt);
  const d=await r.json();
  if(!r.ok)throw Error(d.error||'Simulation backend failed');
  return d;
}
function toast(message,err=false){
  const t=$('toast');t.textContent=message;t.style.borderColor=err?'#ee997c':'#5bbdab';
  t.classList.add('visible');clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('visible'),4500);
}
function fmt(x,n=1){return Number.isFinite(Number(x))?Number(x).toFixed(n):'—'}
function pct(x){return fmt(100*x,1)+'%'}
// Parametric 3D renderer. This is a schematic modelling coordinate system,
// not surveyed geometry or a safety-grade twin of HKIA.
class IsometricTwin {
  constructor(canvas,label){
    this.canvas=canvas;this.policyName=label;this.ctx=canvas.getContext('2d',{alpha:false});
    this.state=null;this.time=0;this.drag=false;this.oldX=0;this.oldY=0;
    canvas.addEventListener('pointerdown',e=>{
      this.drag=true;this.oldX=e.clientX;this.oldY=e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove',e=>{
      if(!this.drag)return;
      camera.yaw+=(e.clientX-this.oldX)*.009;
      camera.pitch=Math.max(.20,Math.min(1.15,camera.pitch+(e.clientY-this.oldY)*.005));
      this.oldX=e.clientX;this.oldY=e.clientY;
    });
    canvas.addEventListener('pointerup',()=>this.drag=false);
    canvas.addEventListener('pointercancel',()=>this.drag=false);
    canvas.addEventListener('wheel',e=>{
      e.preventDefault();
      camera.zoom=Math.max(.64,Math.min(1.75,camera.zoom*Math.exp(-e.deltaY*.001)));
    },{passive:false});
  }
  prepare(){
    const rect=this.canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(320,rect.width),h=Math.max(230,rect.height);
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){
      this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);
    }
    this.ctx.setTransform(dpr,0,0,dpr,0,0);this.w=w;this.h=h;
    this.scale=Math.min(w/25,h/17)*camera.zoom;
  }
  project(x,y,z){
    const c=Math.cos(camera.yaw),s=Math.sin(camera.yaw);
    const xr=x*c-z*s, zr=x*s+z*c;
    return {x:this.w*.51+xr*this.scale,
            y:this.h*.56+(zr*Math.sin(camera.pitch)-y*Math.cos(camera.pitch))*this.scale,
            depth:zr*Math.cos(camera.pitch)+y*Math.sin(camera.pitch)};
  }
  line(a,b,color,width=1,dash=[]){
    const ctx=this.ctx,p=this.project(...a),q=this.project(...b);
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.restore();
  }
  polygon(points,color,outline='#263f49',alpha=1){
    const ctx=this.ctx;
    ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();
    points.forEach((v,i)=>{const p=this.project(...v);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
    ctx.strokeStyle=outline;ctx.lineWidth=.8;ctx.stroke();ctx.restore();
  }
  box(x,y,z,w,h,d,color){
    const pts=[
      [x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2],
      [x-w/2,y+h,z-d/2],[x+w/2,y+h,z-d/2],
      [x+w/2,y+h,z+d/2],[x-w/2,y+h,z+d/2]
    ];
    const faces=[
      {idx:[0,1,5,4],clr:this.shade(color,.66)},
      {idx:[1,2,6,5],clr:this.shade(color,.79)},
      {idx:[2,3,7,6],clr:this.shade(color,.60)},
      {idx:[3,0,4,7],clr:this.shade(color,.75)},
      {idx:[4,5,6,7],clr:this.shade(color,1.15)},
    ];
    faces.sort((a,b)=>b.idx.reduce((n,i)=>n+this.project(...pts[i]).depth,0)-
                      a.idx.reduce((n,i)=>n+this.project(...pts[i]).depth,0));
    for(const f of faces)this.polygon(f.idx.map(i=>pts[i]),f.clr,this.shade(color,.40));
  }
  shade(color,factor){
    let h=color.replace('#','');
    if(h.length===3)h=h.split('').map(x=>x+x).join('');
    const rgb=[0,2,4].map(i=>Math.min(255,Math.max(0,parseInt(h.slice(i,i+2),16)*factor|0)));
    return 'rgb('+rgb.join(',')+')';
  }
  label(text,x,y,z,color='#aacbd1',size=9){
    const p=this.project(x,y,z),ctx=this.ctx;
    ctx.save();ctx.font='700 '+size+'px Inter, Segoe UI, sans-serif';
    ctx.textAlign='center';ctx.fillStyle=color;ctx.shadowBlur=8;
    ctx.shadowColor='#06121c';ctx.fillText(text,p.x,p.y);ctx.restore();
  }
  aircraft(x,z,teal,turn){
    const body=teal?'#45bfb0':'#7f9cad';
    this.box(x,.65+turn*.05,z,3.1,.4,.48,'#d7e9e9');
    this.box(x-1.24,.75+turn*.05,z,.42,.33,.47,body);
    this.polygon([[x-.25,.83,z-2],[x+.5,.83,z],[x-.25,.83,z+2],
                  [x-1.05,.83,z]],body,'#306975');
    this.polygon([[x-1.25,.9,z-.32],[x-1.70,.9,z],[x-1.25,.9,z+.32]],
                '#9bcbd1','#4c7182');
    this.polygon([[x-1.36,.89,z],[x-1.75,1.72,z],[x-1.12,.92,z]],
                '#37887d','#39626d');
    this.box(x+.92,.80,z,.45,.11,.18,'#e9f6f1');
    this.label('SIM-CX',x,.99,z,'#d1e6eb',8);
  }
  environment(t){
    const ctx=this.ctx,w=this.w,h=this.h;
    const grad=ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'#102d3b');grad.addColorStop(.55,'#10242f');
    grad.addColorStop(1,'#081924');
    ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
    // Semi-transparent ground grid indicates research/CAD coordinate space.
    this.polygon([[-11,-.08,-8],[11,-.08,-8],[11,-.08,8],[-11,-.08,8]],
                 '#18313c','#274957');
    for(let x=-10;x<=10;x+=2)this.line([x,.01,-8],[x,.01,8],'#2b4e58',.75);
    for(let z=-8;z<=8;z+=2)this.line([-11,.01,z],[11,.01,z],'#2b4e58',.75);
    // Operational airport zoning: not physically surveyed.
    this.polygon([[-10,.05,4],[10,.05,4],[10,.05,6.8],[-10,.05,6.8]],
                 '#31454d','#47717a');
    for(let x=-9;x<10;x+=2.4){
      this.polygon([[x,.07,5.20],[x+1.15,.07,5.20],
                    [x+1.15,.07,5.36],[x,.07,5.36]],'#b3c8c2','#7c9a9a');
    }
    this.label('RUNWAY · SCHEDULED AIRCRAFT',0,.08,7.15,'#7798a6',9);
    // Cathay City is represented as a separate headquarters / planning node.
    this.box(-8,.06,-5.0,2.6,2.35,2.6,'#42727d');
    this.box(-8,2.42,-5.0,2.9,.15,2.85,'#7baeb1');
    for(let i=0;i<3;i++)this.line([-9.2,.55+i*.56,-3.68],[-6.8,.55+i*.56,-3.68],'#a3c7c9',.9);
    this.label('CATHAY CITY · HQ',-8,2.92,-5,'#a4f6df',10);
    // Cargo processing and cold facility.
    this.box(-5.35,.06,-.6,4.2,1.65,3.05,'#5b8291');
    this.box(-5.35,1.76,-.6,4.5,.15,3.4,'#91bec0');
    this.label('CARGO TERMINAL',-5.35,2.34,-.6,'#d7f5ee',10);
    this.box(-4.1,.05,-3.75,1.7,1.2,1.5,'#2f898b');
    this.box(-4.1,1.26,-3.75,1.88,.12,1.69,'#78d9d4');
    this.label('COLD STORE',-4.1,1.65,-3.75,'#87e1da',8);
    this.polygon([[-2,.03,-4.5],[7,.03,-4.5],[7,.03,2],[-2,.03,2]],
                 '#294a53','#5f7f82');
    for(const sx of [-1,2,5])this.line([sx,.08,-4],[sx,.08,2],'#63868b',1.4,[5,4]);
    this.label('ULD STAGING / RAMP',1.25,.08,2.65,'#6faab2',9);
    if(this.incidentActive){
      this.box(.7,.04,3.2,1.4,.3,.6,'#bf624e');
      this.label('HKG→LHR ALLOCABLE SLOTS = 0',.8,1.28,3.55,'#f7b6a0',9);
    }
    // The number of visually active aircraft stands follows solved handling
    // occupancy. Aircraft are illustrative entities, not real tail numbers.
    const workload=this.state?this.state.active:0;
    this.aircraft(3.65,-2.25,workload>0,Math.sin(t*.0007)*.2);
    this.aircraft(6.35,1.0,workload>1,Math.sin(t*.0009+.4)*.18);
    if(workload>2)this.aircraft(8.0,-3.55,true,Math.sin(t*.0009+.9)*.18);
    // Illustrative taxi choreography coupled to processed cargo count. It is
    // NOT a departure permit, tail-specific schedule, or airline telemetry.
    if(this.state && this.state.completed>0){
      const phase=((this.state.completed%7)+((t/1650)%1))%7/7;
      this.aircraft(-8.3+15.4*phase,5.5,true,0);
      this.label('SIM TAXI · NOT AIR TRAFFIC CONTROL',-3,.09,7.75,'#8aaab2',8);
    }
  }
  drawObjects(t){
    const s=this.state;if(!s)return;
    const waiting=s.objects.filter(x=>x.status==='WAIT').slice(-32);
    const active=s.objects.filter(x=>x.status==='MOVING');
    // Staging stacks grow with the actual queue. Cold items remain tinted cyan.
    waiting.forEach((j,i)=>{
      const row=Math.floor(i/6),col=i%6;
      const color=j.cold?'#53cbda':j.priority===3?'#f5ad80':
                  j.priority===2?'#ddc188':'#6ca9a9';
      this.box(-2.1+col*.69,.08,-2.2+row*.66,.53,.38,.46,color);
    });
    if(waiting.length>0)this.label('QUEUE '+s.waiting,-.25,.86,-2.9,'#ecbd8e',11);
    // Every active task has its own cargo and handling vehicle in the 3D world.
    active.forEach((j,i)=>{
      const p=Math.min(1,Math.max(0,j.progress||0));
      const phase=Math.min(1,p+(t%1000)/1000*.08);
      const x=-3.0+phase*7.3;
      const z=.2+Math.sin(phase*Math.PI)*(-.90)+(i%3)*.9;
      this.box(x,.12,z,.67,.29,.45,this.policyName==='relay'?'#63e8c9':'#d3a285');
      this.box(x-.17,.39,z,.35,.36,.4,'#6f9fa9');
      this.box(x+.24,.25,z,.37,.33,.37,j.cold?'#47c6d6':'#cfb47e');
      this.label(j.id.slice(-4),x,.88,z,'#b4e9e1',8);
    });
  }
  render(t){
    this.prepare();
    this.environment(t);
    this.drawObjects(t);
    const ctx=this.ctx;ctx.save();ctx.strokeStyle='#3d6570';
    ctx.strokeRect(1,1,this.w-2,this.h-2);ctx.restore();
  }
}


window.RelayIsometricTwin = IsometricTwin;
