/* RELAY v6 · standalone, dependency-free, canvas-based 3D SCHEMATIC visuals.
   Actual decisions and work orders come from v5 Python state. Aircraft / equipment motion
   is illustrative. No physical positioning or authoritative flight coordinates are implied. */
(()=>{'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const rgb=(hex)=>{const h=hex.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const color=(a,b,t)=>{let x=rgb(a),y=rgb(b);return `rgb(${x.map((v,i)=>Math.round(mix(v,y[i],clamp(t,0,1)))).join(',')})`};
function screenCanvas(canvas){const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);const w=Math.max(100,rect.width),h=Math.max(100,rect.height);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w,h};}
const camera={yaw:-.77,pitch:.74,zoom:1.03};
class GroundScene{
 constructor(canvas,name){this.canvas=canvas;this.name=name;this.state=null;this.hour=13;this.incident=false;this.currentTarget=null;this.drag=false;this.last=[0,0];
  canvas.addEventListener('pointerdown',e=>{this.drag=true;this.last=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!this.drag)return;camera.yaw+=((e.clientX-this.last[0])*.008);camera.pitch=clamp(camera.pitch+(e.clientY-this.last[1])*.004,.35,1.25);this.last=[e.clientX,e.clientY]});
  ['pointerup','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>this.drag=false));
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*.001),.73,1.5)},{passive:false});
 }
 pos(x,y,z){let cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),a=x*cy-z*sy,b=x*sy+z*cy;return {x:this.w*.50+a*this.scale,y:this.h*.63+(b*Math.sin(camera.pitch)-y*Math.cos(camera.pitch))*this.scale,depth:b*Math.cos(camera.pitch)+y*Math.sin(camera.pitch)}}
 poly(pts,fill,stroke=null,alpha=1){let c=this.c;c.save();c.beginPath();pts.forEach((p,i)=>{let q=this.pos(...p);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y)});c.closePath();c.globalAlpha=alpha;c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.8;c.stroke()}c.restore()}
 line(a,b,stroke,width=1,dash=[]){let c=this.c,x=this.pos(...a),y=this.pos(...b);c.save();c.strokeStyle=stroke;c.lineWidth=width;c.setLineDash(dash);c.beginPath();c.moveTo(x.x,x.y);c.lineTo(y.x,y.y);c.stroke();c.restore()}
 box(x,y,z,w,h,d,fill,edge=null){let p=[[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2],[x-w/2,y+h,z-d/2],[x+w/2,y+h,z-d/2],[x+w/2,y+h,z+d/2],[x-w/2,y+h,z+d/2]];
 let f=[{id:[0,1,5,4],s:.82},{id:[1,2,6,5],s:.76},{id:[2,3,7,6],s:.68},{id:[3,0,4,7],s:.88},{id:[4,5,6,7],s:1.06}];f.sort((a,b)=>b.id.reduce((v,i)=>v+this.pos(...p[i]).depth,0)-a.id.reduce((v,i)=>v+this.pos(...p[i]).depth,0));f.forEach(q=>this.poly(q.id.map(i=>p[i]),this.light(fill,q.s),edge||'rgba(46,92,94,.18)'));}
 light(c,k=1){let a=rgb(c);let night=clamp(this.dark,0,.78);return `rgb(${a.map((v,i)=>Math.round(clamp(v*k*(1-night*.55)+([15,32,43][i])*night*.23,0,255))).join(',')})`}
 bubble(t,x,y,z,fill='#294d52',size=10){const q=this.pos(x,y,z),c=this.c;c.save();c.font=`700 ${size}px DM Sans,Segoe UI,sans-serif`;c.textAlign='center';c.textBaseline='middle';let w=c.measureText(t).width+16;const h=19;c.fillStyle=this.dark>.6?'rgba(13,36,50,.84)':'rgba(255,255,255,.91)';c.strokeStyle=this.dark>.6?'#739cab':'#d6e7e3';c.lineWidth=.8;c.beginPath();c.roundRect(q.x-w/2,q.y-h/2,w,h,5);c.fill();c.stroke();c.fillStyle=this.dark>.6?'#eef8f4':fill;c.fillText(t,q.x,q.y);c.restore()}
 circle(x,y,z,r,fill,glow=0){let p=this.pos(x,y,z),c=this.c;c.save();if(glow){c.shadowColor=fill;c.shadowBlur=glow};c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fillStyle=fill;c.fill();c.restore()}
 plane(x,z,t,active=false){const wing=active?'#168e85':'#90b6b4';this.box(x,.56,z,3.6,.28,.45,'#f8ffff');this.box(x-1.54,.53,z,.36,.32,.45,wing);
 this.poly([[x-.2,.83,z-2],[x+.65,.83,z],[x-.2,.83,z+2],[x-1.04,.83,z]],wing,'#a6bfc1');
 this.poly([[x-1.42,.83,z-.30],[x-1.82,.83,z],[x-1.42,.83,z+.30]],'#4e938e');
 this.poly([[x-1.51,.9,z],[x-1.88,1.48,z],[x-1.14,.86,z]],wing);
 for(let i=0;i<5;i++)this.circle(x-.84+i*.48,.77,z-.20,1.6,'#33666a');
 if(this.dark>.48){this.circle(x+1.65,.67,z,3,'#ffd596',9);this.circle(x-1.45,.78,z+.17,2,'#f26564',7)}
 }
 forklift(x,z,t,accent='#1c9889'){let bounce=Math.sin(t*.0018)*.03;this.box(x,.1+bounce,z,.65,.35,.47,accent);this.box(x-.14,.44+bounce,z,.31,.38,.37,'#f2f7f2');this.box(x+.37,.11+bounce,z,.35,.08,.3,'#bdaf7e');this.circle(x-.22,.14,z+.22,2.2,'#2b4e5a');this.circle(x+.22,.14,z+.22,2.2,'#2b4e5a')}
 worker(x,z,t){let bob=Math.sin(t*.002+x)*.04;this.circle(x,.7+bob,z,3.4,'#e3ad78');this.line([x,.18,z],[x,.57+bob,z],'#317a78',3);this.line([x,.19,z],[x-.2,.02,z+.13],'#39666d',2);this.line([x,.19,z],[x+.2,.02,z-.12],'#39666d',2)}
 render(t){({ctx:this.c,w:this.w,h:this.h}=screenCanvas(this.canvas));this.scale=Math.min(this.w/24,this.h/17.5)*camera.zoom;const c=this.c,hour=this.hour;let day=Math.max(0,Math.sin((hour-5.5)/13*Math.PI)),sunset=Math.exp(-Math.pow((hour-18.1)/2.2,2)),dark=clamp(1-day*.93,0,.95);this.dark=dark;
 let skyTop=color('#f1f9f9','#123449',dark),skyBottom=color('#d7e9f0','#527087',dark);// Lighting gradient is computed from the synthetic visual hour below.
 const g=c.createLinearGradient(0,0,0,this.h);g.addColorStop(0,`rgb(${[mix(221,14,dark),mix(241,44,dark),mix(247,65,dark)].map(Math.round).join(',')})`);g.addColorStop(.68,`rgb(${[mix(241,48,dark)+sunset*12,mix(248,71,dark)+sunset*17,mix(246,91,dark)].map(x=>Math.round(x)).join(',')})`);g.addColorStop(1,`rgb(${[mix(248,85,dark),mix(252,111,dark),mix(249,121,dark)].map(Math.round).join(',')})`);c.fillStyle=g;c.fillRect(0,0,this.w,this.h);
 if(dark>.38){for(let i=0;i<38;i++){let x=(i*169.5+22)%this.w,y=(i*37.1+19)%(this.h*.52);c.fillStyle=`rgba(255,255,255,${Math.min(.6,dark*.7)*(i%3===0?.7:.3)})`;c.fillRect(x,y,1.1,1.1)}}
 // atmospheric rays and sun/moon
 let lx=this.w*.83,ly=this.h*.15;c.save();c.shadowBlur=30;c.shadowColor=dark>.57?'#dae6e6':'#f8d89d';c.fillStyle=dark>.57?'#e8f2f2':sunset>.28?'#f4af80':'#ffefc0';c.beginPath();c.arc(lx,ly,dark>.57?9:13,0,Math.PI*2);c.fill();c.restore();
 // schematic airport ground
 this.poly([[-11,0,-8],[11,0,-8],[11,0,8],[-11,0,8]],this.light('#dbe7e3'),this.light('#b5ceca'));
 for(let i=-10;i<=10;i+=2)this.line([i,.012,-7.9],[i,.012,7.9],this.dark>.5?'#396777':'#c0d4d0',.55);
 for(let i=-7;i<=7;i+=2)this.line([-11,.015,i],[11,.015,i],this.dark>.5?'#396777':'#c0d4d0',.55);
 // dedicated runway and ramp
 this.poly([[-10,.035,4.5],[10,.035,4.5],[10,.035,7.1],[-10,.035,7.1]],this.light('#829da3'));
 for(let x=-9;x<10;x+=2.2)this.poly([[x,.045,5.73],[x+1,.045,5.73],[x+1,.045,5.82],[x,.045,5.82]],this.light('#f9faf2'));
 this.poly([[-1.8,.06,-5.6],[9.6,.06,-5.6],[9.6,.06,3.7],[-1.8,.06,3.7]],this.light('#b2c5c6'));
 for(let x=-1;x<=8;x+=2)this.line([x,.075,-5.6],[x,.075,3.6],this.dark>.5?'#7295a1':'#e1edeb',1,[4,7]);
 this.box(-7.5,.10,-4.5,4.3,1.75,4.1,'#82b1ae');this.box(-7.5,1.91,-4.5,4.7,.22,4.45,'#e4f0ec');
 this.box(-6.6,.12,-.35,5.3,1.95,3.1,'#78a2a8');this.box(-6.6,2.1,-.35,5.7,.22,3.5,'#e7f3ef');
 for(let i=0;i<6;i++)this.box(-8.8+i*.92,.30,1.23,.5,.72,.07,'#d8f5ee');
 this.box(-4.35,.1,-5.6,2.4,1.18,2.1,'#3eaca4');this.box(-4.35,1.30,-5.6,2.65,.14,2.4,'#d1fff1');
 this.bubble('CARGO TERMINAL',-6.6,2.55,-.35);this.bubble('COLD CHAIN',-4.35,1.75,-5.6);this.bubble('ULD / STAGING',2,.25,-5.5);
 this.plane(3.6,-2.5,t,(this.state?.active||0)>0);this.plane(6.4,1.1,t,(this.state?.active||0)>1);
 let taxi=(t*.00006+(this.state?.completed||0)*.018)%1;this.plane(-8.3+16.5*taxi,5.85,t,true);
 for(let z of [-.4,1.9])for(let x of [1.6,4.8,7.4]){this.circle(x,.07,z,2.2,dark>.5?'#ffdf8e':'#f8f5d2',dark>.5?12:0)}
 const objs=this.state?.objects||[];let waiting=objs.filter(x=>x.status==='WAIT').slice(-36),active=objs.filter(x=>x.status==='MOVING').slice(0,8);
 waiting.forEach((j,i)=>{let col=i%7,row=Math.floor(i/7),x=-.8+col*.78,z=-3.9+row*.86;this.box(x,.09,z,.64,.38+(j.priority===3?.20:0),.60,j.blocked?'#cb786b':j.cold?'#51c5ca':this.name==='relay'?'#79b8a3':'#c8ad86')});
 active.forEach((j,i)=>{let p=clamp((j.progress||0)+Math.sin(t*.001)*.018,0,1),x=-1.15+p*7.2,z=-.15+(i%3)*1.1;this.forklift(x,z,t,this.name==='relay'?'#0fa992':'#b5a079');this.box(x+.5,.07,z,.55,.46,.55,j.cold?'#5fd5d1':'#d5c18c')});
 for(let i=0;i<Math.min(5,1+Math.floor((this.state?.active||0)*2));i++){let x=-2.2+i*1.1+Math.sin(t*.0007+i)*.20,z=2+i*.55;this.worker(x,z,t)}
 if(this.incident){this.circle(1.45,.15,3.8,6,'#ff8d5f',18);this.bubble('DISRUPTION',1.45,.96,3.8,'#c15236',9)}
 if(waiting.length)this.bubble('QUEUE '+(this.state?.waiting||waiting.length),.85,.85,-3.8,waiting.length>8?'#ad692c':'#36565d',10);
 if(dark>.56){for(let i=0;i<5;i++){this.circle(-8+i*3,.02,3.7,2.2,'#ffd79f',12)}}
 const badge=c.createLinearGradient(0,0,this.w,0);badge.addColorStop(0,'rgba(255,255,255,.85)');badge.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=badge;c.fillRect(0,0,this.w,34);c.fillStyle='#476e73';c.font='700 9px DM Sans,Segoe UI,sans-serif';c.fillText(this.name==='relay'?'RELAY · SYNTHETIC DISPATCH':'BASELINE · SYNTHETIC DISPATCH',14,20);
 }
}
// Public-domain-style simplified continent polygons, drawn ourselves; visual approximation only.
const land=[
 [[-167,70],[-143,70],[-127,61],[-124,50],[-125,40],[-117,32],[-111,31],[-106,24],[-97,15],[-85,10],[-82,25],[-90,29],[-83,31],[-81,45],[-67,48],[-61,57],[-78,63],[-92,69],[-105,73],[-135,70]],
 [[-80,12],[-72,11],[-65,10],[-57,4],[-50,-2],[-49,-14],[-43,-23],[-50,-31],[-53,-39],[-68,-55],[-74,-44],[-79,-25],[-80,-2]],
 [[-11,36],[-9,44],[0,50],[10,55],[26,59],[34,70],[46,70],[50,62],[40,52],[33,41],[21,35],[12,35],[9,42],[2,43],[-2,36]],
 [[-17,37],[4,37],[13,32],[21,30],[30,21],[35,10],[45,1],[42,-13],[34,-23],[29,-33],[18,-35],[10,-29],[12,-14],[4,5],[-7,6],[-14,22]],
 [[30,40],[40,52],[50,60],[70,63],[96,72],[121,70],[144,61],[152,52],[142,43],[129,35],[121,23],[112,21],[110,10],[100,6],[105,-6],[95,-10],[90,7],[80,13],[73,20],[65,25],[59,28],[50,30],[44,37]],
 [[115,-10],[128,-10],[136,-16],[138,-28],[153,-28],[153,-37],[145,-41],[130,-34],[116,-34],[112,-24]],
 [[44,-12],[50,-13],[51,-24],[46,-26],[43,-17]], [[-52,60],[-42,60],[-42,76],[-52,82],[-61,77]],
 [[-9,59],[-4,58],[1,53],[-5,50],[-11,54]], [[127,45],[142,45],[147,38],[137,34],[130,39]],
 [[120,24],[122,23],[121,21],[119,22]],[[101,20],[105,15],[109,10],[115,5],[119,-5],[126,-3],[125,7],[120,14],[114,21]],
 [[-180,-72],[-130,-70],[-70,-73],[0,-73],[70,-72],[145,-71],[180,-73],[180,-90],[-180,-90]]
];
const airports={HKG:[114.17,22.31],NRT:[140.39,35.77],SIN:[103.99,1.36],BKK:[100.75,13.69],LHR:[-.454,51.47],SYD:[151.18,-33.94],FRA:[8.57,50.05],JFK:[-73.78,40.64],AMS:[4.76,52.31],PVG:[121.8,31.14],ICN:[126.45,37.46],LAX:[-118.40,33.94],CDG:[2.55,49.0],TPE:[121.23,25.08],SFO:[-122.37,37.62],DXB:[55.36,25.25],HND:[139.78,35.55],MEL:[144.84,-37.67],MUC:[11.78,48.35],ORD:[-87.91,41.98],YYZ:[-79.63,43.68]};
const rad=Math.PI/180,vec=([lon,lat])=>[Math.cos(lat*rad)*Math.cos(lon*rad),Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad)];
function slerp(a,b,t){let x=vec(a),y=vec(b),omega=Math.acos(clamp(x.reduce((s,v,i)=>s+v*y[i],0),-1,1)),k=Math.abs(omega)<.0001?0:Math.sin(omega);let v=x.map((z,i)=>k?z*Math.sin((1-t)*omega)/k+y[i]*Math.sin(t*omega)/k:mix(z,y[i],t));return v}
class CustomerGlobe{
 constructor(canvas){this.canvas=canvas;this.lon=111;this.lat=18;this.route=['HKG','NRT'];this.drag=false;this.last=[0,0];canvas.addEventListener('pointerdown',e=>{this.drag=true;this.last=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.lon-=((e.clientX-this.last[0])*.45);this.lat=clamp(this.lat+(e.clientY-this.last[1])*.34,-60,60);this.last=[e.clientX,e.clientY]});['pointerup','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>this.drag=false));}
 reset(){this.lon=111;this.lat=18}setRoute(a,b){this.route=[airports[a]?a:'HKG',airports[b]?b:'NRT'];let d=airports[this.route[1]];this.lon=(114.17+d[0])/2;this.lat=(22.31+d[1])/2}
 xyz(v){let lo=this.lon*rad,la=this.lat*rad,c=Math.cos(lo),s=Math.sin(lo);let x=v[1]*c-v[0]*s,z=v[1]*s+v[0]*c;return [x,z*Math.cos(la)+v[2]*Math.sin(la),-z*Math.sin(la)+v[2]*Math.cos(la)]}
 project(v){let q=this.xyz(v);return {x:this.cx+q[0]*this.r,y:this.cy-q[2]*this.r,visible:q[1]>-.01,depth:q[1]}}
 geo(q){return this.project(vec(q))}
 path(points,stroke,width=1,alpha=1,dash=[]){const c=this.c;c.save();c.beginPath();let running=false;for(let i=0;i<points.length;i++){let p=points[i];if(p.visible){running?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);running=true}else running=false}c.strokeStyle=stroke;c.lineWidth=width;c.globalAlpha=alpha;c.setLineDash(dash);c.stroke();c.restore()}
 label(x,y,t,bg='#fff'){let c=this.c;c.save();c.font='800 10px DM Sans,Segoe UI,sans-serif';let w=c.measureText(t).width+16;c.fillStyle=bg;c.strokeStyle='#cee6de';c.beginPath();c.roundRect(x-w/2,y-18,w,22,7);c.fill();c.stroke();c.fillStyle='#1c6462';c.textAlign='center';c.fillText(t,x,y-4);c.restore()}

 renderCustomerSurface(){
  const c=this.c;this.r=Math.min(this.w*.39,this.h*.40);this.cx=this.w/2;this.cy=this.h*.50;
  const R=this.r;
  // Sample the schematic land once. Individual dots clip cleanly at the horizon.
  if(!this.landDots){
   this.landDots=[];
   for(let lat=-68;lat<=80;lat+=2.5)for(let lon=-180;lon<180;lon+=2.5/Math.max(.25,Math.cos(lat*rad))){
    const inside=land.some(poly=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
     const a=poly[i],b=poly[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }return hit;});if(inside)this.landDots.push(vec([lon,lat]));
   }
  }
  const halo=c.createRadialGradient(this.cx,this.cy,R*.85,this.cx,this.cy,R*1.22);
  halo.addColorStop(0,'#3e9b9026');halo.addColorStop(1,'#3e9b9000');c.fillStyle=halo;c.fillRect(0,0,this.w,this.h);
  const ocean=c.createRadialGradient(this.cx-R*.4,this.cy-R*.5,0,this.cx,this.cy,R*1.2);
  ocean.addColorStop(0,'#255e65');ocean.addColorStop(.65,'#123d47');ocean.addColorStop(1,'#092b36');
  c.fillStyle=ocean;c.beginPath();c.arc(this.cx,this.cy,R,0,Math.PI*2);c.fill();
  for(let lat=-60;lat<=60;lat+=30){const pts=[];for(let lon=-180;lon<=180;lon+=3)pts.push(this.geo([lon,lat]));this.path(pts,'#8ac5c0',.6,.15);}
  for(let lon=-180;lon<180;lon+=30){const pts=[];for(let lat=-90;lat<=90;lat+=3)pts.push(this.geo([lon,lat]));this.path(pts,'#8ac5c0',.6,.15);}
  for(const v of this.landDots){const p=this.project(v);if(p.depth<.03)continue;c.fillStyle=`rgba(153,211,193,${.25+.65*p.depth})`;c.beginPath();c.arc(p.x,p.y,Math.max(.65,R*.006),0,Math.PI*2);c.fill();}
  c.strokeStyle='#6aa69f66';c.lineWidth=1;c.beginPath();c.arc(this.cx,this.cy,R,0,Math.PI*2);c.stroke();
 }

