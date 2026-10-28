// The Markups List: a sortable, filterable table of every markup in the
// active document, with measurement totals and CSV export.
import { measurement, MEASURE_TYPES } from './markups/measure.js';
import { TOOLS } from './markup-ui.js';
import { bounds } from './markups/geometry.js';
import { setToggle } from './ribbon.js';

const $ = (id) => document.getElementById(id);

const TYPE_NAMES = Object.fromEntries(TOOLS.filter((t) => t.id).map((t) => [t.id, t.label]));

const COLUMNS = [
  { key: 'page', label: 'Page', num: true, value: (r) => r.page },
  { key: 'type', label: 'Type', value: (r) => r.typeName },
  { key: 'text', label: 'Text', value: (r) => r.text },
  { key: 'measurement', label: 'Measurement', num: true, value: (r) => r.measureValue ?? -Infinity, display: (r) => r.measureText },
  { key: 'color', label: 'Color', value: (r) => r.color },
  { key: 'author', label: 'Author', value: (r) => r.author },
  { key: 'modified', label: 'Date', value: (r) => r.modified, display: (r) => formatDate(r.modified) },
];

export class MarkupsList {
  constructor({ activeTab }) {
    this.activeTab = activeTab;
    this.panel = $('markups-panel');
    this.sortKey = 'page';
    this.sortDesc = false;

    const head = this.panel.querySelector('thead tr');
    for (const col of COLUMNS) {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.key = col.key;
      if (col.num) th.style.textAlign = 'right';
      th.addEventListener('click', () => {
        this.sortDesc = this.sortKey === col.key ? !this.sortDesc : false;
        this.sortKey = col.key;
        this.render();
      });
      head.append(th);
    }

    $('ml-type').addEventListener('change', () => this.render());
    $('ml-page-only').addEventListener('change', () => this.render());
    $('ml-search').addEventListener('input', () => this.render());
    $('ml-search').addEventListener('keydown', (e) => e.stopPropagation());
    $('ml-close').addEventListener('click', () => this.toggle(false));
    $('ml-export').addEventListener('click', () => this.exportCsv());
  }

  get visible() {
    return !this.panel.hidden;
  }

  toggle(show = !this.visible) {
    this.panel.hidden = !show;
    $('btn-markups-list').classList.toggle('active', show);
    setToggle('toggle-markups-list', show);
    if (show) this.render();
  }

