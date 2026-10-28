// Draws one document's markups as SVG over each rendered page, and handles
// drawing, selecting, moving and resizing them with the pointer.
import {
  outline,
  segsToSvg,
  textLines,
  bounds,
  boxOf,
  normRect,
  translate,
  stampBox,
  fittedTextHeight,
  TEXT_TYPES,
  TEXT_PADDING,
  LINE_HEIGHT,
} from './geometry.js';
import { SCREEN_FONT, sanitize } from './fonts.js';
import { newId } from './store.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Tools drawn with one press-drag-release.
const DRAG_TOOLS = new Set(['pen', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'cloud', 'text', 'callout', 'stamp', 'length', 'calibrate']);
// Tools drawn by clicking each vertex; double-click or Enter finishes.
const POLY_TOOLS = new Set(['polylength', 'area', 'perimeter']);
const MIN_VERTICES = { polylength: 2, area: 3, perimeter: 3 };
const HIT_PX = 10; // how close (in screen pixels) a click must be to a thin line
const HANDLE_PX = 8;
const MIN_DRAG_PX = 3;
const DEFAULT_TEXT_WIDTH = 180;

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  return el;
}

export class MarkupLayer {
  /**
   * @param {object} opts
   * @param {import('../document-tab.js').DocumentTab} opts.tab
   * @param {import('./store.js').MarkupStore} opts.store
   * @param {object} opts.ui  callbacks into the app: tool(), styleFor(type), stamp(), author(),
   *                          onSelect(markup|null), onToolDone(), onCalibrate(pageIndex, points)
   */
  constructor({ tab, store, ui }) {
    this.tab = tab;
    this.store = store;
    this.ui = ui;
    this.pages = new Map(); // page index -> { svg, root, content, overlay, pageView }
    this.selectedId = null;
    this.editingId = null;
    this.preview = null; // markup being moved/resized, drawn in place of the stored one
    this.draft = null; // markup being drawn
    this.gesture = null;
    this.poly = null; // { index } while a click-by-click shape is being drawn
    this.countId = null; // the count markup that further count clicks add to

    store.onChange((pages) => {
      if (this.selectedId && !store.get(this.selectedId)) this.select(null);
      if (this.countId && !store.get(this.countId)) this.countId = null;
      for (const p of pages ?? this.pages.keys()) this.renderPage(p);
      if (this.selectedId) this.ui.onSelect(store.get(this.selectedId));
    });

    const { eventBus } = tab;
    eventBus.on('pagerender', ({ source }) => this.attach(source));
    eventBus.on('pagerendered', ({ source }) => this.attach(source));
    eventBus.on('scalechanging', () => {
      for (const i of this.pages.keys()) this.renderOverlay(i);
      this.#positionEditor();
    });
  }

  get selected() {
    return this.selectedId ? this.store.get(this.selectedId) : null;
  }

  // ---------- Page layers ----------

  /** pdf.js clears page contents on zoom and scroll-out; put our layer back each render. */
  attach(pageView) {
    const index = pageView.id - 1;
    let entry = this.pages.get(index);
    if (!entry) {
      const el = svg('svg', { class: 'markup-layer' });
      const root = svg('g');
      const content = svg('g');
      const draft = svg('g', { class: 'markup-draft' });
      const overlay = svg('g', { class: 'markup-selection' });
      root.append(content, draft, overlay);
      el.append(root);
      entry = { svg: el, root, content, draft, overlay, pageView };
      this.pages.set(index, entry);
      this.#wirePointer(index, entry);
    }
    entry.pageView = pageView;
    const base = pageView.viewport.clone({ scale: 1 });
    entry.svg.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
    entry.root.setAttribute('transform', `matrix(${base.transform.join(' ')})`);
    if (entry.svg.parentNode !== pageView.div) {
      pageView.div.append(entry.svg);
      this.renderPage(index);
    }
    if (this.editing?.markup.page === index) this.#positionEditor();
  }

  renderAll() {
    for (const i of this.pages.keys()) this.renderPage(i);
  }

