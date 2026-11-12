/* RELAY v11 · Control Tower tab renderer.
   Presentation only: reads the shared state object that v9.js polls and fills the
   .ct markup in v11.html. v9.js still owns every action (review, recalculate,
   mode change, mark-done, drawers) through the element ids kept in that markup. */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const esc = x => String(x ?? '—').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = (x, d = 0) => Number.isFinite(Number(x)) ? Number(x).toLocaleString('en-GB', {maximumFractionDigits: d, minimumFractionDigits: d}) : '—';
const ACRONYMS = /\b(uld|awb|milp|fcfs|relay|eta|hkg)\b/gi;
const human = x => {
  const s = String(x || '').replaceAll('_', ' ').trim().toLowerCase();
  return s ? (s[0].toUpperCase() + s.slice(1)).replace(ACRONYMS, m => m.toUpperCase()) : '—';
};

const PROPOSAL_PREVIEW = 5;
const EVENT_ROWS = 7;
const HIDDEN_EVENTS = ['CLOCK', 'READY', 'PAUSE', 'PLAY', 'SPEED', 'MODE'];
const EVENT_LABEL = {
  WEATHER: 'Weather changed', DISRUPTION: 'Disruption', ARRIVAL: 'Cargo inbound', COMPLETED: 'Ground work completed',
  MODEL: 'Decision recalculated', AUTO_SHADOW: 'Auto-approved in sandbox', REVIEW_REQUIRED: 'Review needed',
  ORDER: 'New shipment', TASK: 'Handoff updated', TUNE: 'Resources adjusted', ERROR: 'Engine error',
};
const EVENT_TONE = {DISRUPTION: 'bad', REVIEW_REQUIRED: 'bad', ERROR: 'bad', AUTO_SHADOW: 'ok', COMPLETED: 'ok'};
const OPEN_TASK = ['PENDING', 'ACKNOWLEDGED', 'READY', 'OPEN', 'QUEUED_SIMULATED'];
const DONE_TASK = ['DONE', 'COMPLETED'];
const MODE_NOTE = {
  AUTO_SHADOW: 'Auto mode approves safe, fresh proposals inside the sandbox on its own. It never books cargo or loads aircraft.',
  MANUAL_REVIEW: 'A supervisor decides whether to simulate these work orders. Nothing is booked with a carrier.',
  ADVISORY: 'Advisory mode: recommendations are shown for reference and cannot be accepted.',
};

let showAllProposals = false;
let lastState = null;

/* Only touch the DOM when something changed, so the 1 s poll never steals a
   hover, a scroll position or a click that is in flight. */
const painted = new Map();
function html(id, markup) {
  const el = $(id);
  if (!el || painted.get(id) === markup) return;
  painted.set(id, markup);
  el.innerHTML = markup;
}
function text(id, value, tone) {
  const el = $(id);
  if (!el) return;
  const v = String(value ?? '—');
  if (el.textContent !== v) el.textContent = v;
  if (tone === undefined) return;
  if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
}

function decisionStatus(d) {
  if (!d.id) return ['No decision yet', ''];
  if (d.stale) return ['Out of date', 'warn'];
  if (d.approval_blocked_external_evidence) return ['Blocked · verify flight', 'warn'];
  if (d.status === 'PENDING_REVIEW') return ['Needs review', 'warn'];
  if (d.status === 'APPROVED_SIMULATION_ONLY') return ['Approved · simulation only', 'ok'];
  if (String(d.status).startsWith('REJECTED')) return ['Rejected', 'bad'];
  return [human(d.status), ''];
}

