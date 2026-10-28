// Page operations on a document's base PDF (the PDF without our markups).
// Each returns the new bytes and how old page indexes map to new ones, so the
// caller can move markups and scales along with their pages.
import { PDFDocument, degrees } from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
import { extractMarkups, writeMarkups } from './markups/pdf-io.js';

async function load(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

function identityMap(n) {
  return [...Array(n).keys()];
}

/** Rotates pages by a multiple of 90 degrees (positive is clockwise). */
export async function rotatePages(base, indexes, delta) {
  const doc = await load(base);
  for (const i of indexes) {
    const page = doc.getPage(i);
    page.setRotation(degrees((((page.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return { bytes: await doc.save(), map: identityMap(doc.getPageCount()) };
}

export async function deletePages(base, indexes) {
  const doc = await load(base);
  const n = doc.getPageCount();
  const remove = new Set(indexes);
  if (remove.size >= n) throw new Error('A document needs at least one page.');
  for (const i of [...remove].sort((a, b) => b - a)) doc.removePage(i);
  const map = [];
  let next = 0;
  for (let i = 0; i < n; i++) map.push(remove.has(i) ? null : next++);
  return { bytes: await doc.save(), map };
}

/** Moves pages so they sit, in order, before the page now at 'target' (n = the end). */
export async function movePages(base, indexes, target) {
  const doc = await load(base);
  const n = doc.getPageCount();
  const moving = [...new Set(indexes)].sort((a, b) => a - b);
  const set = new Set(moving);
  const rest = identityMap(n).filter((i) => !set.has(i));
  const insertAt = rest.filter((i) => i < target).length;
  const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  if (order.every((v, i) => v === i)) return null;

  const pages = doc.getPages();
  for (let i = n - 1; i >= 0; i--) doc.removePage(i);
  order.forEach((old, i) => doc.insertPage(i, pages[old]));
  const map = new Array(n);
  order.forEach((old, i) => (map[old] = i));
  return { bytes: await doc.save(), map };
}

/**
 * Inserts all pages of another PDF before page 'at'. Markups and scales saved
 * in that file come along, re-numbered to their new pages.
 */
export async function insertPages(base, otherBytes, at) {
  const doc = await load(base);
  const n = doc.getPageCount();
  const other = await extractMarkups(otherBytes);
  if (!other.editable) throw new Error('That PDF is encrypted, so its pages cannot be inserted.');
  const src = await load(other.base);
  const copied = await doc.copyPages(src, src.getPageIndices());
  copied.forEach((page, i) => doc.insertPage(at + i, page));
  const count = copied.length;
  const map = identityMap(n).map((i) => (i < at ? i : i + count));
  const markups = other.markups.map((m) => ({ ...m, id: crypto.randomUUID(), page: m.page + at }));
  const scales = Object.fromEntries(Object.entries(other.scales).map(([k, v]) => [Number(k) + at, v]));
  return { bytes: await doc.save(), map, inserted: { markups, scales, count } };
}

/** A new PDF of just these pages, with their markups and scales. */
export async function extractPages(base, indexes, markups, scales) {
  const src = await load(base);
  const out = await PDFDocument.create();
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const copied = await out.copyPages(src, sorted);
  copied.forEach((p) => out.addPage(p));
  const newIndex = new Map(sorted.map((old, i) => [old, i]));
  const keptMarkups = markups.filter((m) => newIndex.has(m.page)).map((m) => ({ ...m, page: newIndex.get(m.page) }));
  const keptScales = Object.fromEntries(
    Object.entries(scales)
      .filter(([k]) => newIndex.has(Number(k)))
      .map(([k, v]) => [newIndex.get(Number(k)), v]),
  );
  return writeMarkups(await out.save(), keptMarkups, keptScales);
}

/** Applies a page map to markups and scales; pages mapped to null are dropped. */
export function remap(map, markups, scales) {
  const nextMarkups = markups.filter((m) => map[m.page] != null).map((m) => (map[m.page] === m.page ? m : { ...m, page: map[m.page] }));
  const nextScales = {};
  for (const [k, v] of Object.entries(scales)) {
    const to = map[Number(k)];
    if (to != null) nextScales[to] = v;
  }
  return { markups: nextMarkups, scales: nextScales };
}
