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
    this.drag = null; this.preview = null;
    const el = world.renderer.domElement;
    // capture phase on the container so a cargo grab never reaches OrbitControls
    el.parentElement.addEventListener('pointerdown', e => this.down(e), { capture: true });
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerleave', () => this.setHovered(null));
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

  setHovered(o) {
    this.cargo.hovered = o?.id ?? null;
    if (this.drag) return;
    this.world.renderer.domElement.style.cursor = o && [2, 3, 4, 5].includes(o.data.state) ? 'grab' : '';
    this.updatePreview();
  }

  updatePreview() {
    const o = this.drag ? this.drag.o : this.cargo.objs.get(this.cargo.hovered);
    const loadable = o && !o.leaving && (!this.drag || this.drag.mode === 'load')
      && (o.data.state === 2 || o.data.state === 3);
    if (!loadable) {
      if (this.preview) { this.preview = null; this.paintPads(); }
      return;
    }
    const current = this.preview;
    const now = performance.now();
    if (current?.cargo === o && (current.pending || now - current.requestedAt < 1000)) return;
    const preview = { cargo: o, checks: current?.cargo === o ? current.checks : null, pending: true, requestedAt: now };
    this.preview = preview;
    this.paintPads();
    this.api.check(o.id).then(r => {
      if (this.preview !== preview) return;
      preview.checks = r.flights ?? null;
      this.paintPads();
    }).catch(() => {
      if (this.preview === preview) { preview.checks = null; this.paintPads(); }
    }).finally(() => { preview.pending = false; });
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
    this.updatePreview();
    this.paintPads();
  }

  paintPads() {
    const d = this.drag;
    const checks = this.preview?.checks;
    this.world.standPads.forEach((pad, i) => {
      const a = this.parkedOn(i); const chk = a && checks?.[a.id];
      let color = 0x8a949c, op = 0;
      if (this.preview && a) {
        color = chk ? (chk.ok ? 0x18b26b : 0xe0483a) : 0x8a949c;
        op = d?.target === a ? 0.5 : 0.2;
      }
      pad.material.color.setHex(color); pad.material.opacity = op;
    });
    for (const a of this.actors.values()) {
      const chk = a.parked && checks?.[a.id];
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
      this.setHovered(o && !o.leaving ? o : null);
      return;
    }
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return;
    const o = this.drag.o;
    o.pos.set(p.x, 6, p.z);
    const target = this.drag.mode === 'load' ? this.targetAt(p) : null;
    this.drag.target = target; this.drag.point = p;
    this.paintPads();
  }

  async up() {
    const d = this.drag; if (!d) return;
    this.drag = null; this.world.controls.enabled = true;
    this.setHovered(null);
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
