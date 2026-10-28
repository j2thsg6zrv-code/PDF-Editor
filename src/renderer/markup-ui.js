// Tool buttons and the properties bar for markups.
import { FILLABLE_TYPES, TEXT_TYPES } from './markups/geometry.js';
import { MEASURE_TYPES, PRESET_SCALES, PAPER_SCALE, UNITS, calibratedScale, formatLength } from './markups/measure.js';

const $ = (id) => document.getElementById(id);

const ICON = (body) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const TOOLS = [
  { id: 'select', key: 'v', label: 'Select', icon: ICON('<path d="M3 2l9 6-4 1 2.5 4.5-1.6.9L6.4 9.9 3.5 12.5z"/>') },
  { id: 'hand', key: 'h', label: 'Pan', hint: 'or hold Space', icon: ICON('<path d="M5 8V3.5a1 1 0 012 0V7m0-4.5a1 1 0 012 0V7m0-3.5a1 1 0 012 0V8m0-2a1 1 0 012 0v4a5 5 0 01-5 5H8a4 4 0 01-3.2-1.6L2.5 10.4a1 1 0 011.6-1.2L5 10.3"/>') },
  { separator: true },
  { id: 'pen', key: 'p', label: 'Pen', icon: ICON('<path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z"/>') },
  { id: 'highlight', key: 'g', label: 'Highlighter', icon: ICON('<path d="M10 2.5l3.5 3.5-6 6H4v-3.5z"/><path d="M2 14.5h12" stroke-width="2.4" stroke="#facc15"/>') },
  { id: 'line', key: 'l', label: 'Line', hint: 'Shift snaps to 45°', icon: ICON('<path d="M3 13L13 3"/>') },
  { id: 'arrow', key: 'a', label: 'Arrow', hint: 'Shift snaps to 45°', icon: ICON('<path d="M3 13L13 3M7.5 3H13v5.5"/>') },
  { id: 'rect', key: 'r', label: 'Rectangle', hint: 'Shift for a square', icon: ICON('<rect x="2.5" y="3.5" width="11" height="9"/>') },
  { id: 'ellipse', key: 'e', label: 'Ellipse', hint: 'Shift for a circle', icon: ICON('<ellipse cx="8" cy="8" rx="5.8" ry="4.6"/>') },
  { id: 'cloud', key: 'c', label: 'Cloud', icon: ICON('<path d="M4 12.5a2 2 0 01-1-3.7 2.2 2.2 0 012.6-3.3 3 3 0 015.6.2 2.2 2.2 0 012.3 3.2A2 2 0 0112.5 12.5z"/>') },
  { id: 'text', key: 't', label: 'Text box', ribbonLabel: 'Text Box', icon: ICON('<path d="M3.5 4V3h9v1M8 3v10M6 13h4"/>') },
  { id: 'callout', key: 'q', label: 'Callout', hint: 'drag from the point to the text', icon: ICON('<rect x="6.5" y="2.5" width="7.5" height="5"/><path d="M6.5 6.5L2 13.5"/>') },
  { id: 'stamp', key: 's', label: 'Stamp', icon: ICON('<path d="M6 2.5h4l-.8 5h-2.4zM3 9.5h10v2.5H3zM4 14h8"/>') },
  { separator: true },
  { id: 'length', key: 'm', label: 'Length', hint: 'Shift snaps to 45°', icon: ICON('<path d="M2.5 10.5l11-5M2 8.5l1 4M13 3.5l1 4"/>') },
  { id: 'polylength', key: 'j', label: 'Polylength', hint: 'click each point, double-click to finish', icon: ICON('<path d="M2 12l4-6 4 4 4-7"/><circle cx="2" cy="12" r=".6"/><circle cx="14" cy="3" r=".6"/>') },
  { id: 'area', key: 'b', label: 'Area', hint: 'click each corner, double-click to finish', icon: ICON('<path d="M2.5 12.5l2-9 9 2-2 7z" fill="currentColor" fill-opacity=".25"/>') },
  { id: 'perimeter', key: 'o', label: 'Perimeter', hint: 'click each corner, double-click to finish', icon: ICON('<path d="M2.5 12.5l2-9 9 2-2 7z" stroke-dasharray="2 1.5"/>') },
  { id: 'count', key: 'k', label: 'Count', hint: 'click each item; switch tools to start a new count', icon: ICON('<circle cx="4.5" cy="5" r="1.6" fill="currentColor"/><circle cx="11" cy="5" r="1.6" fill="currentColor"/><circle cx="7.8" cy="11" r="1.6" fill="currentColor"/>') },
  { id: 'calibrate', key: 'x', label: 'Calibrate scale', ribbonLabel: 'Calibrate', hint: 'drag along a known dimension', icon: ICON('<path d="M2 11.5L11.5 2l2.5 2.5L4.5 14z"/><path d="M5 9.5l1 1M7 7.5l1.5 1.5M9 5.5l1 1"/>') },
];

