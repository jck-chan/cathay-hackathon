/* RELAY ground twin renderer · native WebGL2 (static/scene/engine.js), no external libraries/CDNs.
   Draws the state held by RelayGroundOps (operations.js): every container, tug, crew member,
   stand and aircraft movement is a projection of the SERVER'S work orders, capacity and weather.
   The airfield layout is illustrative, NOT a surveyed terminal or a certified loading simulator.
   Browsers without webgl2 get renderFallback2D, a plan view of the same model. */
(function () {
'use strict';

const {Engine, MATERIAL: M, mat, environment, clamp, lerp, smooth} = window.RelayEngine;
const Props = window.RelayProps;
const aircraftModel = window.RelayAircraftModel;
const flight = window.RelayFlight;
const {GroundOps, layout, servicePoint, depotBay, towPose, HITCH, DECK} = window.RelayGroundOps;

const accents = {fcfs: [.86, .55, .16], relay: [.04, .5, .46]};
// Deadline state of a work order: on track, tight, cannot finish in time, overdue.
const urgencyColors = [[.16, .66, .5], [.96, .76, .22], [.97, .52, .16], [.9, .2, .18]];
const urgencyCss = ['#1f9f7c', '#d99a12', '#e2711d', '#d63a33'];
// Until the user drags, the camera frames the work from the landside corner.
const CAMERA = {yaw: 2.2, pitch: .52, zoom: 1, panX: 0, panZ: 0, custom: false};
// Two 1.25x zoom-out clicks from the original default (1.25 ** 2).
const V11_CAMERA = {...CAMERA, zoom: 1.5625};
// Ground point just inside the apron, beside the staging yard.
const ORBIT_PIVOT = {x: 13, z: -8};
// V11: fixed world-space target at half the central floodlight's height.
// Keep this literal: the camera never tracks or reads the lamp instance.
const V11_ORBIT_PIVOT = {x: 10.4, y: 7, z: 0};
const LIGHTING = {day: 11.2, dusk: 18.35, night: 22.5};
const PX = 16;                  // ground paint pixels per unit
const hash = (text) => {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
};
const transformPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

const AIRCRAFT_PARTS = {
  body: [[.95, .96, .97], M.aircraft], belly: [[.74, .77, .8], M.aircraft], metal: [[.72, .75, .78], M.alloy],
  glass: [[.05, .08, .1], M.glass], dark: [[.05, .05, .06], M.matte], gear: [[.55, .57, .6], M.steel],
  tyre: [[.07, .07, .075], M.rubber],
};

// ---- ground paint ------------------------------------------------------------------------
let sitePaint = null;
function paintSite() {
  if (sitePaint) return sitePaint;
  const {site, runway, taxiway, road, apron, yard, cold, hold, depot, carts, truckRoad} = layout;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(site.width * PX);
  canvas.height = Math.round(site.depth * PX);
  const c = canvas.getContext('2d');
  c.setTransform(PX, 0, 0, PX, -site.x * PX, -site.z * PX);
  const z0 = site.z, z1 = site.z + site.depth;
  const rect = (x0, za, x1, zb, fill) => { c.fillStyle = fill; c.fillRect(x0, za, x1 - x0, zb - za); };
  const line = (points, width, style, dash = null) => {
    c.beginPath();
    c.moveTo(...points[0]);
    for (const p of points.slice(1)) c.lineTo(...p);
    c.lineWidth = width; c.strokeStyle = style; c.setLineDash(dash || []); c.lineCap = 'butt';
    c.stroke();
    c.setLineDash([]);
  };
  const curve = (a, ctrl, b, width, style) => {
    c.beginPath(); c.moveTo(...a); c.quadraticCurveTo(...ctrl, ...b);
    c.lineWidth = width; c.strokeStyle = style; c.stroke();
  };
  const joints = (x0, za, x1, zb, step, style) => {
    c.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) { c.moveTo(x, za); c.lineTo(x, zb); }
    for (let z = Math.ceil(za / step) * step; z < zb; z += step) { c.moveTo(x0, z); c.lineTo(x1, z); }
    c.lineWidth = .045; c.strokeStyle = style; c.stroke();
  };
  const text = (label, x, z, size, fill, rotation = 0, back = null) => {
    c.save();
    c.translate(x, z); c.rotate(rotation);
    c.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (back) { const w = c.measureText(label).width; c.fillStyle = back; c.fillRect(-w / 2 - size * .2, -size * .62, w + size * .4, size * 1.24); }
    c.fillStyle = fill; c.fillText(label, 0, 0);
    c.restore();
  };
  const WHITE = 'rgba(236,238,234,.92)', YELLOW = 'rgba(236,184,38,.95)', RED = 'rgba(196,40,32,.9)';

  // Pavements: landside and airside concrete pads, apron, roads, taxiway, runway.
  rect(-29.3, -18.5, 9.1, 21.6, '#8e8c86');
  rect(-27.5, -27.5, -20.5, -18.5, '#93918b');
  rect(-31, -39, -15, -28.5, '#3a3c3e');
  rect(truckRoad.x - truckRoad.width / 2, z0, truckRoad.x + truckRoad.width / 2, z1, '#2d2f31');
  rect(road.x - road.width / 2, -road.half, road.x + road.width / 2, road.half, '#323436');
  rect(apron.x0, -apron.half, apron.x1, apron.half, '#94928b');
  rect(apron.x0, apron.half, 41.6, 92, '#908e88');
  rect(taxiway.x - 3.4, runway.entry - 4, taxiway.x + 3.4, runway.exit + 4, '#3d3f41');
  for (const z of [runway.entry, runway.exit]) rect(taxiway.x, z - 3, runway.x - 6, z + 3, '#3d3f41');
  rect(runway.x - 8.6, runway.start, runway.x + 8.6, z1, '#5d5c57');
  rect(runway.x - 7, runway.start, runway.x + 7, z1, '#333537');
  rect(runway.x - 7, z0, runway.x + 7, runway.start, '#4b4a46');
  rect(88.6, z0, 92, z1, '#86847d');

  // Slab joints, patching and oil stains.
  joints(apron.x0, -apron.half, apron.x1, 92, 4, 'rgba(60,58,52,.35)');
  joints(-29.3, -18.5, 9.1, 21.6, 4.5, 'rgba(60,58,52,.3)');
  for (let k = 0; k < 160; k++) {
    const x = lerp(apron.x0, apron.x1, hash('sx' + k)), z = lerp(-apron.half, apron.half, hash('sz' + k));
    c.fillStyle = `rgba(${hash('st' + k) > .5 ? '60,56,50' : '128,126,118'},${.03 + hash('sa' + k) * .06})`;
    c.beginPath(); c.ellipse(x, z, .3 + hash('sr' + k) * 1.6, .2 + hash('sq' + k) * .9, hash('so' + k) * 3, 0, Math.PI * 2); c.fill();
  }
  for (let k = 0; k < 6; k++) {
    // Drips under each parked aircraft's engines and tugs' routes.
    const z = layout.stand(k).z;
    for (let j = 0; j < 14; j++) {
      c.fillStyle = `rgba(30,28,24,${.05 + hash('d' + k + j) * .08})`;
      c.beginPath(); c.ellipse(13 + hash('dx' + k + j) * 12, z + (hash('dz' + k + j) - .5) * 9, .08 + hash('dr' + k + j) * .22, .06 + hash('dq' + k + j) * .14, hash('do' + j) * 3, 0, Math.PI * 2); c.fill();
    }
  }

  // Landside road: lane line, edge lines, kerbside bay.
  line([[truckRoad.x, z0], [truckRoad.x, z1]], .1, WHITE, [1.2, 1.8]);
  for (const s of [-1, 1]) line([[truckRoad.x + s * (truckRoad.width / 2 - .15), z0], [truckRoad.x + s * (truckRoad.width / 2 - .15), z1]], .08, WHITE);
  // Car park bays.
  for (let k = 0; k <= 16; k++) for (const z of [-38.5, -31.5]) line([[-30.4 + k * .9, z], [-30.4 + k * .9, z + 2.4]], .05, WHITE);

  // Service road and the painted crew walkway beside it.
  line([[road.x, -road.half], [road.x, road.half]], .08, WHITE, [1, 1.4]);
  for (const s of [-1, 1]) line([[road.x + s * (road.width / 2 - .1), -road.half], [road.x + s * (road.width / 2 - .1), road.half]], .07, WHITE);
  for (const x of [9.2, 9.85]) line([[x, -apron.half], [x, apron.half]], .06, WHITE);
  for (let z = -apron.half; z < apron.half; z += .6) line([[9.2, z], [9.85, z + .5]], .04, 'rgba(236,238,234,.35)');

  // Stands: lead-in line and turn from the taxiway, stop bar, wingtip clearance lines, number.
  const order = [...Array(layout.standCount).keys()].map(layout.stand).sort((a, b) => a.z - b.z);
  for (let k = 0; k < layout.standCount; k++) {
    const {x, z} = layout.stand(k);
    curve([taxiway.x, z + 7], [taxiway.x, z], [taxiway.x - 7, z], .14, YELLOW);
    line([[taxiway.x - 7, z], [13.2, z]], .14, YELLOW);
    line([[13.75, z - .9], [13.75, z + .9]], .22, YELLOW);
    line([[14.4, z - .5], [14.4, z + .5]], .1, YELLOW);
    for (const s of [-1, 1]) {
      line([[12, z + s * 11.5], [40.6, z + s * 11.5]], .1, RED);
      // Equipment boxes: cart bay and loader position.
      c.lineWidth = .05; c.strokeStyle = WHITE;
      c.strokeRect(11.2, z + s * 5.15 - .32, 1.2, .64);
      line([[14.85, z + s * 1.0], [14.85, z + s * 1.4], [15.25, z + s * 1.4]], .06, WHITE);
      line([[16.35, z + s * 1.0], [16.35, z + s * 1.4], [15.95, z + s * 1.4]], .06, WHITE);
    }
    const number = 501 + order.findIndex(stand => stand.z === z);
    text(String(number), 11.3, z, 1.5, 'rgba(240,196,48,1)', Math.PI / 2, 'rgba(18,18,18,.92)');
  }
  // Taxiway centreline, edge lines, the turns onto the runway, holding positions.
  line([[taxiway.x, runway.entry + 7], [taxiway.x, runway.exit - 7]], .14, YELLOW);
  for (const [z, dir] of [[runway.entry, 1], [runway.exit, -1]]) {
    curve([taxiway.x, z + dir * 7], [taxiway.x, z], [taxiway.x + 7, z], .14, YELLOW);
    curve([runway.x - 12, z], [runway.x, z], [runway.x, z + dir * 12], .14, YELLOW);
    line([[taxiway.x + 7, z], [runway.x - 12, z]], .14, YELLOW);
    for (let k = 0; k < 4; k++) line([[58 + k * .28, z - 3], [58 + k * .28, z + 3]], .1, YELLOW, k < 2 ? null : [.5, .4]);
    text('A', 54, z + dir * -1.9, .9, 'rgba(240,196,48,1)', Math.PI / 2, 'rgba(18,18,18,.9)');
  }
  for (const s of [-1, 1]) {
    line([[taxiway.x + s * 3.25, runway.entry + 3], [taxiway.x + s * 3.25, runway.exit - 3]], .06, YELLOW);
    line([[taxiway.x + s * 3.1, runway.entry + 3], [taxiway.x + s * 3.1, runway.exit - 3]], .06, YELLOW);
  }

  // Runway: piano keys, designation, touchdown zone, aiming point, centreline, edges.
  for (let z = runway.start; z < runway.threshold - 1; z += 2.4) {
    // Chevrons on the blast pad before the threshold.
    line([[runway.x - 6, z + 1.6], [runway.x, z], [runway.x + 6, z + 1.6]], .35, 'rgba(232,186,40,.85)');
  }
  line([[runway.x - 7, runway.threshold], [runway.x + 7, runway.threshold]], .5, WHITE);
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const x = runway.x + s * (1.1 + k * .95);
    rect(x - .22, runway.threshold + .9, x + .22, runway.threshold + 6.5, WHITE);
  }
  text('07', runway.x, runway.threshold + 10.5, 5.5, WHITE, Math.PI);
  for (const [z, bars] of [[runway.threshold + 18, 3], [runway.threshold + 34, 2], [runway.threshold + 48, 2], [runway.threshold + 62, 1]]) {
    for (const s of [-1, 1]) for (let k = 0; k < bars; k++) {
      const x = runway.x + s * (2.4 + k * .6);
      rect(x - .18, z, x + .18, z + 3.4, WHITE);
    }
  }
  for (const s of [-1, 1]) rect(runway.x + s * 3 - .7, runway.aim, runway.x + s * 3 + .7, runway.aim + 7.5, WHITE);
  // Rubber laid down where wheels touch.
  for (let k = 0; k < 420; k++) {
    const z = lerp(runway.aim - 6, runway.aim + 40, Math.pow(hash('rz' + k), 1.6));
    const x = runway.x + (hash('rs' + k) > .5 ? 1 : -1) * lerp(.4, 3.4, hash('rx' + k));
    c.fillStyle = `rgba(14,14,14,${.05 + hash('ra' + k) * .14})`;
    c.fillRect(x - .25, z, .5, 1 + hash('rl' + k) * 5);
  }
  for (let z = runway.threshold + 22; z < z1; z += 9) rect(runway.x - .16, z, runway.x + .16, z + 4.95, WHITE);
  for (const s of [-1, 1]) line([[runway.x + s * 6.55, runway.threshold], [runway.x + s * 6.55, z1]], .18, WHITE);

  // Staging yard: slot outlines, aisle lines, cold row, hold cage, depot bays, cart bays.
  for (let row = 0; row < yard.rows; row++) {
    const z = yard.z + row * yard.rowPitch;
    for (let col = 0; col < yard.cols; col++) {
      c.lineWidth = .04; c.strokeStyle = 'rgba(236,238,234,.55)';
      c.strokeRect(yard.x - col * yard.colPitch - .5, z - .45, 1, .9);
    }
    line([[yard.x + .6, z + .95], [yard.x - (yard.cols - 1) * yard.colPitch - .6, z + .95]], .06, YELLOW);
  }
  rect(cold.x - (cold.cols - 1) * cold.colPitch - .6, cold.z - .6, cold.x + .6, cold.z + .6, 'rgba(70,128,170,.32)');
  for (let col = 0; col < cold.cols; col++) {
    c.lineWidth = .05; c.strokeStyle = 'rgba(120,190,236,.9)';
    c.strokeRect(cold.x - col * cold.colPitch - .5, cold.z - .45, 1, .9);
  }
  line([[cold.x + .6, cold.aisle], [cold.x - (cold.cols - 1) * cold.colPitch - .6, cold.aisle]], .06, 'rgba(120,190,236,.95)');
  const hx0 = hold.x - .7, hx1 = hold.x + (hold.cols - 1) * hold.colPitch + .7;
  c.save(); c.beginPath(); c.rect(hx0, hold.z - .75, hx1 - hx0, 1.5); c.clip();
  for (let x = hx0 - 2; x < hx1; x += .45) line([[x, hold.z + .8], [x + 1.6, hold.z - .8]], .12, 'rgba(196,40,32,.55)');
  c.restore();
  c.lineWidth = .1; c.strokeStyle = RED; c.strokeRect(hx0, hold.z - .75, hx1 - hx0, 1.5);
  for (let k = 0; k <= depot.bays; k++) {
    const x = depot.x + .62 - k * depot.pitch;
    line([[x, depot.z - .9], [x, depot.z + 2.2]], .06, YELLOW);
  }
  line([[road.x - 1.3, depot.south], [layout.westLane, depot.south]], .06, YELLOW, [.6, .6]);
  line([[road.x - 1.3, depot.north], [depot.x - depot.bays * depot.pitch, depot.north]], .06, YELLOW, [.6, .6]);
  for (let k = 0; k <= 12; k++) line([[carts.x + .5 - k, carts.z - .5], [carts.x + .5 - k, carts.z + .5]], .05, WHITE);
  text('CREW', layout.crew.x + 1.2, layout.crew.z + 1, .55, WHITE);

  sitePaint = canvas;
  return canvas;
}

