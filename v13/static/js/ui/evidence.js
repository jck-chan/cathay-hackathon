// Evidence tab: the paired role study (same synthetic worlds, four operator roles).
// Charts are inline SVG: one small-multiple bar chart per metric (mean ± 95% CI, direct labels,
// hover tooltips) and a backlog-over-time line chart with a crosshair. A table view and CSV
// export carry the same numbers.
import { Dropdown } from './dropdown.js';

const ROLE_ORDER = ['novice_manual', 'novice_assisted', 'expert_manual', 'expert_assisted'];
const SERIES = { novice_manual: 'var(--series-1)', novice_assisted: 'var(--series-2)', expert_manual: 'var(--series-3)', expert_assisted: 'var(--series-4)' };
const CHART_METRICS = ['original_uplift_rate', 'pr1_misses', 'loss_units', 'peak_backlog', 'red_zone_minutes', 'avg_staging_pct'];
const SCENARIOS = ['mixed', 'normal', 'peak_burst', 'thunderstorm', 'flight_cancel', 'crew_shortage', 'equipment_breakdown',
  'documentation_hold', 'cold_chain_alarm', 'dangerous_goods_hold', 'animal_welfare_hold', 'system_outage', 'compound_cascade'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = s => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const hhmm = t => { const m = ((Math.round(t) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

function fmt(v, unit) {
  if (unit === '%') return `${v.toFixed(1)}%`;
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString();
  return v.toFixed(1);
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)); const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export class EvidencePanel {
  constructor(root) {
    this.root = root; this.params = { seeds: 6, days: 1, scenario: 'mixed', rate: 1 };
    this.tip = root.querySelector('.ev-tip'); this.loaded = false;
    const ctl = (id, label, options, key, format) => new Dropdown(root.querySelector(id), {
      label, options, format, onChange: v => { this.params[key] = v; this.dd[key].set(v); },
    });
    this.dd = {
      seeds: ctl('#evSeeds', 'Worlds', [4, 6, 8, 12, 16], 'seeds', v => String(v)),
      days: ctl('#evDays', 'Days', [1, 2], 'days', v => String(v)),
      scenario: ctl('#evScenario', 'Scenario', SCENARIOS, 'scenario', nice),
      rate: ctl('#evRate', 'Cargo rate', [0.5, 0.75, 1, 1.25, 1.5, 2], 'rate', v => `${v}×`),
    };
    for (const [k, d] of Object.entries(this.dd)) d.set(this.params[k]);
    root.querySelector('#evRun').addEventListener('click', () => this.load());
    root.querySelector('#evCsv').addEventListener('click', () => this.csv());
    root.addEventListener('pointermove', e => this.hover(e));
    root.addEventListener('pointerleave', () => { this.tip.hidden = true; });
  }

  show() { if (!this.loaded) this.load(); }

  async load() {
    const run = this.root.querySelector('#evRun'); run.disabled = true; run.textContent = 'Running…';
    this.root.classList.add('busy');
    const q = new URLSearchParams({ seeds: this.params.seeds, days: this.params.days, scenario: this.params.scenario, rate: this.params.rate });
    try {
      const r = await fetch(`/api/evidence?${q}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.data = await r.json(); this.loaded = true; this.render();
    } catch (e) {
      this.root.querySelector('.ev-status').textContent = `Study failed: ${e.message}`;
    } finally { run.disabled = false; run.textContent = 'Run study'; this.root.classList.remove('busy'); }
  }

  render() {
    const d = this.data, p = d.params;
    this.root.querySelector('.ev-status').textContent =
      `${p.seeds} worlds × 4 roles × ${p.days} day${p.days > 1 ? 's' : ''} · scenario ${nice(p.scenario)} · cargo rate ${p.cargo_rate}× · seeds ${p.seed_range[0]}–${p.seed_range[1]}`;
    this.root.querySelector('.ev-legend').innerHTML = ROLE_ORDER.map(r =>
      `<span><i style="background:${SERIES[r]}"></i>${esc(d.roles[r])}</span>`).join('');
    this.renderTiles(); this.renderBars(); this.renderLine(); this.renderTables();
  }

  pair(who, metric) { return this.data.paired.find(x => x.who === who && x.metric === metric); }

  renderTiles() {
    const d = this.data, M = d.metrics;
    const tile = (who, metric) => {
      const x = this.pair(who, metric), m = M[metric], unit = m.unit === '%' ? ' pp' : '';
      const good = m.better === 'higher' ? x.mean_diff > 0 : x.mean_diff < 0;
      const sign = x.mean_diff > 0 ? '+' : x.mean_diff < 0 ? '−' : '±';
      const v = Math.abs(x.mean_diff), val = (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1)) + unit;
      return `<div class="ev-tile"><span class="ev-tile-label">${esc(who)} + RELAY · ${esc(m.label)}</span>
        <b class="${good ? 'up' : 'down'}">${sign}${val}</b>
        <span class="ev-tile-sub">95% CI ±${x.ci95 >= 100 ? Math.round(x.ci95) : x.ci95.toFixed(1)}${unit} · better in ${x.better_in}/${x.n} worlds</span></div>`;
    };
    this.root.querySelector('.ev-tiles').innerHTML =
      tile('New operator', 'original_uplift_rate') + tile('New operator', 'loss_units') +
      tile('New operator', 'pr1_misses') + tile('Senior operator', 'loss_units');
  }

  renderBars() {
    const d = this.data;
    this.root.querySelector('.ev-bars').innerHTML = CHART_METRICS.map(metric => {
      const m = d.metrics[metric], agg = d.aggregate[metric];
      const W = 300, H = 170, L = 40, R = 6, T = 22, B = 22, ph = H - T - B;
      const max = niceMax(Math.max(...ROLE_ORDER.map(r => agg[r].mean + agg[r].ci95)) * 1.05);
      const slot = (W - L - R) / 4, bw = Math.min(42, slot * 0.6);
      const y = v => T + ph - (v / max) * ph;
      const bars = ROLE_ORDER.map((r, i) => {
        const a = agg[r], cx = L + slot * i + slot / 2, top = y(a.mean), hgt = Math.max(0, T + ph - top);
        const lo = y(Math.max(0, a.mean - a.ci95)), hi = y(a.mean + a.ci95);
        const path = hgt > 4
          ? `M${cx - bw / 2},${T + ph} V${top + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${T + ph} Z`
          : `M${cx - bw / 2},${T + ph} V${top} H${cx + bw / 2} V${T + ph} Z`;
        const tip = `${d.roles[r]}|${fmt(a.mean, m.unit)} ${m.unit !== '%' ? esc(m.unit) : ''}|95% CI ±${fmt(a.ci95, m.unit === '%' ? '' : m.unit)}`;
        return `<g class="ev-bar" data-tip="${esc(tip)}">
          <rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ph}" fill="transparent"/>
          <path d="${path}" fill="${SERIES[r]}"/>
          ${a.ci95 > 0 ? `<path class="ev-ci" d="M${cx},${hi} V${lo} M${cx - 5},${hi} H${cx + 5} M${cx - 5},${lo} H${cx + 5}"/>` : ''}
          <text class="ev-val" x="${cx}" y="${Math.min(hi, top) - 5}" text-anchor="middle">${fmt(a.mean, m.unit)}</text></g>`;
      }).join('');
      const better = m.better === 'higher' ? 'higher is better' : m.better === 'lower' ? 'lower is better' : 'context';
      return `<figure class="ev-card"><figcaption><b>${esc(m.label)}</b><span>${m.unit === '%' ? '' : esc(m.unit) + ' · '}${better}</span></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)} by operator role">
          <line class="ev-grid" x1="${L}" x2="${W - R}" y1="${y(max / 2)}" y2="${y(max / 2)}"/>
          <line class="ev-base" x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}"/>${bars}
          <text class="ev-axis" x="${L - 5}" y="${y(max / 2) + 3}" text-anchor="end">${fmt(max / 2, m.unit)}</text>
          <text class="ev-axis" x="${L - 5}" y="${T + ph + 3}" text-anchor="end">0</text>
          ${ROLE_ORDER.map((r, i) => `<text class="ev-axis" x="${L + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${['New', 'New+R', 'Senior', 'Senior+R'][i]}</text>`).join('')}
        </svg></figure>`;
    }).join('');
  }

  renderLine() {
    const tl = this.data.timeline, col = tl.columns.indexOf('backlog');
    const W = 900, H = 230, L = 40, R = 120, T = 14, B = 26;
    const all = ROLE_ORDER.flatMap(r => tl.roles[r]);
    if (!all.length) return;
    const t0 = Math.min(...all.map(x => x[0])), t1 = Math.max(...all.map(x => x[0]));
    const max = niceMax(Math.max(...all.map(x => x[col])) * 1.05);
    const x = t => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), y = v => T + (H - T - B) - (v / max) * (H - T - B);
    const ticks = []; for (let t = Math.ceil(t0 / 180) * 180; t <= t1; t += 180) ticks.push(t);
    const ends = ROLE_ORDER.map(r => { const last = tl.roles[r].at(-1); return { r, y: y(last[col]), v: last[col] }; }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].y, (ends[i - 1].ly ?? ends[i - 1].y) + 13);
    ends[0].ly = ends[0].y;
    this.line = { x, y, t0, t1, L, R, W, H, T, B, col, tl };
    this.root.querySelector('.ev-line').innerHTML = `
      <figcaption><b>Backlog over the day</b><span>shipments on the line + in staging + at the exception desk · world seed ${tl.seed}</span></figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Backlog over time by operator role">
        ${[0.5, 1].map(f => `<line class="ev-grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="ev-axis" x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join('')}
        <line class="ev-base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
        ${ticks.map(t => `<text class="ev-axis" x="${x(t)}" y="${H - 8}" text-anchor="middle">${hhmm(t)}</text>`).join('')}
        ${ROLE_ORDER.map(r => `<polyline fill="none" stroke="${SERIES[r]}" stroke-width="2" stroke-linejoin="round" points="${tl.roles[r].map(p => `${x(p[0]).toFixed(1)},${y(p[col]).toFixed(1)}`).join(' ')}"/>`).join('')}
        ${ends.map(e => `<text class="ev-end" x="${W - R + 8}" y="${e.ly + 4}"><tspan fill="${SERIES[e.r]}">●</tspan> ${esc(this.data.roles[e.r].replace(' operator', ''))}</text>`).join('')}
        <line class="ev-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
        <rect class="ev-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
      </svg>`;
  }

  renderTables() {
    const d = this.data, M = d.metrics;
    this.root.querySelector('.ev-paired tbody').innerHTML = d.paired.filter(x => M[x.metric].better !== 'context').map(x => {
      const m = M[x.metric]; const good = m.better === 'higher' ? x.mean_diff > 0 : x.mean_diff < 0;
      return `<tr><td>${esc(x.who)}</td><td>${esc(m.label)}</td><td class="num ${good ? 'up' : x.mean_diff ? 'down' : ''}">${x.mean_diff > 0 ? '+' : ''}${fmt(x.mean_diff, m.unit === '%' ? '' : m.unit)}${m.unit === '%' ? ' pp' : ''}</td>
        <td class="num">±${fmt(x.ci95, '')}</td><td class="num">${x.better_in}/${x.n}</td></tr>`;
    }).join('');
    const cols = Object.keys(M);
    this.root.querySelector('.ev-seeds thead').innerHTML = `<tr><th>World seed</th><th>Role</th>${cols.map(c => `<th class="num">${esc(M[c].label)}</th>`).join('')}</tr>`;
    this.root.querySelector('.ev-seeds tbody').innerHTML = d.per_seed.map(row =>
      `<tr><td class="num">${row.seed}</td><td>${esc(d.roles[row.role])}</td>${cols.map(c => `<td class="num">${fmt(row[c], M[c].unit)}</td>`).join('')}</tr>`).join('');
    this.root.querySelector('.ev-notes').innerHTML = d.notes.map(n => `<li>${esc(n)}</li>`).join('');
  }

  hover(e) {
    const bar = e.target.closest?.('.ev-bar');
    if (bar) { const [a, b, c] = bar.dataset.tip.split('|'); this.showTip(e, `<b>${esc(a)}</b><span>${esc(b)}</span><span>${esc(c)}</span>`); return; }
    const hit = e.target.closest?.('.ev-hit');
    const svg = hit?.ownerSVGElement, cross = this.root.querySelector('.ev-cross');
    if (!hit || !this.line) { if (cross) cross.setAttribute('visibility', 'hidden'); this.tip.hidden = true; return; }
    const { x, t0, t1, L, R, W, col, tl } = this.line;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const t = t0 + ((loc.x - L) / (W - L - R)) * (t1 - t0);
    const rows = ROLE_ORDER.map(r => { const pts = tl.roles[r]; let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; return [r, best]; });
    const tt = rows[0][1][0];
    cross.setAttribute('x1', x(tt)); cross.setAttribute('x2', x(tt)); cross.setAttribute('visibility', 'visible');
    this.showTip(e, `<b>${hhmm(tt)}</b>${rows.sort((a, b) => b[1][col] - a[1][col]).map(([r, p]) =>
      `<span><i style="background:${SERIES[r]}"></i>${esc(this.data.roles[r])}: <b>${p[col]}</b></span>`).join('')}`);
  }

  showTip(e, html) {
    const box = this.root.getBoundingClientRect();
    this.tip.innerHTML = html; this.tip.hidden = false;
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(e.clientX - box.left + 14, box.width - w - 8)}px`;
    this.tip.style.top = `${e.clientY - box.top + this.root.scrollTop + 14}px`;
  }

  csv() {
    if (!this.data) return;
    const M = this.data.metrics, cols = Object.keys(M);
    const lines = [['seed', 'role', ...cols].join(','), ...this.data.per_seed.map(r => [r.seed, r.role, ...cols.map(c => r[c])].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `relay-v13-evidence-${this.data.params.scenario}-${this.data.params.seeds}w.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