export const STAMPS = [
  { label: 'APPROVED', color: '#16a34a' },
  { label: 'APPROVED AS NOTED', color: '#16a34a' },
  { label: 'REVISE AND RESUBMIT', color: '#ea580c' },
  { label: 'REJECTED', color: '#dc2626' },
  { label: 'REVIEWED', color: '#2563eb' },
  { label: 'FOR CONSTRUCTION', color: '#2563eb' },
  { label: 'NOT FOR CONSTRUCTION', color: '#dc2626' },
  { label: 'DRAFT', color: '#6b7280' },
  { label: 'VOID', color: '#dc2626' },
];

const RED = '#e5322d';
const BLUE = '#1d4ed8';

// Starting style for each tool; changes made in the properties bar are remembered per tool.
const DEFAULT_STYLES = {
  pen: { color: RED, width: 2, opacity: 1 },
  highlight: { color: '#ffd400', width: 14, opacity: 0.4 },
  line: { color: RED, width: 2, opacity: 1 },
  arrow: { color: RED, width: 2, opacity: 1 },
  rect: { color: RED, width: 2, opacity: 1, fill: null },
  ellipse: { color: RED, width: 2, opacity: 1, fill: null },
  cloud: { color: RED, width: 1.5, opacity: 1, fill: null },
  text: { color: RED, width: 0, opacity: 1, fill: null, fontSize: 12 },
  callout: { color: RED, width: 1, opacity: 1, fill: '#ffffff', fontSize: 12 },
  stamp: { color: STAMPS[0].color, width: 2.5, opacity: 0.85 },
  length: { color: BLUE, width: 1.5, opacity: 1, fontSize: 10 },
  polylength: { color: BLUE, width: 1.5, opacity: 1, fontSize: 10 },
  area: { color: BLUE, width: 1.5, opacity: 1, fill: '#60a5fa', fillOpacity: 0.3, fontSize: 10 },
  perimeter: { color: BLUE, width: 1.5, opacity: 1, fill: null, fontSize: 10 },
  count: { color: RED, width: 0, opacity: 1, fontSize: 10 },
  calibrate: { color: '#16a34a', width: 1.5, opacity: 1 },
};

const TYPE_NAMES = Object.fromEntries(TOOLS.filter((t) => t.id).map((t) => [t.id, t.label]));

// Tools that drop back to Select after one use, like most markup apps.
const ONE_SHOT = new Set(['text', 'callout', 'stamp', 'calibrate']);

export class MarkupUi {
  constructor({ activeTab, onToolChange, onSelectionChange }) {
    this.activeTab = activeTab;
    this.onToolChange = onToolChange;
    this.onSelectionChange = onSelectionChange;
    this.current = 'select';
    this.styles = loadStyles();
    this.stampIndex = 0;
    this.user = '';
    window.desktop.userName().then((name) => (this.user = name || ''));

    this.#buildToolButtons();
    this.#buildPropbar();
  }

  // ----- Callbacks used by MarkupLayer -----

  tool() {
    return this.current;
  }

  styleFor(type) {
    return { ...this.styles[type] };
  }

  stamp() {
    return STAMPS[this.stampIndex];
  }

  author() {
    return this.user;
  }

  onSelect() {
    this.refresh();
    this.onSelectionChange?.();
  }

  onToolDone(type) {
    if (ONE_SHOT.has(type) && this.current === type) this.setTool('select');
  }

  /** A calibration line was drawn: ask how long it really is, then set the scale. */
  async onCalibrate(pageIndex, points) {
    const tab = this.activeTab();
    this.setTool('select');
    const answer = await askCalibration(points, tab?.pageCount ?? 1);
    if (!answer || !tab?.store) return;
    const pages = answer.allPages ? [...Array(tab.pageCount).keys()] : [pageIndex];
    tab.store.setScale(pages, calibratedScale(points, answer.length, answer.unit));
  }

  // ----- Tools -----

