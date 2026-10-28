// One open PDF: its viewer, find controller and thumbnail strip.
import { pdfjsLib, viewerLib } from './pdfjs.js';
import { MarkupStore } from './markups/store.js';
import { MarkupLayer } from './markups/layer.js';
import { extractMarkups, writeMarkups } from './markups/pdf-io.js';
import * as pageOps from './page-ops.js';

const THUMB_WIDTH = 120;

export class DocumentTab {
  static #nextId = 1;

  constructor({ name, path, data, viewersEl, sidebarEl, markupUi }) {
    this.id = DocumentTab.#nextId++;
    this.name = name;
    this.path = path;
    this.size = data.byteLength;
    this.data = data;
    this.markupUi = markupUi;

    this.container = document.createElement('div');
    this.container.className = 'viewer-container';
    this.container.tabIndex = 0;
    const viewerEl = document.createElement('div');
    viewerEl.className = 'pdfViewer';
    this.container.append(viewerEl);
    viewersEl.append(this.container);

    this.thumbsEl = document.createElement('div');
    this.thumbsEl.className = 'thumbs';
    sidebarEl.append(this.thumbsEl);

    this.eventBus = new viewerLib.EventBus();
    this.linkService = new viewerLib.PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: viewerLib.LinkTarget.BLANK });
    this.findController = new viewerLib.PDFFindController({ eventBus: this.eventBus, linkService: this.linkService });
    this.viewer = new viewerLib.PDFViewer({
      container: this.container,
      viewer: viewerEl,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      removePageBorders: true,
      // Annotation editing gets built in step 2; keep pdf.js's own editor off.
      annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
    });
    this.linkService.setViewer(this.viewer);

    this.thumbs = [];
    this.sidebarEl = sidebarEl;
    this.selectedPages = new Set(); // zero-based indexes picked in the thumbnail strip
    this.#newThumbObserver();
    this.#wireThumbDrag();

    this.eventBus.on('pagechanging', ({ pageNumber }) => this.#markActiveThumb(pageNumber));
  }

  async load() {
    // Our own markups come out of the file into the editable layer; the rest
    // of the PDF (including other apps' annotations) is what pdf.js draws.
    const { base, markups, scales, editable } = await extractMarkups(this.data);
    this.base = base;
    this.editable = editable;
    this.store = new MarkupStore(markups, scales);
    this.markups = new MarkupLayer({ tab: this, store: this.store, ui: this.markupUi });
    this.container.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.markup, [data-handle], .markup-editor')) this.markups.select(null);
    });

    // pdf.js takes ownership of (and detaches) the buffer it is given, so hand it a copy.
    this.loadingTask = pdfjsLib.getDocument({ data: this.base.slice() });
    this.pdf = await this.loadingTask.promise;
    this.viewer.setDocument(this.pdf);
    this.linkService.setDocument(this.pdf);
    await new Promise((resolve) => this.eventBus.on('pagesinit', resolve, { once: true }));
    this.viewer.currentScaleValue = 'page-width';
    this.#buildThumbs();
  }

  // ---------- Page operations ----------

  /** Pages the page tools act on: the thumbnail selection, else the page in view. */
  get targetPages() {
    return this.selectedPages.size ? [...this.selectedPages].sort((a, b) => a - b) : [this.currentPageIndex];
  }

  rotatePages(delta, pages = this.targetPages) {
    return this.#pageOp(() => pageOps.rotatePages(this.base, pages, delta), pages);
  }

  deletePages(pages = this.targetPages) {
    const first = Math.min(...pages);
    return this.#pageOp(() => pageOps.deletePages(this.base, pages), [], Math.min(first, this.pageCount - pages.length - 1));
  }

  movePages(pages, target) {
    return this.#pageOp(() => pageOps.movePages(this.base, pages, target), pages);
  }

  /** Inserts another PDF's pages before page index 'at'. */
  insertFile(bytes, at) {
    return this.#pageOp(() => pageOps.insertPages(this.base, bytes, at), null, at);
  }

  /** A new PDF (bytes) containing just these pages and their markups. */
  extractPages(pages = this.targetPages) {
    this.markups.commitEditing();
    return pageOps.extractPages(this.base, pages, this.store.all, this.store.scales);
  }

  /**
   * Runs a page operation, carries markups and scales to their new pages, and
   * reloads the view. selectAfter: old indexes to keep selected (null keeps
   * nothing); focus: new index of the page to show.
   */
  async #pageOp(run, selectAfter = null, focus = null) {
    this.markups.commitEditing();
    const result = await run();
    if (!result) return;
    const { markups, scales } = pageOps.remap(result.map, this.store.all, this.store.scales);
    if (result.inserted) {
      markups.push(...result.inserted.markups);
      Object.assign(scales, result.inserted.scales);
    }
    const keep = selectAfter ? selectAfter.map((i) => result.map[i]).filter((i) => i != null) : [];
    const page = focus ?? result.map[this.currentPageIndex] ?? 0;
    await this.#reload(result.bytes, page);
    this.selectedPages = new Set(keep);
    this.#markActiveThumb(this.viewer.currentPageNumber);
    this.store.reset(markups, scales);
  }

  /** Swaps in a new base PDF, keeping the zoom and showing page index 'page'. */
  async #reload(bytes, page) {
    const scaleValue = this.viewer.currentScaleValue;
    const oldTask = this.loadingTask;
    this.markups.resetPages();
    this.base = bytes;
    this.loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
    this.pdf = await this.loadingTask.promise;
    const ready = new Promise((resolve) => this.eventBus.on('pagesinit', resolve, { once: true }));
    this.viewer.setDocument(this.pdf);
    this.linkService.setDocument(this.pdf);
    await ready;
    this.viewer.currentScaleValue = scaleValue || 'page-width';
    this.viewer.currentPageNumber = Math.min(Math.max(1, page + 1), this.pdf.numPages);
    this.thumbObserver.disconnect();
    this.#newThumbObserver();
    this.thumbs = [];
    this.thumbsEl.replaceChildren();
    this.#buildThumbs();
    oldTask?.destroy();
    this.eventBus.dispatch('documentreloaded', { source: this });
  }

  get dirty() {
    return !!this.store?.dirty;
  }

  /** Writes the document with its markups to disk. */
  async save(filePath = this.path) {
    if (!this.editable) throw new Error('This PDF is encrypted, so markups cannot be saved into it.');
    this.markups.commitEditing();
    const bytes = await writeMarkups(this.base, this.store.all, this.store.scales);
    await window.desktop.saveFile(filePath, bytes);
    if (filePath !== this.path) {
      this.path = filePath;
      this.name = filePath.split(/[\\/]/).pop();
    }
    this.size = bytes.byteLength;
    this.store.markSaved();
  }

  /** Zero-based index of the page currently in view. */
  get currentPageIndex() {
    return this.viewer.currentPageNumber - 1;
  }

  get pageCount() {
    return this.pdf ? this.pdf.numPages : 0;
  }

  show(visible) {
    this.container.hidden = !visible;
    this.thumbsEl.hidden = !visible;
  }

  async #buildThumbs() {
    // Size every placeholder up front so the strip scrolls correctly before thumbnails render.
    for (let i = 1; i <= this.pdf.numPages; i++) {
      const pageView = this.viewer.getPageView(i - 1);
      const vp = pageView.viewport;
      const height = Math.round((THUMB_WIDTH * vp.height) / vp.width);

      const item = document.createElement('div');
      item.className = 'thumb';
      item.dataset.page = String(i);
      const frame = document.createElement('div');
      frame.className = 'thumb-frame';
      frame.style.width = `${THUMB_WIDTH + 4}px`;
      frame.style.height = `${height + 4}px`;
      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = String(i);
      item.append(frame, label);
      item.draggable = true;
      item.addEventListener('click', (e) => this.#onThumbClick(i - 1, e));

      this.thumbsEl.append(item);
      this.thumbs.push({ item, frame, rendered: false });
      this.thumbObserver.observe(item);
    }
    this.#markActiveThumb(this.viewer.currentPageNumber);
  }

  #newThumbObserver() {
    this.thumbObserver = new IntersectionObserver((entries) => this.#onThumbsVisible(entries), {
      root: this.sidebarEl,
      rootMargin: '200px 0px',
    });
  }

  // Click shows a page; ⌘-click adds/removes it from the selection; Shift-click selects a range.
  #onThumbClick(index, e) {
    if (e.metaKey || e.ctrlKey) {
      if (!this.selectedPages.size) this.selectedPages.add(this.currentPageIndex);
      if (this.selectedPages.has(index)) this.selectedPages.delete(index);
      else this.selectedPages.add(index);
    } else if (e.shiftKey) {
      const anchor = this.selectionAnchor ?? this.currentPageIndex;
      this.selectedPages = new Set();
      for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) this.selectedPages.add(i);
    } else {
      this.selectedPages = new Set();
      this.selectionAnchor = index;
      this.viewer.currentPageNumber = index + 1;
    }
    this.#markActiveThumb(this.viewer.currentPageNumber);
    this.eventBus.dispatch('pageselectionchanged', { source: this });
  }

  // Drag thumbnails to reorder pages; drop PDF files from Finder to insert their pages.
  #wireThumbDrag() {
    const el = this.thumbsEl;
    let indicator = null;
    const dropIndex = (e) => {
      const items = [...el.querySelectorAll('.thumb')];
      for (const [i, item] of items.entries()) {
        const r = item.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) return i;
      }
      return items.length;
    };
    const showIndicator = (index) => {
      indicator ??= Object.assign(document.createElement('div'), { className: 'thumb-drop' });
      const items = el.querySelectorAll('.thumb');
      if (index < items.length) items[index].before(indicator);
      else el.append(indicator);
    };
    const clear = () => {
      indicator?.remove();
      indicator = null;
    };

    el.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.thumb');
      if (!item) return;
      const index = Number(item.dataset.page) - 1;
      if (!this.selectedPages.has(index)) {
        this.selectedPages = new Set([index]);
        this.#markActiveThumb(this.viewer.currentPageNumber);
      }
      this.dragging = [...this.selectedPages];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-redline-pages', this.dragging.join(','));
    });
    el.addEventListener('dragend', () => {
      this.dragging = null;
      clear();
    });
    el.addEventListener('dragover', (e) => {
      const isPages = !!this.dragging;
      const isFile = e.dataTransfer.types.includes('Files');
      if (!isPages && !isFile) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = isPages ? 'move' : 'copy';
      showIndicator(dropIndex(e));
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) clear();
    });
    el.addEventListener('drop', async (e) => {
      const at = dropIndex(e);
      clear();
      e.preventDefault(); // tells the window's drop handler not to open these as tabs
      if (this.dragging) {
        const pages = this.dragging;
        this.dragging = null;
        await this.movePages(pages, at);
        return;
      }
      for (const file of [...e.dataTransfer.files].reverse()) {
        if (!file.name.toLowerCase().endsWith('.pdf')) continue;
        try {
          await this.insertFile(new Uint8Array(await file.arrayBuffer()), at);
        } catch (err) {
          window.desktop.showError('Could not insert pages', `${file.name}\n\n${err.message}`);
        }
      }
    });
  }

  #onThumbsVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const pageNumber = Number(entry.target.dataset.page);
      this.#renderThumb(pageNumber);
    }
  }

  async #renderThumb(pageNumber) {
    const thumb = this.thumbs[pageNumber - 1];
    if (!thumb || thumb.rendered) return;
    thumb.rendered = true;
    this.thumbObserver.unobserve(thumb.item);

    const page = await this.pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMB_WIDTH / base.width;
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * ratio });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    thumb.frame.style.width = '';
    thumb.frame.style.height = '';
    thumb.frame.replaceChildren(canvas);
  }

  #markActiveThumb(pageNumber) {
    for (const [i, thumb] of this.thumbs.entries()) {
      const active = i + 1 === pageNumber;
      thumb.item.classList.toggle('active', active);
      thumb.item.classList.toggle('selected', this.selectedPages.has(i));
      if (active && !this.thumbsEl.hidden) thumb.item.scrollIntoView({ block: 'nearest' });
    }
  }

  async destroy() {
    this.markups?.destroy();
    this.thumbObserver.disconnect();
    this.container.remove();
    this.thumbsEl.remove();
    if (this.loadingTask) await this.loadingTask.destroy();
  }
}
