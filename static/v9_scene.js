/* RELAY v9 · native WebGL2 air-cargo ground digital twin. No external libraries/CDNs.
   Geometric/layout model is illustrative and inspired by public CCT/ICHM descriptions,
   NOT a surveyed terminal or a certified operational/aircraft loading simulator.
   Cargo positions are deterministic visual projections of the SERVER'S work-order states.
   Synthetic vehicle movements stay in designated lanes; no physics-engine safety guarantee. */
(function(){'use strict';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),lerp=(a,b,t)=>a+(b-a)*t;
const rng=(id)=>{let h=2166136261;for(let c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0)/4294967295};
const mat={
 mul(a,b){let o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o},
 model(x,y,z,sx=1,sy=1,sz=1,rot=0){const c=Math.cos(rot),s=Math.sin(rot);return new Float32Array([c*sx,0,-s*sx,0,0,sy,0,0,s*sz,0,c*sz,0,x,y,z,1])},
 perspective(fov,aspect,near,far){let f=1/Math.tan(fov/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0])},
 ortho(l,r,b,t,n,f){return new Float32Array([2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1])},
 look(eye,target){const norm=(v)=>{let l=Math.hypot(...v)||1;return v.map(x=>x/l)};let sub=(a,b)=>a.map((x,i)=>x-b[i]);const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];let z=norm(sub(eye,target)),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-x.reduce((s,v,i)=>s+v*eye[i],0),-y.reduce((s,v,i)=>s+v*eye[i],0),-z.reduce((s,v,i)=>s+v*eye[i],0),1])}
};
const vertex=`#version 300 es\nprecision highp float;layout(location=0)in vec3 pos;layout(location=1)in vec3 nor;uniform mat4 projection,view,model;out vec3 vNormal;out float vDepth;out vec3 vWorld;void main(){vec4 w=model*vec4(pos,1.);vWorld=w.xyz;vNormal=mat3(model)*nor;vec4 p=view*w;vDepth=-p.z;gl_Position=projection*p;}`;
const fragment=`#version 300 es\nprecision mediump float;in vec3 vNormal;in float vDepth;in vec3 vWorld;uniform vec3 base,lightColor,fogColor;uniform vec3 lightDir;uniform float ambient,fogMix;out vec4 color;void main(){vec3 n=normalize(vNormal);float d=max(dot(n,normalize(lightDir)),0.);float shade=ambient+(1.-ambient)*d;float rim=0.035*max(n.y,0.);vec3 shaded=base*shade*lightColor+vec3(rim);float fog=clamp((vDepth-18.)/68.,0.,1.)*fogMix;color=vec4(mix(shaded,fogColor,fog),1.);}`;
function shader(gl,kind,src){let s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function geomBox(){let v=[],n=[];const f=[[[1,0,0],[[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]]],[[-1,0,0],[[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5]]],[[0,1,0],[[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]]],[[0,-1,0],[[-.5,-.5,.5],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5]]],[[0,0,1],[[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[-.5,-.5,.5]]],[[0,0,-1],[[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]]]];for(let [normal,points] of f){for(let i of [0,1,2,0,2,3]){v.push(...points[i]);n.push(...normal)}}return [v,n]}
function cylinder(segments=12){const v=[],n=[];for(let i=0;i<segments;i++){let a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments,c=Math.cos(a),d=Math.sin(a),e=Math.cos(b),f=Math.sin(b);for(let [x,ny,nz,xx,yy,zz] of [[-.5,c,d,.5,c,d],[.5,c,d,.5,e,f],[-.5,e,f,-.5,c,d]]){}const quads=[[[-.5,c,d],[.5,c,d],[.5,e,f]],[[-.5,c,d],[.5,e,f],[-.5,e,f]]];for(let tri of quads)for(let p of tri){v.push(...p);n.push(0,p[1],p[2])}for(let cap of [-.5,.5]){let points=cap<0?[[cap,0,0],[cap,e,f],[cap,c,d]]:[[cap,0,0],[cap,c,d],[cap,e,f]];for(let p of points){v.push(...p);n.push(cap<0?-1:1,0,0)}}}return [v,n]}
function wedge(){// thin wing: extruded swept planform in XZ; tips sweep BACKWARD (toward -X)
 const poly=[[.55,.07],[.18,.42],[-.62,.88],[-.88,.88],[-.32,.42],[-.15,.07],[-.32,-.42],[-.88,-.88],[-.62,-.88],[.18,-.42],[.55,-.07]];
 let v=[],n=[];const put=(pts,normal)=>{for(let p of pts){v.push(...p);n.push(...normal)}};for(let i=1;i<poly.length-1;i++){put([[poly[0][0],.025,poly[0][1]],[poly[i][0],.025,poly[i][1]],[poly[i+1][0],.025,poly[i+1][1]]],[0,1,0]);put([[poly[i+1][0],-.025,poly[i+1][1]],[poly[i][0],-.025,poly[i][1]],[poly[0][0],-.025,poly[0][1]]],[0,-1,0])}for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length],nx=b[1]-a[1],nz=a[0]-b[0],len=Math.hypot(nx,nz)||1;put([[a[0],.025,a[1]],[a[0],-.025,a[1]],[b[0],-.025,b[1]]],[nx/len,0,nz/len]);put([[a[0],.025,a[1]],[b[0],-.025,b[1]],[b[0],.025,b[1]]],[nx/len,0,nz/len])}return [v,n]}
