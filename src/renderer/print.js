// Printing: the document is written out with its markups baked in as PDF
// annotations (the same bytes Save would write), each page is drawn to an image
// with pdf.js, and the images are laid out one per sheet for the system print
// dialog, which scales them to the paper the user picks.
import { pdfjsLib } from './pdfjs.js';
import { writeMarkups } from './markups/pdf-io.js';

// Sharp enough for text on small pages without huge images for large sheets.
const MAX_DPI = 300;
const MAX_PIXELS = 16_000_000;

let printing = false;

/**
 * Prints a document tab with its markups. onProgress(done, total) reports pages
 * prepared; isCancelled() is checked between pages.
 */
export async function printTab(tab, { onProgress = () => {}, isCancelled = () => false } = {}) {
  if (printing || !tab?.pdf || tab.kind === 'compare') return false;
  printing = true;
  const root = document.createElement('div');
  root.id = 'print-root';
  const style = document.createElement('style');
  const urls = [];
  let pdf = null;
  try {
    tab.markups.commitEditing();
    // Encrypted files can't carry markups, so they print as they are.
    const bytes = tab.editable ? await writeMarkups(tab.base, tab.store.all, tab.store.scales) : tab.base.slice();
    pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

    // Chromium prints every sheet at one paper size, so the sheets take the most
    // common page size in the document and other pages are scaled (and turned, if
    // their orientation differs) to fit it. The print dialog then fits that to the paper.
    const pages = [];
    const counts = new Map();
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 }); // points, with the page's rotation
      pages.push({ page, width, height });
      const key = `${round(width)}x${round(height)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [sheetW, sheetH] = [...counts].sort((a, b) => b[1] - a[1])[0][0].split('x').map(Number);
    const sheetLandscape = sheetW > sheetH;
    style.textContent = `@page { size: ${sheetW}pt ${sheetH}pt; margin: 0; }`;

    for (const [i, { page, width, height }] of pages.entries()) {
      if (isCancelled()) return false;
      onProgress(i, pages.length);
      const turn = width !== height && width > height !== sheetLandscape;
      const dpi = Math.min(MAX_DPI, Math.sqrt(MAX_PIXELS / ((width / 72) * (height / 72))));
      const viewport = page.getViewport({ scale: dpi / 72, rotation: (page.rotate + (turn ? 90 : 0)) % 360 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: ctx,
        viewport,
        intent: 'print',
        annotationMode: pdfjsLib.AnnotationMode.ENABLE,
      }).promise;
      page.cleanup();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      canvas.width = canvas.height = 0; // free the pixels now, not at the next GC
      const url = URL.createObjectURL(blob);
      urls.push(url);

      const sheet = document.createElement('div');
      sheet.className = 'print-sheet';
      sheet.style.width = `${sheetW}pt`;
      sheet.style.height = `${sheetH}pt`;
      const img = new Image();
      img.src = url;
      sheet.append(img);
      root.append(sheet);
    }
    onProgress(pages.length, pages.length);

    document.head.append(style);
    document.body.append(root);
    await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    if (isCancelled()) return false;
    return await window.desktop.print();
  } finally {
    root.remove();
    style.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    pdf?.destroy();
    printing = false;
  }
}

function round(points) {
  return Math.round(points * 100) / 100;
}