  renderPage(index) {
    const entry = this.pages.get(index);
    if (!entry) return;
    const scale = this.#scale(entry);
    const items = this.store.onPage(index).map((m) => (this.preview?.id === m.id ? this.preview : m));
    entry.content.replaceChildren(...items.map((m) => this.#markupEl(m, scale)));
    this.renderOverlay(index);
  }

  renderOverlay(index) {
    const entry = this.pages.get(index);
    if (!entry) return;
    const scale = this.#scale(entry);
    const els = [];
    const sel = this.preview?.id === this.selectedId ? this.preview : this.selected;
    if (sel && sel.page === index && this.editingId !== sel.id) {
      const [x1, y1, x2, y2] = bounds(sel, this.store.scaleFor(sel.page));
      els.push(
        svg('rect', {
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
          class: 'selection-box',
          'stroke-width': 1 / scale,
          'stroke-dasharray': `${4 / scale} ${3 / scale}`,
        }),
      );
      const size = HANDLE_PX / scale;
      for (const h of handlesFor(sel)) {
        els.push(
          svg('rect', {
            x: h.point[0] - size / 2,
            y: h.point[1] - size / 2,
            width: size,
            height: size,
            class: 'selection-handle',
            'stroke-width': 1 / scale,
            'data-handle': h.key,
          }),
        );
      }
    }
    entry.overlay.replaceChildren(...els);
  }

  #renderDraft(index) {
    for (const [i, entry] of this.pages) {
      entry.draft.replaceChildren(...(this.draft && i === index ? [this.#markupEl(this.draft, this.#scale(entry), true)] : []));
    }
  }

  #scale(entry) {
    return entry.pageView.viewport.scale;
  }

  #markupEl(m, scale, isDraft = false) {
    const { style } = m;
    const g = svg('g', { 'data-id': m.id, opacity: style.opacity ?? 1, class: 'markup' });
    const cap = m.type === 'highlight' ? 'butt' : 'round';
    const hitWidth = Math.max(style.width || 0, HIT_PX / scale);
    const parts = outline(m);
    const hitD = [];
    const hitAreas = [];
    for (const sub of parts) {
      const d = segsToSvg(sub.segs);
      hitD.push(d);
      const fill = sub.fillColor ?? (sub.fill && style.fill ? style.fill : null);
      if (fill) hitAreas.push(d);
      g.append(
        svg('path', {
          d,
          fill: fill ?? 'none',
          'fill-opacity': fill && !sub.fillColor ? style.fillOpacity : null,
          stroke: sub.stroke && style.width > 0 ? style.color : 'none',
          'stroke-width': style.width,
          'stroke-linecap': cap,
          'stroke-linejoin': 'round',
        }),
      );
    }
    if (this.editingId !== m.id) {
      const lines = textLines(m, this.store.scaleFor(m.page));
      if (lines.length) {
        // Text is drawn in a y-down group so glyphs aren't mirrored.
        const tg = svg('g', { transform: 'scale(1 -1)', fill: style.color, 'font-family': SCREEN_FONT });
        for (const l of lines) {
          const t = svg('text', { x: l.x, y: -l.y, 'font-size': l.size, 'font-weight': l.bold ? 'bold' : null });
          t.textContent = l.text;
          tg.append(t);
        }
        g.append(tg);
      }
    }
    if (!isDraft) {
      // Invisible, wider copies of the shape make thin lines easy to click.
      g.append(svg('path', { d: hitD.join(' '), class: 'markup-hit', 'stroke-width': hitWidth }));
      for (const d of hitAreas) g.append(svg('path', { d, class: 'markup-hit-area' }));
      if (TEXT_TYPES.has(m.type) || m.type === 'stamp') {
        const [x1, y1, x2, y2] = boxOf(m);
        g.append(svg('rect', { x: x1, y: y1, width: x2 - x1, height: y2 - y1, class: 'markup-hit-area' }));
      }
    }
    return g;
  }

  // ---------- Selection ----------

  select(id) {
    if (this.selectedId === id) return;
    const prev = this.selected;
    this.selectedId = id;
    if (prev) this.renderOverlay(prev.page);
    const now = this.selected;
    if (now) this.renderOverlay(now.page);
    this.ui.onSelect(now);
  }

  deleteSelected() {
    if (this.selectedId) this.store.remove([this.selectedId]);
  }

  /** Applies a style change to the selected markup (one undo step). */
  restyleSelected(patch) {
    const m = this.selected;
    if (!m) return;
    let next = { ...m, style: { ...m.style, ...patch }, modified: new Date().toISOString() };
    if (TEXT_TYPES.has(m.type) && 'fontSize' in patch) next = fitTextBox(next);
    this.store.replace([next]);
  }

  // ---------- Pointer input ----------

  #toPdf(entry, e) {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(entry.root.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  #wirePointer(index, entry) {
    const el = entry.svg;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const tool = this.ui.tool();
      const pt = this.#toPdf(entry, e);
      if (this.editingId) this.#commitEditor();
      // preventDefault below stops the click from taking focus; take it from the
      // properties bar ourselves so single-key tool shortcuts keep working.
      if (document.activeElement?.closest?.('#propbar, #markups-panel')) this.tab.container.focus({ preventScroll: true });

      if (POLY_TOOLS.has(tool)) {
        e.preventDefault();
        e.stopPropagation();
        this.select(null);
        this.#polyClick(index, tool, pt, e);
        return;
      }
      if (tool === 'count') {
        e.preventDefault();
        e.stopPropagation();
        this.#countClick(index, pt);
        return;
      }
      if (DRAG_TOOLS.has(tool)) {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        this.select(null);
        this.#startDraw(index, tool, pt, e);
        return;
      }
      if (tool !== 'select') return;

      const handle = e.target.closest('[data-handle]');
      const hit = e.target.closest('.markup');
      if (!handle && !hit) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      if (handle && this.selected) {
        this.gesture = { kind: 'resize', index, key: handle.dataset.handle, start: pt, original: this.selected, client: [e.clientX, e.clientY] };
      } else {
        this.select(hit.dataset.id);
        this.gesture = { kind: 'move', index, start: pt, original: this.selected, client: [e.clientX, e.clientY] };
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (this.poly?.index === index && this.draft) {
        // Rubber-band the next segment to the pointer.
        const pts = this.draft.points;
        const prev = pts[pts.length - 2];
        const pt = this.#toPdf(entry, e);
        this.draft = { ...this.draft, points: [...pts.slice(0, -1), e.shiftKey ? snapAngle(prev, pt) : pt] };
        this.#renderDraft(index);
        return;
      }
      if (!this.gesture || this.gesture.index !== index) return;
      const pt = this.#toPdf(entry, e);
      const g = this.gesture;
      if (!g.moved && Math.hypot(e.clientX - g.client[0], e.clientY - g.client[1]) < MIN_DRAG_PX) return;
      g.moved = true;
      if (g.kind === 'draw') {
        this.draft = updateDraft(this.draft, g, pt, e.shiftKey);
        this.#renderDraft(index);
      } else if (g.kind === 'move') {
        this.preview = translate(g.original, pt[0] - g.start[0], pt[1] - g.start[1]);
        this.renderPage(index);
      } else if (g.kind === 'resize') {
        this.preview = resize(g.original, g.key, pt, e.shiftKey);
        this.renderPage(index);
      }
    });

    const finish = (e) => {
      const g = this.gesture;
      if (!g || g.index !== index) return;
      this.gesture = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (g.kind === 'draw') this.#finishDraw(index, g);
      else if (this.preview) {
        const next = { ...this.preview, modified: new Date().toISOString() };
        this.preview = null;
        this.store.replace([TEXT_TYPES.has(next.type) ? fitTextBox(next, true) : next]);
      }
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);

    el.addEventListener('dblclick', (e) => {
      if (this.ui.tool() !== 'select') return;
      // Pointer capture retargets the click to the layer itself, so use the selection the first click made.
      const m = this.selected;
      if (m && m.page === index && TEXT_TYPES.has(m.type)) this.editText(m.id);
    });
  }

