// The markups of one document, with undo/redo.

const UNDO_LIMIT = 200;

export class MarkupStore {
  #markups = [];
  #undo = [];
  #redo = [];
  #listeners = new Set();
  #savedVersion = 0;
  #version = 0;

  constructor(initial = []) {
    this.#markups = initial;
  }

  get all() {
    return this.#markups;
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
    return this.#markups.find((m) => m.id === id);
  }

  onPage(pageIndex) {
    return this.#markups.filter((m) => m.page === pageIndex);
  }

  onChange(listener) {
    this.#listeners.add(listener);
  }

  add(markup) {
    this.#apply([...this.#markups, markup], [markup.page]);
  }

  /** Replaces markups by id. Pass the full new objects. */
  replace(updated) {
    const byId = new Map(updated.map((m) => [m.id, m]));
    const pages = new Set(updated.map((m) => m.page));
    for (const m of this.#markups) if (byId.has(m.id)) pages.add(m.page);
    this.#apply(
      this.#markups.map((m) => byId.get(m.id) ?? m),
      [...pages],
    );
  }

  remove(ids) {
    const set = new Set(ids);
    const pages = this.#markups.filter((m) => set.has(m.id)).map((m) => m.page);
    if (!pages.length) return;
    this.#apply(
      this.#markups.filter((m) => !set.has(m.id)),
      pages,
    );
  }

  undo() {
    if (!this.#undo.length) return;
    const prev = this.#undo.pop();
    this.#redo.push(this.#markups);
    this.#swap(prev);
  }

  redo() {
    if (!this.#redo.length) return;
    const next = this.#redo.pop();
    this.#undo.push(this.#markups);
    this.#swap(next);
  }

  markSaved() {
    this.#savedVersion = this.#version;
    this.#emit([]);
  }

  #apply(next, pages) {
    this.#undo.push(this.#markups);
    if (this.#undo.length > UNDO_LIMIT) this.#undo.shift();
    this.#redo = [];
    this.#markups = next;
    this.#version = nextVersion();
    this.#emit(pages);
  }

  #swap(next) {
    const pages = new Set([...this.#markups, ...next].map((m) => m.page));
    this.#markups = next;
    // Undo/redo can land back on the saved state, but tracking that exactly
    // isn't worth it: any undo/redo counts as a change.
    this.#version = nextVersion();
    this.#emit([...pages]);
  }

  #emit(pages) {
    for (const listener of this.#listeners) listener(pages);
  }
}

let versionCounter = 0;
function nextVersion() {
  return ++versionCounter;
}

export function newId() {
  return crypto.randomUUID();
}