 render(t){({ctx:this.c,w:this.w,h:this.h}=screenCanvas(this.canvas));let c=this.c;c.clearRect(0,0,this.w,this.h);if(this.canvas.dataset.style==='customer'){this.renderCustomerSurface();return;}this.r=Math.min(this.w*.33,this.h*.38);this.cx=this.w/2;this.cy=this.h*.50+6;
 let g=c.createRadialGradient(this.cx-this.r*.38,this.cy-this.r*.46,this.r*.10,this.cx,this.cy,this.r*1.18);g.addColorStop(0,'#fcffff');g.addColorStop(.73,'#d7f0e9');g.addColorStop(1,'#a2cec5');c.fillStyle=g;c.beginPath();c.arc(this.cx,this.cy,this.r,0,Math.PI*2);c.fill();c.strokeStyle='#9fcabc';c.lineWidth=1.1;c.stroke();
 c.save();c.beginPath();c.arc(this.cx,this.cy,this.r-1,0,Math.PI*2);c.clip();
 for(let lat=-75;lat<=75;lat+=15){let pts=[];for(let lon=-180;lon<=180;lon+=3)pts.push(this.geo([lon,lat]));this.path(pts,'#9fc9c6',.65,.53)}
 for(let lon=-180;lon<180;lon+=15){let pts=[];for(let lat=-90;lat<=90;lat+=3)pts.push(this.geo([lon,lat]));this.path(pts,'#b0d8d1',.65,.45)}
 // land visible portions, break on horizon; simplified geometry is not geographic authority
 for(let poly of land){let pts=[];for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length];for(let j=0;j<12;j++){let f=j/12;pts.push(this.geo([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]))}}let shown=pts.filter(p=>p.visible);if(shown.length>2){c.save();c.beginPath();let first=true;pts.forEach(p=>{if(p.visible){first?c.moveTo(p.x,p.y):c.lineTo(p.x,p.y);first=false}else first=true});c.strokeStyle='#8abdb1';c.lineWidth=8;c.lineJoin='round';c.stroke();c.strokeStyle='#acd1c7';c.lineWidth=5;c.stroke();c.restore()}}
 const origin=airports[this.route[0]],dest=airports[this.route[1]];if(origin&&dest){const arc=[];for(let i=0;i<=120;i++)arc.push(this.project(slerp(origin,dest,i/120)));this.path(arc,'rgba(255,255,255,.9)',5,.95);this.path(arc,'#087f75',2.9,.94);this.path(arc,'#0f8b7a',1.2,.7,[5,8]);
 const pp=this.project(slerp(origin,dest,(t*.00008)%1));if(pp.visible){c.fillStyle='#0d8072';c.shadowBlur=18;c.shadowColor='#0d8072';c.beginPath();c.arc(pp.x,pp.y,6,0,Math.PI*2);c.fill();c.shadowBlur=0;c.fillStyle='#fff';c.beginPath();c.arc(pp.x,pp.y,2.5,0,Math.PI*2);c.fill()}}
 c.restore();
 // limb highlight/gloss
 let gloss=c.createRadialGradient(this.cx-this.r*.52,this.cy-this.r*.58,5,this.cx-this.r*.24,this.cy-this.r*.28,this.r*1.25);gloss.addColorStop(0,'rgba(255,255,255,.52)');gloss.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=gloss;c.beginPath();c.arc(this.cx,this.cy,this.r,0,Math.PI*2);c.fill();
 if(origin&&dest){let a=this.geo(origin),b=this.geo(dest);for(let [p,txt] of [[a,this.route[0]],[b,this.route[1]]]){if(!p.visible)continue;c.fillStyle='#fff';c.beginPath();c.arc(p.x,p.y,7.5,0,Math.PI*2);c.fill();c.fillStyle='#057e70';c.beginPath();c.arc(p.x,p.y,4.3,0,Math.PI*2);c.fill();this.label(p.x,p.y-13,txt)}}
 // rings around globe
 c.save();c.strokeStyle='rgba(36,152,137,.13)';c.lineWidth=1;for(let i=1;i<=2;i++){c.beginPath();c.arc(this.cx,this.cy,this.r+10+i*17,0,Math.PI*2);c.stroke()}c.restore();
 }
}
window.RelayV6={GroundScene,CustomerGlobe};
})();
