// Compare two versions of a document, page by page.
//
// Overlay view: the old version in red and the new one in blue; where they
// agree the drawing is black. Differences view: the new version with every
// changed area boxed, and a button that clouds those areas as markups.

const ANALYSIS_MAX_PX = 2400; // longest side of a page when looking for differences
const INK_DIFF = 0.3; // darkness difference that counts as a change
const CELL = 8; // pixels per cell when grouping changed pixels
const CELL_MIN = 3; // changed pixels a cell needs, so specks of noise don't count
const GAP = 2; // cells apart that still belong to the same change
const PAD = 6; // pixels around each change box

export class CompareTab {
  static #nextId = 1;

  constructor({ oldTab, newTab, viewersEl, sidebarEl, onAddClouds }) {
    this.id = `compare-${CompareTab.#nextId++}`;
    this.kind = 'compare';
    this.oldTab = oldTab;
    this.newTab = newTab;
    this.onAddClouds = onAddClouds;
    this.path = '';
    this.size = null;
    this.mode = 'overlay';
    this.pageInfo = new Map(); // page index -> { boxes, onlyIn }
    this.queue = Promise.resolve();

    this.container = document.createElement('div');
    this.container.className = 'viewer-container compare-view';
    this.container.tabIndex = 0;
    viewersEl.append(this.container);

    // Compare tabs have no thumbnails, but the sidebar shows an empty strip for them.
    this.thumbsEl = document.createElement('div');
    this.thumbsEl.className = 'thumbs';
    sidebarEl.append(this.thumbsEl);

    this.#build();
    this.onSourceReloaded = () => this.#build();
    for (const tab of [oldTab, newTab]) tab.eventBus.on('documentreloaded', this.onSourceReloaded);
  }

  get name() {
    return `Compare: ${this.oldTab.name} → ${this.newTab.name}`;
  }

  get dirty() {
    return false;
  }

  /** True if this view depends on the given document tab. */
  uses(tab) {
    return tab === this.oldTab || tab === this.newTab;
  }

  show(visible) {
    this.container.hidden = !visible;
    this.thumbsEl.hidden = !visible;
  }

  setMode(mode) {
    this.mode = mode;
    for (const btn of this.header.querySelectorAll('[data-mode]')) btn.classList.toggle('active', btn.dataset.mode === mode);
    this.legend.hidden = mode !== 'overlay';
    for (const card of this.cards) if (card.loaded) this.#draw(card);
  }

  #build() {
    this.observer?.disconnect();
    this.pageInfo.clear();
    this.container.replaceChildren();

    this.header = el('div', 'compare-header');
    const modes = el('div', 'segmented');
    for (const [mode, label] of [
      ['overlay', 'Overlay'],
      ['diff', 'Differences'],
    ]) {
      const btn = el('button', mode === this.mode ? 'active' : '', label);
      btn.dataset.mode = mode;
      btn.addEventListener('click', () => this.setMode(mode));
      modes.append(btn);
    }
    this.legend = el('span', 'compare-legend');
    this.legend.innerHTML = `<i class="sw old"></i> Only in old <i class="sw new"></i> Only in new <i class="sw both"></i> Same`;
    this.legend.hidden = this.mode !== 'overlay';
    this.summary = el('span', 'compare-summary');
    this.cloudBtn = el('button', 'primary', 'Cloud changes in new version');
    this.cloudBtn.title = `Adds a revision cloud around every change to “${this.newTab.name}”`;
    this.cloudBtn.addEventListener('click', () => this.addClouds());
    this.header.append(modes, this.legend, el('span', 'spacer'), this.summary, this.cloudBtn);
    this.container.append(this.header);