  setTool(id) {
    if (this.current === id) return;
    this.activeTab()?.markups?.commitEditing();
    this.activeTab()?.markups?.endTool();
    this.current = id;
    if (id !== 'select') this.activeTab()?.markups?.select(null);
    for (const btn of this.toolButtons) btn.classList.toggle('active', btn.dataset.tool === id);
    this.onToolChange(id);
    this.refresh();
  }

  toolForKey(key) {
    return TOOLS.find((t) => t.key === key.toLowerCase())?.id;
  }

  /** Wires the tool buttons the ribbon placed (a tool can appear on several ribbon tabs). */
  #buildToolButtons() {
    this.toolButtons = [...document.querySelectorAll('button[data-tool]')];
    for (const btn of this.toolButtons) {
      const t = TOOLS.find((x) => x.id === btn.dataset.tool);
      btn.classList.add('tool');
      btn.classList.toggle('active', t.id === this.current);
      btn.title = `${t.label} (${t.key.toUpperCase()})${t.hint ? ` — ${t.hint}` : ''}`;
      btn.addEventListener('click', () => this.setTool(t.id));
    }
  }

  // ----- Properties bar -----

  #buildPropbar() {
    const stampSelect = $('prop-stamp');
    STAMPS.forEach((s, i) => stampSelect.append(new Option(s.label, String(i))));
    stampSelect.addEventListener('change', () => {
      this.stampIndex = Number(stampSelect.value);
    });

    $('prop-color').addEventListener('change', (e) => this.#apply({ color: e.target.value }));
    $('prop-fill-on').addEventListener('change', (e) => this.#apply({ fill: e.target.checked ? $('prop-fill').value : null }));
    $('prop-fill').addEventListener('change', (e) => this.#apply({ fill: e.target.value }));
    $('prop-width').addEventListener('change', (e) => this.#apply({ width: Number(e.target.value) }));
    $('prop-font-size').addEventListener('change', (e) => this.#apply({ fontSize: Number(e.target.value) }));
    const opacity = $('prop-opacity');
    opacity.addEventListener('input', () => ($('prop-opacity-value').textContent = `${opacity.value}%`));
    opacity.addEventListener('change', () => this.#apply({ opacity: Number(opacity.value) / 100 }));
    $('prop-delete').addEventListener('click', () => this.activeTab()?.markups?.deleteSelected());

    const scaleSelect = $('prop-scale');
    scaleSelect.addEventListener('change', () => {
      const tab = this.activeTab();
      const value = scaleSelect.value;
      if (!tab?.store) return;
      if (value === 'calibrate') {
        this.setTool('calibrate');
      } else if (value !== 'current') {
        const pages = $('prop-scale-all').checked ? [...Array(tab.pageCount).keys()] : [this.#scalePage()];
        tab.store.setScale(pages, value === '' ? null : PRESET_SCALES[Number(value)]);
      }
      this.refresh();
    });
  }

  /** The page whose scale the bar shows: the selected markup's, else the one in view. */
  #scalePage() {
    const tab = this.activeTab();
    return tab?.markups?.selected?.page ?? tab?.currentPageIndex ?? 0;
  }

  #refreshScale() {
    const select = $('prop-scale');
    const tab = this.activeTab();
    const scale = tab?.store?.scaleFor(this.#scalePage()) ?? null;
    const options = [new Option(PAPER_SCALE.label, '')];
    const presetIndex = scale ? PRESET_SCALES.findIndex((p) => p.label === scale.label) : -1;
    if (scale && presetIndex === -1) options.push(new Option(scale.label, 'current'));
    PRESET_SCALES.forEach((p, i) => options.push(new Option(p.label, String(i))));
    options.push(new Option('Calibrate from a known dimension…', 'calibrate'));
    select.replaceChildren(...options);
    select.value = !scale ? '' : presetIndex === -1 ? 'current' : String(presetIndex);
  }

  /** What the properties bar is editing: the selected markup, or the current drawing tool's defaults. */
  #target() {
    const selected = this.activeTab()?.markups?.selected;
    if (selected) return { type: selected.type, style: selected.style, selected };
    if (this.styles[this.current]) return { type: this.current, style: this.styles[this.current] };
    return null;
  }

  #apply(patch) {
    const target = this.#target();
    if (!target) return;
    if (target.selected) {
      this.activeTab().markups.restyleSelected(patch);
    } else {
      Object.assign(this.styles[target.type], patch);
      saveStyles(this.styles);
    }
    this.refresh();
  }

  refresh() {
    // The bar stays put whenever a document is open, so selecting things never shifts the page.
    const bar = $('propbar');
    bar.hidden = !this.activeTab()?.pdf;
    const target = this.#target();
    const controls = bar.querySelectorAll('[data-prop], #prop-delete');
    if (!target) {
      $('prop-title').textContent = 'Choose a markup tool, or click a markup to edit it';
      for (const el of controls) el.hidden = true;
      return;
    }
    const { type, style, selected } = target;
    $('prop-title').textContent = selected ? `${TYPE_NAMES[type]} (selected)` : TYPE_NAMES[type];

    const isMeasure = MEASURE_TYPES.has(type) || type === 'calibrate';
    const show = {
      stamp: type === 'stamp' && !selected,
      scale: isMeasure,
      color: true,
      fill: FILLABLE_TYPES.has(type),
      width: type !== 'stamp' && type !== 'count',
      fontSize: TEXT_TYPES.has(type) || (isMeasure && type !== 'calibrate'),
      opacity: true,
    };
    if (isMeasure) this.#refreshScale();
    for (const label of bar.querySelectorAll('[data-prop]')) label.hidden = !show[label.dataset.prop];
    $('prop-delete').hidden = !selected;

    $('prop-stamp').value = String(this.stampIndex);
    $('prop-color').value = style.color;
    $('prop-fill-on').checked = !!style.fill;
    $('prop-fill').value = style.fill || '#ffffff';
    $('prop-fill').disabled = !style.fill;
    setSelectValue($('prop-width'), style.width);
    if (style.fontSize) setSelectValue($('prop-font-size'), style.fontSize);
    const pct = Math.round((style.opacity ?? 1) * 100);
    $('prop-opacity').value = String(pct);
    $('prop-opacity-value').textContent = `${pct}%`;
  }
}

/** Selects a value in a <select>, adding it as an option if it isn't one. */
function setSelectValue(select, value) {
  const v = String(value);
  if (![...select.options].some((o) => o.value === v)) {
    select.append(new Option(select.id === 'prop-width' ? `${v} pt` : v, v));
  }
  select.value = v;
}

const STYLE_KEY = 'markup-styles-v1';

function loadStyles() {
  const styles = structuredClone(DEFAULT_STYLES);
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_KEY) || '{}');
    for (const [type, style] of Object.entries(saved)) if (styles[type]) Object.assign(styles[type], style);
  } catch {
    // Ignore unreadable saved preferences.
  }
  return styles;
}