// ---- scene -----------------------------------------------------------------------------
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
  this.wallTime = 0;
  this.fallback = null;
  this.lightingMode = 'live';
  this.airport = layout;
  this.ops = new GroundOps();
  this.accent = accents[name] || accents.relay;
  this.interaction = GLWorld.sharedCamera ||
   (GLWorld.sharedCamera = {...(canvas.dataset.airportLayout === 'v11' ? V11_CAMERA : CAMERA), mode: '3D', lastInput: performance.now()});
  this.showAircraftWindows = canvas.dataset.aircraftWindows !== 'hidden';
  this.gl = canvas.getContext('webgl2', {antialias: false, alpha: false, depth: false, powerPreference: 'high-performance'});
  if (this.gl) {
   try {
    this.initGL();
   } catch (error) {
    console.error('RELAY ground scene: WebGL2 renderer unavailable, using the plan view.', error);
    this.engine?.dispose();
    this.engine = null;
    this.gl = null;
    this.fallback = true;
    // The canvas already holds a WebGL context; draw the plan view on a sibling canvas.
    const plan = document.createElement('canvas');
    plan.className = 'scene-plan';
    plan.setAttribute('aria-hidden', 'true');
    plan.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    canvas.parentElement.insertBefore(plan, canvas.nextSibling);
    this.planCanvas = plan;
   }
  } else {
   this.fallback = true;
  }
  const overlay = document.createElement('canvas');
  overlay.className = 'scene-weather';
  overlay.setAttribute('aria-hidden', 'true');
  canvas.parentElement.insertBefore(overlay, (this.planCanvas || canvas).nextSibling);
  this.weatherCanvas = overlay;
  this.setupInput();
  if (canvas.dataset.airportLayout === 'v11') this.setupZoomButtons();
  (window.RELAY_GROUND_SCENES ||= []).push(this);
 }

 initGL() {
  const tier = this.canvas.dataset.airportLayout === 'v11' ? 'high' : 'medium';
  this.engine = new Engine(this.gl, {tier});
  for (const [material, vertices] of Object.entries(aircraftModel.meshes)) this.engine.addMesh('ac_' + material, vertices);
  this.engine.setSite(paintSite(), [layout.site.x, layout.site.z, layout.site.width, layout.site.depth]);
  this.pen = this.engine.pen;
  this.buildStatic();
 }

 dispose() {
  this.zoomControls?.remove();
  this.weatherCanvas?.remove();
  this.planCanvas?.remove();
  window.RELAY_GROUND_SCENES = (window.RELAY_GROUND_SCENES || []).filter(scene => scene !== this);
  if (!this.gl) return;
  this.engine?.dispose();
  this.gl.getExtension('WEBGL_lose_context')?.loseContext();
 }

 setupInput() {
  const c = this.canvas, cc = this.interaction;
  let held = false, panning = false, lx = 0, ly = 0;
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('pointerdown', e => {
   held = true; panning = e.button === 2 || e.shiftKey || cc.mode === '2D';
   lx = e.clientX; ly = e.clientY; cc.lastInput = performance.now();
   try { c.setPointerCapture(e.pointerId); } catch {}
  });
  c.addEventListener('pointermove', e => {
   if (!held) return;
   const dx = e.clientX - lx, dy = e.clientY - ly;
   lx = e.clientX; ly = e.clientY; cc.lastInput = performance.now();
   if (!cc.custom) { cc.yaw = this.viewYaw ?? cc.yaw; cc.pitch = this.viewPitch ?? cc.pitch; cc.custom = true; }
   if (panning || this.fallback) {
    // Drag the ground: move the focus along the camera's ground axes.
    const per = (this.unitsPerPixel || .1);
    const yaw = cc.mode === '2D' ? -Math.PI / 2 : cc.yaw;
    const fx = -Math.cos(yaw), fz = -Math.sin(yaw), rx = -fz, rz = fx;
    cc.panX -= (dx * rx - dy * fx) * per;
    cc.panZ -= (dx * rz - dy * fz) * per;
   } else {
    cc.yaw += dx * .006;
    cc.pitch = clamp(cc.pitch + dy * .005, .08, 1.45);
   }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(type, () => { held = false; });
  c.addEventListener('wheel', e => {
   e.preventDefault();
   const before = cc.zoom;
   cc.zoom = clamp(cc.zoom * Math.exp(e.deltaY * .0011), .06, 2.4);
   cc.lastInput = performance.now();
   // Zoom toward the point under the cursor.
   const hit = this.groundUnder(e);
   if (hit && this.focus) {
    if (!cc.custom) { cc.yaw = this.viewYaw ?? cc.yaw; cc.pitch = this.viewPitch ?? cc.pitch; cc.custom = true; }
    const k = cc.zoom / before;
    cc.panX += (hit[0] - this.focus[0]) * (1 - k);
    cc.panZ += (hit[2] - this.focus[2]) * (1 - k);
   }
  }, {passive: false});
  c.addEventListener('dblclick', () => Object.assign(cc, this.canvas.dataset.airportLayout === 'v11' ? V11_CAMERA : CAMERA, {lastInput: performance.now()}));
 }
  // Each viewport has a zoom control; the A/B camera stays synchronized.
 setupZoomButtons() {
  const group = document.createElement('div');
  group.className = 'scene-zoom-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Ground camera zoom');
  for (const [label, glyph, factor] of [['Zoom in', '+', 1 / 1.25], ['Zoom out', '−', 1.25]]) {
   const button = document.createElement('button');
   button.type = 'button';
   button.setAttribute('aria-label', label);
   button.title = label;
   button.textContent = glyph;
   button.addEventListener('click', () => {
    const camera = this.interaction;
    camera.zoom = clamp(camera.zoom * factor, .06, 2.4);
    camera.lastInput = performance.now();
   });
   group.appendChild(button);
  }
  this.canvas.parentElement.appendChild(group);
  this.zoomControls = group;
 }
 setMode(mode) { this.interaction.mode = mode === '2D' ? '2D' : '3D'; this.interaction.lastInput = performance.now(); }

 // Where a pointer event's ray meets the ground, using the last frame's camera.
 groundUnder(e) {
  if (!this.inverseViewProj) return null;
  const rect = this.canvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width * 2 - 1, ny = 1 - (e.clientY - rect.top) / rect.height * 2;
  const unproject = z => {
   const m = this.inverseViewProj, w = m[3] * nx + m[7] * ny + m[11] * z + m[15];
   return [(m[0] * nx + m[4] * ny + m[8] * z + m[12]) / w, (m[1] * nx + m[5] * ny + m[9] * z + m[13]) / w, (m[2] * nx + m[6] * ny + m[10] * z + m[14]) / w];
  };
  const a = unproject(-1), b = unproject(1);
  if (Math.abs(b[1] - a[1]) < 1e-6) return null;
  const t = -a[1] / (b[1] - a[1]);
  if (t < 0 || t > 1) return null;
  return [a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t];
 }

 // ---- static world -------------------------------------------------------------------
 buildStatic() {
  const set = this.engine.staticSet;
  set.begin();
  const p = this.pen.into(set);
  const g = {pen: p, engine: this.engine, night: 0, time: 0};
  this.levels = this.sceneControls.warehouseLevels || 7;
  this.terminal(p);
  this.coldStore(p);
  this.crewShelter(p);
  this.depotCanopy(p);
  this.controlTower(p);
  this.hangar(p);
  this.carPark(p);
  this.airfieldFurniture(p);
  this.landscape(p);
  // Spare unit-load devices in a two-tier rack next to the depot.
  for (let k = 0; k < 5; k++) for (const tier of [0, 1]) {
   p.put('box', 1, .05, .9, 1.2 + k * 1.05, tier * .9 + .32, 12.4, [.85, .55, .1], M.paint);
   if (hash('rack' + k + tier) > .3) Props.crate(g, 1.2 + k * 1.05, tier * .9 + .35, 12.4, 0, .5 + hash('rk' + k) * .1);
  }
  for (const x of [.6, 6.4]) for (const z of [11.9, 12.9]) p.put('box', .07, 1.85, .07, x, .92, z, [.85, .55, .1], M.paint);
 }

 terminal(p) {
  const {terminal: t} = layout, h = 2.2 + this.levels * .55;
  const west = t.x - t.width / 2, east = t.x + t.width / 2, north = t.z - t.depth / 2, south = t.z + t.depth / 2;
  const wall = [.76, .79, .8], trim = [.32, .35, .38], door = [.07, .08, .09];
  p.put('box', t.width, h, t.depth, t.x, h / 2, t.z, wall, M.cladding);
  p.put('box', t.width + .1, .35, t.depth + .1, t.x, .175, t.z, [.55, .55, .53], M.concrete);
  p.put('box', t.width + .12, .3, t.depth + .12, t.x, h - .15, t.z, trim, M.paint);
  p.push(t.x, h, t.z, Math.PI / 2);
  p.put('barrel', t.depth + .2, 1.5, t.width + .2, 0, 0, 0, [.7, .71, .7], M.cladding);
  p.pop();
  for (const [x, z, w, d] of [[t.x - 3, t.z - 3, 2, 1.4], [t.x + 2.5, t.z + 2, 1.6, 1.2], [t.x - 1, t.z + 4.5, 1.2, 1.2]]) {
   p.put('cbox', w, .7, d, x, h + .9, z, [.7, .72, .73], M.steel);
   p.push(x, h + 1.27, z, 0, 0, 0);
   p.put('cyl', w * .36, .05, w * .36, -w * .22, 0, 0, [.12, .13, .14], M.matte);
   p.put('cyl', w * .36, .05, w * .36, w * .22, 0, 0, [.12, .13, .14], M.matte);
   p.pop();
  }
  // Office block with curtain wall on the south end.
  p.put('box', t.width, h + 1.4, 2.6, t.x, (h + 1.4) / 2, south + 1.3, [.56, .62, .66], M.windows);
  p.put('box', t.width + .5, .22, 3, t.x, h + 1.5, south + 1.3, [.88, .89, .9], M.paint);
  p.put('box', t.width + .02, .25, 2.62, t.x, 2.6, south + 1.3, [.88, .89, .9], M.paint);
  // Airside dock: one opening per staging aisle, under a canopy.
  for (const z of [-6.4, -3.95, -2.05, -.15, 1.75, 3.65, 5.55]) {
   p.put('box', .06, 1.2, 1.1, east + .03, .6, z, door, M.matte);
   p.put('box', .07, .3, 1.12, east + .035, 1.35, z, [.6, .63, .66], M.cladding);
   p.put('box', .08, 1.55, .08, east + .04, .78, z - .6, [.95, .76, .12], M.paint);
   p.put('box', .08, 1.55, .08, east + .04, .78, z + .6, [.95, .76, .12], M.paint);
  }
  p.put('box', 1.4, .1, t.depth - .6, east + .7, 2.25, t.z, [.86, .87, .88], M.paint);
  for (const z of [north + .6, south - .6]) p.put('box', .08, 2.2, .08, east + 1.3, 1.1, z, trim, M.steel);
  // Landside truck docks: shelters, levellers, bumpers.
  for (let k = 0; k < 5; k++) {
   const z = t.z - 5 + k * 2.5;
   p.put('box', .06, 1.3, 1.3, west - .03, 1.05, z, door, M.matte);
   p.put('box', .3, 1.7, .14, west - .15, 1.1, z - .72, [.08, .08, .09], M.rubber);
   p.put('box', .3, 1.7, .14, west - .15, 1.1, z + .72, [.08, .08, .09], M.rubber);
   p.put('box', .3, .3, 1.6, west - .15, 2.05, z, [.08, .08, .09], M.rubber);
   p.put('box', .5, .4, 1.3, west - .25, .2, z, [.45, .46, .47], M.concrete);
   for (const s of [-1, 1]) p.put('cbox', .1, .18, .14, west - .55, .35, z + s * .5, [.06, .06, .06], M.rubber);
  }
  p.put('box', 1.6, .12, t.depth - 1, west - .8, 2.65, t.z, [.86, .87, .88], M.paint);
 }

 coldStore(p) {
  const s = layout.coldStore, h = 3.5;
  p.put('box', s.width, h, s.depth, s.x, h / 2, s.z, [.9, .93, .95], M.cladding);
  p.put('box', s.width + .3, .2, s.depth + .3, s.x, h + .1, s.z, [.7, .74, .77], M.paint);
  p.put('box', s.width + .02, .25, s.depth + .02, s.x, .12, s.z, [.5, .5, .48], M.concrete);
  p.put('box', s.width + .02, .18, s.depth + .02, s.x, h - .45, s.z, [.1, .45, .72], M.gloss);
  for (let k = 0; k < 4; k++) {
   const x = s.x - 7 + k * 4.6;
   p.put('cbox', 2.6, .8, 1.3, x, h + .6, s.z - .6, [.78, .8, .81], M.steel);
   for (const dx of [-.65, .65]) p.put('cyl', .9, .06, .9, x + dx, h + 1.02, s.z - .6, [.1, .11, .12], M.matte);
  }
  p.put('box', s.width - 1, .1, 1.3, s.x, 2.75, s.z + s.depth / 2 + .65, [.86, .88, .9], M.paint);
 }

 crewShelter(p) {
  const s = layout.shelter;
  p.put('box', s.width, 1.05, s.depth, s.x, .53, s.z, [.62, .68, .72], M.windows);
  p.put('box', s.width + .02, .2, s.depth + .02, s.x, 1.15, s.z, [.92, .62, .18], M.paint);
  p.put('box', s.width + .9, .1, s.depth + 1.4, s.x, 1.3, s.z - .45, [.9, .9, .88], M.paint);
  for (const x of [s.x - s.width / 2 - .3, s.x + s.width / 2 + .3]) p.put('box', .06, 1.3, .06, x, .65, s.z - s.depth / 2 - 1.05, [.3, .32, .34], M.steel);
  p.put('cbox', 1.6, .08, .3, s.x, .3, s.z - s.depth / 2 - .35, [.4, .3, .2], M.matte);
 }

 depotCanopy(p) {
  const d = layout.depot, x0 = d.x + .62 - d.bays * d.pitch, x1 = d.x + .62;
  p.put('box', x1 - x0 + .3, .1, 2.9, (x0 + x1) / 2, 1.65, d.z + .85, [.85, .86, .86], M.metal);
  p.put('box', x1 - x0 + .3, .14, .1, (x0 + x1) / 2, 1.55, d.z - .6, [.95, .76, .12], M.paint);
  for (let k = 0; k <= d.bays; k += 2) for (const z of [d.z - .55, d.z + 2.2]) {
   p.put('box', .08, 1.6, .08, d.x + .62 - k * d.pitch, .8, z, [.3, .32, .34], M.steel);
  }
 }

 controlTower(p) {
  const x = -24, z = -23;
  p.put('box', 3.4, 1.4, 3.4, x, .7, z, [.68, .7, .7], M.concrete);
  p.put('cyl', 1.8, 12.5, 1.8, x, 7.6, z, [.8, .81, .8], M.concrete);
  for (let k = 0; k < 6; k++) p.put('box', .12, 12, .5, x + Math.cos(k) * .9, 7.4, z + Math.sin(k) * .9, [.7, .71, .7], M.concrete);
  p.put('cyl', 3, .35, 3, x, 13.9, z, [.88, .89, .88], M.paint);
  p.put('cyl', 3.1, 1.6, 3.1, x, 14.9, z, [.25, .4, .45], M.litGlass);
  p.put('cyl', 3.5, .25, 3.5, x, 15.82, z, [.9, .9, .9], M.paint);
  p.put('cyl', 2.4, .5, 2.4, x, 16.2, z, [.8, .8, .8], M.paint);
  p.put('cyl', .08, 2.2, .08, x + .6, 17.5, z, [.6, .62, .64], M.steel);
  p.put('sphere', .6, .6, .6, x - .7, 16.8, z + .3, [.96, .96, .96], M.paint);
 }

 hangar(p) {
  const x = 26, z = 86, w = 22, d = 11, h = 6.2;
  p.put('box', w, h, d, x, h / 2, z, [.8, .82, .83], M.cladding);
  p.push(x, h, z);
  p.put('barrel', w + .2, 2.4, d + .2, 0, 0, 0, [.68, .69, .68], M.cladding);
  p.pop();
  for (let k = 0; k < 6; k++) p.put('box', w / 6 - .1, h - .4, .08, x - w / 2 + (k + .5) * w / 6, (h - .4) / 2, z - d / 2 - .04, [.56, .6, .62], M.cladding);
  p.put('box', w + .1, .5, .1, x, h - .25, z - d / 2 - .06, [.08, .3, .35], M.paint);
 }

 carPark(p) {
  const colors = [[.75, .76, .78], [.08, .09, .1], [.94, .94, .93], [.5, .08, .07], [.15, .22, .38], [.42, .44, .46], [.6, .55, .45]];
  for (let row = 0; row < 2; row++) for (let k = 0; k < 16; k++) {
   if (hash('car' + row + k) < .3) continue;
   const x = -30 + k * .9, z = row ? -30.3 : -37.3, color = colors[Math.floor(hash('cc' + row + k) * colors.length)];
   p.push(x, 0, z, Math.PI / 2 + (hash('ca' + k + row) - .5) * .08);
   p.put('cbox', 1.4, .32, .56, 0, .25, 0, color, M.gloss);
   p.put('cbox', .78, .26, .5, -.08, .52, 0, color, M.gloss);
   p.put('box', .8, .2, .52, -.08, .52, 0, [.1, .13, .16], M.glass);
   for (const sx of [-.45, .45]) for (const sz of [-1, 1]) p.put('cyl', .22, .1, .22, sx, .11, sz * .26, [.05, .05, .05], M.rubber);
   p.pop();
  }
 }

 airfieldFurniture(p) {
  const {runway, taxiway, apron} = layout;
  // Apron floodlight masts.
  for (const z of [0, -24, 24, -48, 48, -72, 72]) {
   p.put('cyl', .26, 14, .26, 10.4, 7, z, [.55, .57, .58], M.steel);
   p.put('cyl', .6, .4, .6, 10.4, .2, z, [.6, .6, .58], M.concrete);
   p.push(10.6, 14, z, 0, -.35, 0);
   p.put('box', .4, .5, 2.2, 0, 0, 0, [.25, .27, .28], M.steel);
   p.put('box', .05, .42, 2.05, .2, 0, 0, [1, .95, .8], M.nightLamp);
   p.pop();
  }
  // Runway edge and threshold light housings within the site.
  for (let z = runway.threshold; z < 92; z += 6) for (const s of [-1, 1]) p.put('cyl', .14, .22, .14, runway.x + s * 7.15, .11, z, [.85, .85, .8], M.paint);
  for (let z = runway.start - 6; z > -200; z -= 6) {
   p.put('box', .1, .6, .1, runway.x, .3, z, [.5, .5, .48], M.steel);
   const wide = z === runway.start - 30 || z === runway.start - 60;
   p.put('box', wide ? 9 : 2.4, .08, .12, runway.x, .62, z, [.4, .4, .38], M.steel);
  }
  // PAPI units left of the aiming point.
  for (let k = 0; k < 4; k++) p.put('cbox', .5, .35, .4, runway.x - 9.5 - k * .8, .25, runway.aim + 2, [.85, .85, .82], M.paint);
  // Signs at the holding positions.
  for (const z of [runway.entry, runway.exit]) for (const s of [-1, 1]) {
   p.put('cbox', .18, .5, 1.5, 57.6, .55, z + s * 3.9, [.75, .1, .08], M.paint);
   p.put('box', .2, .15, 1.2, 57.6, .55, z + s * 3.9, [.95, .95, .95], M.paint);
   p.put('cbox', .16, .45, 1.1, taxiway.x + 4.2, .5, z + s * 4.5, [.08, .08, .08], M.paint);
   p.put('box', .18, .3, .5, taxiway.x + 4.2, .5, z + s * 4.5 - .25, [.95, .76, .12], M.paint);
  }
  // Windsock mast.
  p.put('cyl', .1, 3, .1, 83, 1.5, runway.aim - 6, [.9, .9, .9], M.paint);
  // Ground power units and spare equipment at the apron edge.
  for (let k = 0; k < layout.standCount; k++) {
   const z = layout.stand(k).z;
   p.push(10.6, 0, z + 8.4, Math.PI / 2);
   p.put('cbox', .9, .55, .55, 0, .38, 0, [.92, .92, .9], M.paint);
   for (const sx of [-.3, .3]) for (const sz of [-1, 1]) p.put('cyl', .2, .08, .2, sx, .1, sz * .27, [.06, .06, .06], M.rubber);
   p.pop();
   p.put('cbox', .9, .25, .7, 10.7, .2, z - 8.5, [.85, .55, .1], M.paint);
  }
  // Apron edge kerb along the service road.
  p.put('box', .12, .08, apron.half * 2, apron.x0 - .1, .04, 0, [.7, .7, .66], M.concrete);
 }

 landscape(p) {
  const {site} = layout;
  // Perimeter fence between landside and the airfield's outer road.
  for (let z = site.z; z < site.z + site.depth; z += 2.5) p.put('box', .06, 1.1, .06, -36.6, .55, z, [.5, .52, .53], M.steel);
  for (const y of [.25, .7, 1.08]) p.put('box', .03, .03, site.depth, -36.6, y, site.z + site.depth / 2, [.55, .57, .58], M.steel);
  p.put('box', .02, .9, site.depth, -36.6, .6, site.z + site.depth / 2, [.42, .44, .45], M.steel);
  // Seawall and rock armour.
  p.put('box', 1.6, .7, site.depth + 40, 90.8, .2, -10, [.62, .61, .58], M.concrete);
  for (let k = 0; k < 120; k++) {
   const z = lerp(-120, 110, hash('rock' + k)), s = .5 + hash('rs' + k) * .9;
   p.put('sphere', s * 1.3, s * .7, s, 92.2 + hash('rx' + k) * 1.4, -.1, z, [.42 + hash('rc' + k) * .12, .41, .38], M.concrete);
  }
  // Trees landside and around the car park.
  const tree = (x, z, k) => {
   const s = .8 + hash('tsize' + k) * .7;
   p.put('cyl', .16 * s, 1.4 * s, .16 * s, x, .7 * s, z, [.28, .2, .14], M.matte);
   const green = [.12 + hash('tg' + k) * .08, .2 + hash('tg2' + k) * .08, .07];
   p.put('sphere', 2 * s, 1.7 * s, 2 * s, x, 1.9 * s, z, green, M.matte);
   p.put('sphere', 1.4 * s, 1.2 * s, 1.4 * s, x + .4 * s, 2.6 * s, z - .3 * s, green.map(v => v * 1.15), M.matte);
  };
  let k = 0;
  for (let z = site.z + 4; z < site.z + site.depth; z += 3.4 + hash('tz' + z) * 2) tree(-38.6 - hash('tx' + z) * 2.5, z, k++);
  for (let x = -30; x < -15; x += 2.6) tree(x, -41.2 + hash('cp' + x), k++);
  for (const [x, z] of [[-12, -20], [-8, -21], [-4, -19.5], [2, -20.5], [7, -19.8]]) tree(x, z, k++);
 }

 // ---- per-frame world ----------------------------------------------------------------
 container(g, x, y, z, heading, job, scale = 1) {
  const level = this.ops.urgency(job);
  const pulse = level === 3 ? .6 + .4 * Math.sin(this.wallTime * 7 + x) : 1;
  const glow = level >= 2 ? (.15 + .85 * g.night) * pulse : 0;
  Props.container(g, x, y, z, heading, job, urgencyColors[level].map(v => v * (level === 3 ? pulse * .4 + .6 : 1)), glow, scale);
 }

 drawStands(g) {
  const p = g.pen;
  for (const stand of this.ops.stands) {
   const {z} = stand;
   if (stand.configured && !stand.open) {
    // Closed by weather: barriers across the lead-in line.
    for (let k = -3; k <= 3; k++) Props.cone(g, 38.5, z + k * .9);
    for (const s of [-1, 1]) {
     p.push(38.2, 0, z + s * 1.6, Math.PI / 2);
     p.put('cbox', 2, .3, .12, 0, .45, 0, [.9, .15, .1], M.paint);
     for (const dx of [-.9, .9]) p.put('box', .06, .5, .06, dx, .25, 0, [.9, .9, .9], M.paint);
     p.pop();
    }
    continue;
   }
   if (!stand.open) continue;
   for (const side of [-1, 1]) {
    const job = this.ops.jobs.get(stand.sides[side]);
    const pose = job && this.ops.jobPose(job);
    Props.loader(g, servicePoint(stand, side), side, DECK + (layout.sill - DECK) * (pose ? pose.lift : 0), stand.staffed || Boolean(job));
   }
   if (stand.aircraft === 'parked') {
    const s = layout.aircraftScale;
    Props.chock(g, stand.x - 3.75 * s - .25, z, Math.PI / 2);
    for (const side of [-1, 1]) {
     Props.chock(g, stand.x + .42 * s - .3, z + side * .74 * s, Math.PI / 2);
     Props.cone(g, stand.x + 2.1 * s, z + side * 4.9 * s);
     Props.cone(g, stand.x - .2 * s, z + side * 2.4 * s);
    }
    Props.cone(g, stand.x + 5.4 * s, z);
   }
  }
 }

 drawAircraft(g, entry) {
  const {pose, phase, stand} = entry, scale = layout.aircraftScale;
  const p = g.pen, e = this.engine, t = this.wallTime;
  const m = flight.transform(pose, scale);
  const gm = pose.gear < 1 ? flight.transform(pose, scale, (1 - pose.gear) * .55) : m;
  for (const [name] of Object.entries(aircraftModel.meshes)) {
   let [color, material] = AIRCRAFT_PARTS[name] || [this.accent, M.gloss];
   if (name === 'glass' && !this.showAircraftWindows) [color, material] = AIRCRAFT_PARTS.body;
   p.matrix('ac_' + name, name === 'gear' || name === 'tyre' ? gm : m, color, material);
  }
  const L = aircraftModel.lights, at = local => transformPoint(m, local);
  const lit = g.night;
  const live = phase !== 'parked' || stand.pending;
  for (const [key, color] of [['port', [1, .12, .08]], ['starboard', [.15, 1, .35]], ['tail', [1, 1, 1]]]) {
   const [x, y, z] = at(L[key]);
   e.glow(x, y, z, .6 + lit * .5, color, .25 + lit * .9);
  }
  if (live) {
   const beat = (Math.sin(t * 6.3 + stand.index) > .82 ? 1 : 0);
   for (const key of ['beaconTop', 'beaconBelly']) { const [x, y, z] = at(L[key]); e.glow(x, y, z, 1.4, [1, .1, .05], beat * (.6 + lit)); }
  }
  const fast = ['roll', 'climb', 'approach', 'rollout'].includes(phase);
  if (fast) {
   const strobe = (t * 1.2 + stand.index * .3) % 1 < .06 ? 1 : 0;
   for (const key of ['port', 'starboard']) { const [x, y, z] = at(L[key]); e.glow(x, y, z, 2.2, [1, 1, 1], strobe * 1.5); }
  }
  if (fast || (phase === 'taxi' && lit > .2)) {
   for (const local of L.landing) { const [x, y, z] = at(local); e.glow(x, y, z, 1.6, [1, .97, .88], .6 + lit * 1.4); }
   if (pose.y < 25) {
    const ahead = 9 + pose.y * 1.5;
    e.pool(pose.x + Math.cos(pose.heading) * ahead, pose.z + Math.sin(pose.heading) * ahead, 5 + pose.y * .2, [1, .96, .86],
     (.3 + lit * 1.2) / (1 + pose.y * .15), pose.heading, 2.2);
   }
  }
  if (lit > .2) { const [x, y, z] = at(L.logo); e.glow(x, y, z, 2.6, [1, .95, .85], lit * .35); }
  // Pushback tractor on the nose gear, from the moment the departure is called.
  if (entry.kind === 'departure' && phase === 'push' || stand.pending && stand.aircraft === 'outbound' && !entry.moving) {
   const tractor = this.ops.tractorPose(pose, entry.distance || 0);
   Props.pushback(g, tractor.x, tractor.z, tractor.heading, entry.distance || 0, 1.6);
  }
  // Spray from wet runways and tyre smoke on touchdown.
  if (this.env.wet > .3 && pose.y < .4 && entry.speed > 8) {
   for (let k = 0; k < 8; k++) {
    const back = 2.2 + ((t * 4 + k * .37) % 1) * 9;
    const side = k % 2 ? 1 : -1, spread = back * .12;
    e.puff(pose.x - Math.cos(pose.heading) * back - Math.sin(pose.heading) * side * (1.4 + spread), .4 + back * .06,
     pose.z - Math.sin(pose.heading) * back + Math.cos(pose.heading) * side * (1.4 + spread), 1 + back * .35, [.78, .8, .82],
     .18 * (1 - back / 11.5) * this.env.wet);
   }
  }
 }

 drawWorld(g) {
  const ops = this.ops, p = g.pen;
  this.drawStands(g);
  // Containers waiting in their slots, or being carried out of the terminal.
  for (const job of ops.jobs.values()) {
   if (!job.visible || job.status !== 'WAIT') continue;
   if (job.route) {
    if (job.delay > 0) continue;
    const h = job.heading;
    this.container(g, job.x, .2, job.z, h, job);
    Props.forklift(g, job.x - Math.cos(h) * 1.1, job.z - Math.sin(h) * 1.1, h, .2, job.routeS);
    continue;
   }
   this.container(g, job.x, 0, job.z, 0, job);
  }
  // Orders being worked: tug, dolly, then onto the loader and in through the door.
  for (const job of ops.jobs.values()) {
   if (job.status !== 'MOVING') continue;
   const pose = ops.jobPose(job);
   Props.tug(g, pose.tug, this.accent, {seed: job.id.length});
   Props.dolly(g, pose.dolly, pose.tug);
   if (pose.container.scale > 0) this.container(g, pose.container.x, pose.container.y, pose.container.z, pose.container.heading, job);
  }
  for (const tug of ops.returns) {
   const rig = towPose(tug.path, tug.s);
   Props.tug(g, rig.tug, this.accent, {braking: tug.speed < 2 && tug.s > tug.path.length - 3});
   Props.dolly(g, rig.dolly, rig.tug);
  }
  for (let k = 0, parked = ops.parkedTugs(); k < parked; k++) {
   const bay = depotBay(k);
   Props.tug(g, {x: bay.x, z: bay.z, heading: -Math.PI / 2}, this.accent, {driver: false});
   Props.dolly(g, {x: bay.x, z: bay.z + HITCH, heading: -Math.PI / 2}, {x: bay.x, z: bay.z, heading: -Math.PI / 2});
  }
  for (const fork of ops.forklifts) {
   const at = fork.path.at(fork.s);
   Props.forklift(g, at.x, at.z, at.heading, .05, fork.s);
  }
  for (const truck of ops.trucks) Props.truck(g, truck.path.at(truck.s, 2), truck.loaded, truck.braking, truck.s);
  for (const tractor of ops.tractors.values()) {
   const at = tractor.path.at(tractor.s, 1);
   Props.pushback(g, at.x, at.z, at.heading, tractor.s);
  }
  for (const worker of ops.workers) {
   Props.cart(g, worker.cart, worker.mode === 'drive' ? worker : null, worker.index);
   if (worker.mode !== 'drive') Props.person(g, worker);
  }
  // Cold store bays: open and lit while busy, red when out of service.
  const {cfgColdBays, coldBays} = ops.capacity, store = layout.coldStore, front = store.z + store.depth / 2;
  for (let k = 0; k < Math.min(6, Math.max(cfgColdBays, 1)); k++) {
   const x = 3.4 - k * 2.9, working = k < coldBays, busy = k < ops.stats.coldBusy;
   p.put('box', 2, busy ? .5 : 2.1, .08, x, busy ? 1.85 : 1.05, front + .05, working ? [.86, .9, .92] : [.42, .22, .2], M.cladding);
   if (busy) p.put('box', 2, 1.6, .04, x, .8, front + .02, [.06, .1, .13], M.matte);
   const lamp = !working || k >= cfgColdBays ? [1, .15, .1] : busy ? [.2, .7, 1] : [.25, 1, .5];
   p.put('cbox', .5, .12, .1, x, 2.35, front + .1, lamp, M.lamp, .8);
   this.engine.glow(x, 2.35, front + .2, .8, lamp, .35 + g.night * .6);
  }
  // Windsock: points downwind, fills with the wind.
  const wind = this.weather === 'STORM' ? 1 : this.weather === 'RAIN' ? .7 : .45;
  p.push(83, 3, layout.runway.aim - 6, .9 + Math.sin(this.wallTime * .7) * .2, -(1 - wind) * 1.1 + Math.sin(this.wallTime * 3.1) * .05);
  for (let k = 0; k < 5; k++) {
   p.put('cyl', .45 - k * .05, .36, .45 - k * .05, .2 + k * .36, 0, 0, k % 2 ? [.95, .95, .95] : [1, .35, .05], M.cloth);
  }
  p.pop();
  for (const fx of ops.effects) {
   if (fx.kind !== 'touchdown') continue;
   const a = fx.age / fx.life;
   for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    this.engine.puff(fx.x + side * 1.6, .3 + a * 1.2 + k * .2, fx.z - a * 6 - k * 1.2, 1 + a * 4 + k, [.86, .86, .85], .5 * (1 - a));
   }
  }
 }

 // Airfield lights are glows; floodlights also light the ground.
 drawLights(g, env) {
  const e = this.engine, {runway, taxiway} = layout, on = g.night, t = this.wallTime;
  const vis = Math.max(on, env.weather === 'FOG' ? .75 : env.weather === 'STORM' ? .5 : 0);
  if (vis > .02) {
   for (let z = runway.threshold; z < 700; z += 6) for (const s of [-1, 1]) {
    e.glow(runway.x + s * 7.15, .25, z, .7, z > 500 ? [1, .78, .3] : [1, .95, .82], .35 + vis * .7);
   }
   for (let k = -6; k <= 6; k++) e.glow(runway.x + k * 1.1, .2, runway.threshold, .6, [.3, 1, .45], .5 + vis * .6);
   for (let z = runway.entry + 4; z < runway.exit - 4; z += 5) for (const s of [-1, 1]) e.glow(taxiway.x + s * 3.4, .2, z, .45, [.25, .45, 1], .3 + vis * .6);
   for (const z of [runway.entry, runway.exit]) for (let k = -2; k <= 2; k++) e.glow(58, .2, z + k * 1.1, .45, [1, .12, .08], .4 + vis * .6);
   // Approach lights with the sequenced flasher running toward the threshold.
   const rabbit = (t * 2) % 1;
   for (let z = runway.start - 6, k = 0; z > -200; z -= 6, k++) {
    const wide = z === runway.start - 30 || z === runway.start - 60;
    for (let j = wide ? -7 : -2; j <= (wide ? 7 : 2); j++) e.glow(runway.x + j * .55, .7, z, .55, [1, .95, .8], .3 + vis * .6);
    const flash = Math.abs(rabbit - (1 - k / 16)) < .04 ? 1 : 0;
    e.glow(runway.x, .9, z, 2.2, [1, 1, 1], flash * vis * 1.6);
   }
  }
  // PAPI: two white, two red on the glide path.
  for (let k = 0; k < 4; k++) e.glow(layout.runway.x - 9.5 - k * .8, .4, runway.aim + 1.8, .9, k < 2 ? [1, .95, .9] : [1, .12, .08], .35 + vis * .7);
  // Obstruction lights.
  const blink = Math.sin(t * 3) > 0 ? 1 : .2;
  e.glow(-24, 17.3, -23, 1.2, [1, .1, .05], (.3 + on) * blink);
  for (const z of [0, -24, 24, -48, 48, -72, 72]) e.glow(10.4, 14.4, z, .8, [1, .1, .05], (.2 + on * .7) * blink);
  e.clearLights();
  if (on > .02) {
   for (const z of [0, -24, 24, -48, 48, -72, 72]) {
    e.light(12.5, 13.6, z, 36, [1, .9, .72], 7 * on);
    e.glow(10.8, 14, z, 4.5, [1, .92, .75], on * .9);
   }
   const t0 = layout.terminal;
   e.light(t0.x + t0.width / 2 + 1.2, 2.1, t0.z - 3, 9, [1, .85, .6], 2.5 * on);
   e.light(t0.x + t0.width / 2 + 1.2, 2.1, t0.z + 3, 9, [1, .85, .6], 2.5 * on);
   e.light(t0.x - t0.width / 2 - 1.2, 2.6, t0.z, 10, [1, .85, .6], 2.5 * on);
   e.light(layout.coldStore.x, 2.7, layout.coldStore.z + 3.4, 11, [.85, .92, 1], 2 * on);
   e.light(layout.shelter.x, 1.25, layout.shelter.z - 2, 6, [1, .82, .55], 1.6 * on);
   e.light(26, 6, 79, 16, [1, .9, .75], 3 * on);
   for (const x of [t0.x + t0.width / 2 + .7, t0.x - t0.width / 2 - .5]) for (const dz of [-3, 3, 0]) e.glow(x, 2.15, t0.z + dz, .9, [1, .88, .62], on * .7);
  }
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
   const streaks = storm ? 260 : 130, phase = this.wallTime * 620;
   c.lineWidth = storm ? 1 : .7;
   c.strokeStyle = storm ? 'rgba(210,225,240,.32)' : 'rgba(205,222,235,.26)';
   c.beginPath();
   for (let i = 0; i < streaks; i++) {
    const x = (i * 61.13 + Math.sin(i * 8) * 39) % w;
    const y = (i * 97.61 + phase * (.6 + i % 5 * .08)) % (h + 50) - 30;
    const len = 14 + (i % 7) * 3;
    c.moveTo(x, y);
    c.lineTo(x - len * .35, y + len);
   }
   c.stroke();
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
  const {yard, coldStore, crew, runway, hold} = layout;
  const late = stats.overdue ? ` · ${stats.overdue} overdue` : stats.atRisk ? ` · ${stats.atRisk} at risk` : '';
  tag(-4.6, 2.6, yard.z - 1.6, `QUEUE ${stats.queue}${late}${stats.hidden > 0 ? ` · +${stats.hidden} not shown` : ''}`,
   stats.overdue ? 'bad' : stats.atRisk ? 'warn' : 'plain');
  const coldDown = capacity.coldBays < capacity.cfgColdBays || capacity.coldBays === 0;
  tag(coldStore.x, 5.2, coldStore.z, `COLD ${stats.coldBusy}/${capacity.coldBays} bays${stats.coldWaiting ? ` · ${stats.coldWaiting} waiting` : ''}${coldDown ? ' · OUTAGE' : ''}`,
   coldDown ? 'bad' : 'plain');
  const busy = ops.workers.filter(worker => worker.busy).length;
  const short = capacity.handlers < capacity.cfgHandlers;
  tag(crew.x + 1.2, 2.8, crew.z + 1.6, `CREW ${busy}/${capacity.handlers} busy${short ? ` · ${capacity.cfgHandlers - capacity.handlers} off` : ''}`, short ? 'warn' : 'plain');
  if (!small) tag(runway.x, 3, 24, `${ops.departedFlights} flights out · ${ops.departedOrders} orders`);
  for (const stand of ops.stands) {
   if (stand.configured && !stand.open) tag(stand.x + 4, 4, stand.z, 'CLOSED · WEATHER', 'bad');
   else if (stand.open && !stand.staffed && !stand.sides[-1]) tag(stand.x - 6, 3.4, stand.z, 'NO CREW', 'warn');
  }
  if (stats.blocked && !small) tag(hold.x + 4, 2.4, hold.z, `HOLD ${stats.blocked} blocked`, 'bad');
  for (const pop of ops.pops) {
   const rise = pop.age * 1.6, alpha = clamp(1.6 - pop.age * .7, 0, 1);
   if (pop.late) tag(pop.x, 3.4 + rise, pop.z, `LATE +${pop.late}`, 'bad', alpha);
   else tag(pop.x, 3.4 + rise, pop.z, 'ON TIME', 'good', alpha);
  }
 }

 // Plan view for browsers without WebGL2: same model, flat shapes.
 renderFallback2D(t) {
  const canvas = this.planCanvas || this.canvas;
  const c = canvas.getContext('2d');
  const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
  if (!c || w < 4 || h < 4) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rw = Math.round(w * dpr), rh = Math.round(h * dpr);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#7f9a6c';
  c.fillRect(0, 0, w, h);
  const {panX, panZ, zoom} = this.interaction;
  const scale = Math.min(w / 120, h / 110) / zoom;
  this.unitsPerPixel = 1 / scale;
  const originX = w / 2 - (panX + 22) * scale, originY = h / 2 - (panZ - 4) * scale;
  c.save();
  c.translate(originX, originY);
  c.scale(scale, scale);
  const {site} = layout;
  c.drawImage(paintSite(), site.x, site.z, site.width, site.depth);
  const rect = (x, z, width, depth, fill) => { c.fillStyle = fill; c.fillRect(x - width / 2, z - depth / 2, width, depth); };
  const {terminal, coldStore, shelter} = layout;
  const ops = this.ops;
  c.fillStyle = '#2f5d73'; c.fillRect(layout.seaX, site.z - 60, 200, site.depth + 120);
  rect(terminal.x, terminal.z, terminal.width, terminal.depth, '#c9d2d5');
  rect(coldStore.x, coldStore.z, coldStore.width, coldStore.depth, '#e6eef2');
  rect(shelter.x, shelter.z, shelter.width, shelter.depth, '#9fb3bd');
  rect(26, 86, 22, 11, '#cfd4d6');
  for (const job of ops.jobs.values()) {
   if (!job.visible || (job.delay > 0 && job.route)) continue;
   let x = job.x, z = job.z;
   if (job.status === 'MOVING') {
    const pose = ops.jobPose(job);
    rect(pose.tug.x, pose.tug.z, .9, .5, this.name === 'fcfs' ? '#c98a24' : '#0c8a7d');
    rect(pose.dolly.x, pose.dolly.z, .9, .7, '#3b4246');
    if (!pose.container.scale) continue;
    x = pose.container.x; z = pose.container.z;
   }
   rect(x, z, .88, .8, job.cold ? '#e9f6fb' : job.blocked ? '#8d7474' : '#bcc8cd');
   rect(x, z, .56, .48, urgencyCss[ops.urgency(job)]);
  }
  for (const truck of ops.trucks) { const p = truck.path.at(truck.s); c.save(); c.translate(p.x, p.z); c.rotate(p.heading); rect(0, 0, 3.4, 1.1, '#f1f4f4'); c.restore(); }
  for (const tug of ops.returns) { const p = tug.path.at(tug.s); rect(p.x, p.z, .9, .5, '#6d8088'); }
  for (const worker of ops.workers) {
   c.fillStyle = worker.busy ? '#f08a1c' : '#d8c63a';
   c.beginPath(); c.arc(worker.x, worker.z, .3, 0, 2 * Math.PI); c.fill();
  }
  for (const {pose} of ops.aircraftPoses()) {
   aircraftModel.drawPlan(c, pose, layout.aircraftScale, this.name === 'fcfs' ? '#c98a24' : '#008479', this.showAircraftWindows);
  }
  c.restore();
  this.drawOverlay(t, (x, y, z) => [originX + x * scale, originY + z * scale - y * 3]);
 }

 // Frame the configured stands and the staging yard; the user's camera is shared by both cards.
 camera(w, h) {
  const cc = this.interaction, aspect = w / h;
  const zs = this.ops.stands.filter(s => s.configured).map(s => s.z);
  const zMin = Math.min(-18, ...zs.map(z => z - 12)), zMax = Math.max(22, ...zs.map(z => z + 12));
  if (cc.mode === '2D') {
   const half = Math.max(62, (zMax - zMin + 14) / 2 * aspect) * cc.zoom;
   const cx = 22 + cc.panX, cz = (zMin + zMax) / 2 + cc.panZ;
   this.focus = [cx, 0, cz];
   this.unitsPerPixel = half * 2 / w;
   this.viewYaw = cc.yaw; this.viewPitch = cc.pitch;
   return {projection: mat.ortho(-half, half, -half / aspect, half / aspect, 1, 600),
    view: mat.look([cx, 300, cz], [cx, 0, cz], [0, 0, -1]), eye: [cx, 300, cz], focus: this.focus, distance: half * 2, near: 1, far: 600};
  }
  const pivot = this.canvas.dataset.airportLayout === 'v11' ? V11_ORBIT_PIVOT : ORBIT_PIVOT;
  const focus = [pivot.x + cc.panX, pivot.y ?? 0, pivot.z + cc.panZ];
  this.focus = focus;
  const tall = aspect < 1.05;
  const yaw = cc.custom ? cc.yaw : tall ? 2.62 : CAMERA.yaw;
  const pitch = cc.custom ? cc.pitch : tall ? .6 : CAMERA.pitch;
  this.viewYaw = yaw; this.viewPitch = pitch;
  const spread = Math.max(1, (zMax - zMin) / 64);
  const distance = 62 * Math.max(1, 1.35 / aspect) * spread * cc.zoom;
  const eye = [focus[0] + Math.cos(yaw) * Math.cos(pitch) * distance, Math.max(.6, Math.sin(pitch) * distance),
   focus[2] + Math.sin(yaw) * Math.cos(pitch) * distance];
  const fov = .74, near = clamp(distance * .006, .08, 1.5);
  this.unitsPerPixel = 2 * Math.tan(fov / 2) * distance / h;
  return {projection: mat.perspective(fov, aspect, near, 3000), view: mat.look(eye, focus), eye, focus, distance, near, far: 3000};
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
  const dp = Math.min(devicePixelRatio || 1, 1.6), rw = Math.round(w * dp), rh = Math.round(h * dp);
  if (this.canvas.width !== rw || this.canvas.height !== rh) { this.canvas.width = rw; this.canvas.height = rh; }
  const cc = this.interaction;
  if (this.autoOrbit === true && this.name === 'fcfs' && t - cc.lastInput > 2700 && cc.mode === '3D') {
   if (!cc.custom) { cc.yaw = this.viewYaw ?? cc.yaw; cc.pitch = this.viewPitch ?? cc.pitch; cc.custom = true; }
   cc.yaw += seconds * .045;
  }
  if ((this.sceneControls.warehouseLevels || 7) !== this.levels) this.buildStatic();

  const hour = LIGHTING[this.lightingMode] ?? this.hour;
  const storm = this.weather === 'STORM';
  const flash = storm && Math.sin(this.wallTime * 1.7) > .996 ? 1.4 : 0;
  const env = environment(hour, this.weather, flash);
  this.env = env;
  this.dark = env.night;
  const lampsOn = smooth((env.night * 1.25 + env.overcast * .3 + env.dusk * .25 - .18) / .4);
  const g = {pen: this.pen, engine: this.engine, night: lampsOn, time: this.wallTime};

  const camera = this.camera(w, h);
  const e = this.engine;
  e.clearSprites();
  e.dynamicSet.begin();
  this.pen.into(e.dynamicSet);
  this.drawLights(g, env);
  this.drawWorld(g);
  for (const entry of this.ops.aircraftPoses()) this.drawAircraft(g, entry);

  e.render({
   env, projection: camera.projection, view: camera.view, eye: camera.eye, focus: camera.focus,
   shadowRadius: camera.distance * .7, width: rw, height: rh, near: camera.near, far: camera.far,
   time: this.wallTime, groundExtent: 3000, runway: [layout.runway.x, layout.runway.width / 2, layout.runway.start, 0],
   road: [layout.truckRoad.x, layout.truckRoad.width / 2], seaX: layout.seaX, aoRadius: clamp(camera.distance * .012, .25, 1.2),
  });

  const clip = mat.mul(camera.projection, camera.view);
  this.inverseViewProj = mat.invert(clip);
  this.drawOverlay(t, (x, y, z) => {
   const cw = clip[3] * x + clip[7] * y + clip[11] * z + clip[15];
   if (cw <= .1) return null;
   const cx = (clip[0] * x + clip[4] * y + clip[8] * z + clip[12]) / cw;
   const cy = (clip[1] * x + clip[5] * y + clip[9] * z + clip[13]) / cw;
   if (Math.abs(cx) > 1.05 || Math.abs(cy) > 1.05) return null;
   return [(cx * .5 + .5) * w, (.5 - cy * .5) * h];
  });
  if (flash) {
   const c = this.weatherCanvas.getContext('2d');
   c.fillStyle = 'rgba(235,242,255,.18)';
   c.fillRect(0, 0, w, h);
  }
 }
}

window.RelayV6 = {...window.RelayV6, GroundScene: GLWorld};
window.RELAY_V9_SCENE = {version: '14.0', engine: 'native-webgl2', fallback: '2d-airport-map', supports2D: true, ready: true};
})();
