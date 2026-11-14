// Cargo units: ULDs, pallets, crates; their placement on the inbound line, in the
// accumulation area, at the aircraft and at the exception desk; and the floating tags.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as T from './textures.js';
import { CARGO_SCALE } from './layout.js';
import { CAT_ICON, CAT_LABEL } from '../ui/icons.js';

const S = CARGO_SCALE;

// ---- geometry prototypes (metres before CARGO_SCALE) ---------------------------------
function ld3Geometry() {
  // AKE/LD3 end profile with the lower contour; extruded along z (depth 1.53 m).
  const sh = new THREE.Shape();
  sh.moveTo(-1.0, 0); sh.lineTo(0.56, 0); sh.lineTo(1.01, 0.52); sh.lineTo(1.01, 1.63); sh.lineTo(-1.0, 1.63); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1.53, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1 });
  g.translate(0, 0, -0.765);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nor.getZ(i)) > 0.9) uv.setXY(i, (pos.getX(i) + 1.03) / 2.06, pos.getY(i) / 1.66);
    else uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  }
  return g;
}

const mats = {};
function mat(key, make) { return mats[key] || (mats[key] = make()); }
const std = (o) => new THREE.MeshStandardMaterial(o);

function uld(skin, door) {
  const g = new THREE.Mesh(ld3Geometry(), [door, skin]);
  return g;
}

function boxMesh(w, h, d, m, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z); return b;
}

const builders = {
  GEN: () => uld(mat('alu', () => std({ map: T.aluminium(), metalness: 0.85, roughness: 0.42 })),
    mat('genDoor', () => std({ map: T.uldDoor('AKE 21734 CX'), roughness: 0.75, metalness: 0.1 }))),
  FRESH: () => uld(mat('reefer', () => std({ map: T.aluminium('#e8edf0', 33), metalness: 0.3, roughness: 0.5 })),
    mat('freshDoor', () => std({ map: T.uldDoor('RKN 30512 CX', '#245c86', '#e8edf0'), roughness: 0.7 }))),
  PHARMA: () => {
    const g = new THREE.Group(); const skin = mat('pharma', () => std({ map: T.pharmaSkin(), roughness: 0.38, metalness: 0.1 }));
    g.add(boxMesh(2.05, 1.62, 1.55, skin));
    g.add(boxMesh(0.7, 0.28, 0.9, mat('unit', () => std({ color: 0x2a3036, roughness: 0.6, metalness: 0.4 })), 0.55, 1.62, 0));
    return g;
  },
  AVI: () => {
    const g = new THREE.Group();
    g.add(boxMesh(2.0, 0.14, 1.6, mat('pallet', () => std({ map: T.aluminium('#b9bec2', 35), metalness: 0.85, roughness: 0.45 }))));
    g.add(boxMesh(1.8, 1.45, 1.45, mat('crate', () => std({ map: T.woodCrate(), roughness: 0.85 })), 0, 0.14, 0));
    return g;
  },
  DG: () => {
    const g = new THREE.Group(); const card = mat('card', () => std({ map: T.cardboard(), roughness: 0.9 }));
    const dg = mat('dg', () => std({ map: T.dgBox(), roughness: 0.85 }));
    g.add(boxMesh(2.2, 0.12, 1.7, mat('pallet', () => std({ map: T.aluminium('#b9bec2', 35), metalness: 0.85, roughness: 0.45 }))));
    for (const [x, z, y, m] of [[-0.52, -0.38, 0.12, dg], [0.52, -0.38, 0.12, card], [-0.52, 0.4, 0.12, card], [0.52, 0.4, 0.12, dg], [-0.25, 0, 0.82, dg], [0.5, 0.1, 0.82, card]])
      g.add(boxMesh(0.98, 0.7, 0.74, m, x, y, z));
    const net = mat('net', () => { const t = T.cargoNet(); t.repeat.set(3, 2); return std({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }); });
    g.add(boxMesh(2.14, 1.44, 1.62, net, 0, 0.1, 0));
    return g;
  },
  VALUABLE: () => {
    const g = new THREE.Group();
    g.add(boxMesh(1.7, 0.12, 1.4, mat('pallet', () => std({ map: T.aluminium('#b9bec2', 35), metalness: 0.85, roughness: 0.45 }))));
    g.add(boxMesh(1.35, 1.2, 1.1, mat('secure', () => std({ map: T.secureSkin(), metalness: 0.7, roughness: 0.35 })), 0, 0.12, 0));
    return g;
  },
};

function build(category) {
  const g = new THREE.Group(); const inner = (builders[category] || builders.GEN)();
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(inner); g.scale.setScalar(S);
  return g;
}