class GLWorld{
 constructor(canvas,name){this.canvas=canvas;this.name=name;this.state={objects:[]};this.hour=11;this.incident=false;this.weather='CLEAR';this.sceneControls={};this.simTick=0;this.running=false;this.requestedSpeed=1;this.actualTicksPerSecond=0;this.simSeconds=0;this.sceneTime=0;this.phase=0;this.pulse=0;this.fallback=null;this.weatherCanvas=null;this.interaction=GLWorld.sharedCamera||(GLWorld.sharedCamera={yaw:-.69,pitch:.72,zoom:1,panX:0,panZ:0,mode:'3D',lastInput:performance.now()});
  try{this.gl=canvas.getContext('webgl2',{antialias:true,preserveDrawingBuffer:false,alpha:false,powerPreference:'high-performance'});if(!this.gl)throw Error('WebGL2 unavailable');this.initGL();}catch(e){console.warn('RELAY v9 WebGL2 fallback',e);this.gl=null;let old=new window.RelayV6Legacy.GroundScene(canvas,name);this.fallback=old}
  const host=this.canvas.parentElement;const rainLayer=document.createElement('canvas');rainLayer.className='scene-weather';rainLayer.setAttribute('aria-hidden','true');host.insertBefore(rainLayer,this.canvas.nextSibling);this.weatherCanvas=rainLayer;
  this.setupInput();
 }
 initGL(){let gl=this.gl,p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);this.prog=p;this.uni={};for(let n of ['projection','view','model','base','lightColor','fogColor','lightDir','ambient','fogMix'])this.uni[n]=gl.getUniformLocation(p,n);this.meshes={};for(let [name,geo] of Object.entries({box:geomBox(),cyl:cylinder(14),wing:wedge()})){let [v,n]=geo,m=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,m);let inter=new Float32Array(v.length*2);for(let i=0;i<v.length/3;i++){inter.set(v.slice(3*i,3*i+3),6*i);inter.set(n.slice(3*i,3*i+3),6*i+3)}gl.bufferData(gl.ARRAY_BUFFER,inter,gl.STATIC_DRAW);this.meshes[name]={buffer:m,count:v.length/3}}gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);}
 setupInput(){const c=this.canvas;let held=false,lx=0,ly=0;const cc=this.interaction;
 c.addEventListener('pointerdown',e=>{held=true;lx=e.clientX;ly=e.clientY;cc.lastInput=performance.now();try{c.setPointerCapture(e.pointerId)}catch{}});
 c.addEventListener('pointermove',e=>{if(!held)return;let dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;cc.lastInput=performance.now();if(cc.mode==='3D'){cc.yaw+=dx*.007;cc.pitch=clamp(cc.pitch+dy*.006,.28,1.35)}else{cc.panX+=(dx/Math.max(c.clientWidth,1))*75*cc.zoom;cc.panZ+=(dy/Math.max(c.clientHeight,1))*50*cc.zoom}});
 for(let ev of ['pointerup','pointercancel','lostpointercapture'])c.addEventListener(ev,()=>held=false);
 c.addEventListener('wheel',e=>{e.preventDefault();cc.zoom=clamp(cc.zoom*Math.exp(e.deltaY*.0009),.52,2.2);cc.lastInput=performance.now()},{passive:false});
 c.addEventListener('dblclick',()=>{cc.yaw=-.69;cc.pitch=.72;cc.zoom=1;cc.panX=0;cc.panZ=0;cc.lastInput=performance.now()});
 }
 setMode(mode){this.interaction.mode=mode==='2D'?'2D':'3D';this.interaction.lastInput=performance.now()}
 draw(kind,x,y,z,w,h,d,color,rot=0){const gl=this.gl,mesh=this.meshes[kind];gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.enableVertexAttribArray(0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);gl.uniformMatrix4fv(this.uni.model,false,mat.model(x,y,z,w,h,d,rot));let [r,g,b]=color;gl.uniform3f(this.uni.base,r,g,b);gl.drawArrays(gl.TRIANGLES,0,mesh.count);this.drawCalls++}
 box(x,y,z,w,h,d,c,rot=0){this.draw('box',x,y,z,w,h,d,c,rot)}
 cyl(x,y,z,w,r1,r2,c,rot=0){this.draw('cyl',x,y,z,w,r1,r2,c,rot)}
 diskShadow(x,z,r=.8,alpha=.17){this.box(x,.018,z,r*2,.006,r*1.2,[.27-alpha,.32-alpha,.34-alpha])}
 ground(){let bx=(x,y,z,w,h,d,c)=>this.box(x,y,z,w,h,d,c);
 bx(0,-.25,0,66,.42,44,[.64,.73,.72]);bx(8,-.02,0,38,.06,23,[.63,.67,.69]); // runway apron
 bx(22,-.005,0,9,.04,32,[.29,.38,.43]);bx(27,.015,0,2,.025,34,[.39,.47,.49]);
 for(let z=-16;z<=16;z+=3.4)bx(22,.018,z,1,.03,1.1,[.88,.91,.85]);
 bx(4,.01,10.1,27,.025,2,[.41,.48,.51]);bx(4,.018,7.5,27,.025,.13,[.82,.68,.35]);bx(4,.018,12.3,27,.025,.10,[.86,.78,.46]);
 bx(-8,.03,-.4,13,.05,18,[.56,.63,.64]);bx(-15,.035,9.5,16,.06,5,[.45,.55,.57]);
 // Terminal volume: lower truck dock, multi-floor landside air cargo facility, cool / ULD center.
 const levels=this.sceneControls.warehouseLevels||7;bx(-15,levels*.49+.18,-6.5,12,levels*.98+.36,9,[.71,.82,.83]);bx(-15,levels*.98+.44,-6.5,12.5,.35,9.4,[.88,.93,.93]);
 for(let floor=0;floor<levels;floor++){const y=.65+floor*.99;bx(-8.93,y,-6.5,.09,.45,7.85,[.24,.46,.52]);for(let k=0;k<7;k++)bx(-8.89,y,-10+k*1.05,.06,.37,.78,[.49,.68,.75]);bx(-21.04,y,-6.5,.08,.45,7.7,[.26,.48,.53])}
 bx(-15,1.45,9,10,2.8,5.5,[.64,.76,.79]);bx(-15,3,9,10.5,.22,5.8,[.84,.9,.91]);for(let i=0;i<9;i++)bx(-19.98+i*1.16,.75,11.78,.9,1.25,.08,[.26,.44,.48]);
 // Cold storage real operational zone; illustrative only.
 bx(-7.1,1.3,-15.4,7,2.6,4.7,[.28,.67,.68]);bx(-7.1,2.75,-15.4,7.3,.21,5,[.72,.91,.9]);
 for(let i=0;i<5;i++)bx(-9.7+i*1.35,1.15,-12.97,.9,1.6,.12,[.81,.93,.91]);
 // Automated CHS gantry visual; does not represent machine-state telemetry.
 for(let i=0;i<7;i++){let x=-1.7+i*2.7;bx(x,1.55,-13.8,.12,3.1,.12,[.32,.46,.53]);bx(x,1.55,-8.9,.12,3.1,.12,[.32,.46,.53]);bx(x,3.02,-11.35,.19,.18,5.3,[.42,.59,.64])}
 bx(6.3,3.15,-11.35,18,.22,.31,[.47,.65,.68]); // overhead CHS guide
 // apron stand markings, service road, boundary & security fencing
 for(let k=0;k<6;k++){let z=-14+k*5.15;bx(10,.042,z,13,.024,.06,[.9,.77,.38]);bx(9.8,.041,z+1.68,10,.025,.08,[.82,.87,.86]);bx(17,.041,z,.1,.03,3.3,[.82,.86,.85]);}
 for(let x=-25;x<24;x+=2.6){bx(x,.15,19.7,.08,.3,.08,[.42,.58,.58]);bx(x,.3,19.7,2.6,.025,.035,[.47,.56,.56]);}
 for(let i=0;i<16;i++){let z=-17+i*2.3;bx(30.2,1,z,.12,2.0,.12,[.48,.55,.56]);bx(30.2,2,z,.13,.09,.9,[.83,.85,.72]);}
 }
 aircraft(x,z,rot=0,body=[.95,.97,.98],tail=[.08,.46,.51],gear=true,altitude=0){const S=.62;const q=(dx,dz)=>{dx*=S;dz*=S;return[x+dx*Math.cos(rot)-dz*Math.sin(rot),z+dx*Math.sin(rot)+dz*Math.cos(rot)]};
 const b=(dx,y,dz,w,h,d,c,r=0)=>{let p=q(dx,dz);this.box(p[0],y*S+altitude,p[1],w*S,h*S,d*S,c,rot+r)},cy=(dx,y,dz,w,h,d,c)=>{let p=q(dx,dz);this.cyl(p[0],y*S+altitude,p[1],w*S,h*S,d*S,c,rot)};
 // Aircraft based on generic twin-engine widebody freighter proportions, scaled to the schematic runway/stand layout.
 cy(0,1.15,0,6.45,.78,.78,body);cy(3.21,1.15,0,.85,.67,.67,body);b(-2.15,1.14,0,1.3,.68,.74,body);
 let wing=q(-.2,0);this.draw('wing',wing[0],1.12*S+altitude,wing[1],3.55*S,2.6*S,3.2*S,[.45,.63,.68],rot);
 for(let sg of [-1,1]){cy(-.43,.78,sg*1.35,1.32,.38,.38,[.28,.43,.5]);cy(-1.77,.72,sg*2.2,1.0,.33,.33,[.28,.43,.5]);b(-2.65,1.32,sg*.72,1.5,.12,1.45,tail)}
 b(-3,1.85,0,1.38,1.65,.18,tail,0);b(-2.98,2.42,0,.61,.44,.2,tail);
 // nose windows, cargo door, beacon
 b(2.98,1.47,-.32,.72,.16,.08,[.19,.34,.42]);b(2.98,1.47,.32,.72,.16,.08,[.19,.34,.42]);b(.94,1.44,-.39,.82,.52,.025,[.78,.87,.89]);
 if(gear){for(let dx of [-1.7,2.1])for(let dz of [-.42,.42]){b(dx,.48,dz,.12,.7,.12,[.27,.35,.37]);cy(dx,.19,dz,.24,.35,.35,[.13,.20,.23])}}
 }
 worker(x,z,t,hi=false){let bob=Math.sin(t*4+x)*.04;this.box(x,.72+bob,z,.26,.52,.21,hi?[.94,.62,.16]:[.87,.77,.31]);this.box(x,1.12+bob,z,.23,.23,.24,[.67,.43,.29]);this.box(x,.42,z-.13,.1,.49,.1,[.23,.34,.40]);this.box(x,.42,z+.13,.1,.49,.1,[.23,.34,.40]);this.box(x,1.29+bob,z,.28,.09,.27,[.95,.81,.22]);}
 tug(x,z,rot=0,color=[.11,.52,.55],cargo=false){this.box(x,.48,z,1.38,.68,.9,color,rot);this.box(x-.34,.97,z,.6,.56,.80,[.88,.93,.91],rot);for(let xx of [-.48,.48])for(let zz of [-.43,.43])this.box(x+xx,.22,z+zz,.24,.36,.18,[.14,.24,.29],rot);if(cargo){this.box(x-1.24,.36,z,1.05,.28,.93,[.44,.55,.59],rot);this.box(x-1.24,.86,z,.88,.73,.76,[.85,.72,.50],rot)}}
 loader(x,z){this.box(x,.34,z,2.1,.65,1.6,[.94,.78,.24]);this.box(x+.43,1.2,z,1.12,.16,1.45,[.36,.52,.58]);for(let zz of [-.55,.55])this.box(x-.71,.15,z+zz,.4,.28,.4,[.13,.24,.29]);}
 slotCargo(objects,t){let waiting=(objects||[]).filter(o=>o.status==='WAIT'),moving=(objects||[]).filter(o=>o.status==='MOVING');let actualWaiting=this.state?.waiting||waiting.length;const active=moving.length,traffic=Math.min(12,Math.max(1,active*2+Math.floor(waiting.length/7)));
 // Fixed-capacity block of visible containers; a backlog counter makes truncation explicit.
 for(let i=0;i<Math.min(actualWaiting,95);i++){let j=waiting[i%Math.max(1,waiting.length)]||{priority:1},col=i%12,row=Math.floor(i/12),x=-6.2+col*1.14,z=-3.5+row*1.13;let h=j.priority===3?1.25:.93;this.box(x,.30+h*.5,z,1.0,h,.95,j.blocked?[.72,.27,.25]:j.cold?[.22,.65,.73]:this.name==='relay'?[.19,.66,.51]:[.77,.64,.42]);this.box(x,.30+h+.018,z,1.0,.035,.95,[.77,.84,.83])}
 // Visual transfer progress is driven by actual work-order stage/progress, with bounded interpolation between received snapshots.
 for(let i=0;i<Math.min(moving.length,12);i++){let j=moving[i],p=clamp((j.progress||0)+this.phase*.035,0,.995),line=i%3;let x,z,r;if(p<.36){x=-7+p/.36*11;z=6+line*1.15;r=0}else if(p<.72){x=4+line*.3;z=6-(p-.36)/.36*7.7;r=-Math.PI/2}else{x=4+(p-.72)/.28*7.5;z=-1.7-line*1.2;r=0}this.tug(x,z,r,this.name==='relay'?[.06,.61,.5]:[.67,.52,.3],true);}
 // Service workers: mapped to actual configured handler count; presence visibly changes after slider update.
 const handlers=this.sceneControls.handlers??3;for(let i=0;i<handlers*2;i++){let x=-18.3+(i%5)*1.05,z=4.9+Math.floor(i/5)*.78;let bounce=Math.sin(t*1.6+i)*.1;this.worker(x+bounce,z,t,i%3===0)}
 // Extra visual equipment: available handlers -> loading units, remaining standby units are immobile.
 for(let i=0;i<Math.min(6,handlers);i++){let x=12.4,z=-11+i*3.5;this.loader(x,z)}
 // Extra parked ground-service fleet is a VISUAL-ONLY layer, never optimization capacity.
 for(let k=0;k<Math.min(14,this.sceneControls.ambientVehicles||0);k++){let x=-21+(k%7)*2.1,z=14+Math.floor(k/7)*1.55;this.tug(x,z,0,[.24,.56,.60],false)}
 // Flight volume is visualization only; parked aircraft count driven by configured stand availability, NOT location telemetry.
 const stands=clamp(this.sceneControls.stands||3,1,6);for(let i=0;i<stands;i++){this.aircraft(16,-14+i*5.15,Math.PI,[.93,.96,.96],i%2?[.07,.47,.49]:[.14,.55,.52]);}
 // A taxiing representative aircraft follows synthetic scenario time and cannot contradict booked/confirmed cargo states.
 const sim=this.sceneTime,cycle=(sim*.028)%40,tx=cycle<32?-21+cycle*1.5:27-(cycle-32)*1.0;this.aircraft(tx,16.8,0,[.94,.96,.96],[.07,.53,.55]);
 this.aircraft(-31+(sim*.045%63),-23,0,[.96,.97,.98],[.07,.46,.50],false,10);
 this.aircraft(31-(sim*.033%63),22,Math.PI,[.90,.95,.96],[.17,.55,.53],false,13);
 }
 drawWeather(t){let c=this.weatherCanvas;if(!c)return;let w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);if(c.width!==Math.floor(w*dpr)||c.height!==Math.floor(h*dpr)){c.width=Math.floor(w*dpr);c.height=Math.floor(h*dpr)}let x=c.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);const v=this.weather;if(!['RAIN','STORM'].includes(v))return;const n=v==='STORM'?210:95;let p=this.sceneTime*32; x.save();x.lineWidth=v==='STORM'?1.1:.72;x.strokeStyle=v==='STORM'?'rgba(190,221,238,.66)':'rgba(178,212,227,.49)';x.beginPath();for(let i=0;i<n;i++){let a=(i*61.13+Math.sin(i*8)*39)%w,b=((i*97.61+p*(.6+i%5*.08))%(h+50))-30;x.moveTo(a,b);x.lineTo(a-11,b+25)}x.stroke();if(v==='STORM'&&Math.sin(t*.00049)>.998){x.fillStyle='rgba(245,250,255,.21)';x.fillRect(0,0,w,h)}x.restore()}
 renderFallback2D(t){let c=this.canvas.getContext('2d'),w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);if(!c)return;let rw=Math.max(1,Math.round(w*dpr)),rh=Math.max(1,Math.round(h*dpr));if(this.canvas.width!==rw||this.canvas.height!==rh){this.canvas.width=rw;this.canvas.height=rh}c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#e5f0f0';c.fillRect(0,0,w,h);c.save();c.translate(w/2+(this.interaction.panX||0),h/2+(this.interaction.panZ||0));let sc=Math.min(w/66,h/45)*.95/this.interaction.zoom;c.scale(sc,sc);c.rotate(this.interaction.yaw+.69);const rect=(x,z,ww,hh,fill)=>{c.fillStyle=fill;c.fillRect(x-ww/2,z-hh/2,ww,hh)};rect(0,0,64,42,'#b7c6c7');rect(22,0,9,32,'#536a70');rect(4,9,28,4,'#667e80');rect(-15,-6.5,12,9,'#c8dcda');rect(-15,9,10,5,'#a0bec4');rect(-7,-15.4,7,5,'#54bbb6');for(let k=0;k<(this.sceneControls.stands||3);k++){let z=-14+k*5.15;rect(16,z,7,1.6,'#eff7f5');rect(15.2,z,1.4,4.6,'#dce9e9')}let wait=(this.state?.objects||[]).filter(x=>x.status==='WAIT');for(let k=0;k<Math.min(110,wait.length);k++){let j=wait[k];rect(-6.5+(k%12)*1.15,-3.6+Math.floor(k/12)*1.1,.95,.92,j.blocked?'#e17862':j.cold?'#36b3bc':this.name==='relay'?'#3ea88d':'#c1a57a')}let move=(this.state?.objects||[]).filter(x=>x.status==='MOVING');for(let k=0;k<move.length;k++){let j=move[k],p=clamp((j.progress||0)+this.phase*.035,0,1);rect(-4+p*17,6+k%3,.95,.65,this.name==='relay'?'#087f74':'#a7874a')}let handlers=this.sceneControls.handlers||3;for(let k=0;k<handlers*2;k++){let x=-19+(k%5)*1.2,z=3.3+Math.floor(k/5)*.9;c.beginPath();c.fillStyle='#e9af52';c.arc(x,z,.25,0,Math.PI*2);c.fill()}c.restore();this.drawWeather(t)}
 render(t){if(this.fallback){this.fallback.hour=this.hour;this.fallback.state=this.state;this.fallback.incident=this.incident;if(this.interaction.mode==='2D')this.renderFallback2D(t);else{this.fallback.render(t);this.drawWeather(t)}return}
 const gl=this.gl,w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(w<4||h<4)return;const dp=Math.min(devicePixelRatio||1,1.7),rw=Math.round(w*dp),rh=Math.round(h*dp);if(this.canvas.width!==rw||this.canvas.height!==rh){this.canvas.width=rw;this.canvas.height=rh;}gl.viewport(0,0,rw,rh);
 const sec=Math.min(.08,Math.max(0,(t-(this.lastFrame||t))/1000));this.lastFrame=t;if(this.running)this.sceneTime+=sec*clamp(this.actualTicksPerSecond||.5,.1,20)*8;this.phase=(this.sceneTime*.25)%1;
 if(this.name==='fcfs'&&this.autoOrbit!==false&&t-this.interaction.lastInput>2700&&this.interaction.mode==='3D')this.interaction.yaw+=sec*.07;
 const hour=this.hour,dark=clamp(.12+Math.max(0,(7-hour)/7,(hour-17)/7),.1,.75),rain=this.weather==='STORM'?1:this.weather==='RAIN'?.5:0;
 const sky=[lerp(.76,.06,dark),lerp(.88,.15,dark),lerp(.90,.24,dark)];gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.prog);
 const cc=this.interaction;let dist=66*cc.zoom,eye=[Math.cos(cc.yaw)*Math.cos(cc.pitch)*dist,Math.sin(cc.pitch)*dist+3,Math.sin(cc.yaw)*Math.cos(cc.pitch)*dist];let projection=cc.mode==='2D'?mat.ortho(-26*cc.zoom*(w/h),26*cc.zoom*(w/h),-26*cc.zoom,26*cc.zoom,.1,180):mat.perspective(.90,w/h,.1,230);if(cc.mode==='2D'){eye=[(cc.panX||0)+.01,54*cc.zoom,(cc.panZ||0)];cc.yaw=cc.yaw||0;}
 gl.uniformMatrix4fv(this.uni.projection,false,projection);gl.uniformMatrix4fv(this.uni.view,false,mat.look(eye,cc.mode==='2D'?[cc.panX||0,0,cc.panZ||0]:[0,0,0]));gl.uniform3f(this.uni.lightDir,-.44,.89,-.51);gl.uniform3f(this.uni.lightColor,1.03-dark*.27,1.01-dark*.20,.96-dark*.09);gl.uniform3f(this.uni.fogColor,...sky);gl.uniform1f(this.uni.ambient,.44-dark*.18);gl.uniform1f(this.uni.fogMix,this.weather==='FOG'?.52:rain*.24);
 this.drawCalls=0;this.ground();this.slotCargo(this.state?.objects,this.sceneTime);
 if(this.incident){this.box(-6,3.75,-15.5,.65,.65,.65,[.96,.32,.21]);this.box(-6,4.35,-15.5,.25,.45,.25,[1,.55,.3]);}
 this.drawWeather(t);
 }
}
// Canvas weather layers & auto orbit are part of scene; no external network fetches.
const Legacy=window.RelayV6;window.RelayV6Legacy=Legacy;window.RelayV6={...Legacy,GroundScene:GLWorld};
window.RELAY_V9_SCENE={version:'9.0',engine:'native-webgl2',fallback:'v8-canvas',supports2D:true,ready:true};
})();