    const n = Math.max(this.oldTab.pageCount, this.newTab.pageCount);
    this.cards = [];
    this.observer = new IntersectionObserver((entries) => this.#onVisible(entries), {
      root: this.container,
      rootMargin: '600px 0px',
    });
    for (let i = 0; i < n; i++) {
      const card = { index: i, el: el('section', 'compare-page'), loaded: false };
      card.title = el('div', 'compare-page-title', `Page ${i + 1}`);
      card.canvas = el('canvas');
      card.el.append(card.title, card.canvas);
      this.container.append(card.el);
      this.cards.push(card);
      this.observer.observe(card.el);
    }
    this.#updateSummary();
  }

  #onVisible(entries) {
    for (const entry of entries) {
      const card = this.cards.find((c) => c.el === entry.target);
      if (!card) continue;
      if (entry.isIntersecting && !card.loaded) {
        card.loaded = true;
        this.#enqueue(() => this.#draw(card));
      } else if (!entry.isIntersecting && card.loaded) {
        // Free the pixels of pages far out of view; they redraw when scrolled back.
        card.loaded = false;
        card.el.style.minHeight = `${card.el.offsetHeight}px`;
        card.canvas.width = 0;
        card.canvas.height = 0;
      }
    }
  }

  #enqueue(job) {
    this.queue = this.queue.then(job).catch((err) => console.error(err));
    return this.queue;
  }

  /** Renders both versions of a page into equal-size pixel buffers. */
  async #renderPair(index) {
    const [a, b] = await Promise.all([pageOf(this.oldTab, index), pageOf(this.newTab, index)]);
    const base = [a, b].filter(Boolean).map((p) => p.getViewport({ scale: 1 }));
    const longest = Math.max(...base.map((v) => Math.max(v.width, v.height)));
    const scale = Math.min(2, ANALYSIS_MAX_PX / longest);
    const vpA = a?.getViewport({ scale });
    const vpB = b?.getViewport({ scale });
    const w = Math.ceil(Math.max(vpA?.width ?? 0, vpB?.width ?? 0));
    const h = Math.ceil(Math.max(vpA?.height ?? 0, vpB?.height ?? 0));
    const [imgA, imgB] = await Promise.all([render(a, vpA, w, h), render(b, vpB, w, h)]);
    return { w, h, imgA, imgB, vpB, onlyIn: !a ? 'new' : !b ? 'old' : null };
  }

  /** Finds (and remembers) the change boxes of a page, in pixel coordinates of the new page. */
  async #analyze(index) {
    const pair = await this.#renderPair(index);
    let info = this.pageInfo.get(index);
    if (!info) {
      const boxes = pair.onlyIn ? [] : findChanges(pair.imgA.data, pair.imgB.data, pair.w, pair.h);
      info = { boxes, onlyIn: pair.onlyIn, pdfBoxes: boxes.map((b) => toPdfBox(pair.vpB, b)) };
      this.pageInfo.set(index, info);
      this.#updateSummary();
    }
    return { pair, info };
  }

  async #draw(card) {
    if (!card.loaded) return;
    const { pair, info } = await this.#analyze(card.index);
    if (!card.loaded) return;
    const { w, h } = pair;
    const out = new ImageData(w, h);
    const A = pair.imgA.data;
    const B = pair.imgB.data;
    const O = out.data;
    for (let p = 0; p < O.length; p += 4) {
      const dA = 1 - lum(A, p) / 255;
      const dB = 1 - lum(B, p) / 255;
      if (this.mode === 'overlay') {
        O[p] = 255 * (1 - dB);
        O[p + 1] = 255 * (1 - Math.max(dA, dB));
        O[p + 2] = 255 * (1 - dA);
      } else {
        // The new version (or the old one, for a page that was removed), slightly faded.
        const d = info.onlyIn === 'old' ? dA : dB;
        O[p] = O[p + 1] = O[p + 2] = 255 * (1 - 0.85 * d);
      }
      O[p + 3] = 255;
    }
    card.canvas.width = w;
    card.canvas.height = h;
    const ctx = card.canvas.getContext('2d');
    ctx.putImageData(out, 0, 0);
    if (this.mode === 'diff') {
      ctx.lineWidth = Math.max(2, w / 600);
      ctx.strokeStyle = '#e11d48';
      ctx.fillStyle = 'rgba(225, 29, 72, 0.12)';
      for (const [x1, y1, x2, y2] of info.boxes) {
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
    }
    card.el.style.minHeight = '';
    card.title.textContent = pageTitle(card.index, info);
  }

  #updateSummary() {
    const n = this.cards?.length ?? 0;
    let changes = 0;
    let pages = 0;
    for (const info of this.pageInfo.values()) {
      changes += info.boxes.length;
      if (info.boxes.length || info.onlyIn) pages++;
    }
    const checked = this.pageInfo.size;
    this.summary.textContent =
      `${changes} change${changes === 1 ? '' : 's'} on ${pages} page${pages === 1 ? '' : 's'}` +
      (checked < n ? ` (checked ${checked} of ${n})` : '');
    this.cloudBtn.disabled = checked === n && changes === 0;
  }

  /** Checks every page, then hands the change boxes (PDF coordinates) to the app. */
  async addClouds() {
    this.cloudBtn.disabled = true;
    const label = this.cloudBtn.textContent;
    try {
      const byPage = [];
      for (let i = 0; i < this.newTab.pageCount; i++) {
        this.cloudBtn.textContent = `Checking page ${i + 1} of ${this.newTab.pageCount}…`;
        const { info } = await this.#enqueue(() => this.#analyze(i));
        if (info.pdfBoxes.length) byPage.push({ page: i, boxes: info.pdfBoxes });
      }
      this.onAddClouds(this.newTab, byPage);
    } catch (err) {
      window.desktop.showError('Could not compare', err.message);
    } finally {
      this.cloudBtn.textContent = label;
      this.#updateSummary();
    }
  }

  async destroy() {
    for (const tab of [this.oldTab, this.newTab]) tab.eventBus.off('documentreloaded', this.onSourceReloaded);
    this.observer?.disconnect();
    this.container.remove();
    this.thumbsEl.remove();
  }
}

