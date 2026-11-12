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
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 pos;
layout(location=1) in vec3 nor;
uniform mat4 projection, view, model;
uniform float effect;
out vec3 vNormal;
out float vDepth;
out vec2 vLocal;
void main() {
  vLocal = pos.xz;
  if (effect == 2.0) {
    gl_Position = vec4(2.0 * vLocal, .9999, 1.0);
    vNormal = vec3(0.0, 1.0, 0.0);
    vDepth = 0.0;
    return;
  }
  vNormal = mat3(model) * nor;
  vec4 point = view * model * vec4(pos, 1.0);
  vDepth = -point.z;
  gl_Position = projection * point;
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vDepth;
in vec2 vLocal;
uniform vec3 base, lightColor, fogColor, lightDir;
uniform float ambient, fogMix, effect, intensity;
out vec4 color;
void main() {
  if (effect == 1.0) {
    float fade = 1.0 - smoothstep(.04, .49, length(vLocal));
    color = vec4(.025, .06, .08, intensity * fade);
    return;
  }
  if (effect == 2.0) {
    float horizon = smoothstep(.0, 1.0, vLocal.y + .5);
    color = vec4(mix(fogColor * 1.18, fogColor * .66, horizon), 1.0);
    return;
  }
  float fog = clamp((vDepth - 18.0) / 68.0, 0.0, 1.0) * fogMix;
  if (effect == 3.0) {
    color = vec4(mix(base, fogColor, fog * .65), 1.0);
    return;
  }
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(lightDir)), 0.0);
  float shade = ambient + (1.0 - ambient) * diffuse;
  vec3 shaded = base * shade * lightColor + vec3(.035 * max(normal.y, 0.0));
  color = vec4(mix(shaded, fogColor, fog), 1.0);
}`;
function shader(gl,kind,src){let s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function geomBox(){let v=[],n=[];const f=[[[1,0,0],[[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[.5,-.5,.5]]],[[-1,0,0],[[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-.5,-.5,-.5]]],[[0,1,0],[[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5]]],[[0,-1,0],[[-.5,-.5,.5],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5]]],[[0,0,1],[[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[-.5,-.5,.5]]],[[0,0,-1],[[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,-.5,-.5]]]];for(let [normal,points] of f){for(let i of [0,1,2,0,2,3]){v.push(...points[i]);n.push(...normal)}}return [v,n]}
const aircraftModel = window.RelayAircraftModel;
const flight = window.RelayFlight;
const aircraftColors = {
  body: [.98, 1, 1],
  metal: [.66, .76, .80],
  cockpit: [.075, .15, .19],
  dark: [.075, .15, .19],
  gear: [.12, .18, .20],
};

const airportRunway = {x: 26.5, width: 9, halfLength: 20};
const airportStand = index => ({x: 17.5, y: .053, z: -14.5 + index * 5.8, scale: .82});
const airport = {
  runway: airportRunway,
  stand: airportStand,
  circuit: flight.createCircuit(airportRunway, .064),
  groundWidth: 74,
  groundDepth: 48,
  groundCenter: 1,
};
const effect = {surface: 0, shadow: 1, sky: 2, light: 3};

function cargoLane(progress, lane) {
  const remaining = 1 - progress;
  const p = progress;
  const x = -10 * remaining ** 3 + 6 * remaining * p ** 2 + 10.6 * p ** 3;
  const z = 6.3 + lane + 3.4 * remaining ** 2 * (1 + 2 * p);
  const dx = 30 * remaining ** 2 + 12 * remaining * p + 25.8 * p ** 2;
  const dz = -20.4 * remaining * p;
  return {x, z, heading: Math.atan2(dz, dx)};
}

function uploadMesh(gl, vertices) {
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  return {vao, buffer, count: vertices.length / 6};
}

class GLWorld{
 constructor(canvas,name){this.canvas=canvas;this.name=name;this.state={objects:[]};this.hour=11;this.incident=false;this.weather='CLEAR';this.sceneControls={};this.simTick=0;this.running=false;this.requestedSpeed=1;this.actualTicksPerSecond=0;this.simSeconds=0;this.sceneTime=0;this.flightTime=0;this.phase=0;this.pulse=0;this.fallback=null;this.weatherCanvas=null;this.interaction=GLWorld.sharedCamera||(GLWorld.sharedCamera={yaw:-.69,pitch:.72,zoom:1,panX:0,panZ:0,mode:'3D',lastInput:performance.now()});
  this.airport = canvas.dataset.airportLayout === 'v11' ? airport : null;
  this.cargoProgress = new Map();
  this.showAircraftWindows = canvas.dataset.aircraftWindows !== 'hidden';
  this.gl = canvas.getContext('webgl2', {antialias:true, alpha:false});
  if (this.gl) this.initGL();
  else this.fallback = true;
  const host=this.canvas.parentElement;const rainLayer=document.createElement('canvas');rainLayer.className='scene-weather';rainLayer.setAttribute('aria-hidden','true');host.insertBefore(rainLayer,this.canvas.nextSibling);this.weatherCanvas=rainLayer;
  this.setupInput();
 }
 initGL() {
  const gl = this.gl;
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
   const stage = shader(gl, type, source);
   gl.attachShader(program, stage);
   gl.deleteShader(stage);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  this.prog = program;
  this.uni = {};
  for (const name of ['projection','view','model','base','lightColor','fogColor','lightDir','ambient','fogMix','effect','intensity']) {
   this.uni[name] = gl.getUniformLocation(program, name);
  }
  const [positions, normals] = geomBox();
  const box = new Float32Array(positions.length * 2);
  for (let i = 0; i < positions.length; i += 3) {
   box.set(positions.slice(i, i + 3), i * 2);
   box.set(normals.slice(i, i + 3), i * 2 + 3);
  }
  this.boxMesh = uploadMesh(gl, box);
  if (this.airport) {
   const vertices = [];
   for (const [x,z] of [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,-.5],[.5,.5],[-.5,.5]]) {
    vertices.push(x,0,z,0,1,0);
   }
   this.planeMesh = uploadMesh(gl, new Float32Array(vertices));
  }
  this.aircraftMeshes = Object.entries(aircraftModel.meshes).map(([material, vertices]) =>
   [material, uploadMesh(gl, vertices)]);
  gl.enable(gl.DEPTH_TEST);
 }

 dispose() {
  const gl = this.gl;
  if (!gl) return;
  for (const mesh of [this.boxMesh, ...this.aircraftMeshes.map(([, mesh]) => mesh)]) {
   gl.deleteVertexArray(mesh.vao);
   gl.deleteBuffer(mesh.buffer);
  }
  if (this.planeMesh) {
   gl.deleteVertexArray(this.planeMesh.vao);
   gl.deleteBuffer(this.planeMesh.buffer);
  }
  gl.deleteProgram(this.prog);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
 }

 setupInput(){const c=this.canvas;let held=false,lx=0,ly=0;const cc=this.interaction;
 c.addEventListener('pointerdown',e=>{held=true;lx=e.clientX;ly=e.clientY;cc.lastInput=performance.now();try{c.setPointerCapture(e.pointerId)}catch{}});
 c.addEventListener('pointermove',e=>{if(!held)return;let dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;cc.lastInput=performance.now();if(cc.mode==='3D'&&!this.fallback){cc.yaw+=dx*.007;cc.pitch=clamp(cc.pitch+dy*.006,.28,1.35)}else{const scale=Math.min(c.clientWidth/74,c.clientHeight/48)/cc.zoom;cc.panX-=dx/scale;cc.panZ-=dy/scale}});
 for(let ev of ['pointerup','pointercancel','lostpointercapture'])c.addEventListener(ev,()=>held=false);
 c.addEventListener('wheel',e=>{e.preventDefault();cc.zoom=clamp(cc.zoom*Math.exp(e.deltaY*.0009),.52,2.2);cc.lastInput=performance.now()},{passive:false});
 c.addEventListener('dblclick',()=>{cc.yaw=-.69;cc.pitch=.72;cc.zoom=1;cc.panX=0;cc.panZ=0;cc.lastInput=performance.now()});
 }
 setMode(mode){this.interaction.mode=mode==='2D'?'2D':'3D';this.interaction.lastInput=performance.now()}
 drawMesh(mesh, model, color) {
  const gl = this.gl;
  gl.bindVertexArray(mesh.vao);
  gl.uniformMatrix4fv(this.uni.model, false, model);
  gl.uniform3f(this.uni.base, ...color);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  this.drawCalls++;
 }

 box(x,y,z,w,h,d,c,rot=0){this.drawMesh(this.boxMesh,mat.model(x,y,z,w,h,d,rot),c)}

 drawAircraft(pose, scale, accent) {
  const model = flight.transform(pose, scale);
  for (const [material, mesh] of this.aircraftMeshes) {
   const matrix = material === 'gear' && pose.gear < 1
    ? flight.transform(pose, scale, (1 - pose.gear) * 1.05)
    : model;
   const finish = material === 'cockpit' && !this.showAircraftWindows ? 'body' : material;
   this.drawMesh(mesh, matrix, finish === 'teal' ? accent : aircraftColors[finish]);
  }
 }
 drawFleet(draw) {
  flight.drawFleet(this.flightTime, this.sceneControls.stands, draw, this.airport?.circuit, this.airport?.stand);
 }

 drawAirfieldShadows() {
  const gl = this.gl;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(this.uni.effect, effect.shadow);
  this.drawFleet((pose, scale) => {
   const height = pose.y - .042;
   const x = pose.x - height * .24;
   const z = pose.z + height * .15;
   if (Math.abs(x - airport.groundCenter) > 31 || Math.abs(z) > 20) return;
   gl.uniform1f(this.uni.intensity, .49 / (1 + height * .25));
   const model = mat.model(x,.071,z,8.7 * scale,1,5.3 * scale,-pose.heading);
   this.drawMesh(this.planeMesh,model,[0,0,0]);
  });
  gl.uniform1f(this.uni.effect, effect.surface);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
 }

 drawRunwayLights(runway, dark) {
  const gl = this.gl;
  const runwayEdge = runway.width / 2 - .2;
  gl.uniform1f(this.uni.effect, effect.light);
  const white = [.71 + dark * .2,.91 + dark * .08,1];
  for (const side of [-1,1]) {
   for (let z = -18; z <= 18; z += 3) {
    this.box(runway.x + side * runwayEdge,.075,z,.14,.075,.14,white);
   }
   for (const x of [-2.8,-1.4,0,1.4,2.8]) {
    this.box(runway.x + x,.075,side * 19,.18,.07,.13,[.23,.93,.68]);
   }
  }
  gl.uniform1f(this.uni.effect, effect.surface);
 }

 drawControlTower() {
  const x = -25, z = -15.5;
  this.box(x,.08,z,4.8,.16,4.8,[.43,.51,.52]);
  this.box(x,.38,z,2.2,.55,2.2,[.64,.71,.73]);
  this.box(x,2.8,z,1.27,4.85,1.27,[.70,.79,.79]);
  this.box(x,5.19,z,2.8,.34,2.8,[.62,.73,.73]);
  this.box(x,5.8,z,2.55,1.0,2.55,[.18,.39,.46]);
  this.box(x,6.41,z,2.86,.22,2.86,[.81,.89,.88]);
  for (const side of [-1,1]) {
   this.box(x + side * 1.28,5.8,z,.05,1,.06,[.64,.76,.77]);
   this.box(x,5.8,z + side * 1.28,.06,1,.05,[.64,.76,.77]);
  }
  this.box(x,6.79,z,.08,.54,.08,[.54,.64,.67]);
  this.gl.uniform1f(this.uni.effect,effect.light);
  this.box(x,7.07,z,.16,.13,.16,[1,.38,.28]);
  this.gl.uniform1f(this.uni.effect,effect.surface);
 }

 drawApron() {
  const amber = [.84,.67,.32];
  const cream = [.72,.79,.80];
  this.box(9,.004,0,25,.052,38,[.41,.50,.53]);
  this.box(11.8,.036,0,3.2,.018,38,[.28,.38,.41]);
  for (let z = -17; z <= 17; z += 3.4) {
   this.box(11.8,.049,z,.085,.004,1.5,cream);
  }
  for (let index = 0; index < 6; index++) {
   const {x,z} = this.airport.stand(index);
   this.box(x,.047,z,6.3,.01,4.94,[.48,.56,.58]);
   this.box(x,.057,z,6.0,.004,.075,amber);
   this.box(x-2.86,.057,z,.075,.004,2.0,amber);
   for (const side of [-1,1]) {
    this.box(x,.057,z + side * 2.42,5.9,.004,.057,cream);
   }
  }
 }

 ground(dark) {
 const bx=(x,y,z,w,h,d,c)=>this.box(x,y,z,w,h,d,c);
 const runway = this.airport?.runway ?? flight.runway;
 if (this.airport) {
  bx(airport.groundCenter,-.47,0,airport.groundWidth,.94,airport.groundDepth,[.30,.46,.44]);
  this.drawApron();
  this.drawControlTower();
 } else {
  bx(0,-.25,0,66,.42,44,[.64,.73,.72]);
  bx(8,-.02,0,38,.06,23,[.63,.67,.69]);
 }
 const {x: runwayX, width: runwayWidth, halfLength} = runway;
 const runwayHeight = this.airport ? .05 : .026;
 bx(runwayX,runwayHeight-.025,0,runwayWidth,.05,2 * halfLength,this.airport ? [.22,.29,.34] : [.25,.32,.36]);
 const paint = [.93,.96,.92];
 const marking = runwayHeight + .004;
 for (let z = -12; z <= 12; z += 4) bx(runwayX,marking,z,.17,.004,2.2,paint);
 for (const side of [-1,1]) {
  bx(runwayX + side * (runwayWidth / 2 - .32),marking,0,.095,.004,2 * halfLength - .8,paint);
  for (const offset of [-2.6,-1.7,-.8,.8,1.7,2.6]) {
   bx(runwayX + offset,marking,side * (halfLength - 2.3),.39,.004,2.2,paint);
  }
 }
 if (this.airport) this.drawRunwayLights(runway,dark);
 if (this.airport) {
  bx(-3,.038,8.8,24,.018,5.8,[.33,.41,.45]);
  for (let x = -13; x <= 7; x += 4) bx(x,.05,8.8,1.8,.004,.08,[.76,.69,.47]);
 } else {
  bx(4,.01,10.1,27,.025,2,[.41,.48,.51]);bx(4,.018,7.5,27,.025,.13,[.82,.68,.35]);bx(4,.018,12.3,27,.025,.10,[.86,.78,.46]);
 }
 bx(-8,.03,-.4,13,.05,18,[.56,.63,.64]);bx(-15,.035,9.5,16,.06,5,[.45,.55,.57]);
 // Terminal volume: lower truck dock, multi-floor landside air cargo facility, cool / ULD center.
 const levels=this.sceneControls.warehouseLevels||7;bx(-15,levels*.49+.18,-6.5,12,levels*.98+.36,9,[.71,.82,.83]);bx(-15,levels*.98+.44,-6.5,12.5,.35,9.4,[.88,.93,.93]);
 if (this.airport) {
  const roof = levels*.98 + .65;
  for (const x of [-18,-14,-10.5]) bx(x,roof,-6.5,1.9,.12,6.7,[.35,.51,.56]);
  bx(-15,roof+.17,-10.25,7.0,.34,.55,[.12,.34,.37]);
 }
 for(let floor=0;floor<levels;floor++){const y=.65+floor*.99;bx(-8.93,y,-6.5,.09,.45,7.85,[.24,.46,.52]);for(let k=0;k<7;k++)bx(-8.89,y,-10+k*1.05,.06,.37,.78,[.49,.68,.75]);bx(-21.04,y,-6.5,.08,.45,7.7,[.26,.48,.53])}
 bx(-15,1.45,9,10,2.8,5.5,[.64,.76,.79]);bx(-15,3,9,10.5,.22,5.8,[.84,.9,.91]);for(let i=0;i<9;i++)bx(-19.98+i*1.16,.75,11.78,.9,1.25,.08,[.26,.44,.48]);
 // Cold storage real operational zone; illustrative only.
 bx(-7.1,1.3,-15.4,7,2.6,4.7,[.28,.67,.68]);bx(-7.1,2.75,-15.4,7.3,.21,5,[.72,.91,.9]);
 for(let i=0;i<5;i++)bx(-9.7+i*1.35,1.15,-12.97,.9,1.6,.12,[.81,.93,.91]);
 // Automated CHS gantry visual; does not represent machine-state telemetry.
 for(let i=0;i<(this.airport ? 5 : 7);i++){let x=-1.7+i*2.7;bx(x,1.55,-13.8,.12,3.1,.12,[.32,.46,.53]);bx(x,1.55,-8.9,.12,3.1,.12,[.32,.46,.53]);bx(x,3.02,-11.35,.19,.18,5.3,[.42,.59,.64])}
 bx(this.airport ? 3.7 : 6.3,3.15,-11.35,this.airport ? 11.2 : 18,.22,.31,[.47,.65,.68]); // overhead CHS guide
 // apron stand markings, service road, boundary & security fencing
 if (!this.airport) for(let k=0;k<6;k++){let z=-14+k*5.15;bx(10,.042,z,13,.024,.06,[.9,.77,.38]);bx(9.8,.041,z+1.68,10,.025,.08,[.82,.87,.86]);bx(17,.041,z,.1,.03,3.3,[.82,.86,.85]);}
 for(let x=-25;x<24;x+=2.6){bx(x,.15,19.7,.08,.3,.08,[.42,.58,.58]);bx(x,.3,19.7,2.6,.025,.035,[.47,.56,.56]);}
 for(let i=0;i<16;i++){let z=-17+i*2.3;bx(this.airport ? 34.2 : 30.2,1,z,.12,2.0,.12,[.48,.55,.56]);bx(this.airport ? 34.2 : 30.2,2,z,.13,.09,.9,[.83,.85,.72]);}
 }
 worker(x,z,t,hi=false){let bob=Math.sin(t*4+x)*.04;this.box(x,.72+bob,z,.26,.52,.21,hi?[.94,.62,.16]:[.87,.77,.31]);this.box(x,1.12+bob,z,.23,.23,.24,[.67,.43,.29]);this.box(x,.42,z-.13,.1,.49,.1,[.23,.34,.40]);this.box(x,.42,z+.13,.1,.49,.1,[.23,.34,.40]);this.box(x,1.29+bob,z,.28,.09,.27,[.95,.81,.22]);}
 tug(x,z,heading=0,color=[.11,.52,.55],cargo=false) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const part = (dx,y,dz,w,h,d,fill) =>
   this.box(x+dx*cos-dz*sin,y,z+dx*sin+dz*cos,w,h,d,fill,-heading);
  part(0,.48,0,1.38,.68,.9,color);
  part(-.34,.97,0,.6,.56,.80,[.88,.93,.91]);
  for (const xx of [-.48,.48]) for (const zz of [-.43,.43]) {
   part(xx,.22,zz,.24,.36,.18,[.14,.24,.29]);
  }
  if (cargo) {
   part(-1.24,.36,0,1.05,.28,.93,[.44,.55,.59]);
   part(-1.24,.86,0,.88,.73,.76,[.85,.72,.50]);
  }
 }

 drawAirportCargo(moving) {
  const visible = moving.slice(0,12);
  const previous = this.cargoProgress;
  this.cargoProgress = new Map();
  const color = this.name === 'relay' ? [.06,.61,.5] : [.67,.52,.3];
  for (const job of visible) {
   const target = clamp(job.progress || 0,0,1);
   const last = previous.get(job.id) ?? target;
   const progress = target < last ? target : lerp(last,target,1 - Math.exp(-8 * this.frameSeconds));
   this.cargoProgress.set(job.id,progress);
   const lane = Math.floor(rng(job.id) * 3) * .9;
   const {x,z,heading} = cargoLane(progress,lane);
   this.tug(x,z,heading,color,true);
  }
 }
 loader(x,z){this.box(x,.34,z,2.1,.65,1.6,[.94,.78,.24]);this.box(x+.43,1.2,z,1.12,.16,1.45,[.36,.52,.58]);for(let zz of [-.55,.55])this.box(x-.71,.15,z+zz,.4,.28,.4,[.13,.24,.29]);}
 slotCargo(objects,t){let waiting=(objects||[]).filter(o=>o.status==='WAIT'),moving=(objects||[]).filter(o=>o.status==='MOVING');let actualWaiting=this.state?.waiting||waiting.length;const active=moving.length,traffic=Math.min(12,Math.max(1,active*2+Math.floor(waiting.length/7)));
 // Fixed-capacity block of visible containers; a backlog counter makes truncation explicit.
 for(let i=0;i<Math.min(actualWaiting,95);i++){let j=waiting[i%Math.max(1,waiting.length)]||{priority:1},col=i%12,row=Math.floor(i/12),x=-6.2+col*1.14,z=-3.5+row*1.13;let h=j.priority===3?1.25:.93;this.box(x,.30+h*.5,z,1.0,h,.95,j.blocked?[.72,.27,.25]:j.cold?[.22,.65,.73]:this.name==='relay'?[.19,.66,.51]:[.77,.64,.42]);this.box(x,.30+h+.018,z,1.0,.035,.95,[.77,.84,.83])}
 // Visual transfer progress is driven by actual work-order stage/progress, with bounded interpolation between received snapshots.
 if(this.airport)this.drawAirportCargo(moving);
 else for(let i=0;i<Math.min(moving.length,12);i++){let j=moving[i],p=clamp((j.progress||0)+this.phase*.035,0,.995),line=i%3;let x,z,r;if(p<.36){x=-7+p/.36*11;z=6+line*1.15;r=0}else if(p<.72){x=4+line*.3;z=6-(p-.36)/.36*7.7;r=-Math.PI/2}else{x=4+(p-.72)/.28*7.5;z=-1.7-line*1.2;r=0}this.tug(x,z,r,this.name==='relay'?[.06,.61,.5]:[.67,.52,.3],true);}
 // Service workers: mapped to actual configured handler count; presence visibly changes after slider update.
 const handlers=this.sceneControls.handlers??3;for(let i=0;i<handlers*2;i++){let x=-18.3+(i%5)*1.05,z=4.9+Math.floor(i/5)*.78;let bounce=Math.sin(t*1.6+i)*.1;this.worker(x+bounce,z,t,i%3===0)}
 // Extra visual equipment: available handlers -> loading units, remaining standby units are immobile.
 for(let i=0;i<Math.min(6,handlers);i++){
  const x=this.airport ? 12.6 : 12.4;
  const z=this.airport ? this.airport.stand(i).z - 1.4 : -11+i*3.5;
  this.loader(x,z);
 }
 // Extra parked ground-service fleet is a VISUAL-ONLY layer, never optimization capacity.
 for(let k=0;k<Math.min(14,this.sceneControls.ambientVehicles||0);k++){let x=-21+(k%7)*2.1,z=14+Math.floor(k/7)*1.55;this.tug(x,z,0,[.24,.56,.60],false)}

 }
 drawWeather(t) {
  const canvas = this.weatherCanvas;
  if (!canvas) return;
  const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1,2);
  const width = Math.floor(w*dpr), height = Math.floor(h*dpr);
  if (canvas.width !== width || canvas.height !== height) {
   canvas.width = width;
   canvas.height = height;
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr,0,0,dpr,0,0);
  c.clearRect(0,0,w,h);
  const storm = this.weather === 'STORM';
  if (!storm && this.weather !== 'RAIN') return;
  const streaks = this.airport ? (storm ? 130 : 65) : (storm ? 210 : 95);
  const phase = this.sceneTime * 32;
  c.lineWidth = storm ? 1.1 : .72;
  c.strokeStyle = this.airport ? 'rgba(190,224,238,.42)' :
   (storm ? 'rgba(190,221,238,.66)' : 'rgba(178,212,227,.49)');
  c.beginPath();
  for (let i = 0; i < streaks; i++) {
   const x = (i*61.13 + Math.sin(i*8)*39) % w;
   const y = (i*97.61 + phase*(.6 + i%5*.08)) % (h+50) - 30;
   c.moveTo(x,y);
   c.lineTo(x-11,y+25);
  }
  c.stroke();
  if (storm && Math.sin(t*.00049) > .998) {
   c.fillStyle = 'rgba(245,250,255,.21)';
   c.fillRect(0,0,w,h);
  }
 }
 renderFallback2D(t) {
  const canvas = this.canvas;
  const c = canvas.getContext('2d');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!c || w < 4 || h < 4) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) {
   canvas.width = rw;
   canvas.height = rh;
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#e5f0f0';
  c.fillRect(0, 0, w, h);
  const {panX, panZ, zoom} = this.interaction;
  const scale = Math.min(w / 74, h / 48) / zoom;
  c.save();
  c.translate(w / 2 - panX * scale, h / 2 - panZ * scale);
  c.scale(scale, scale);
  const rect = (x,z,width,height,fill) => {
   c.fillStyle = fill;
   c.fillRect(x - width / 2, z - height / 2, width, height);
  };
  const runway = this.airport?.runway ?? flight.runway;
  rect(this.airport?.groundCenter ?? 0,0,this.airport?.groundWidth ?? 66,this.airport?.groundDepth ?? 44,'#b7c6c7');
  if (this.airport) {
   rect(9,0,25,38,'#788b91');
   for(let i=0;i<6;i++){
    const {x,z} = this.airport.stand(i);
    rect(x,z,6.3,4.94,'#9aabad');
    rect(x,z,5.9,.075,'#d9bb70');
   }
  }
  rect(runway.x,0,runway.width,2 * runway.halfLength,'#536a70');
  for (let z = -12; z <= 12; z += 4) rect(runway.x,z,.18,2.2,'#eff7f5');
  if (this.airport) rect(-3,8.8,24,5.8,'#667e80');
  else rect(4,9,28,4,'#667e80');
  rect(-15,-6.5,12,9,'#c8dcda');
  rect(-15,9,10,5,'#a0bec4');
  rect(-7,-15.4,7,5,'#54bbb6');

  const objects = this.state?.objects || [];
  const waiting = objects.filter(job => job.status === 'WAIT').slice(0, 110);
  const moving = objects.filter(job => job.status === 'MOVING');
  for (const [i, job] of waiting.entries()) {
   const fill = job.blocked ? '#e17862' : job.cold ? '#36b3bc' : this.name === 'relay' ? '#3ea88d' : '#c1a57a';
   rect(-6.5 + (i % 12) * 1.15, -3.6 + Math.floor(i / 12) * 1.1, .95, .92, fill);
  }
  for (const [i, job] of moving.entries()) {
   const progress = clamp((job.progress || 0) + this.phase * .035, 0, 1);
   rect(-4 + progress * 17, 6 + i % 3, .95, .65, this.name === 'relay' ? '#087f74' : '#a7874a');
  }
  const handlers = this.sceneControls.handlers || 3;
  c.fillStyle = '#e9af52';
  for (let i = 0; i < handlers * 2; i++) {
   c.beginPath();
   c.arc(-19 + (i % 5) * 1.2, 3.3 + Math.floor(i / 5) * .9, .25, 0, 2 * Math.PI);
   c.fill();
  }

  this.drawFleet((pose, size) =>
   aircraftModel.drawPlan(c, pose, size, '#008479', this.showAircraftWindows));
  c.restore();
  this.drawWeather(t);
 }

 cameraMatrices(w, h) {
  const {mode, yaw, pitch, zoom, panX, panZ} = this.interaction;
  const aspect = w / h;
  if (mode === '2D') {
   const halfWidth = Math.max(37, 24 * aspect) * zoom;
   const halfHeight = halfWidth / aspect;
   return {
    projection: mat.ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, .1, 180),
    view: mat.look([panX, 54 * zoom, panZ + .01], [panX, 0, panZ]),
   };
  }
  const distance = (this.airport ? 72 : 66) * zoom * Math.max(1, .93 / aspect);
  const focusX = this.airport ? 5.5 : 4;
  const eye = [
   focusX + Math.cos(yaw) * Math.cos(pitch) * distance,
   Math.sin(pitch) * distance + 3,
   Math.sin(yaw) * Math.cos(pitch) * distance,
  ];
  return {projection: mat.perspective(.90, aspect, .1, 260), view: mat.look(eye, [focusX, 0, 0])};
 }

 render(t, sharedFlightTime) {
 const sec = clamp((t - (this.lastFrame ?? t)) / 1000, 0, .15);
 this.frameSeconds = sec;
 this.lastFrame = t;
 if (sharedFlightTime !== undefined) this.flightTime = sharedFlightTime;
 else if (this.running) this.flightTime += sec;
 if (this.running) this.sceneTime += sec * clamp(this.actualTicksPerSecond || .5,.1,20) * 8;
 this.phase = (this.sceneTime * .25) % 1;
 if (this.fallback) { this.renderFallback2D(t); return; }
 const gl=this.gl,w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(w<4||h<4||gl.isContextLost())return;const dp=Math.min(devicePixelRatio||1,1.7),rw=Math.round(w*dp),rh=Math.round(h*dp);if(this.canvas.width!==rw||this.canvas.height!==rh){this.canvas.width=rw;this.canvas.height=rh;}gl.viewport(0,0,rw,rh);
 if(this.name==='fcfs'&&this.autoOrbit!==false&&t-this.interaction.lastInput>2700&&this.interaction.mode==='3D')this.interaction.yaw+=sec*.07;
 const hour=this.hour,dark=clamp(.12+Math.max(0,(7-hour)/7,(hour-17)/7),.1,.75),rain=this.weather==='STORM'?1:this.weather==='RAIN'?.5:0;
 const sky=this.airport
  ? [lerp(.48,.055,dark),lerp(.68,.13,dark),lerp(.71,.23,dark)]
  : [lerp(.76,.06,dark),lerp(.88,.15,dark),lerp(.90,.24,dark)];gl.clearColor(...sky,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.prog);
 const {projection, view} = this.cameraMatrices(w, h);
 gl.uniformMatrix4fv(this.uni.projection,false,projection);gl.uniformMatrix4fv(this.uni.view,false,view);gl.uniform3f(this.uni.lightDir,-.44,.89,-.51);gl.uniform3f(this.uni.lightColor,1.03-dark*.27,1.01-dark*.20,.96-dark*.09);gl.uniform3f(this.uni.fogColor,...sky);gl.uniform1f(this.uni.ambient,this.airport ? .55-dark*.14 : .44-dark*.18);gl.uniform1f(this.uni.fogMix,this.weather==='FOG'?.52:rain*.24);
 this.drawCalls = 0;
 if (this.airport) {
  gl.uniform1f(this.uni.effect,effect.sky);
  gl.depthMask(false);
  this.drawMesh(this.planeMesh,mat.model(0,0,0),sky);
  gl.depthMask(true);
  gl.uniform1f(this.uni.effect,effect.surface);
 }
 this.ground(dark);
 if (this.airport) this.drawAirfieldShadows();
 this.slotCargo(this.state?.objects,this.sceneTime);
 this.drawFleet((...args) => this.drawAircraft(...args));
 if(this.incident){this.box(-6,3.75,-15.5,.65,.65,.65,[.96,.32,.21]);this.box(-6,4.35,-15.5,.25,.45,.25,[1,.55,.3]);}
 this.drawWeather(t);
 }
}
// Canvas weather layers & auto orbit are part of scene; no external network fetches.
window.RelayV6={...window.RelayV6,GroundScene:GLWorld};
window.RELAY_V9_SCENE={version:'9.0',engine:'native-webgl2',fallback:'2d-airport-map',supports2D:true,ready:true};
})();
