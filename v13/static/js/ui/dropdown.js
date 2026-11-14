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
    this.open = open; this.root.classList.toggle('open', open); this.btn.setAttribute('aria-expanded', open);
    if (open) { this.focus(Math.max(0, this.options.indexOf(this.value))); this.menu.focus(); }
  }

  focus(i) {
    this.active = i;
    this.menu.querySelectorAll('li').forEach((li, k) => li.classList.toggle('active', k === i));
  }

  pick(i) { this.toggle(false); this.btn.focus(); if (this.options[i] !== this.value) { this.set(this.options[i]); this.onChange(this.options[i]); } }

  key(e) {
    if (!this.open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && e.target === this.btn) { e.preventDefault(); this.toggle(true); } return; }
    if (e.key === 'Escape') { e.preventDefault(); this.toggle(false); this.btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this.focus(Math.min(this.options.length - 1, this.active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.focus(Math.max(0, this.active - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(this.active); }
    else if (e.key === 'Tab') this.toggle(false);
  }
}