function el(tag, className = '', text = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function pageOf(tab, index) {
  return index < tab.pageCount ? tab.pdf.getPage(index + 1) : null;
}

async function render(page, viewport, w, h) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  if (page) await page.render({ canvasContext: ctx, viewport, annotationMode: 0 }).promise;
  return ctx.getImageData(0, 0, w, h);
}

function lum(d, p) {
  // Treat transparent as white paper.
  return d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
}

/** Groups changed pixels into boxes [x1, y1, x2, y2]. */
export function findChanges(A, B, w, h) {
  const cw = Math.ceil(w / CELL);
  const ch = Math.ceil(h / CELL);
  const counts = new Uint16Array(cw * ch);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / CELL) * cw;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (Math.abs(lum(A, p) - lum(B, p)) > INK_DIFF * 255) counts[row + Math.floor(x / CELL)]++;
    }
  }

  // Connected groups of busy cells, allowing small gaps, become one box each.
  const seen = new Uint8Array(cw * ch);
  const boxes = [];
  for (let start = 0; start < counts.length; start++) {
    if (seen[start] || counts[start] < CELL_MIN) continue;
    seen[start] = 1;
    const stack = [start];
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cw;
      const cy = (c - cx) / cw;
      x1 = Math.min(x1, cx);
      y1 = Math.min(y1, cy);
      x2 = Math.max(x2, cx);
      y2 = Math.max(y2, cy);
      for (let ny = Math.max(0, cy - GAP); ny <= Math.min(ch - 1, cy + GAP); ny++) {
        for (let nx = Math.max(0, cx - GAP); nx <= Math.min(cw - 1, cx + GAP); nx++) {
          const n = ny * cw + nx;
          if (!seen[n] && counts[n] >= CELL_MIN) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    boxes.push([
      Math.max(0, x1 * CELL - PAD),
      Math.max(0, y1 * CELL - PAD),
      Math.min(w, (x2 + 1) * CELL + PAD),
      Math.min(h, (y2 + 1) * CELL + PAD),
    ]);
  }
  return mergeOverlapping(boxes);
}

function mergeOverlapping(boxes) {
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
          boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return boxes;
}

/** A pixel box on the rendered new page, as two corners in PDF user space. */
function toPdfBox(viewport, [x1, y1, x2, y2]) {
  const [ax, ay] = viewport.convertToPdfPoint(x1, y1);
  const [bx, by] = viewport.convertToPdfPoint(x2, y2);
  return [
    [Math.min(ax, bx), Math.min(ay, by)],
    [Math.max(ax, bx), Math.max(ay, by)],
  ];
}

function pageTitle(index, info) {
  if (info.onlyIn === 'new') return `Page ${index + 1} — added in the new version`;
  if (info.onlyIn === 'old') return `Page ${index + 1} — removed in the new version`;
  const n = info.boxes.length;
  return `Page ${index + 1} — ${n ? `${n} change${n === 1 ? '' : 's'}` : 'no changes'}`;
}
