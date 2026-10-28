// Helvetica metrics from pdf-lib, so text wraps identically on screen and in
// the saved PDF (whose appearance streams use the same standard fonts).
import { PDFDocument, StandardFonts } from '../../../node_modules/pdf-lib/dist/pdf-lib.esm.js';

const metricsDoc = await PDFDocument.create();
const regular = await metricsDoc.embedFont(StandardFonts.Helvetica);
const bold = await metricsDoc.embedFont(StandardFonts.HelveticaBold);
const supported = new Set(regular.getCharacterSet());

export const SCREEN_FONT = 'Helvetica, Arial, sans-serif';

/** Replaces characters the standard PDF fonts cannot encode. */
export function sanitize(text) {
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || supported.has(ch.codePointAt(0))) out += ch;
    else if (ch === '\t') out += '    ';
    else if (ch === '‘' || ch === '’') out += "'";
    else if (ch === '“' || ch === '”') out += '"';
    else out += '?';
  }
  return out;
}

export function textWidth(text, size, isBold = false) {
  return (isBold ? bold : regular).widthOfTextAtSize(sanitize(text || ''), size);
}

/** Word-wraps text to a width, keeping explicit line breaks. */
export function wrapText(text, size, maxWidth) {
  const lines = [];
  for (const para of sanitize(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const candidate = line + word;
      if (!line || textWidth(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
      // Break words longer than the whole line.
      while (line && textWidth(line, size) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), size) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
