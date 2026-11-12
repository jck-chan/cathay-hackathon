/* RELAY ground twin renderer · native WebGL2, no external libraries/CDNs.
   Draws the state held by RelayGroundOps (ground_ops.js): every container, tug, crew member,
   stand and aircraft movement is a projection of the SERVER'S work orders, capacity and weather.
   The airfield layout is illustrative, NOT a surveyed terminal or a certified loading simulator. */
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
const {GroundOps, layout, slotPosition, servicePoint} = window.RelayGroundOps;
const aircraftColors = {
  body: [.98, 1, 1],
  metal: [.66, .76, .80],
  cockpit: [.075, .15, .19],
  dark: [.075, .15, .19],
  gear: [.12, .18, .20],
};
const accents = {fcfs: [.72, .52, .24], relay: [.05, .55, .50]};
// Deadline state of a work order: on track, tight, cannot finish in time, overdue.
const urgencyColors = [[.16, .66, .50], [.96, .76, .22], [.97, .52, .16], [.90, .20, .18]];
const urgencyCss = ['#1f9f7c', '#d99a12', '#e2711d', '#d63a33'];
const effect = {surface: 0, shadow: 1, sky: 2, light: 3};
const SURFACE = .07;
// Until the user drags, the camera frames the flow for the card's shape: landside → runway
// left-to-right in a wide card, near-to-far in a tall one.
const CAMERA = {yaw: 1.32, pitch: .86, zoom: 1, panX: 0, panZ: 0, custom: false};

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