function saveStyles(styles) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(styles));
  } catch {
    // Preferences are a convenience; failing to save them is fine.
  }
}

/**
 * Shows the calibration dialog for a line 'points' long on the sheet.
 * Resolves to { length, unit, allPages } or null if cancelled.
 */
function askCalibration(points, pageCount) {
  const dialog = $('calibrate-dialog');
  const input = $('cal-length');
  const unit = $('cal-unit');
  const error = $('cal-error');
  $('cal-sheet').textContent = formatLength((points / 72) * 0.0254, 'imperial');
  $('cal-all').closest('label').hidden = pageCount < 2;
  input.value = '';
  error.textContent = '';
  dialog.showModal();
  input.focus();
  return new Promise((resolve) => {
    const onSubmit = (e) => {
      if (e.submitter?.value !== 'ok') return;
      const length = parseLength(input.value, unit.value);
      if (!(length > 0)) {
        e.preventDefault();
        error.textContent = 'Enter a length, like 10, 12.5 or 12\'6"';
        input.focus();
      }
    };
    dialog.querySelector('form').addEventListener('submit', onSubmit);
    dialog.addEventListener(
      'close',
      () => {
        dialog.querySelector('form').removeEventListener('submit', onSubmit);
        if (dialog.returnValue !== 'ok') return resolve(null);
        resolve({ length: parseLength(input.value, unit.value), unit: unit.value, allPages: $('cal-all').checked });
      },
      { once: true },
    );
  });
}

/** Parses "12.5", or feet-and-inches like 12'6", 12' 6 1/2", 6" (returned in the chosen unit). */
export function parseLength(text, unit) {
  const t = text.trim();
  if (!/['"]/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)?(?:\s+(\d+)\/(\d+))?\s*")?$/);
  if (!m) return NaN;
  const feet = Number(m[1] || 0);
  const inches = Number(m[2] || 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
  const meters = feet * 0.3048 + inches * 0.0254;
  return meters / UNITS[unit].meters;
}
