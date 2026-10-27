// Loads pdf.js and its viewer components. The viewer bundle reads the core
// library from globalThis.pdfjsLib, so it has to be imported second.
import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).href;
globalThis.pdfjsLib = pdfjsLib;

const viewerLib = await import('../../node_modules/pdfjs-dist/web/pdf_viewer.mjs');

export { pdfjsLib, viewerLib };
