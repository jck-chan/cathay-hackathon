// Styled (non-native) dropdown: a button plus an ARIA listbox with mouse and keyboard support.
import { ICON } from './icons.js';

export class Dropdown {
  constructor(root, { label, options, format = v => String(v), onChange }) {
    Object.assign(this, { root, options, format, onChange }); this.value = null; this.open = false;
    root.classList.add('dd');
    root.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">
        <span class="dd-label">${label}</span><b class="dd-value"></b>${ICON.down}</button>
      <ul class="dd-menu" role="listbox" tabindex="-1" aria-label="${label}"></ul>`;
    this.btn = root.querySelector('.dd-btn'); this.menu = root.querySelector('.dd-menu');
    this.menu.innerHTML = options.map((v, i) => `<li role="option" data-i="${i}">${format(v)}</li>`).join('');
    this.btn.addEventListener('click', () => this.toggle(!this.open));
    this.menu.addEventListener('click', e => { const li = e.target.closest('li'); if (li) this.pick(+li.dataset.i); });
    this.menu.addEventListener('mousemove', e => { const li = e.target.closest('li'); if (li) this.focus(+li.dataset.i); });
    root.addEventListener('keydown', e => this.key(e));
    document.addEventListener('pointerdown', e => { if (this.open && !root.contains(e.target)) this.toggle(false); });
  }

  set(v) {
    if (v === this.value) return; this.value = v;
    this.root.querySelector('.dd-value').textContent = this.format(v);
    this.menu.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', this.options[i] === v));
  }

  toggle(open) {
    if (open && this.btn.disabled) return;
    this.open = open; this.root.classList.toggle('open', open); this.btn.setAttribute('aria-expanded', open);
    if (open) { this.focus(Math.max(0, this.options.indexOf(this.value))); this.menu.focus(); }
  }

  focus(i) {
    this.active = i;
    this.menu.querySelectorAll('li').forEach((li, k) => li.classList.toggle('active', k === i));
  }

  pick(i) {
    if (this.btn.disabled) return;
    this.toggle(false);
    this.btn.focus();
    if (this.options[i] !== this.value) this.onChange(this.options[i], this.btn);
  }

  key(e) {
    if (!this.open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && e.target === this.btn) { e.preventDefault(); this.toggle(true); } return; }
    if (e.key === 'Escape') { e.preventDefault(); this.toggle(false); this.btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this.focus(Math.min(this.options.length - 1, this.active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.focus(Math.max(0, this.active - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(this.active); }
    else if (e.key === 'Tab') this.toggle(false);
  }
}

// Editable variant: the same styled preset list, plus a text field you can type any value into.
// Enter or leaving the field commits; the value is parsed, clamped to [min, max] and rounded.
export class ComboBox extends Dropdown {
  constructor(root, { label, options, min, max, step = 0.1, unit = '', onChange }) {
    super(root, { label, options, format: v => `${v}${unit}`, onChange });
    Object.assign(this, { min, max, step, unit });
    root.classList.add('dd-combo');
    const btn = this.btn;
    const field = document.createElement('div'); field.className = 'dd-btn dd-field';
    field.innerHTML = `<span class="dd-label">${label}</span><input class="dd-input" inputmode="decimal" autocomplete="off"
      spellcheck="false" aria-label="${label}" aria-autocomplete="list" role="combobox" aria-expanded="false">`;
    btn.replaceWith(field);
    btn.className = 'dd-toggle'; btn.setAttribute('aria-label', `${label} presets`); btn.innerHTML = btn.querySelector('svg')?.outerHTML || '';
    field.append(btn);
    this.input = field.querySelector('.dd-input'); this.field = field;
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !this.open) { e.preventDefault(); this.commit(); this.input.select(); }
      else if (e.key === 'Escape' && !this.open) { this.input.value = this.format(this.value); this.input.blur(); }
      else if (e.key === 'ArrowDown' && !this.open) { e.preventDefault(); this.toggle(true); }
    });
    this.input.addEventListener('focus', () => { this.input.value = String(this.value ?? ''); this.input.select(); });
    this.input.addEventListener('blur', () => { if (!this.open) this.commit(); });
    field.addEventListener('click', e => { if (e.target === field) this.input.focus(); });
  }

  commit() {
    const raw = parseFloat(String(this.input.value).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(raw)) { this.input.value = this.format(this.value); return; }
    const v = Math.round(Math.min(this.max, Math.max(this.min, raw)) / this.step) * this.step;
    const clean = +v.toFixed(3);
    if (document.activeElement !== this.input) this.input.value = this.format(clean);
    if (clean !== this.value && !this.btn.disabled) this.onChange(clean, this.btn);
  }

  set(v) {
    if (v === this.value) return; this.value = v;
    if (document.activeElement !== this.input) this.input.value = this.format(v);
    this.menu.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', this.options[i] === v));
  }

  toggle(open) {
    super.toggle(open); this.input?.setAttribute('aria-expanded', open);
  }
}
