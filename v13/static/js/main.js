// RELAY v13 front end: polls the simulation, drives the 3D apron and the side panels.
import { createWorld } from './scene/world.js';
import { makeLayout } from './scene/layout.js';
import { AircraftActor, preloadAircraft } from './scene/aircraft.js';
import { CargoManager } from './scene/cargo.js';
import { DragDrop } from './scene/interaction.js';
import { RankingPanel, LogPanel, StagingPanel } from './ui/panels.js';
import { ICON } from './ui/icons.js';
import { Dropdown, ComboBox } from './ui/dropdown.js';
import { EvidencePanel } from './ui/evidence.js';
import { initModel } from './ui/model.js';
import { initChat } from './ui/chat.js';

const $ = s => document.querySelector(s);
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
let lastEvent = 0;
const api = {
  state: () => fetch(`/api/state?since=${lastEvent}`).then(r => r.json()),
  control: b => post('/api/control', { ...b, since: lastEvent }),
  step: n => post('/api/step', { n, since: lastEvent }),
  reset: b => post('/api/reset', b),
  check: id => fetch(`/api/check?cargo=${encodeURIComponent(id)}`).then(r => r.json()),
  load: (cargo, flight) => post('/api/load', { cargo, flight, since: lastEvent }),
  offload: cargo => post('/api/offload', { cargo, since: lastEvent }),
};

const hhmm = t => { const m = ((Math.floor(t) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const mins = m => { const a = Math.abs(Math.round(m)); return (m < 0 ? '-' : '') + (a >= 60 ? `${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}` : `${a}m`); };

function toast(tone, title, detail) {
  const el = document.createElement('div'); el.className = `toast tone-${tone}`;
  el.innerHTML = `<span class="ti">${tone === 'good' ? ICON.check : tone === 'bad' ? ICON.ban : ICON.box}</span><div><b class="tt"></b><span class="td"></span></div>`;
  el.querySelector('.tt').textContent = title; el.querySelector('.td').textContent = detail || '';
  $('#toasts').prepend(el); setTimeout(() => el.classList.add('out'), 4200); setTimeout(() => el.remove(), 4700);
}

// ---- tabs ------------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('on', p.id === `tab-${b.dataset.tab}`));
  activeTab = b.dataset.tab;
  if (activeTab === 'evidence') evidencePanel.show();
}));
let activeTab = 'apron';
const evidencePanel = new EvidencePanel($('#tab-evidence'));
initModel($('#tab-model'));
initChat();

// ---- boot ------------------------------------------------------------------------------
let state = await fetch('/api/state').then(r => r.json());
lastEvent = 0;
let layout = makeLayout(state.stands, state.staging.capacity);
const world = createWorld($('#viewport'), layout);
const actors = new Map();
let cargo = new CargoManager(world.scene, layout);
const ranking = new RankingPanel($('#panelRank'), {
  onHover: id => { cargo.highlight = id; },
  onFocus: id => { const o = cargo.objs.get(id); if (o) { world.controls.target.lerp(o.pos.clone().setY(0), 0.6); } },
});
const logs = new LogPanel($('#panelLog'));
const staging = new StagingPanel($('#panelStage'));
await preloadAircraft(state.flights.map(f => f.model)).catch(() => {});
$('#loading').remove();

let recvAt = performance.now(), simT = state.t;
function apply(s) {
  if (!s) return;
  if (s.t < state.t - 1 || s.seed !== state.seed) { // a new world
    for (const a of actors.values()) a.dispose(); actors.clear();
    for (const o of [...cargo.objs.values()]) cargo.remove(o);
    cargo.slots.fill(null); cargo.exSlots.fill(null); cargo.dolly.clear(); cargo.lineOrder = [];
    logs.clear(); ranking.rankT = null; simT = s.t;
  }
  state = s; recvAt = performance.now();
  if (s.events.length) { logs.add(s.events); lastEvent = s.event_seq; }
  for (const f of s.flights) {
    const a = actors.get(f.id);
    if (a) a.update(f); else actors.set(f.id, new AircraftActor(world.scene, layout, f));
  }
  cargo.sync(s.cargo, actors);
  drag.updatePreview();
  ranking.render(s); staging.render(s.staging); renderTop(s);
  window.dispatchEvent(new CustomEvent('relay:state', { detail: s }));  // chat artifacts subscribe to this
}

// ---- top bar ---------------------------------------------------------------------------
const playButton = $('#btnPlay');

async function runControl(control, request) {
  if (control.disabled) return;
  const hadFocus = document.activeElement === control;
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    apply(await request());
  } catch (error) {
    renderTop(state);
    toast('bad', 'Simulation control request failed', error.message);
  } finally {
    control.removeAttribute('aria-busy');
    control.disabled = control === playButton && state.done;
    if (hadFocus && !control.disabled && document.activeElement === document.body) control.focus();
  }
}