  // ---------- Click-by-click shapes and counts ----------

  #newMarkup(index, type, points) {
    const now = new Date().toISOString();
    return { id: newId(), page: index, type, style: { ...this.ui.styleFor(type) }, author: this.ui.author(), created: now, modified: now, points };
  }

  #polyClick(index, tool, pt, e) {
    if (this.poly && this.poly.index !== index) this.finishPoly();
    if (!this.poly) {
      this.poly = { index };
      this.draft = this.#newMarkup(index, tool, [pt, pt]);
    } else if (e.detail >= 2) {
      // The first click of the double-click already placed the last vertex.
      this.finishPoly();
      return;
    } else {
      const pts = this.draft.points;
      const fixed = e.shiftKey ? snapAngle(pts[pts.length - 2], pt) : pt;
      this.draft = { ...this.draft, points: [...pts.slice(0, -1), fixed, fixed] };
    }
    this.#renderDraft(index);
  }

  get drawingPoly() {
    return !!this.poly;
  }

  /** Ends the shape being clicked out, keeping it if it has enough vertices. */
  finishPoly() {
    if (!this.poly) return;
    const { index } = this.poly;
    let m = this.draft;
    this.poly = null;
    this.draft = null;
    this.#renderDraft(index);
    const points = dedupe(m.points.slice(0, -1)); // drop the rubber-band point
    if (points.length < MIN_VERTICES[m.type]) return;
    m = { ...m, points };
    this.store.add(m);
    this.select(m.id);
    this.ui.onToolDone(m.type);
  }

  cancelPoly() {
    if (!this.poly) return;
    const { index } = this.poly;
    this.poly = null;
    this.draft = null;
    this.#renderDraft(index);
  }

  /** Removes the last clicked vertex. */
  undoVertex() {
    if (!this.poly) return;
    const pts = this.draft.points;
    if (pts.length <= 2) return this.cancelPoly();
    this.draft = { ...this.draft, points: [...pts.slice(0, -2), pts[pts.length - 1]] };
    this.#renderDraft(this.poly.index);
  }

  #countClick(index, pt) {
    const current = this.countId && this.store.get(this.countId);
    if (current && current.page === index) {
      this.store.replace([{ ...current, points: [...current.points, pt], modified: new Date().toISOString() }]);
    } else {
      const m = this.#newMarkup(index, 'count', [pt]);
      this.store.add(m);
      this.countId = m.id;
    }
  }

  /** Called when the tool changes: finishes anything in progress. */
  endTool() {
    this.finishPoly();
    this.countId = null;
  }

  #startDraw(index, tool, pt, e) {
    const now = new Date().toISOString();
    const style = { ...this.ui.styleFor(tool) };
    const base = { id: newId(), page: index, type: tool, style, author: this.ui.author(), created: now, modified: now };
    if (tool === 'stamp') {
      const stamp = this.ui.stamp();
      const subtext = `${base.author ? base.author + '  ' : ''}${new Date().toLocaleDateString()}`;
      style.color = stamp.color;
      this.draft = { ...base, text: stamp.label, subtext, points: stampBox(stamp.label, subtext, pt) };
    } else if (tool === 'callout') {
      this.draft = { ...base, text: '', points: [pt, pt, pt] };
    } else if (tool === 'pen' || tool === 'highlight') {
      this.draft = { ...base, points: [pt] };
    } else {
      this.draft = { ...base, text: tool === 'text' ? '' : undefined, points: [pt, pt] };
    }
    this.gesture = { kind: 'draw', index, start: pt, client: [e.clientX, e.clientY] };
    this.#renderDraft(index);
  }

  #finishDraw(index, g) {
    let m = this.draft;
    this.draft = null;
    this.#renderDraft(index);
    if (!m) return;
    const scale = this.#scale(this.pages.get(index));
    const tiny = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * scale < MIN_DRAG_PX * 2;

    if (m.type === 'text' || m.type === 'callout') {
      const h = m.style.fontSize * LINE_HEIGHT + TEXT_PADDING * 2;
      if (m.type === 'text') {
        const [a, b] = m.points;
        // A drag sets the box width; a click gets a default-width box with its top-left at the click.
        const box = g.moved && !tiny(a, b) ? normRect([a, b]) : [a[0], a[1] - h, a[0] + DEFAULT_TEXT_WIDTH, a[1]];
        m = { ...m, points: [[box[0], box[1]], [box[2], box[3]]] };
      } else {
        // Callout: the drag runs from the arrow tip to where the text box goes.
        const tip = m.points[0];
        let at = m.points[2];
        if (!g.moved || tiny(tip, at)) at = [tip[0] + 40, tip[1] + 30];
        const left = at[0] >= tip[0] ? at[0] : at[0] - DEFAULT_TEXT_WIDTH;
        m = { ...m, points: [tip, [left, at[1] - h / 2], [left + DEFAULT_TEXT_WIDTH, at[1] + h / 2]] };
      }
      this.editText(m);
      return;
    }

    if (m.type === 'calibrate') {
      if (g.moved && !tiny(m.points[0], m.points[1])) {
        this.ui.onCalibrate(index, Math.hypot(m.points[1][0] - m.points[0][0], m.points[1][1] - m.points[0][1]));
      }
      return;
    }
    if (m.type !== 'stamp') {
      if (!g.moved) return;
      if (m.points.length < 2 || tiny(m.points[0], m.points[m.points.length - 1]) && m.points.length <= 2) return;
    }
    if (m.type === 'pen' || m.type === 'highlight') m = { ...m, points: simplify(m.points, 0.6 / scale) };
    this.store.add(m);
    this.select(m.id);
    this.ui.onToolDone(m.type);
  }

  // ---------- Text editing ----------

  /** Opens the in-place text editor on a stored markup (by id) or a new, not-yet-stored one. */
  editText(idOrMarkup) {
    const isNew = typeof idOrMarkup !== 'string';
    const m = isNew ? idOrMarkup : this.store.get(idOrMarkup);
    const entry = m && this.pages.get(m.page);
    if (!entry) return;
    this.#commitEditor();
    this.editing = { markup: m, isNew };
    this.editingId = m.id;
    const ta = document.createElement('textarea');
    ta.className = 'markup-editor';
    ta.value = m.text || '';
    ta.spellcheck = true;
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.#commitEditor();
      }
    });
    ta.addEventListener('input', () => this.#positionEditor());
    ta.addEventListener('blur', () => this.#commitEditor());
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.editor = ta;
    entry.pageView.div.append(ta);
    if (isNew) {
      this.draft = { ...m, text: '' };
      this.#renderDraft(m.page);
    } else {
      this.renderPage(m.page);
    }
    this.#positionEditor();
    ta.focus();
    ta.select();
  }

  #positionEditor() {
    const ta = this.editor;
    const m = this.editing?.markup;
    const entry = m && this.pages.get(m.page);
    if (!ta || !entry) return;
    if (ta.parentNode !== entry.pageView.div) entry.pageView.div.append(ta);
    const vp = entry.pageView.viewport;
    const [x1, , x2, y2] = boxOf(m);
    const draftHeight = fittedTextHeight({ ...m, text: ta.value });
    const [a, b, c, d] = vp.convertToViewportRectangle([x1, y2 - draftHeight, x2, y2]);
    const s = vp.scale;
    Object.assign(ta.style, {
      left: `${Math.min(a, c)}px`,
      top: `${Math.min(b, d)}px`,
      width: `${Math.abs(c - a)}px`,
      height: `${Math.abs(d - b) + m.style.fontSize * s * LINE_HEIGHT}px`,
      fontSize: `${m.style.fontSize * s}px`,
      lineHeight: String(LINE_HEIGHT),
      padding: `${(TEXT_PADDING - 0.15 * m.style.fontSize) * s}px ${TEXT_PADDING * s}px`,
      color: m.style.color,
      fontFamily: SCREEN_FONT,
    });
  }

  #commitEditor() {
    const ta = this.editor;
    if (!ta) return;
    const { markup, isNew } = this.editing;
    this.editor = null;
    this.editing = null;
    this.editingId = null;
    ta.remove();
    if (isNew) {
      this.draft = null;
      this.#renderDraft(markup.page);
    }
    const current = isNew ? markup : this.store.get(markup.id);
    if (!current) return;
    const text = sanitize(ta.value).replace(/\s+$/, '');
    if (!text) {
      if (!isNew) this.store.remove([current.id]);
    } else if (isNew) {
      this.store.add(fitTextBox({ ...current, text }));
      this.select(current.id);
    } else if (text !== current.text) {
      this.store.replace([fitTextBox({ ...current, text, modified: new Date().toISOString() })]);
    } else {
      this.renderPage(current.page);
    }
    this.ui.onToolDone(current.type);
  }

  commitEditing() {
    this.#commitEditor();
  }

  destroy() {
    this.#commitEditor();
    for (const entry of this.pages.values()) entry.svg.remove();
    this.pages.clear();
  }
}