// ---- tags ----------------------------------------------------------------------------
function mins(m) {
  if (m == null) return '';
  const a = Math.abs(Math.round(m)); const s = a >= 60 ? `${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}` : `${a}m`;
  return m < 0 ? `-${s}` : s;
}

function tagHTML(c, t) {
  const category = CAT_LABEL[c.category] || c.category;
  const type = `<span class="ct-cat" title="${category}">${CAT_ICON[c.category] || ''}<span class="ct-cat-label">${category}</span></span>`;
  if (c.state === 7) return `<div class="ctag st-exc mini"><div class="ct-row"><span class="rk rk-exc">EXC</span>${type}</div><div class="ct-row"><b class="ct-fl">${c.id.slice(-4)}</b></div>
    <div class="ct-more"><div><b>${c.id}</b> · ${c.kg} kg</div><div>Missed ${c.target_no} — waiting for an authorised later CX flight</div></div></div>`;
  const cut = c.cutoff - t;
  let badge, cls = `int-${c.intensity}`;
  if (c.state === 4) { badge = `<span class="rk rk-load">LOAD</span>`; cls = 'st-load'; }
  else if (c.state === 5) { badge = `<span class="rk rk-ready">RDY</span>`; cls = 'st-ready'; }
  else badge = `<span class="rk">#${c.rank ?? '–'}</span>`;
  const flags = [];
  if (c.state === 3 || c.state === 2) {
    if (!c.docs_ready) flags.push('<i class="fl fl-docs" title="Documents pending">D</i>');
    if (c.hold) flags.push('<i class="fl fl-hold" title="Mandatory hold">H</i>');
  }
  const when = c.state === 4 ? mins(c.eta - t) : mins(cut);
  return `<div class="ctag ${cls}">
    <div class="ct-row">${badge}${type}</div>
    <div class="ct-row"><span class="ct-tier t-${c.tier}">${c.tier.slice(2)}</span><b class="ct-fl">${c.target_no.replace('CX ', '')}</b></div>
    <div class="ct-row"><span class="ct-when">${when}</span>${flags.join('')}</div>
    <div class="ct-more"><div><b>${c.id}</b></div><div>${c.tier} · ${c.kg} kg</div>
      <div>${c.target_no} → ${c.route} · Stand ${c.stand}</div><div>Cutoff ${mins(cut)} · docs ${c.docs_ready ? 'ready' : 'pending'}${c.hold ? ' · HOLD' : ''}${c.quote ? ' · spot sale' : ''}</div></div>
  </div>`;
}

// ---- manager -------------------------------------------------------------------------
export class CargoManager {
  constructor(scene, layout) {
    this.scene = scene; this.layout = layout; this.objs = new Map(); this.pickables = [];
    this.slots = new Array(layout.staging.length).fill(null);
    this.exSlots = new Array(layout.exception.length).fill(null);
    this.lineOrder = []; this.dolly = new Map(); // flightId -> [cargoId]
    this.beltDir = new THREE.Vector3().subVectors(layout.beltEnd, layout.beltStart).normalize();
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.4, 40), new THREE.MeshBasicMaterial({ color: 0x15d18c, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring); this.ring = ring;
    this.hovered = null; this.highlight = null;
  }

  ensure(c) {
    let o = this.objs.get(c.id);
    if (o) return o;
    const group = build(c.category);
    group.traverse(m => { if (m.isMesh) { m.userData.cargoId = c.id; this.pickables.push(m); } });
    const el = document.createElement('div'); el.className = 'ctag-wrap';
    const tag = new CSS2DObject(el); tag.position.set(0, 1.9, 0); tag.center.set(0.5, 1); group.add(tag);
    o = { id: c.id, group, el, tag, data: c, pos: new THREE.Vector3(), html: '', s: 0, state: c.state, dragging: false, leaving: 0 };
    if (c.state === 2) o.pos.copy(this.layout.beltStart);
    else o.pos.copy(this.targetFor(o, c) || this.layout.beltEnd);
    group.position.copy(o.pos); this.scene.add(group); this.objs.set(c.id, o);
    return o;
  }

  freeSlot(arr, id) { const k = arr.indexOf(id); if (k >= 0) arr[k] = null; }
  takeSlot(arr, id) {
    let k = arr.indexOf(id); if (k >= 0) return k;
    k = arr.indexOf(null); if (k >= 0) arr[k] = id; return k;
  }