// Target TPS: one tick = one simulated minute, so TPS is the only speed control.
const TPS_PRESETS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 60];
const tpsBox = new ComboBox($('#tpsDd'), {
  label: 'Target TPS', options: TPS_PRESETS, min: 0.1, max: 60, step: 0.05,
  onChange: (v, button) => runControl(button, () => api.control({ tps: v })),
});
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const rateDd = new Dropdown($('#rateDd'), {
  label: 'Cargo rate', options: RATES, format: x => `${x}×`,
  onChange: (v, button) => runControl(button, () => api.control({ demand: v })),
});
playButton.addEventListener('click', () => runControl(playButton, () => api.control({ playing: !state.control.playing })));
$('#btnStep').innerHTML = `${ICON.step}<span>Step</span>`;
$('#btnStep').addEventListener('click', e => runControl(e.currentTarget, () => api.step(Math.max(1, +$('#stepN').value || 1))));
$('#autoIn').addEventListener('change', e => runControl(e.currentTarget, () => api.control({ autopilot: e.target.checked })));
$('#btnReset').addEventListener('click', e => runControl(e.currentTarget, () => api.reset({ seed: Math.floor(Math.random() * 99999) + 1 })));
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.defaultPrevented && !['INPUT', 'BUTTON', 'SUMMARY'].includes(document.activeElement.tagName)) { e.preventDefault(); playButton.click(); }
});

function renderTop(s) {
  const c = s.control;
  playButton.innerHTML = c.playing ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>${s.done ? 'Finished' : 'Start'}</span>`;
  playButton.disabled = s.done || playButton.hasAttribute('aria-busy');
  tpsBox.set(c.tps); rateDd.set(RATES.reduce((a, b) => (Math.abs(b - s.demand) < Math.abs(a - s.demand) ? b : a)));
  $('#tpsMeasured').textContent = `${c.measured_tps.toFixed(1)} actual`;
  $('#autoIn').checked = c.autopilot;
  const k = s.kpis;
  $('#kpis').innerHTML = `<span title="Shipments uplifted"><b>${k.uplifted}</b>uplifted</span>
    <span title="Your accepted drops"><b>${k.manual_loads}</b>your loads</span>
    <span title="Drops refused by the guard"><b>${k.blocked}</b>refused</span>
    <span title="Shipments in exception"><b class="${s.counts.exceptions ? 'warn' : ''}">${s.counts.exceptions}</b>exceptions</span>`;
}

// ---- plane labels ------------------------------------------------------------------------
const PHASE = { approach: 'On approach', rollout: 'Landing', 'taxi-in': 'Taxiing in', parked: 'On stand', pushback: 'Pushback',
  'engine-start': 'Engine start', 'taxi-out': 'Taxiing out', takeoff: 'Take-off', climb: 'Departed', tow: 'Towed off' };
function planeLabel(a, t) {
  const f = a.flight; const ph = a.phase;
  const cut = f.cutoff - t, closed = cut <= 0;
  const short = f.type_name.replace(/^(Airbus|Boeing) /, '');
  const banned = ['GEN', 'FRESH', 'PHARMA', 'AVI', 'DG', 'VALUABLE'].filter(c => !f.categories.includes(c));
  const html = `<div class="pt-type ty-${f.type}" title="${f.type_name}"><span class="ty-code">${f.type}</span></div>
    <div class="pt-head"><b>${f.number.replace('CX ', 'CX')}</b></div>
    <div class="pt-route" title="${f.city}">→ ${f.route}</div>
    ${ph === 'parked' ? `<div class="pt-meta">${hhmm(f.departure)}${f.delay > 0 ? ` <em>+${f.delay}</em>` : ''}</div>
    <div class="pt-cut ${closed ? 'closed' : cut < 20 ? 'soon' : ''}">${f.status === 'cancelled' ? 'CNX' : closed ? 'Closed' : `⏱ ${mins(cut)}`}</div>
    <div class="pt-load"><span class="pt-bar"><i style="width:${(100 * f.used) / Math.max(1, f.slots)}%"></i></span>${f.used}/${f.slots}</div>
    <div class="pt-meta" title="max piece weight">≤${f.max_piece_kg}kg</div>
    ${banned.length ? `<div class="pt-rule" title="Not accepted on ${f.type_name}">✕ ${banned.join(' ')}</div>` : ''}`
    : `<div class="pt-phase">${PHASE[ph] || ''}</div>`}
    <div class="pt-reason"></div>`;
  if (html !== a._html) { a.labelEl.innerHTML = html; a._html = html; }
  const reason = a.labelEl.dataset.reason || '';
  const r = a.labelEl.querySelector('.pt-reason'); if (r.textContent !== reason) r.textContent = reason;
}

// ---- loops -------------------------------------------------------------------------------
const drag = new DragDrop({ world, cargo, actors, layout, api, toast, onState: apply });
apply(state);

let polling = false;
setInterval(async () => {
  if (polling) return; polling = true;
  try { apply(await api.state()); } catch { /* server restarting */ } finally { polling = false; }
}, 200);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const c = state.control || {};
  // interpolate the sim clock between polls, never running ahead more than a tick
  const predicted = state.t + (c.playing ? Math.min(1, ((now - recvAt) / 1000) * c.effective_tps) : 0);
  simT = Math.abs(predicted - simT) > 3 ? predicted : Math.max(simT, predicted);
  $('#clockTime').textContent = hhmm(simT); $('#clockDay').textContent = `Day ${Math.floor(simT / 1440) + 1}`;
  world.setTimeOfDay(simT % 1440);
  for (const [id, a] of actors) {
    a.tick(simT);
    if (a.gone) { a.dispose(); actors.delete(id); continue; }
    if (a.root.visible) planeLabel(a, simT);
  }
  const flow = c.playing ? 4 * Math.min(6, Math.max(0.6, c.effective_tps)) : 0;
  world.animateBelt(dt, flow);
  cargo.update(dt, simT, flow);
  if (activeTab === 'apron') world.render();  // no GPU work while another tab is showing
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__relay = { world, actors, cargo, get state() { return state; } };