// ---------- Shape editing helpers ----------

function updateDraft(m, g, pt, constrain) {
  switch (m.type) {
    case 'pen':
    case 'highlight':
      return { ...m, points: [...m.points, pt] };
    case 'stamp': {
      const [[x1, y1], [x2, y2]] = m.points;
      const w = x2 - x1;
      const h = y2 - y1;
      return { ...m, points: [[pt[0] - w / 2, pt[1] - h / 2], [pt[0] + w / 2, pt[1] + h / 2]] };
    }
    case 'callout':
      return { ...m, points: [m.points[0], pt, pt] };
    case 'line':
    case 'arrow':
    case 'length':
    case 'calibrate':
      return { ...m, points: [g.start, constrain ? snapAngle(g.start, pt) : pt] };
    default:
      return { ...m, points: [g.start, constrain ? squareUp(g.start, pt) : pt] };
  }
}

function snapAngle(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len];
}

function squareUp(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return [from[0] + Math.sign(dx || 1) * size, from[1] + Math.sign(dy || 1) * size];
}

function cornersOf([x1, y1, x2, y2]) {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function handlesFor(m) {
  switch (m.type) {
    case 'line':
    case 'arrow':
    case 'length':
      return m.points.map((point, i) => ({ key: `p${i}`, point }));
    case 'polylength':
    case 'area':
    case 'perimeter':
    case 'count':
      return m.points.map((point, i) => ({ key: `v${i}`, point }));
    case 'rect':
    case 'ellipse':
    case 'cloud':
    case 'text':
      return cornersOf(boxOf(m)).map((point, i) => ({ key: `c${i}`, point }));
    case 'callout':
      return [{ key: 'tip', point: m.points[0] }, ...cornersOf(boxOf(m)).map((point, i) => ({ key: `c${i}`, point }))];
    default:
      return [];
  }
}

function resize(m, key, pt, constrain) {
  if (key === 'tip') return { ...m, points: [pt, m.points[1], m.points[2]] };
  if (key[0] === 'v') {
    const i = Number(key.slice(1));
    const points = [...m.points];
    const prev = points[i - 1];
    points[i] = constrain && prev ? snapAngle(prev, pt) : pt;
    return { ...m, points };
  }
  if (key[0] === 'p') {
    const i = Number(key.slice(1));
    const other = m.points[1 - i];
    const points = [...m.points];
    points[i] = constrain ? snapAngle(other, pt) : pt;
    return { ...m, points };
  }
  const corners = cornersOf(boxOf(m));
  const opposite = corners[(Number(key.slice(1)) + 2) % 4];
  const corner = constrain && m.type !== 'text' && m.type !== 'callout' ? squareUp(opposite, pt) : pt;
  const box = [opposite, corner];
  return { ...m, points: m.type === 'callout' ? [m.points[0], ...box] : box };
}

/** Grows or shrinks a text box's height to fit its text, keeping its top edge. */
function fitTextBox(m, onlyGrow = false) {
  if (!TEXT_TYPES.has(m.type)) return m;
  const [x1, y1, x2, y2] = boxOf(m);
  const needed = fittedTextHeight(m);
  if (onlyGrow && y2 - y1 >= needed) return m;
  const box = normRect([
    [x1, y2 - needed],
    [x2, y2],
  ]);
  const pts = [
    [box[0], box[1]],
    [box[2], box[3]],
  ];
  return { ...m, points: m.type === 'callout' ? [m.points[0], ...pts] : pts };
}

// Drops vertices that land on the previous one (e.g. from a double-click).
function dedupe(points) {
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.01);
}

// Ramer–Douglas–Peucker: drop freehand points that don't change the shape.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
