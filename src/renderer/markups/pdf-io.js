// Reading and writing markups as real PDF annotations.
//
// Each markup becomes a standard annotation (Ink, Line, Square, Circle,
// FreeText, Stamp) with its own appearance stream, so any PDF reader shows it.
// The annotation also carries our editable copy of the markup under a private
// key; on open, those annotations are lifted back out into the markup layer.
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
  PDFHexString,
  StandardFonts,
} from '../../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
import { outline, textLines, boxOf, bounds, nearestEdgeMidpoint } from './geometry.js';
import { measurement } from './measure.js';
import { sanitize } from './fonts.js';

const MARKUP_KEY = PDFName.of('PDFEditorMarkup');
const SCALES_KEY = PDFName.of('PDFEditorScales');
const MARKUP_FORMAT = 1;

/**
 * Splits a PDF into the document without our annotations (what the viewer
 * renders underneath the markup layer) and the markups themselves.
 */
export async function extractMarkups(bytes) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { base: bytes, markups: [], scales: {}, editable: false };
  }
  if (doc.isEncrypted) return { base: bytes, markups: [], scales: {}, editable: false };

  // Page scales live in the document catalog.
  let scales = {};
  const rawScales = doc.catalog.lookup(SCALES_KEY);
  if (rawScales instanceof PDFString || rawScales instanceof PDFHexString) {
    try {
      const data = JSON.parse(rawScales.decodeText());
      if (data.v === MARKUP_FORMAT) scales = data.scales || {};
    } catch {
      // Unreadable scales: start uncalibrated.
    }
    doc.catalog.delete(SCALES_KEY);
  }

  const markups = [];
  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const raw = annot?.lookup(MARKUP_KEY);
      if (!(raw instanceof PDFString || raw instanceof PDFHexString)) continue;
      try {
        const data = JSON.parse(raw.decodeText());
        if (data.v !== MARKUP_FORMAT) continue;
        markups.push({ ...data.markup, page: pageIndex });
        annots.remove(i);
      } catch {
        // Not ours after all, or damaged: leave it for the viewer to draw.
      }
    }
  });

  if (!markups.length && !rawScales) return { base: bytes, markups, scales, editable: true };
  markups.sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  return { base: await doc.save(), markups, scales, editable: true };
}

