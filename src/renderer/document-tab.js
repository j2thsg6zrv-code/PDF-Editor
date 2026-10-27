// One open PDF: its viewer, find controller and thumbnail strip.
import { pdfjsLib, viewerLib } from './pdfjs.js';

const THUMB_WIDTH = 120;

export class DocumentTab {
  static #nextId = 1;

  constructor({ name, path, data, viewersEl, sidebarEl }) {
    this.id = DocumentTab.#nextId++;
    this.name = name;
    this.path = path;
    this.size = data.byteLength;
    this.data = data;

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
    this.thumbObserver = new IntersectionObserver((entries) => this.#onThumbsVisible(entries), {
      root: sidebarEl,
      rootMargin: '200px 0px',
    });

    this.eventBus.on('pagechanging', ({ pageNumber }) => this.#markActiveThumb(pageNumber));
  }

  async load() {
    // pdf.js takes ownership of (and detaches) the buffer it is given, so hand it a copy.
    this.loadingTask = pdfjsLib.getDocument({ data: this.data.slice() });
    this.pdf = await this.loadingTask.promise;
    this.viewer.setDocument(this.pdf);
    this.linkService.setDocument(this.pdf);
    await new Promise((resolve) => this.eventBus.on('pagesinit', resolve, { once: true }));
    this.viewer.currentScaleValue = 'page-width';
    this.#buildThumbs();
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
      item.addEventListener('click', () => {
        this.viewer.currentPageNumber = i;
      });

      this.thumbsEl.append(item);
      this.thumbs.push({ item, frame, rendered: false });
      this.thumbObserver.observe(item);
    }
    this.#markActiveThumb(this.viewer.currentPageNumber);
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
      if (active && !this.thumbsEl.hidden) thumb.item.scrollIntoView({ block: 'nearest' });
    }
  }

  async destroy() {
    this.thumbObserver.disconnect();
    this.container.remove();
    this.thumbsEl.remove();
    if (this.loadingTask) await this.loadingTask.destroy();
  }
}
