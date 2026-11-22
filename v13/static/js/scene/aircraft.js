// Aircraft: GLB templates per type and sim-time-driven motion actors.
// Position is a pure function of the (interpolated) simulated minute, so planes pause with
// the simulation and stay in sync at any speed multiplier.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { arrivalPaths, departurePaths, STAND_Z } from './layout.js';

const FALLBACK_MODEL = 'a350-cathay.glb';
const BASE_COLOR_SCALE = { 'a350-cathay.glb': 0.78, 'b777-300er.glb': 0.82 };
const loader = new GLTFLoader();
const templates = new Map();

// Timeline offsets in simulated minutes (engine: LAND_TO_STAND = 24, CLEAR_AFTER_DEPARTURE = 32)
const APPROACH = 6, ROLLOUT = 4;
const PUSH = 4, HOLD = 1, TAXI_OUT = 14, ROLL = 6, CLIMB = 7;

function loadModel(file) {
  if (!templates.has(file)) {
    templates.set(file, new Promise((resolve, reject) => {
      loader.load(`/assets/aircraft/${file}`, g => resolve(prepare(g.scene, file)), undefined, reject);
    }).catch(() => file === FALLBACK_MODEL ? null : loadModel(FALLBACK_MODEL)));
  }
  return templates.get(file);
}

function prepare(root, file) {
  const drop = [];
  const materials = new Set();
  root.traverse(o => {
    if (o.isCamera || o.isLight) drop.push(o);
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) materials.add(m);
    }
  });
  for (const material of materials) {
    if (material.map) material.map.anisotropy = 8;
    material.envMapIntensity = 1.0;
    material.color?.multiplyScalar(BASE_COLOR_SCALE[file] ?? 1);
  }
  drop.forEach(o => o.parent && o.parent.remove(o));
  root.updateMatrixWorld(true);
  // Nose must face +z. The fin tip is the highest vertex: if it sits at +z the model faces -z.
  let topY = -Infinity, topZ = 0; const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 5) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y > topY) { topY = v.y; topZ = v.z; } }
  });
  const flip = new THREE.Group(); flip.add(root);
  if (topZ > 0) flip.rotation.y = Math.PI;
  flip.updateMatrixWorld(true); root = flip;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  holder.add(root);
  holder.userData.length = size.z; holder.userData.span = size.x; holder.userData.height = size.y;
  return holder;
}

export function preloadAircraft(files) { return Promise.all([...new Set(files)].map(loadModel)); }

// distance fraction for a phase given time fraction u and relative start/end speeds
function profile(u, v0, v1) { u = THREE.MathUtils.clamp(u, 0, 1); return (v0 * u + 0.5 * (v1 - v0) * u * u) / ((v0 + v1) / 2); }
function easeInOut(u) { u = THREE.MathUtils.clamp(u, 0, 1); return u - Math.sin(2 * Math.PI * u) / (2 * Math.PI); }

const tmpT = new THREE.Vector3();

export class AircraftActor {
  constructor(scene, layout, flight) {
    this.scene = scene; this.layout = layout; this.flight = flight; this.id = flight.id;
    this.root = new THREE.Group(); this.pitch = new THREE.Group(); this.root.add(this.pitch);
    this.root.visible = false; scene.add(this.root);
    this.phase = 'hidden'; this.gone = false;
    const sx = layout.standX[flight.stand];
    this.arr = arrivalPaths(sx); this.dep = departurePaths(sx);
    // pick proxy for drag-and-drop ray casting
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    this.proxy.userData.flightId = flight.id; this.root.add(this.proxy);
    this.labelEl = document.createElement('div'); this.labelEl.className = 'plane-tag';
    this.label = new CSS2DObject(this.labelEl); this.root.add(this.label);
    loadModel(flight.model).then(tpl => {
      if (!tpl || this.disposed) return;
      const m = tpl.clone(true);
      // shared mesh: stretch to this type's real length and span, height follows the mean
      const kz = flight.length_m / tpl.userData.length, kx = flight.span_m / tpl.userData.span, k = (kz + kx) / 2;
      m.scale.set(kx, k, kz); this.pitch.add(m); this.model = m;
      this.proxy.scale.set(flight.span_m * 0.55, tpl.userData.height * k, flight.length_m);
      this.proxy.position.y = tpl.userData.height * k / 2;
      this.label.position.set(0, tpl.userData.height * k + 9, -flight.length_m * 0.3);
    });
  }

