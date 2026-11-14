// Drag-and-drop by ray casting: pick a cargo unit from the inbound line or the
// accumulation area, carry it over an aircraft (or its stand) and release. The backend
// guard (Model I) accepts or refuses; the reason is shown on the aircraft and as a toast.
import * as THREE from 'three';
import { STAND_Z } from './layout.js';

export class DragDrop {
  constructor({ world, cargo, actors, layout, api, toast, onState }) {
    Object.assign(this, { world, cargo, actors, layout, api, toast, onState });
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.drag = null; this.checks = {};
    const el = world.renderer.domElement;
    // capture phase on the container so a cargo grab never reaches OrbitControls
    el.parentElement.addEventListener('pointerdown', e => this.down(e), { capture: true });
    el.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('contextmenu', e => { if (this.drag) e.preventDefault(); });
  }

  setPointer(e) {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera);
  }

  pickCargo() {
    const hit = this.ray.intersectObjects(this.cargo.pickables, false)[0];
    return hit ? this.cargo.objs.get(hit.object.userData.cargoId) : null;
  }

  standUnder(point) {
    let best = -1, bestD = Infinity;
    this.layout.standX.forEach((sx, i) => {
      const dx = Math.abs(point.x - sx), dz = point.z - STAND_Z;
      if (dx < 36 && dz > -40 && dz < 46 && dx < bestD) { best = i; bestD = dx; }
    });
    return best;
  }

  parkedOn(stand) {
    for (const a of this.actors.values()) if (a.flight.stand === stand && a.parked) return a;
    return null;
  }

  targetAt(point) {
    const proxies = [...this.actors.values()].filter(a => a.parked).map(a => a.proxy);
    const hit = this.ray.intersectObjects(proxies, false)[0];
    if (hit) return [...this.actors.values()].find(a => a.proxy === hit.object);
    const s = point ? this.standUnder(point) : -1;
    return s >= 0 ? this.parkedOn(s) : null;
  }

  inStaging(p) {
    const st = this.layout.staging; const xs = st.map(v => v.x), zs = st.map(v => v.z);
    return p.x > Math.min(...xs) - 6 && p.x < Math.max(...xs) + 6 && p.z > Math.min(...zs) - 7 && p.z < Math.max(...zs) + 7;
  }

  down(e) {
    if (e.button !== 0) return;
    this.setPointer(e);
    const o = this.pickCargo();
    if (!o || o.leaving || ![2, 3, 4, 5].includes(o.data.state)) return;
    e.preventDefault(); e.stopPropagation();
    this.world.controls.enabled = false;
    o.dragging = true; this.drag = { o, origin: o.pos.clone(), target: null, mode: o.data.state >= 4 ? 'offload' : 'load' };
    this.world.renderer.domElement.style.cursor = 'grabbing';
    document.body.classList.add('dragging');
    this.checks = {};
    if (this.drag.mode === 'load') {
      this.api.check(o.id).then(r => { if (this.drag && this.drag.o === o) { this.checks = r.flights; this.paintPads(); } });
    }
    this.paintPads();
  }

  paintPads(hoverStand = -1) {
    const d = this.drag;
    this.world.standPads.forEach((pad, i) => {
      const a = this.parkedOn(i); const chk = a && this.checks[a.id];
      let color = 0x8a949c, op = 0;
      if (d && d.mode === 'load' && a) {
        color = chk ? (chk.ok ? 0x18b26b : 0xe0483a) : 0x8a949c;
        op = i === hoverStand ? 0.5 : 0.2;
      }
      pad.material.color.setHex(color); pad.material.opacity = op;
    });
    for (const a of this.actors.values()) {
      const chk = d && d.mode === 'load' && this.checks[a.id];
      a.labelEl.classList.toggle('drop-ok', !!chk && chk.ok);
      a.labelEl.classList.toggle('drop-no', !!chk && !chk.ok);
      a.labelEl.classList.toggle('drop-hover', !!d && d.target === a);
      a.labelEl.dataset.reason = chk && !chk.ok ? chk.message : '';
    }
  }

  move(e) {
    this.setPointer(e);
    if (!this.drag) {
      const o = this.pickCargo();
      const id = o && !o.leaving ? o.id : null;
      if (id !== this.cargo.hovered) {
        this.cargo.hovered = id;
        this.world.renderer.domElement.style.cursor = id && [2, 3, 4, 5].includes(o.data.state) ? 'grab' : '';
      }
      return;
    }
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return;
    const o = this.drag.o;
    o.pos.set(p.x, 6, p.z);
    const target = this.drag.mode === 'load' ? this.targetAt(p) : null;
    this.drag.target = target; this.drag.point = p;
    this.paintPads(target ? target.flight.stand : -1);
  }

  async up() {
    const d = this.drag; if (!d) return;
    this.drag = null; this.world.controls.enabled = true;
    this.world.renderer.domElement.style.cursor = '';
    document.body.classList.remove('dragging');
    const o = d.o;
    try {
      if (d.mode === 'load' && d.target) {
        const r = await this.api.load(o.id, d.target.id);
        if (r.ok) this.toast('good', `${o.id} → ${d.target.flight.number}`, r.message);
        else { this.toast('bad', `Refused: ${o.id} → ${d.target.flight.number}`, r.message); this.shake(d.target); }
        this.onState(r.state);
      } else if (d.mode === 'offload' && d.point && this.inStaging(d.point)) {
        const r = await this.api.offload(o.id);
        this.toast(r.ok ? 'info' : 'bad', r.ok ? `${o.id} offloaded` : 'Offload refused', r.message);
        this.onState(r.state);
      }
    } finally {
      o.dragging = false; this.paintPads();
    }
  }

  shake(actor) {
    actor.labelEl.classList.remove('shake'); void actor.labelEl.offsetWidth; actor.labelEl.classList.add('shake');
  }
}
