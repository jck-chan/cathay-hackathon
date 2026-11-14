// Right-hand column: priority ranking (race-style reordering), event log, staging capacity.
import { ICON, CAT_ICON, EVENT_STYLE } from './icons.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtSlack = m => (m < 0 ? `${-m}m late` : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`);
const hhmm = t => { const m = ((Math.round(t) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ---- ranking -------------------------------------------------------------------------
export class RankingPanel {
  constructor(root, { onHover, onFocus }) {
    this.root = root; this.list = root.querySelector('.rank-list'); this.meta = root.querySelector('.rank-meta');
    this.rows = new Map(); this.rankT = null; this.onHover = onHover; this.onFocus = onFocus;
    this.ROW = 40;
  }

  render(state) {
    const t = state.t, next = state.rank_every - ((t - state.rank_t) % state.rank_every);
    this.meta.innerHTML = `Updated <b>${hhmm(state.rank_t)}</b> · next in ${next} min · ${state.ranked_total} actionable`;
    if (state.rank_t === this.rankT) return;
    this.rankT = state.rank_t;
    const seen = new Set();
    state.ranking.forEach((r, k) => {
      seen.add(r.cargo);
      let el = this.rows.get(r.cargo); const fresh = !el;
      if (fresh) {
        el = document.createElement('div'); el.className = 'rank-row entering';
        el.addEventListener('mouseenter', () => this.onHover(r.cargo));
        el.addEventListener('mouseleave', () => this.onHover(null));
        el.addEventListener('click', () => this.onFocus(el.dataset.cargo));
        el.style.transform = `translateY(${(state.ranking.length + 1) * this.ROW}px)`;
        this.list.appendChild(el); this.rows.set(r.cargo, el);
      }
      el.dataset.cargo = r.cargo;
      const moved = r.prev == null ? 'new' : r.prev - r.rank;
      const mv = moved === 'new' ? '<span class="mv mv-new">NEW</span>'
        : moved > 0 ? `<span class="mv mv-up">${ICON.up}${moved}</span>`
        : moved < 0 ? `<span class="mv mv-down">${ICON.down}${-moved}</span>` : '<span class="mv mv-same">–</span>';
      const flags = r.flags.filter(f => f !== 'late').map(f => `<i class="fl fl-${f}">${{ docs: 'DOCS', hold: 'HOLD', line: 'LINE' }[f]}</i>`).join('');
      el.className = `rank-row int-${r.intensity}${fresh ? ' entering' : ''}`;
      el.innerHTML = `<span class="rr-pos">${r.rank}</span>${mv}
        <span class="rr-main"><span class="rr-id">${CAT_ICON[r.category]}${esc(r.cargo)}</span>
        <span class="rr-sub"><b>${esc(r.flight_no)}</b> · Stand ${r.stand} · ${esc(r.tier)} · ${r.kg} kg ${flags}</span></span>
        <span class="rr-slack">${fmtSlack(r.slack)}</span>`;
      if (moved !== 'new' && moved !== 0 && !fresh) { el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(moved > 0 ? 'flash-up' : 'flash-down'); }
      requestAnimationFrame(() => { el.classList.remove('entering'); el.style.transform = `translateY(${k * this.ROW}px)`; });
    });
    for (const [id, el] of this.rows) {
      if (seen.has(id)) continue;
      el.classList.add('leaving'); this.rows.delete(id);
      setTimeout(() => el.remove(), 450);
    }
    this.list.style.height = `${state.ranking.length * this.ROW}px`;
  }
}

// ---- event log -----------------------------------------------------------------------
export class LogPanel {
  constructor(root) {
    this.list = root.querySelector('.log-list'); this.filters = root.querySelectorAll('[data-filter]');
    this.filter = 'all'; this.count = 0;
    this.filters.forEach(b => b.addEventListener('click', () => {
      this.filter = b.dataset.filter; this.filters.forEach(x => x.classList.toggle('on', x === b)); this.apply();
    }));
  }

  group(kind) {
    if (['rejected', 'assigned', 'offload'].includes(kind)) return 'decisions';
    if (['departure', 'landing'].includes(kind)) return 'flights';
    if (['delay', 'cancel', 'capacity', 'hold', 'clear', 'crew', 'outage', 'redzone', 'staging', 'missed', 'exception', 'unserved', 'error'].includes(kind)) return 'alerts';
    return 'cargo';
  }

  apply() { for (const el of this.list.children) el.hidden = this.filter !== 'all' && el.dataset.group !== this.filter; }

  add(events) {
    for (const e of events) {
      const [icon, tone] = EVENT_STYLE[e.kind] || [ICON.box, 'info'];
      const el = document.createElement('div'); el.className = `log-item tone-${tone} new`;
      el.dataset.group = this.group(e.kind);
      el.hidden = this.filter !== 'all' && el.dataset.group !== this.filter;
      el.innerHTML = `<span class="li-icon">${icon}</span><span class="li-body"><span class="li-title">${esc(e.title)}</span>
        <span class="li-detail">${esc(e.detail)}</span></span><span class="li-time">${e.clock}${e.actor === 'operator' ? '<em>you</em>' : e.actor === 'assist' ? '<em>auto</em>' : e.actor === 'agent' ? '<em class="ag">agent</em>' : ''}</span>`;
      this.list.prepend(el);
      setTimeout(() => el.classList.remove('new'), 900);
    }
    while (this.list.children.length > 160) this.list.lastChild.remove();
  }

  clear() { this.list.innerHTML = ''; }
}

// ---- staging capacity ----------------------------------------------------------------
export class StagingPanel {
  constructor(root) { this.root = root; }

  render(s) {
    const cap = s.capacity, pct = Math.round((100 * s.used) / cap);
    const seg = (n) => (100 * n) / cap;
    const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
    const outPct = Math.min(100, (100 * s.outside) / s.outside_limit);
    const hist = s.history || [];
    const W = 220, H = 34; const maxY = Math.max(cap, ...hist.map(h => h.staging + h.outside), 1);
    const pts = key => hist.map((h, i) => `${(i / Math.max(1, hist.length - 1)) * W},${H - (key(h) / maxY) * H}`).join(' ');
    this.root.querySelector('.stg-body').innerHTML = `
      <div class="stg-top">
        <div class="stg-pct tone-${tone}"><div class="stg-nums"><b>${pct}%</b><em class="stg-avg" title="Average staging use since the world opened">avg <strong>${s.avg_pct ?? '–'}%</strong></em></div><span>${s.used} / ${cap} positions now · ${s.avg_used ?? '–'} on average</span></div>
        <div class="stg-press ${s.pressure > 100 ? 'over' : ''}" title="Backlog (line + staging + exceptions) relative to staging capacity — can exceed 100%">
          <span>Demand pressure</span><b>${s.pressure}%</b></div>
      </div>
      <div class="stg-bar" role="img" aria-label="Staging ${pct}% full">
        <i class="sg-wait" style="width:${seg(s.waiting)}%"></i><i class="sg-handle" style="width:${seg(s.handling)}%"></i><i class="sg-ready" style="width:${seg(s.ready)}%"></i>
      </div>
      <div class="stg-legend"><span><i class="sg-wait"></i>Waiting ${s.waiting}</span><span><i class="sg-handle"></i>Loading ${s.handling}</span><span><i class="sg-ready"></i>Ready ${s.ready}</span></div>
      <div class="stg-rows">
        <div class="stg-row"><span>Inbound line</span><span class="mini-bar ${outPct >= 100 ? 'bad' : outPct > 70 ? 'warn' : ''}"><i style="width:${outPct}%"></i></span><b>${s.outside}/${s.outside_limit}</b></div>
        <div class="stg-row"><span>Exception desk</span><span class="mini-bar exc"><i style="width:${Math.min(100, s.exceptions * 4)}%"></i></span><b>${s.exceptions}</b></div>
        <div class="stg-row"><span>Handling teams free</span><span class="dots">${Array.from({ length: Math.max(s.workers, 1) }, (_, i) => `<i class="${i < s.workers_free ? 'on' : ''}"></i>`).join('')}</span><b>${s.workers_free}/${s.workers}</b></div>
      </div>
      ${s.holds.length ? `<div class="stg-holds">${ICON.lock} Hold: ${s.holds.join(', ')}</div>` : ''}
      ${s.red_zone ? `<div class="stg-red">${ICON.flame} Red zone — queues saturated</div>` : ''}
      <svg class="stg-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Last 4 hours">
        <line x1="0" x2="${W}" y1="${H - (cap / maxY) * H}" y2="${H - (cap / maxY) * H}" class="cap-line"/>
        <polyline points="${pts(h => h.staging + h.outside)}" class="sp-out"/><polyline points="${pts(h => h.staging)}" class="sp-stage"/>
      </svg>`;
  }
}