function proposals(d) {
  const all = d.proposed_actions || [];
  if (!all.length) return d.id ? '<p class="ct-empty">This decision proposes no route changes.</p>' : '';
  const rows = (showAllProposals ? all : all.slice(0, PROPOSAL_PREVIEW)).map(a => `<tr>
    <td>${esc(a.shipment_id)}</td>
    <td>${esc(a.from_assigned_flight_id || 'Unassigned')}</td>
    <td class="ct-arrow" aria-hidden="true">→</td>
    <td class="ct-route">${esc((a.route || []).join(' → ') || '—')}</td>
    <td><span class="ct-tag">${a.route_status === 'PROPOSAL_NOT_BOOKED' ? 'Not booked' : esc(human(a.route_status))}</span></td>
  </tr>`).join('');
  const toggle = all.length > PROPOSAL_PREVIEW
    ? `<button type="button" class="ct-link" data-ct-toggle-proposals aria-expanded="${showAllProposals}">${showAllProposals ? 'Show fewer' : `Show all ${all.length}`}</button>` : '';
  return `<div class="ct-proposals-head"><b>Proposed route changes</b>${toggle}</div>
    <div class="ct-table-wrap"><table class="ct-table">
      <thead><tr><th scope="col">Shipment</th><th scope="col">Current flight</th><th aria-hidden="true"></th><th scope="col">Proposed route</th><th scope="col">Booking</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function events(s) {
  const rows = (s.unified_events || []).filter(e => !HIDDEN_EVENTS.includes(e.kind)).slice(-EVENT_ROWS).reverse();
  if (!rows.length) return '<li class="ct-empty">Nothing yet. Start the simulation or create an order.</li>';
  return rows.map(e => `<li class="ct-event" data-tone="${EVENT_TONE[e.kind] || ''}">
    <b>${esc(EVENT_LABEL[e.kind] || human(e.kind))}</b><time>Tick ${esc(e.tick)}</time>
    <p>${esc(String(e.message || '').replace(/^([a-z]+(?:_[a-z]+)+)/, m => human(m)).slice(0, 160))}</p>
  </li>`).join('');
}

function tasks(list) {
  if (!list.length) return '<p class="ct-empty">Work orders appear here once a proposal is approved.</p>';
  const groups = new Map();
  for (const t of list) {
    const key = t.shipment_id || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups].map(([shipment, items]) => {
    const done = items.filter(t => DONE_TASK.includes(t.status)).length;
    const route = (items[0].proposed_route || []).join(' → ');
    return `<section class="ct-task-group">
      <div class="ct-task-group-head"><b>${esc(shipment)}${route ? ' → ' + esc(route) : ''}</b><span>${done} of ${items.length} done</span></div>
      ${items.map(t => {
        const isDone = DONE_TASK.includes(t.status);
        return `<div class="ct-task"${isDone ? ' data-done' : ''}>
          <span class="ct-task-mark" aria-hidden="true">${isDone ? '✓' : ''}</span>
          <div class="ct-task-text"><span>${esc(human(t.task_type || t.type || 'Team handoff'))}</span><small>${esc(human(t.team || 'Team'))} · ${esc(isDone ? 'Done' : t.status === 'QUEUED_SIMULATED' ? 'Queued' : human(t.status || 'PENDING'))}</small></div>
          ${OPEN_TASK.includes(t.status) ? `<button type="button" data-task="${esc(t.id)}" aria-label="Mark ${esc(human(t.task_type))} for ${esc(shipment)} done">Mark done</button>` : ''}
        </div>`;
      }).join('')}
    </section>`;
  }).join('');
}

/* lowerIsBetter: penalty and missed targets; otherwise more is better. */
function difference(id, before, after, lowerIsBetter, digits = 0) {
  const delta = after - before;
  if (!delta) return text(id, 'No difference', 'flat');
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  text(id, `${delta > 0 ? '+' : '−'}${num(Math.abs(delta), digits)} ${better ? 'better' : 'worse'}`, better ? 'ok' : 'bad');
}

function render(s, baseline, relay, delta, statusLabel) {
  lastState = s;
  const d = s.decision || {}, v = s.v8 || {}, mode = v.mode || 'AUTO_SHADOW';
  const count = (d.proposed_actions || []).length;

  for (const b of document.querySelectorAll('#ctModeSeg [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));

  const [chip, tone] = decisionStatus(d);
  text('towerStatus', chip, tone);
  text('towerDecision', statusLabel ? statusLabel(d) : chip);
  text('towerRationale', d.stale ? 'Source data changed after this was calculated. Recalculate before approving.'
    : d.approval_blocked_external_evidence ? 'An external flight observation must be verified before this can be approved.'
    : !d.id ? 'The solver evaluates all three model layers on every operational change.'
    : `${count} tentative route change${count === 1 ? '' : 's'} from the latest solve. Internal review is not carrier confirmation.`);
  text('impactedCount', count);
  text('scopeCount', `${s.decision_scope?.evaluated ?? 0} / ${s.decision_scope?.eligible ?? 0}`);
  text('ctSolve', d.engine_runtime_ms != null ? `${num(d.engine_runtime_ms, 0)} ms` : '—');
  text('reviewState', chip);
  $('reviewState')?.classList.add('ct-text');
  html('ctProposals', proposals(d));
  text('actionText', d.stale ? 'This decision is out of date and cannot be approved.' : MODE_NOTE[mode] || MODE_NOTE.MANUAL_REVIEW);

  const reviewable = Boolean(d.id && d.status === 'PENDING_REVIEW' && !d.stale && !d.approval_blocked_external_evidence && count) && mode !== 'ADVISORY';
  for (const id of ['approveBtn', 'rejectBtn']) { const b = $(id); if (b) b.disabled = !reviewable; }

  const costA = baseline.cost_units || 0, costB = relay.cost_units || 0;
  text('towerBefore', num(costA, 1)); text('towerAfter', num(costB, 1));
  text('towerBeforeDone', baseline.completed || 0); text('towerAfterDone', relay.completed || 0);
  text('towerBeforeMiss', baseline.missed_work_order_targets || 0); text('towerAfterMiss', relay.missed_work_order_targets || 0);
  difference('ctDeltaCost', costA, costB, true, 1);
  difference('ctDeltaDone', baseline.completed || 0, relay.completed || 0, false);
  difference('ctDeltaMiss', baseline.missed_work_order_targets || 0, relay.missed_work_order_targets || 0, true);
  text('towerImpact', delta > 0 ? `RELAY has saved ${num(delta, 1)} staging-penalty units against FCFS in this run.`
    : delta < 0 ? `RELAY is costing ${num(-delta, 1)} more staging-penalty units than FCFS in this run.`
    : 'The two policies are tied so far.', delta > 0 ? 'ok' : delta < 0 ? 'bad' : '');

  text('iSummary', `2D load · ${human(d.model_i?.status || 'Not available')}`);
  text('iiSummary', `${d.model_ii?.cases?.length || 0} cases · one-step Bayes`);
  text('iiiSummary', `${d.model_iii?.candidate_columns || 0} route candidates · scoped MILP`);
  for (const id of ['iSummary', 'iiSummary', 'iiiSummary']) { const el = $(id); if (el) el.title = el.textContent; }

  text('eventCounter', (s.unified_events || []).filter(e => !HIDDEN_EVENTS.includes(e.kind)).length);
  html('eventsGrid', events(s));

  const list = s.tasks || [];
  const open = list.filter(t => OPEN_TASK.includes(t.status)).length;
  text('taskCounter', list.length ? `${open} open` : '0');
  html('taskCards', tasks(list));
}

/* The segmented control drives the hidden <select id="autonomy"> that v9.js listens to. */
$('ctModeSeg')?.addEventListener('click', e => {
  const b = e.target.closest('[data-mode]'), select = $('autonomy');
  if (!b || !select || select.value === b.dataset.mode) return;
  select.value = b.dataset.mode;
  select.dispatchEvent(new Event('change', {bubbles: true}));
});
$('ctProposals')?.addEventListener('click', e => {
  if (!e.target.closest('[data-ct-toggle-proposals]')) return;
  showAllProposals = !showAllProposals;
  if (lastState) html('ctProposals', proposals(lastState.decision || {}));
  $('ctProposals').querySelector('[data-ct-toggle-proposals]')?.focus();
});

window.RELAY_TOWER = {render};
})();
