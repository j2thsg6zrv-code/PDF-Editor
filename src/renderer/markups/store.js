// The markups and page scales of one document, with undo/redo.

const UNDO_LIMIT = 200;

export class MarkupStore {
  // One immutable snapshot of everything undoable: { markups: [], scales: { [pageIndex]: scale } }.
  #state;
  #undo = [];
  #redo = [];
  #listeners = new Set();
  #savedVersion = 0;
  #version = 0;

  constructor(markups = [], scales = {}) {
    this.#state = { markups, scales };
  }

  get all() {
    return this.#state.markups;
  }

  get scales() {
    return this.#state.scales;
  }

  /** The scale set on a page, or null if it isn't calibrated. */
  scaleFor(pageIndex) {
    return this.#state.scales[pageIndex] ?? null;
  }

  get dirty() {
    return this.#version !== this.#savedVersion;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  get(id) {
    return this.#state.markups.find((m) => m.id === id);
  }

  onPage(pageIndex) {
    return this.#state.markups.filter((m) => m.page === pageIndex);
  }

  /** Listener gets (pages changed, { scales: bool }). */
  onChange(listener) {
    this.#listeners.add(listener);
  }

  add(markup) {
    this.#apply({ ...this.#state, markups: [...this.#state.markups, markup] }, [markup.page]);
  }

  /** Adds several markups as one undoable step. */
  addMany(markups) {
    if (!markups.length) return;
    this.#apply({ ...this.#state, markups: [...this.#state.markups, ...markups] }, [...new Set(markups.map((m) => m.page))]);
  }

  /** Replaces markups by id. Pass the full new objects. */
  replace(updated) {
    const byId = new Map(updated.map((m) => [m.id, m]));
    const pages = new Set(updated.map((m) => m.page));
    for (const m of this.#state.markups) if (byId.has(m.id)) pages.add(m.page);
    this.#apply(
      { ...this.#state, markups: this.#state.markups.map((m) => byId.get(m.id) ?? m) },
      [...pages],
    );
  }

  remove(ids) {
    const set = new Set(ids);
    const pages = this.#state.markups.filter((m) => set.has(m.id)).map((m) => m.page);
    if (!pages.length) return;
    this.#apply(
      { ...this.#state, markups: this.#state.markups.filter((m) => !set.has(m.id)) },
      pages,
    );
  }

  /** Sets (or with null, clears) the scale of some pages. */
  setScale(pageIndexes, scale) {
    const scales = { ...this.#state.scales };
    for (const i of pageIndexes) {
      if (scale) scales[i] = scale;
      else delete scales[i];
    }
    this.#apply({ ...this.#state, scales }, pageIndexes, true);
  }

  /**
   * Replaces everything after a page operation (rotate, delete, reorder...).
   * Page operations change the PDF itself, so they clear undo history.
   */
  reset(markups, scales) {
    this.#state = { markups, scales };
    this.#undo = [];
    this.#redo = [];
    this.#version = nextVersion();
    this.#emit(null, true);
  }

  undo() {
    if (!this.#undo.length) return;
    const prev = this.#undo.pop();
    this.#redo.push(this.#state);
    this.#swap(prev);
  }

  redo() {
    if (!this.#redo.length) return;
    const next = this.#redo.pop();
    this.#undo.push(this.#state);
    this.#swap(next);
  }

  markSaved() {
    this.#savedVersion = this.#version;
    this.#emit([], false);
  }

  #apply(next, pages, scalesChanged = false) {
    this.#undo.push(this.#state);
    if (this.#undo.length > UNDO_LIMIT) this.#undo.shift();
    this.#redo = [];
    this.#state = next;
    this.#version = nextVersion();
    this.#emit(pages, scalesChanged);
  }

  #swap(next) {
    const scalesChanged = next.scales !== this.#state.scales;
    const pages = new Set([...this.#state.markups, ...next.markups].map((m) => m.page));
    if (scalesChanged) for (const k of Object.keys({ ...next.scales, ...this.#state.scales })) pages.add(Number(k));
    this.#state = next;
    // Undo/redo can land back on the saved state, but tracking that exactly
    // isn't worth it: any undo/redo counts as a change.
    this.#version = nextVersion();
    this.#emit([...pages], scalesChanged);
  }

  /** pages === null means every page. */
  #emit(pages, scalesChanged) {
    for (const listener of this.#listeners) listener(pages, { scales: scalesChanged });
  }
}

let versionCounter = 0;
function nextVersion() {
  return ++versionCounter;
}

export function newId() {
  return crypto.randomUUID();
}