  /** Rows for every markup in the document, before filtering. */
  #rows() {
    const tab = this.activeTab();
    if (!tab?.store) return [];
    return tab.store.all.map((m) => {
      const value = measurement(m, tab.store.scaleFor(m.page));
      return {
        id: m.id,
        markup: m,
        page: m.page + 1,
        type: m.type,
        typeName: TYPE_NAMES[m.type] ?? m.type,
        text: (m.text || '').replace(/\s+/g, ' ').trim(),
        measureValue: value?.value,
        measureText: value?.text ?? '',
        unit: value?.unit ?? '',
        color: m.style.color,
        author: m.author || '',
        created: m.created || '',
        modified: m.modified || m.created || '',
      };
    });
  }

  #filtered() {
    const tab = this.activeTab();
    const type = $('ml-type').value;
    const pageOnly = $('ml-page-only').checked;
    const q = $('ml-search').value.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === this.sortKey);
    const rows = this.#rows().filter(
      (r) =>
        (!type || r.type === type) &&
        (!pageOnly || r.page === (tab?.currentPageIndex ?? 0) + 1) &&
        (!q || [r.typeName, r.text, r.measureText, r.author].some((v) => v.toLowerCase().includes(q))),
    );
    rows.sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return (this.sortDesc ? -c : c) || a.page - b.page;
    });
    return rows;
  }

  render() {
    if (!this.visible) return;
    const tab = this.activeTab();
    const all = this.#rows();

    // Type filter offers only the types present, keeping the current choice.
    const typeSelect = $('ml-type');
    const current = typeSelect.value;
    const types = [...new Set(all.map((r) => r.type))];
    typeSelect.replaceChildren(new Option('All types', ''), ...types.map((t) => new Option(TYPE_NAMES[t] ?? t, t)));
    typeSelect.value = types.includes(current) ? current : '';

    const rows = this.#filtered();
    $('ml-title').textContent = `Markups (${rows.length}${rows.length !== all.length ? ` of ${all.length}` : ''})`;
    for (const th of this.panel.querySelectorAll('th')) {
      th.classList.toggle('sorted', th.dataset.key === this.sortKey);
      th.classList.toggle('desc', th.dataset.key === this.sortKey && this.sortDesc);
    }

    const selectedId = tab?.markups?.selectedId;
    const body = this.panel.querySelector('tbody');
    body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement('tr');
        tr.dataset.id = r.id;
        tr.classList.toggle('selected', r.id === selectedId);
        for (const col of COLUMNS) {
          const td = document.createElement('td');
          if (col.num) td.className = 'num';
          if (col.key === 'color') {
            const sw = document.createElement('span');
            sw.className = 'swatch';
            sw.style.background = r.color;
            td.append(sw, r.color);
          } else {
            td.textContent = col.display ? col.display(r) : String(col.value(r));
          }
          if (col.key === 'text') td.title = r.text;
          tr.append(td);
        }
        tr.addEventListener('click', () => this.#reveal(r.markup));
        return tr;
      }),
    );
    $('ml-empty').hidden = rows.length > 0;
    $('ml-empty').textContent = all.length ? 'No markups match.' : 'No markups yet.';
    this.#renderTotals(rows);
  }

  /** Sums measurements by type and unit, for takeoffs. */
  #renderTotals(rows) {
    const totals = new Map();
    for (const r of rows) {
      if (!MEASURE_TYPES.has(r.type) || r.measureValue == null) continue;
      const key = `${r.typeName}|${r.unit}`;
      const t = totals.get(key) ?? { name: r.typeName, unit: r.unit, sum: 0, n: 0, type: r.type };
      t.sum += r.measureValue;
      t.n += 1;
      totals.set(key, t);
    }
    const el = $('ml-totals');
    el.replaceChildren();
    if (!totals.size) return;
    el.append('Totals: ');
    [...totals.values()].forEach((t, i) => {
      if (i) el.append(' · ');
      const b = document.createElement('b');
      b.textContent = `${t.name} ${formatTotal(t)}`;
      el.append(b);
    });
  }

  #reveal(m) {
    const tab = this.activeTab();
    if (!tab?.pdf) return;
    const [x1, , , y2] = bounds(m, tab.store.scaleFor(m.page));
    tab.viewer.scrollPageIntoView({ pageNumber: m.page + 1, destArray: [null, { name: 'XYZ' }, x1 - 40, y2 + 40, null] });
    tab.markups.select(m.id);
  }

  async exportCsv() {
    const tab = this.activeTab();
    if (!tab?.store) return;
    const rows = this.#filtered();
    const header = ['Page', 'Type', 'Text', 'Measurement', 'Value', 'Unit', 'Color', 'Author', 'Created', 'Modified'];
    const lines = [header, ...rows.map((r) => [r.page, r.typeName, r.text, r.measureText, r.measureValue ?? '', r.unit, r.color, r.author, r.created, r.modified])];
    const csv = lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n');
    const base = (tab.name || 'markups').replace(/\.pdf$/i, '');
    const target = await window.desktop.saveAsDialog(`${base} markups.csv`, 'csv');
    if (!target) return;
    // A byte-order mark makes Excel read the file as UTF-8 (for ², °, accents).
    await window.desktop.saveFile(target, new TextEncoder().encode('﻿' + csv + '\r\n'));
  }
}

function csvCell(v) {
  const s = typeof v === 'number' ? String(+v.toFixed(4)) : String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatTotal(t) {
  if (t.type === 'count') return `${t.sum} ea`;
  return `${t.sum.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t.unit}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