  update(flight) { this.flight = flight; }

  place(curve, s, reverse = false, yLift = null) {
    const p = curve.getPointAt(THREE.MathUtils.clamp(s, 0, 1));
    curve.getTangentAt(THREE.MathUtils.clamp(s, 0.0001, 0.9999), tmpT);
    if (reverse) tmpT.negate();
    this.root.position.set(p.x, yLift ?? p.y, p.z);
    this.root.rotation.y = Math.atan2(tmpT.x, tmpT.z);
  }

  tick(t) {
    const f = this.flight; const dep = f.departure;
    let phase, pitch = 0;
    if (t < f.land - APPROACH) phase = 'hidden';
    else if (t < f.land) {
      phase = 'approach';
      const u = (t - (f.land - APPROACH)) / APPROACH, s = profile(u, 1, 0.82);
      const flare = THREE.MathUtils.smoothstep(s, 0.86, 1);
      const c = this.arr.approach; const p = c.getPointAt(s);
      this.place(c, s, false, p.y * (1 - 0.35 * flare));
      pitch = 3 + 3 * flare;
    } else if (t < f.land + ROLLOUT) {
      phase = 'rollout';
      const u = (t - f.land) / ROLLOUT; this.place(this.arr.rollout, profile(u, 1, 0.1));
      pitch = 6 * (1 - THREE.MathUtils.smoothstep(u, 0, 0.18));
    } else if (t < f.on_stand) {
      phase = 'taxi-in';
      const dur = Math.max(1, f.on_stand - f.land - ROLLOUT);
      this.place(this.arr.taxi, profile((t - f.land - ROLLOUT) / dur, 0.9, 0.25));
    } else if (t < dep) {
      phase = 'parked'; this.place(this.arr.taxi, 1);
    } else if (f.status === 'cancelled') {
      if (t < dep + PUSH) { phase = 'pushback'; this.place(this.dep.pushback, easeInOut((t - dep) / PUSH), true); }
      else if (t < dep + PUSH + TAXI_OUT) { phase = 'tow'; this.place(this.dep.tow, easeInOut((t - dep - PUSH) / TAXI_OUT)); }
      else phase = 'gone';
    } else if (t < dep + PUSH) {
      phase = 'pushback'; this.place(this.dep.pushback, easeInOut((t - dep) / PUSH), true);
    } else if (t < dep + PUSH + HOLD) {
      phase = 'engine-start'; this.place(this.dep.pushback, 1, true);
    } else if (t < dep + PUSH + HOLD + TAXI_OUT) {
      phase = 'taxi-out'; this.place(this.dep.taxi, easeInOut((t - dep - PUSH - HOLD) / TAXI_OUT));
    } else if (t < dep + PUSH + HOLD + TAXI_OUT + ROLL) {
      phase = 'takeoff';
      const u = (t - dep - PUSH - HOLD - TAXI_OUT) / ROLL; this.place(this.dep.roll, profile(u, 0.02, 1));
      pitch = 9 * THREE.MathUtils.smoothstep(u, 0.82, 1);
    } else if (t < dep + PUSH + HOLD + TAXI_OUT + ROLL + CLIMB) {
      phase = 'climb';
      const u = (t - dep - PUSH - HOLD - TAXI_OUT - ROLL) / CLIMB; this.place(this.dep.climb, profile(u, 1, 1.25));
      pitch = 9 + 2 * Math.min(1, u * 3);
    } else phase = 'gone';

    this.pitch.rotation.x = -pitch * Math.PI / 180;
    this.root.visible = phase !== 'hidden' && phase !== 'gone';
    if (phase === 'gone' && t > dep) this.gone = true;
    this.phase = phase;
    this.labelEl.classList.toggle('airborne', phase === 'approach' || phase === 'climb' || phase === 'takeoff');
    return phase;
  }

  get parked() { return this.phase === 'parked'; }

  dispose() {
    this.disposed = true; this.scene.remove(this.root);
    this.labelEl.remove();
  }
}

export const STAND_REF_Z = STAND_Z;