class GLWorld {
 constructor(canvas, name) {
  this.canvas = canvas;
  this.name = name;
  this.state = {objects: []};
  this.hour = 11;
  this.incident = false;
  this.weather = 'CLEAR';
  this.sceneControls = {};
  this.simTick = 0;
  this.running = false;
  this.requestedSpeed = 1;
  this.actualTicksPerSecond = 0;
  this.sceneTime = 0;
  this.fallback = null;
  this.airport = layout;
  this.ops = new GroundOps();
  this.accent = accents[name] || accents.relay;
  this.interaction = GLWorld.sharedCamera ||
   (GLWorld.sharedCamera = {...CAMERA, mode: '3D', lastInput: performance.now()});
  this.showAircraftWindows = canvas.dataset.aircraftWindows !== 'hidden';
  this.gl = canvas.getContext('webgl2', {antialias: true, alpha: false});
  if (this.gl) this.initGL();
  else this.fallback = true;
  const overlay = document.createElement('canvas');
  overlay.className = 'scene-weather';
  overlay.setAttribute('aria-hidden', 'true');
  canvas.parentElement.insertBefore(overlay, canvas.nextSibling);
  this.weatherCanvas = overlay;
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
  const plane = [];
  for (const [x, z] of [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,-.5],[.5,.5],[-.5,.5]]) plane.push(x, 0, z, 0, 1, 0);
  this.planeMesh = uploadMesh(gl, new Float32Array(plane));
  this.aircraftMeshes = Object.entries(aircraftModel.meshes).map(([material, vertices]) =>
   [material, uploadMesh(gl, vertices)]);
  gl.enable(gl.DEPTH_TEST);
 }

 dispose() {
  const gl = this.gl;
  this.weatherCanvas?.remove();
  if (!gl) return;
  for (const mesh of [this.boxMesh, this.planeMesh, ...this.aircraftMeshes.map(([, mesh]) => mesh)]) {
   gl.deleteVertexArray(mesh.vao);
   gl.deleteBuffer(mesh.buffer);
  }
  gl.deleteProgram(this.prog);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
 }

 setupInput() {
  const c = this.canvas, cc = this.interaction;
  let held = false, lx = 0, ly = 0;
  c.addEventListener('pointerdown', e => {
   held = true; lx = e.clientX; ly = e.clientY; cc.lastInput = performance.now();
   try { c.setPointerCapture(e.pointerId); } catch {}
  });
  c.addEventListener('pointermove', e => {
   if (!held) return;
   const dx = e.clientX - lx, dy = e.clientY - ly;
   lx = e.clientX; ly = e.clientY; cc.lastInput = performance.now();
   if (cc.mode === '3D' && !this.fallback) {
    if (!cc.custom) { cc.yaw = this.viewYaw ?? cc.yaw; cc.custom = true; }
    cc.yaw += dx * .007;
    cc.pitch = clamp(cc.pitch + dy * .006, .28, 1.35);
   } else {
    const scale = Math.min(c.clientWidth / 74, c.clientHeight / 48) / cc.zoom;
    cc.panX -= dx / scale; cc.panZ -= dy / scale;
   }
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) c.addEventListener(type, () => held = false);
  c.addEventListener('wheel', e => {
   e.preventDefault();
   cc.zoom = clamp(cc.zoom * Math.exp(e.deltaY * .0009), .4, 2.2);
   cc.lastInput = performance.now();
  }, {passive: false});
  c.addEventListener('dblclick', () => Object.assign(cc, CAMERA, {lastInput: performance.now()}));
 }
 setMode(mode) { this.interaction.mode = mode === '2D' ? '2D' : '3D'; this.interaction.lastInput = performance.now(); }

 // ---- drawing primitives ----------------------------------------------------------
 drawMesh(mesh, model, color) {
  const gl = this.gl;
  gl.bindVertexArray(mesh.vao);
  gl.uniformMatrix4fv(this.uni.model, false, model);
  gl.uniform3f(this.uni.base, ...color);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  this.drawCalls++;
 }
 box(x, y, z, w, h, d, c, rot = 0) { this.drawMesh(this.boxMesh, mat.model(x, y, z, w, h, d, rot), c); }
 // Flat ground paint, lifted slightly above the pavement it sits on.
 paint(x, z, w, d, c, rot = 0, lift = 0) { this.box(x, SURFACE - .012 + lift, z, w, .006, d, c, rot); }
 glow(on, draw) {
  if (on) this.gl.uniform1f(this.uni.effect, effect.light);
  draw();
  if (on) this.gl.uniform1f(this.uni.effect, effect.surface);
 }
 // Parts of a vehicle placed in its own frame: +x is forward along `heading`.
 parts(x, z, heading) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  return (dx, y, dz, w, h, d, fill) =>
   this.box(x + dx * cos - dz * sin, y, z + dx * sin + dz * cos, w, h, d, fill, -heading);
 }

 drawAircraft(pose, scale, accent) {
  const placed = {...pose, y: pose.y + SURFACE - .03};
  const model = flight.transform(placed, scale);
  for (const [material, mesh] of this.aircraftMeshes) {
   const matrix = material === 'gear' && pose.gear < 1
    ? flight.transform(placed, scale, (1 - pose.gear) * 1.05)
    : model;
   const finish = material === 'cockpit' && !this.showAircraftWindows ? 'body' : material;
   this.drawMesh(mesh, matrix, finish === 'teal' ? accent : aircraftColors[finish]);
  }
 }

 worker(x, z, t, busy, walking) {
  const bob = walking ? Math.abs(Math.sin(t * 9 + x)) * .06 : 0;
  this.box(x, .46, z, .2, .5, .2, [.20, .27, .33]);
  this.box(x, .92 + bob, z, .3, .46, .24, busy ? [.98, .56, .10] : [.86, .80, .22]);
  this.box(x, 1.26 + bob, z, .2, .2, .2, [.80, .62, .48]);
  this.box(x, 1.39 + bob, z, .25, .08, .25, busy ? [.98, .98, .98] : [.95, .84, .2]);
 }

 tug(x, z, heading = 0, color = this.accent, dolly = true) {
  const part = this.parts(x, z, heading);
  part(0, .42, 0, 1.25, .5, .82, color);
  part(-.2, .86, 0, .6, .46, .74, [.86, .91, .92]);
  part(.52, .6, 0, .14, .16, .7, [.14, .2, .24]);
  for (const xx of [-.42, .42]) for (const zz of [-.4, .4]) part(xx, .2, zz, .28, .28, .16, [.1, .14, .17]);
  if (!dolly) return;
  part(-.72, .26, 0, .34, .06, .08, [.2, .26, .3]);
  part(-1.3, .3, 0, 1.12, .12, .96, [.36, .43, .47]);
  for (const xx of [-1.66, -.94]) for (const zz of [-.45, .45]) part(xx, .16, zz, .22, .22, .12, [.1, .14, .17]);
 }

 truck(x, z, heading, loaded) {
  const part = this.parts(x, z, heading);
  part(1.25, .78, 0, .95, 1.12, 1.3, [.90, .93, .94]);
  part(1.6, 1.0, 0, .3, .46, 1.14, [.16, .28, .34]);
  part(-.45, .42, 0, 2.5, .18, 1.3, [.22, .28, .32]);
  if (loaded) part(-.45, 1.14, 0, 2.4, 1.26, 1.26, [.82, .86, .87]);
  for (const xx of [-1.2, -.4, 1.25]) for (const zz of [-.6, .6]) part(xx, .24, zz, .46, .46, .18, [.1, .13, .16]);
 }

 // One unit-load container. The lid colour is the order's deadline state.
 container(x, y, z, heading, job, scale = 1) {
  const level = this.ops.urgency(job);
  const tall = job.priority >= 3 ? 1.12 : job.priority === 2 ? .94 : .8;
  const h = tall * scale, w = .98 * scale, d = .9 * scale;
  const body = job.blocked ? [.52, .44, .44] : job.cold ? [.93, .97, .99] : [.74, .79, .82];
  this.box(x, y + h / 2, z, w, h, d, body, -heading);
  if (job.cold) this.box(x, y + h * .5, z, w + .02, h * .22, d + .02, [.16, .58, .86], -heading);
  if (job.blocked) this.box(x, y + h * .5, z, w + .02, h * .2, d + .02, [.86, .24, .2], -heading);
  const pulse = level === 3 ? .78 + .22 * Math.sin(this.wallTime * 7 + x) : 1;
  const lid = urgencyColors[level].map(v => v * pulse);
  this.glow(level >= 2 && this.dark > .4, () => this.box(x, y + h + .035, z, w, .07, d, lid, -heading));
 }

 // ---- static world ----------------------------------------------------------------
 ground(dark) {
  const bx = (...args) => this.box(...args);
  const wet = this.weather === 'STORM' ? .72 : this.weather === 'RAIN' ? .84 : 1;
  const tone = c => c.map(v => v * wet);
  const {ground, runway, taxiway, apron, road, terminal, coldStore, yard, cold, hold, crew, depot, truckLane} = layout;
  const concrete = tone([.62, .67, .68]), asphalt = tone([.25, .31, .35]), white = [.92, .95, .93], yellow = [.93, .76, .25];

  bx(ground.x, -.47, 0, ground.width, .94, ground.depth, [.34, .49, .41]);

  // Landside road and cargo terminal: every admitted order arrives here by truck.
  bx(truckLane + .5, .02, 0, 5.2, .06, ground.depth, asphalt);
  for (let z = -22; z <= 22; z += 3) this.paint(truckLane - .9, z, .1, 1.3, white);
  const levels = this.sceneControls.warehouseLevels || 6;
  const height = 2.2 + levels * .55;
  bx(terminal.x, height / 2, terminal.z, terminal.width, height, terminal.depth, [.74, .82, .84]);
  bx(terminal.x, height + .14, terminal.z, terminal.width + .5, .28, terminal.depth + .5, [.88, .92, .93]);
  for (const x of [-3.4, 0, 3.4]) bx(terminal.x + x, height + .34, terminal.z, 2, .14, terminal.depth - 3, [.3, .46, .52]);
  const west = terminal.x - terminal.width / 2, east = terminal.x + terminal.width / 2;
  bx(west - .9, 2.5, terminal.z, 1.8, .14, terminal.depth - 1, [.82, .87, .88]);
  for (let k = 0; k < 5; k++) {
   const z = terminal.z - 5 + k * 2.5;
   bx(west - .03, 1.05, z, .08, 1.9, 1.7, [.22, .34, .4]);
   bx(east + .03, .8, z + 1.25, .08, 1.5, 1.5, [.2, .36, .42]);
  }
  for (let floor = 1; floor < levels; floor++) bx(east + .02, 2.2 + floor * .55, terminal.z, .06, .22, terminal.depth - 1.2, [.4, .6, .68]);
  this.glow(dark > .35, () => bx(east + .06, 2.05, terminal.z, .06, .12, terminal.depth - 1, [.98, .9, .62]));

  // Staging yard. A container holds one slot from admission until the policy dispatches it.
  bx(-5.1, .01, .4, 21.4, .1, 24, concrete);
  for (let row = 0; row < yard.rows; row++) {
   const z = yard.z + row * yard.rowPitch;
   this.paint(-4.6, z, 19.4, 1.02, tone([.55, .60, .62]));
   this.paint(-4.6, z + .95, 19.4, .05, yellow);
  }
  this.paint(-4.6, cold.z, 19.4, 1.1, tone([.50, .66, .74]));
  this.paint(-4.6, cold.aisle, 19.4, .05, [.3, .62, .8]);
  // Hold cage: blocked orders (customs, DGR, measurement) can never be dispatched.
  const holdX = hold.x + (hold.cols - 1) * hold.colPitch / 2;
  this.paint(holdX, hold.z, hold.cols * hold.colPitch + .6, 1.5, tone([.72, .56, .54]));
  for (let k = 0; k <= hold.cols; k += 2) for (const side of [-1, 1]) {
   bx(hold.x - .6 + k * hold.colPitch, .5, hold.z + side * .8, .07, 1, .07, [.6, .3, .28]);
  }
  for (const side of [-1, 1]) bx(holdX, .98, hold.z + side * .8, hold.cols * hold.colPitch + .6, .05, .05, [.6, .3, .28]);

  // Cold store. Lit bays are the cold capacity; a dark red bay is out of service.
  const {cfgColdBays, coldBays} = this.ops.capacity;
  bx(coldStore.x, 1.45, coldStore.z, coldStore.width, 2.9, coldStore.depth, [.80, .90, .93]);
  bx(coldStore.x, 3, coldStore.z, coldStore.width + .4, .2, coldStore.depth + .4, [.36, .66, .78]);
  const front = coldStore.z + coldStore.depth / 2;
  for (let k = 0; k < Math.min(6, Math.max(cfgColdBays, 1)); k++) {
   const x = 3.4 - k * 2.9;
   const working = k < coldBays, busy = k < this.ops.stats.coldBusy;
   bx(x, 1.05, front + .03, 2, 2, .08, working ? (busy ? [.14, .5, .78] : [.86, .93, .96]) : [.33, .2, .2]);
   this.glow(true, () => bx(x, 2.36, front + .08, 1.1, .16, .08,
    !working || k >= cfgColdBays ? [.86, .2, .18] : busy ? [.2, .72, 1] : [.3, .86, .62]));
  }

  // Crew shelter and tug depot.
  bx(crew.x + 2.1, 1.05, crew.z + 2.5, 6.4, 2.1, 1.6, [.84, .86, .8]);
  bx(crew.x + 2.1, 2.16, crew.z + 2.1, 6.8, .12, 2.6, [.92, .62, .2]);
  this.paint(depot.x, depot.z, 5.2, 2.2, tone([.5, .56, .58]));
  for (const side of [-1, 1]) this.paint(depot.x, depot.z + side * 1.1, 5.2, .06, yellow);

  // Apron, service road, taxiway and runway.
  bx(apron.x, .012, 0, apron.width, .1, apron.depth, tone([.45, .52, .55]));
  this.paint(road.x, 0, road.width, apron.depth - 1, tone([.33, .40, .44]));
  for (let z = -19; z <= 19; z += 2.6) this.paint(road.x, z, .07, 1.2, white);
  bx(taxiway.x, .012, 0, taxiway.width + 1.2, .1, 44, tone([.38, .45, .48]));
  this.paint(taxiway.x, 0, .1, 42, yellow);
  for (const z of [-20.2, 20.4]) {
   bx((taxiway.x + runway.x) / 2, .012, z, runway.x - taxiway.x, .1, 3.4, tone([.38, .45, .48]));
   this.paint((taxiway.x + runway.x) / 2, z, runway.x - taxiway.x - 3, .1, yellow);
  }
  bx(runway.x, .014, 0, runway.width, .1, runway.half * 2, tone([.21, .27, .31]));
  for (let z = -14; z <= 14; z += 4) this.paint(runway.x, z, .18, 2.2, white);
  for (const side of [-1, 1]) {
   this.paint(runway.x + side * (runway.width / 2 - .3), 0, .1, runway.half * 2 - 1, white);
   for (const offset of [-2.4, -1.5, -.6, .6, 1.5, 2.4]) this.paint(runway.x + offset, side * (runway.half - 2.4), .36, 2.2, white);
  }
  this.gl.uniform1f(this.uni.effect, effect.light);
  for (const side of [-1, 1]) {
   for (let z = -20; z <= 20; z += 4) bx(runway.x + side * (runway.width / 2 + .1), .12, z, .14, .1, .14, [.78 + dark * .2, .93, 1]);
   for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) bx(runway.x + x, .12, side * (runway.half + .3), .18, .1, .14, side < 0 ? [.25, .93, .6] : [.95, .3, .25]);
  }
  for (let z = -18; z <= 18; z += 6) bx(taxiway.x + 2.05, .1, z, .1, .08, .1, [.3, .5, 1]);
  this.gl.uniform1f(this.uni.effect, effect.surface);

  // Apron floodlights.
  for (const z of [-18, -6, 6, 18]) {
   bx(10.2, 3, z, .14, 6, .14, [.5, .56, .58]);
   this.glow(dark > .35, () => bx(10.5, 6, z, .9, .16, .5, dark > .35 ? [1, .95, .76] : [.82, .85, .84]));
  }
  this.drawControlTower(-25.5, -17.5, dark);
  for (let x = -35; x <= 37; x += 3) {
   for (const z of [-23.6, 23.6]) { bx(x, .45, z, .07, .9, .07, [.42, .5, .5]); bx(x, .86, z, 3, .03, .03, [.5, .57, .57]); }
  }
 }

 drawControlTower(x, z, dark) {
  this.box(x, .3, z, 3.4, .6, 3.4, [.62, .69, .71]);
  this.box(x, 3.2, z, 1.3, 5.4, 1.3, [.72, .80, .80]);
  this.box(x, 6.05, z, 2.9, .3, 2.9, [.62, .73, .73]);
  this.glow(dark > .35, () => this.box(x, 6.7, z, 2.6, 1, 2.6, dark > .35 ? [.62, .82, .86] : [.18, .39, .46]));
  this.box(x, 7.3, z, 3, .2, 3, [.81, .89, .88]);
  this.box(x, 7.7, z, .08, .6, .08, [.54, .64, .67]);
  this.glow(true, () => this.box(x, 8.04, z, .16, .13, .16, [1, .38, .28]));
 }

 // Stand paint and equipment reflect capacity: configured, closed by weather, or without crew.
 drawStands(t) {
  const amber = [.93, .76, .25], cream = [.86, .9, .9], red = [.88, .24, .2];
  for (const stand of this.ops.stands) {
   const {x, z} = stand;
   const closed = stand.configured && !stand.open;
   const line = closed ? red : stand.configured ? amber : [.5, .56, .58];
   this.paint(x + 2.6, z, 9.6, .08, line);
   this.paint(x - 3.3, z, .1, 1.6, line);
   for (const side of [-1, 1]) this.paint(x + .4, z + side * 2.95, 7.4, .06, closed ? red : cream);
   if (closed) {
    for (const rot of [.62, -.62]) this.paint(x, z, 6.4, .34, red, rot, .004);
    for (let k = 0; k < 5; k++) {
     this.box(x - 3.6, .3, z - 2.4 + k * 1.2, .26, .5, .26, [.98, .45, .1]);
     this.box(x - 3.6, .36, z - 2.4 + k * 1.2, .28, .1, .28, [.98, .98, .98]);
    }
    continue;
   }
   if (!stand.open) continue;
   for (const side of [-1, 1]) {
    const id = stand.sides[side];
    if (side === 1 && !id) continue;
    const job = id && this.ops.jobs.get(id);
    const pose = job && this.ops.jobPose(job);
    this.loader(servicePoint(stand, side), pose ? pose.lift : 0, stand.staffed || Boolean(job));
    // Ground strip: how far this order's work has progressed, coloured by its deadline state.
    const barZ = z + side * 1.25;
    this.paint(11.35, barZ, 2.6, .5, [.2, .25, .28]);
    if (job) {
     const fill = clamp(job.shown, 0, 1) * 2.5;
     this.glow(true, () => this.paint(10.1 + fill / 2, barZ, fill, .4, urgencyColors[this.ops.urgency(job)], 0, .004));
    }
   }
   if (!stand.staffed && !stand.sides[-1]) {
    // Open stand that the current crew cannot serve.
    const blink = .55 + .45 * Math.sin(t * 3);
    this.glow(true, () => this.box(12.4, 1.5, z - 1.25, .3, .3, .3, amber.map(v => v * blink)));
    this.box(12.4, .7, z - 1.25, .07, 1.4, .07, [.4, .46, .48]);
   }
  }
 }

 loader(point, lift, crewed) {
  const {x, z} = point;
  this.box(x, .24, z, 1.7, .3, 1.2, crewed ? [.95, .78, .2] : [.62, .62, .56]);
  for (const xx of [-.6, .6]) for (const zz of [-.5, .5]) this.box(x + xx, .14, z + zz, .3, .28, .16, [.1, .14, .17]);
  this.box(x - .5, .42 + lift / 2, z, .1, .16 + lift, .9, [.38, .44, .48], .5);
  this.box(x + .5, .42 + lift / 2, z, .1, .16 + lift, .9, [.38, .44, .48], -.5);
  this.box(x, .46 + lift, z, 1.6, .08, 1.15, [.34, .44, .5]);
 }

 // ---- everything that follows the simulation --------------------------------------
 slotCargo(objects, t) {
  const ops = this.ops;
  for (const job of ops.jobs.values()) {
   if (!job.visible) continue;
   if (job.status === 'WAIT') {
    if (job.delay > 0 && job.route) continue;
    if (job.route) this.box(job.x, .16, job.z, 1.1, .14, 1, [.3, .36, .4]);
    this.container(job.x, job.route ? .23 : SURFACE, job.z, 0, job);
    continue;
   }
   const pose = ops.jobPose(job);
   this.tug(pose.tug.x, pose.tug.z, pose.tug.heading);
   if (pose.container.scale > .47) {
    this.container(pose.container.x, pose.container.y - .14, pose.container.z, pose.container.heading, job, pose.container.scale);
   }
  }
  for (const tug of ops.returns) {
   const p = tug.path.at(tug.s);
   this.tug(p.x, p.z, p.heading);
  }
  for (const truck of ops.trucks) {
   const p = truck.path.at(truck.s);
   this.truck(p.x, p.z, p.heading, truck.loaded);
  }
  for (const worker of ops.workers) this.worker(worker.x, worker.z, t, worker.busy, worker.walking);
 }

 drawShadows(aircraft) {
  const gl = this.gl;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(this.uni.effect, effect.shadow);
  const blob = (x, z, w, d, heading, alpha) => {
   gl.uniform1f(this.uni.intensity, alpha);
   this.drawMesh(this.planeMesh, mat.model(x, SURFACE + .012, z, w, 1, d, -heading), [0, 0, 0]);
  };
  for (const {pose} of aircraft) {
   const x = pose.x - pose.y * .24, z = pose.z + pose.y * .15;
   if (Math.abs(x - layout.ground.x) > 36 || Math.abs(z) > 23) continue;
   blob(x, z, 8.7 * layout.aircraftScale, 5.3 * layout.aircraftScale, pose.heading, .5 / (1 + pose.y * .25));
  }
  for (const job of this.ops.jobs.values()) {
   if (job.status !== 'MOVING') continue;
   const {tug} = this.ops.jobPose(job);
   blob(tug.x - .5 * Math.cos(tug.heading), tug.z - .5 * Math.sin(tug.heading), 3.6, 1.7, tug.heading, .34);
  }
  for (const truck of this.ops.trucks) {
   const p = truck.path.at(truck.s);
   blob(p.x, p.z, 4.6, 2.2, p.heading, .36);
  }
  gl.uniform1f(this.uni.effect, effect.surface);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
 }

 // ---- 2D overlay: rain, and the numbers the geometry stands for ------------------
 drawOverlay(t, project) {
  const canvas = this.weatherCanvas;
  if (!canvas) return;
  const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(w * dpr), height = Math.floor(h * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const storm = this.weather === 'STORM';
  if (storm || this.weather === 'RAIN') {
   const streaks = storm ? 170 : 80, phase = this.wallTime * 560;
   c.lineWidth = storm ? 1.1 : .75;
   c.strokeStyle = storm ? 'rgba(205,228,240,.5)' : 'rgba(198,222,235,.4)';
   c.beginPath();
   for (let i = 0; i < streaks; i++) {
    const x = (i * 61.13 + Math.sin(i * 8) * 39) % w;
    const y = (i * 97.61 + phase * (.6 + i % 5 * .08)) % (h + 50) - 30;
    c.moveTo(x, y);
    c.lineTo(x - 11, y + 25);
   }
   c.stroke();
   if (storm && Math.sin(this.wallTime * 1.7) > .995) { c.fillStyle = 'rgba(245,250,255,.22)'; c.fillRect(0, 0, w, h); }
  }
  if (!project) return;

  const small = w < 520;
  const size = small ? 9.5 : 11;
  c.font = `600 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
  c.textBaseline = 'middle';
  const tag = (x, y, z, text, tone = 'plain', alpha = 1) => {
   const p = project(x, y, z);
   if (!p) return;
   const tw = c.measureText(text).width + 12, th = size + 8;
   const left = clamp(p[0] - tw / 2, 3, w - tw - 3), top = p[1] - th / 2;
   c.globalAlpha = alpha;
   c.fillStyle = {plain: 'rgba(18,34,40,.78)', bad: 'rgba(196,44,38,.92)', warn: 'rgba(204,128,10,.92)', good: 'rgba(20,132,100,.92)'}[tone];
   c.beginPath();
   c.roundRect(left, top, tw, th, 5);
   c.fill();
   c.fillStyle = '#fff';
   c.fillText(text, left + 6, top + th / 2 + .5);
   c.globalAlpha = 1;
  };
  const ops = this.ops, {stats, capacity} = ops;
  const {yard, coldStore, crew, runway} = layout;
  const late = stats.overdue ? ` · ${stats.overdue} overdue` : stats.atRisk ? ` · ${stats.atRisk} at risk` : '';
  tag(-4.6, 2.4, yard.z - 1.2, `QUEUE ${stats.queue}${late}${stats.hidden > 0 ? ` · +${stats.hidden} not shown` : ''}`,
   stats.overdue ? 'bad' : stats.atRisk ? 'warn' : 'plain');
  const coldDown = capacity.coldBays < capacity.cfgColdBays || capacity.coldBays === 0;
  tag(coldStore.x, 4.2, coldStore.z, `COLD ${stats.coldBusy}/${capacity.coldBays} bays${stats.coldWaiting ? ` · ${stats.coldWaiting} waiting` : ''}${coldDown ? ' · OUTAGE' : ''}`,
   coldDown ? 'bad' : 'plain');
  const busy = ops.workers.filter(worker => worker.busy).length;
  const short = capacity.handlers < capacity.cfgHandlers;
  tag(crew.x + 2.1, 3.2, crew.z + 2.4, `CREW ${busy}/${capacity.handlers} busy${short ? ` · ${capacity.cfgHandlers - capacity.handlers} off` : ''}`, short ? 'warn' : 'plain');
  if (!small) tag(runway.x, 2.6, 17, `${ops.departedFlights} flights out · ${ops.departedOrders} orders`);
  for (const stand of ops.stands) {
   if (stand.configured && !stand.open) tag(stand.x + 1, 2.4, stand.z, 'CLOSED · WEATHER', 'bad');
   else if (stand.open && !stand.staffed && !stand.sides[-1]) tag(stand.x + 1, 2.6, stand.z, 'NO CREW', 'warn');
  }
  if (stats.blocked && !small) tag(layout.hold.x + 4, 2, layout.hold.z, `HOLD ${stats.blocked} blocked`, 'bad');
  for (const pop of ops.pops) {
   const rise = pop.age * 1.6, alpha = clamp(1.6 - pop.age * .7, 0, 1);
   if (pop.late) tag(pop.x, 3 + rise, pop.z, `LATE +${pop.late}`, 'bad', alpha);
   else tag(pop.x, 3 + rise, pop.z, 'ON TIME', 'good', alpha);
  }
 }

 // Plan view for browsers without WebGL2: same model, flat shapes.
 renderFallback2D(t) {
  const canvas = this.canvas;
  const c = canvas.getContext('2d');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!c || w < 4 || h < 4) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#dfe9e6';
  c.fillRect(0, 0, w, h);
  const {panX, panZ, zoom} = this.interaction;
  const scale = Math.min(w / 76, h / 50) / zoom;
  const originX = w / 2 - (panX + layout.ground.x) * scale, originY = h / 2 - panZ * scale;
  c.save();
  c.translate(originX, originY);
  c.scale(scale, scale);
  const rect = (x, z, width, depth, fill) => { c.fillStyle = fill; c.fillRect(x - width / 2, z - depth / 2, width, depth); };
  const {ground, runway, taxiway, apron, road, terminal, coldStore, hold, truckLane} = layout;
  const ops = this.ops;
  rect(ground.x, 0, ground.width, ground.depth, '#a9c4b3');
  rect(truckLane + .5, 0, 5.2, ground.depth, '#5c6f77');
  rect(-5.1, .4, 21.4, 24, '#c3cdcd');
  rect(apron.x, 0, apron.width, apron.depth, '#93a3a8');
  rect(road.x, 0, road.width, apron.depth - 1, '#75878d');
  rect(taxiway.x, 0, taxiway.width + 1.2, 44, '#7f9096');
  rect(runway.x, 0, runway.width, runway.half * 2, '#4e6168');
  for (let z = -14; z <= 14; z += 4) rect(runway.x, z, .2, 2.2, '#eef4f2');
  rect(terminal.x, terminal.z, terminal.width, terminal.depth, '#dbe7e8');
  rect(coldStore.x, coldStore.z, coldStore.width, coldStore.depth, '#9fd3e2');
  rect(hold.x + 4.2, hold.z, 10, 1.5, '#dcb9b4');
  for (const stand of ops.stands) {
   const closed = stand.configured && !stand.open;
   rect(stand.x + .4, stand.z, 7.4, 5.6, closed ? '#d9a6a0' : stand.configured ? '#a9b8bc' : '#9aa9ad');
   for (const side of [-1, 1]) {
    const job = stand.sides[side] && ops.jobs.get(stand.sides[side]);
    if (!job) continue;
    rect(11.35, stand.z + side * 1.25, 2.6, .5, '#2f3b41');
    const fill = clamp(job.shown, 0, 1) * 2.5;
    rect(10.1 + fill / 2, stand.z + side * 1.25, fill, .4, urgencyCss[ops.urgency(job)]);
   }
  }
  for (const job of ops.jobs.values()) {
   if (!job.visible || (job.delay > 0 && job.route)) continue;
   let x = job.x, z = job.z;
   if (job.status === 'MOVING') {
    const pose = ops.jobPose(job);
    rect(pose.tug.x, pose.tug.z, 1.2, .8, this.name === 'fcfs' ? '#a47a36' : '#0c8a7d');
    if (pose.container.scale <= .47) continue;
    x = pose.container.x; z = pose.container.z;
   }
   rect(x, z, .98, .9, job.cold ? '#e9f6fb' : job.blocked ? '#8d7474' : '#bcc8cd');
   rect(x, z, .6, .52, urgencyCss[ops.urgency(job)]);
  }
  for (const truck of ops.trucks) { const p = truck.path.at(truck.s); rect(p.x, p.z, 1.4, 3.2, '#f1f4f4'); }
  for (const tug of ops.returns) { const p = tug.path.at(tug.s); rect(p.x, p.z, 1.2, .8, '#6d8088'); }
  for (const worker of ops.workers) {
   c.fillStyle = worker.busy ? '#f08a1c' : '#d8c63a';
   c.beginPath(); c.arc(worker.x, worker.z, .28, 0, 2 * Math.PI); c.fill();
  }
  for (const {pose} of ops.aircraftPoses()) {
   aircraftModel.drawPlan(c, pose, layout.aircraftScale, this.name === 'fcfs' ? '#a47a36' : '#008479', this.showAircraftWindows);
  }
  c.restore();
  this.drawOverlay(t, (x, y, z) => [originX + x * scale, originY + z * scale - y * 4]);
 }

 cameraMatrices(w, h) {
  const {mode, yaw, pitch, zoom, panX, panZ, custom} = this.interaction;
  const aspect = w / h;
  if (mode === '2D') {
   const halfWidth = Math.max(38, 25 * aspect) * zoom;
   const halfHeight = halfWidth / aspect;
   return {
    projection: mat.ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, .1, 180),
    view: mat.look([panX + 1, 54, panZ + .01], [panX + 1, 0, panZ]),
   };
  }
  const tall = aspect < 1.05;
  const angle = custom ? yaw : tall ? 2.72 : yaw;
  this.viewYaw = angle;
  const distance = (tall && !custom ? 61 * Math.max(1, .62 / aspect) : 54 * Math.max(1, 1.5 / aspect)) * zoom;
  const focusX = tall && !custom ? 4 : 3;
  const eye = [
   focusX + Math.cos(angle) * Math.cos(pitch) * distance,
   Math.sin(pitch) * distance + 3,
   Math.sin(angle) * Math.cos(pitch) * distance,
  ];
  return {projection: mat.perspective(.82, aspect, .1, 320), view: mat.look(eye, [focusX, 0, 1])};
 }

 // Feed the latest server snapshot to the operations model, then advance it by one frame.
 advance(t) {
  const seconds = clamp((t - (this.lastFrame ?? t)) / 1000, 0, .15);
  this.lastFrame = t;
  this.wallTime = t / 1000;
  const controls = this.sceneControls, configured = controls.configured || {};
  if (this.state !== this.syncedState || this.simTick !== this.syncedTick) {
   if (this.simTick !== this.syncedTick) this.lastTickChange = t;
   this.syncedState = this.state;
   this.syncedTick = this.simTick;
   this.ops.sync(this.state, {
    tick: this.simTick,
    handlers: controls.handlers, stands: controls.stands, coldBays: controls.cold_bays,
    cfgHandlers: configured.handlers, cfgStands: configured.stands, cfgColdBays: configured.cold_bays,
   });
  }
  const rate = Math.max(0, Number(this.actualTicksPerSecond) || 0);
  // Visual tempo follows achieved simulation speed; a manual step plays out briefly while paused.
  const stepping = !this.running && t - (this.lastTickChange ?? -1e9) < 2600;
  const tempo = this.running ? clamp(1 + .8 * Math.log2(Math.max(1, rate / .5)), 1, 6) : stepping ? 1.6 : 0;
  this.ops.step(seconds, tempo, this.running ? Math.max(rate, .5) : stepping ? .5 : 0);
  this.sceneTime += seconds * tempo;
  return seconds;
 }

 render(t) {
  const seconds = this.advance(t);
  if (this.fallback) { this.renderFallback2D(t); return; }
  const gl = this.gl, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
  if (w < 4 || h < 4 || gl.isContextLost()) return;
  const dp = Math.min(devicePixelRatio || 1, 1.7), rw = Math.round(w * dp), rh = Math.round(h * dp);
  if (this.canvas.width !== rw || this.canvas.height !== rh) { this.canvas.width = rw; this.canvas.height = rh; }
  gl.viewport(0, 0, rw, rh);
  if (this.autoOrbit === true && this.name === 'fcfs' && t - this.interaction.lastInput > 2700 && this.interaction.mode === '3D') {
   const cc = this.interaction;
   if (!cc.custom) { cc.yaw = this.viewYaw ?? cc.yaw; cc.custom = true; }
   cc.yaw += seconds * .07;
  }
  const hour = this.hour;
  const dark = clamp(.12 + Math.max(0, (7 - hour) / 7, (hour - 17) / 7), .1, .75);
  const rain = this.weather === 'STORM' ? 1 : this.weather === 'RAIN' ? .5 : 0;
  this.dark = dark;
  const grey = rain * .35 + (this.weather === 'FOG' ? .3 : 0);
  const sky = [lerp(lerp(.50, .56, grey), .05, dark), lerp(lerp(.70, .62, grey), .12, dark), lerp(lerp(.76, .64, grey), .22, dark)];
  gl.clearColor(...sky, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(this.prog);
  const {projection, view} = this.cameraMatrices(w, h);
  gl.uniformMatrix4fv(this.uni.projection, false, projection);
  gl.uniformMatrix4fv(this.uni.view, false, view);
  gl.uniform3f(this.uni.lightDir, -.44, .89, -.51);
  gl.uniform3f(this.uni.lightColor, 1.03 - dark * .3 - rain * .08, 1.01 - dark * .22 - rain * .06, .96 - dark * .08);
  gl.uniform3f(this.uni.fogColor, ...sky);
  gl.uniform1f(this.uni.ambient, .55 - dark * .16);
  gl.uniform1f(this.uni.fogMix, this.weather === 'FOG' ? .62 : rain * .26);
  this.drawCalls = 0;
  gl.uniform1f(this.uni.effect, effect.sky);
  gl.depthMask(false);
  this.drawMesh(this.planeMesh, mat.model(0, 0, 0), sky);
  gl.depthMask(true);
  gl.uniform1f(this.uni.effect, effect.surface);

  const aircraft = this.ops.aircraftPoses();
  this.ground(dark);
  this.drawStands(this.wallTime);
  this.drawShadows(aircraft);
  this.slotCargo(this.state?.objects, this.sceneTime);
  for (const {pose} of aircraft) this.drawAircraft(pose, layout.aircraftScale, this.accent);

  const clip = mat.mul(projection, view);
  this.drawOverlay(t, (x, y, z) => {
   const cw = clip[3] * x + clip[7] * y + clip[11] * z + clip[15];
   if (cw <= .1) return null;
   const cx = (clip[0] * x + clip[4] * y + clip[8] * z + clip[12]) / cw;
   const cy = (clip[1] * x + clip[5] * y + clip[9] * z + clip[13]) / cw;
   if (Math.abs(cx) > 1.05 || Math.abs(cy) > 1.05) return null;
   return [(cx * .5 + .5) * w, (.5 - cy * .5) * h];
  });
 }
}

window.RelayV6 = {...window.RelayV6, GroundScene: GLWorld};
window.RELAY_V9_SCENE = {version: '13.0', engine: 'native-webgl2', fallback: '2d-airport-map', supports2D: true, ready: true};
})();