/** Writes markups into a copy of the base PDF and returns the new bytes. */
export async function writeMarkups(baseBytes, markups, scales = {}) {
  const doc = await PDFDocument.load(baseBytes, { updateMetadata: false });
  if (Object.keys(scales).length) {
    doc.catalog.set(SCALES_KEY, PDFHexString.fromText(JSON.stringify({ v: MARKUP_FORMAT, scales })));
  }
  const fonts = {
    F1: await doc.embedFont(StandardFonts.Helvetica),
    F2: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const pages = doc.getPages();
  for (const m of markups) {
    const page = pages[m.page];
    if (!page) continue;
    const ref = doc.context.register(buildAnnotation(doc, page, m, fonts, scales[m.page] ?? null));
    page.node.addAnnot(ref);
  }
  return doc.save();
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const num = (n) => +n.toFixed(3);

function buildAnnotation(doc, page, m, fonts, pageScale) {
  const { context } = doc;
  const rect = bounds(m, pageScale).map(num);
  const color = rgb(m.style.color);
  const opacity = m.style.opacity ?? 1;
  const fillOpacity = opacity * (m.style.fillOpacity ?? 1);
  const value = measurement(m, pageScale);

  const ap = context.stream(appearance(m, fonts, pageScale), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: {
      ExtGState: {
        GS0: { Type: 'ExtGState', CA: opacity, ca: opacity },
        GS1: { Type: 'ExtGState', CA: opacity, ca: fillOpacity },
      },
      Font: { F1: fonts.F1.ref, F2: fonts.F2.ref },
    },
  });

  const dict = {
    Type: 'Annot',
    Subtype: SUBTYPES[m.type],
    Rect: rect,
    P: page.ref,
    F: 4, // print
    NM: PDFHexString.fromText(m.id),
    T: PDFHexString.fromText(m.author || ''),
    M: PDFString.fromDate(new Date(m.modified || Date.now())),
    Contents: PDFHexString.fromText(value ? value.text : m.text || ''),
    C: color,
    CA: opacity,
    BS: { W: m.style.width, S: 'S' },
    AP: { N: context.register(ap) },
  };

  const pts = m.points.map(([x, y]) => [num(x), num(y)]);
  switch (m.type) {
    case 'pen':
    case 'highlight':
      dict.InkList = [pts.flat()];
      break;
    case 'line':
    case 'arrow':
      dict.L = pts.flat();
      dict.LE = ['None', m.type === 'arrow' ? 'OpenArrow' : 'None'];
      break;
    case 'rect':
    case 'ellipse':
    case 'cloud':
      if (m.style.fill) dict.IC = rgb(m.style.fill);
      if (m.type === 'cloud') dict.BE = { S: 'C', I: 1 };
      break;
    case 'text':
    case 'callout': {
      const [r, g, b] = color;
      dict.DA = PDFString.of(`/Helv ${m.style.fontSize} Tf ${r} ${g} ${b} rg`);
      if (m.style.fill) dict.IC = rgb(m.style.fill);
      if (m.type === 'callout') {
        const anchor = nearestEdgeMidpoint(boxOf(m), m.points[0]);
        dict.IT = 'FreeTextCallout';
        dict.CL = [...pts[0], ...anchor.map(num)];
        dict.LE = 'OpenArrow';
      }
      break;
    }
    case 'stamp':
      dict.Name = 'Draft';
      break;
    case 'length':
      dict.L = pts.flat();
      dict.LE = ['Butt', 'Butt'];
      dict.IT = 'LineDimension';
      break;
    case 'polylength':
      dict.Vertices = pts.flat();
      dict.IT = 'PolyLineDimension';
      break;
    case 'area':
    case 'perimeter':
      dict.Vertices = pts.flat();
      dict.IT = m.type === 'area' ? 'PolygonDimension' : 'PolyLineDimension';
      if (m.style.fill) dict.IC = rgb(m.style.fill);
      break;
    case 'count':
      dict.InkList = pts.map((p) => p);
      break;
  }

  const obj = context.obj(dict);
  obj.set(MARKUP_KEY, PDFHexString.fromText(JSON.stringify({ v: MARKUP_FORMAT, markup: { ...m, page: undefined } })));
  return obj;
}

const SUBTYPES = {
  pen: 'Ink',
  highlight: 'Ink',
  line: 'Line',
  arrow: 'Line',
  rect: 'Square',
  ellipse: 'Circle',
  cloud: 'Square',
  text: 'FreeText',
  callout: 'FreeText',
  stamp: 'Stamp',
  length: 'Line',
  polylength: 'PolyLine',
  area: 'Polygon',
  perimeter: 'Polygon',
  count: 'Ink',
};

function appearance(m, fonts, pageScale) {
  const { style } = m;
  const [sr, sg, sb] = rgb(style.color);
  const ops = ['q', `${num(style.width || 0)} w`, '1 J', '1 j', `${sr} ${sg} ${sb} RG`];
  if (m.type === 'highlight') ops.push('0 J');

  for (const sub of outline(m)) {
    // Shape fills use the style's fill opacity (GS1); solid markers like count dots don't (GS0).
    const fillColor = sub.fillColor || style.fill;
    ops.push(sub.fillColor ? '/GS0 gs' : '/GS1 gs');
    if (fillColor) {
      const [r, g, b] = rgb(fillColor);
      ops.push(`${r} ${g} ${b} rg`);
    }
    for (const s of sub.segs) {
      if (s[0] === 'M') ops.push(`${num(s[1])} ${num(s[2])} m`);
      else if (s[0] === 'L') ops.push(`${num(s[1])} ${num(s[2])} l`);
      else if (s[0] === 'C') ops.push(`${s.slice(1).map(num).join(' ')} c`);
      else ops.push('h');
    }
    const fill = sub.fill && (sub.fillColor || style.fill);
    const stroke = sub.stroke && style.width > 0;
    ops.push(fill && stroke ? 'B' : fill ? 'f' : stroke ? 'S' : 'n');
  }

  const lines = textLines(m, pageScale);
  if (lines.length) {
    ops.push('/GS0 gs', `${sr} ${sg} ${sb} rg`, 'BT');
    for (const l of lines) {
      const font = l.bold ? fonts.F2 : fonts.F1;
      ops.push(`/${l.bold ? 'F2' : 'F1'} ${l.size} Tf`, `1 0 0 1 ${num(l.x)} ${num(l.y)} Tm`, `${font.encodeText(sanitize(l.text))} Tj`);
    }
    ops.push('ET');
  }
  ops.push('Q');
  return ops.join('\n');
}