  targetFor(o, c) {
    const L = this.layout;
    if (c.state === 3) { const k = this.takeSlot(this.slots, c.id); return k >= 0 ? L.staging[k] : L.beltEnd; }
    if (c.state === 7) { const k = this.takeSlot(this.exSlots, c.id); return k >= 0 ? L.exception[k] : L.exception.at(-1); }
    if (c.state === 4 || c.state === 5) {
      const fid = c.assigned || c.target; if (!this.dolly.has(fid)) this.dolly.set(fid, []);
      const list = this.dolly.get(fid); if (!list.includes(c.id)) list.push(c.id);
      return L.dolly(c.stand - 1, list.indexOf(c.id));
    }
    return null;
  }

  sync(cargo, actors) {
    const seen = new Set();
    for (const c of cargo) {
      seen.add(c.id); const o = this.ensure(c);
      if (o.state !== c.state) {
        if (o.state === 3) this.freeSlot(this.slots, c.id);
        if (o.state === 7) this.freeSlot(this.exSlots, c.id);
        if ((o.state === 4 || o.state === 5) && !(c.state === 4 || c.state === 5)) this.dropDolly(c.id);
        if (c.state === 2) { o.s = Math.max(0, Math.min(this.layout.beltLen, this.layout.beltStart.distanceTo(o.pos))); }
        o.state = c.state;
      }
      o.data = c;
    }
    for (const [id, o] of this.objs) {
      if (seen.has(id) || o.leaving) continue;
      // gone from the live list: flown with its aircraft, or closed/unserved
      this.freeSlot(this.slots, id); this.freeSlot(this.exSlots, id);
      const fid = o.data.assigned; const actor = fid && actors.get(fid);
      o.leaving = 1; o.leaveTo = actor ? actor.root.position.clone().add(new THREE.Vector3(-3, 3, 14)) : null;
      this.dropDolly(id, true);
    }
    this.lineOrder = cargo.filter(c => c.state === 2).sort((a, b) => (this.objs.get(b.id).s - this.objs.get(a.id).s) || (a.arrival - b.arrival)).map(c => c.id);
  }

  dropDolly(id, keep) { for (const list of this.dolly.values()) { const k = list.indexOf(id); if (k >= 0 && !keep) list.splice(k, 1); else if (k >= 0) list[k] = null; } }

  remove(o) {
    this.scene.remove(o.group); o.el.remove(); this.objs.delete(o.id);
    this.pickables = this.pickables.filter(m => m.userData.cargoId !== o.id);
    for (const list of this.dolly.values()) { const k = list.indexOf(o.id); if (k >= 0) list.splice(k, 1); }
  }

  update(dt, t, flow) {
    const L = this.layout; const pitch = 6.4;
    // belt queue: advance, but never closer than one pitch to the unit ahead
    this.lineOrder.forEach((id, k) => {
      const o = this.objs.get(id); if (!o || o.dragging) return;
      const limit = L.beltLen - k * pitch;
      o.s = Math.min(Math.max(o.s, 0) + flow * dt, Math.max(0, limit));
    });
    for (const o of [...this.objs.values()]) {
      const c = o.data;
      if (o.leaving) {
        o.leaving += dt;
        if (o.leaveTo) o.group.position.lerp(o.leaveTo, Math.min(1, dt * 21));
        const k = Math.max(0.001, 1 - o.leaving / 0.5); o.group.scale.setScalar(S * k);
        o.el.style.opacity = String(k);
        if (o.leaving > 0.5) this.remove(o);
        continue;
      }
      if (!o.dragging) {
        let target;
        if (c.state === 2) target = L.beltStart.clone().addScaledVector(this.beltDir, o.s).setY(0);
        else target = this.targetFor(o, c) || o.pos;
        const base = c.state === 2 ? L.beltStart.y : 0;
        const d = Math.hypot(target.x - o.pos.x, target.z - o.pos.z);
        if (c.state === 2 && d < 8) { o.pos.set(target.x, base, target.z); }
        else {
          const step = Math.min(d, Math.max(90, d * 21) * dt);
          if (d > 0.001) { o.pos.x += (target.x - o.pos.x) / d * step; o.pos.z += (target.z - o.pos.z) / d * step; }
          o.pos.y = base + Math.min(3.5, d * 0.12);
        }
      }
      o.group.position.copy(o.pos);
      const html = tagHTML(c, t);
      if (html !== o.html) { o.el.innerHTML = html; o.html = html; }
      o.el.classList.toggle('expanded', o.dragging || this.hovered === o.id || this.highlight === o.id);
      o.el.classList.toggle('dim', !!this.highlight && this.highlight !== o.id);
    }
    const ho = this.objs.get(this.hovered) || this.objs.get(this.highlight);
    this.ring.visible = !!ho && !ho.leaving;
    if (ho) this.ring.position.set(ho.group.position.x, 0.12, ho.group.position.z);
  }
}
