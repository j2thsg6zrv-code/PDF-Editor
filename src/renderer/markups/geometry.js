// Shape geometry shared by the on-screen layer and the PDF writer.
// All coordinates are PDF user space (points, y axis pointing up).
import { wrapText, textWidth } from './fonts.js';

export const TEXT_PADDING = 4;
export const LINE_HEIGHT = 1.2;
const ARROW_LENGTH = 4; // multiples of the line width, plus a minimum below
const KAPPA = 0.5523;

export function normRect([a, b]) {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

// The box part of a markup, for the types that have one.
export function boxOf(m) {
  if (m.type === 'callout') return normRect([m.points[1], m.points[2]]);
  return normRect([m.points[0], m.points[1]]);
}

export const BOX_TYPES = new Set(['rect', 'ellipse', 'cloud', 'text', 'callout', 'stamp']);
export const TEXT_TYPES = new Set(['text', 'callout']);
export const FILLABLE_TYPES = new Set(['rect', 'ellipse', 'cloud', 'text', 'callout']);

/** Bounding box [x1, y1, x2, y2] including stroke width and decorations. */
export function bounds(m) {
  let xs = m.points.map((p) => p[0]);
  let ys = m.points.map((p) => p[1]);
  let pad = (m.style.width || 0) / 2 + 1;
  if (m.type === 'arrow') pad += arrowSize(m.style.width);
  if (m.type === 'cloud') pad += cloudArc(m.style.width) / 2;
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function arrowSize(width) {
  return Math.max(8, width * ARROW_LENGTH + 4);
}

function cloudArc(width) {
  return Math.max(10, width * 4 + 6);
}

/**
 * Vector outline of a markup as a list of subpaths. Each subpath is
 * { segs: [['M',x,y] | ['L',x,y] | ['C',x1,y1,x2,y2,x,y] | ['Z']], fill: bool, stroke: bool }.
 */
export function outline(m) {
  const { style } = m;
  const filled = !!style.fill && FILLABLE_TYPES.has(m.type);
  switch (m.type) {
    case 'pen':
    case 'highlight':
      return [{ segs: polyline(m.points), stroke: true, fill: false }];
    case 'line':
      return [{ segs: polyline(m.points), stroke: true, fill: false }];
    case 'arrow': {
      const [a, b] = m.points;
      return [
        { segs: polyline([a, b]), stroke: true, fill: false },
        { segs: arrowHead(a, b, style.width), stroke: true, fill: false },
      ];
    }
    case 'rect':
      return [{ segs: rectPath(boxOf(m)), stroke: true, fill: filled }];
    case 'ellipse':
      return [{ segs: ellipsePath(boxOf(m)), stroke: true, fill: filled }];
    case 'cloud':
      return [{ segs: cloudPath(boxOf(m), style.width), stroke: true, fill: filled }];
    case 'text':
      return [{ segs: rectPath(boxOf(m)), stroke: style.width > 0, fill: filled }];
    case 'callout': {
      const box = boxOf(m);
      const tip = m.points[0];
      const anchor = nearestEdgeMidpoint(box, tip);
      return [
        { segs: polyline([anchor, tip]), stroke: true, fill: false },
        { segs: arrowHead(anchor, tip, style.width), stroke: true, fill: false },
        { segs: rectPath(box), stroke: style.width > 0, fill: filled },
      ];
    }
    case 'stamp':
      return [{ segs: roundRectPath(boxOf(m), 4), stroke: true, fill: false }];
    default:
      return [];
  }
}

export function nearestEdgeMidpoint([x1, y1, x2, y2], [tx, ty]) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const candidates = [
    [x1, cy],
    [x2, cy],
    [cx, y1],
    [cx, y2],
  ];
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c[0] - tx) ** 2 + (c[1] - ty) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function polyline(points) {
  return points.map((p, i) => [i === 0 ? 'M' : 'L', p[0], p[1]]);
}

function arrowHead(from, to, width) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = arrowSize(width);
  const spread = Math.tan(Math.PI / 7); // ~25 degrees each side
  const bx = to[0] - ux * size;
  const by = to[1] - uy * size;
  return [
    ['M', bx - uy * size * spread, by + ux * size * spread],
    ['L', to[0], to[1]],
    ['L', bx + uy * size * spread, by - ux * size * spread],
  ];
}

function rectPath([x1, y1, x2, y2]) {
  return [['M', x1, y1], ['L', x2, y1], ['L', x2, y2], ['L', x1, y2], ['Z']];
}

function roundRectPath([x1, y1, x2, y2], r) {
  r = Math.min(r, (x2 - x1) / 2, (y2 - y1) / 2);
  const k = r * (1 - KAPPA);
  return [
    ['M', x1 + r, y1],
    ['L', x2 - r, y1],
    ['C', x2 - k, y1, x2, y1 + k, x2, y1 + r],
    ['L', x2, y2 - r],
    ['C', x2, y2 - k, x2 - k, y2, x2 - r, y2],
    ['L', x1 + r, y2],
    ['C', x1 + k, y2, x1, y2 - k, x1, y2 - r],
    ['L', x1, y1 + r],
    ['C', x1, y1 + k, x1 + k, y1, x1 + r, y1],
    ['Z'],
  ];
}

function ellipsePath([x1, y1, x2, y2]) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2;
  const ry = (y2 - y1) / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
    ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
    ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
    ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
    ['Z'],
  ];
}

// Revision cloud: the rectangle's edges replaced by outward-bulging arcs.
function cloudPath([x1, y1, x2, y2], width) {
  const corners = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
  const target = cloudArc(width);
  const segs = [['M', x1, y1]];
  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / target));
    const dx = (b[0] - a[0]) / n;
    const dy = (b[1] - a[1]) / n;
    const segLen = Math.hypot(dx, dy) || 1;
    // Counter-clockwise traversal in y-up space: outward normal is (dy, -dx).
    const h = (4 / 3) * (segLen / 2);
    const nx = (dy / segLen) * h;
    const ny = (-dx / segLen) * h;
    for (let i = 0; i < n; i++) {
      const p0 = [a[0] + dx * i, a[1] + dy * i];
      const p1 = [a[0] + dx * (i + 1), a[1] + dy * (i + 1)];
      segs.push(['C', p0[0] + nx, p0[1] + ny, p1[0] + nx, p1[1] + ny, p1[0], p1[1]]);
    }
  }
  segs.push(['Z']);
  return segs;
}

export function segsToSvg(segs) {
  return segs
    .map((s) => (s[0] === 'Z' ? 'Z' : s[0] + s.slice(1).map((n) => +n.toFixed(2)).join(' ')))
    .join(' ');
}

/**
 * Text layout for text boxes, callouts and stamps.
 * Returns [{ text, x, y, size, bold }] with baselines in PDF space.
 */
export function textLines(m) {
  if (m.type === 'stamp') return stampLines(m);
  if (!TEXT_TYPES.has(m.type) || !m.text) return [];
  const [x1, , x2, y2] = boxOf(m);
  const size = m.style.fontSize;
  const maxWidth = Math.max(1, x2 - x1 - TEXT_PADDING * 2);
  return wrapText(m.text, size, maxWidth).map((text, i) => ({
    text,
    x: x1 + TEXT_PADDING,
    y: y2 - TEXT_PADDING - size * 0.85 - i * size * LINE_HEIGHT,
    size,
    bold: false,
  }));
}

/** Height a text box needs to show all of its text at its current width. */
export function fittedTextHeight(m) {
  const [x1, , x2] = boxOf(m);
  const size = m.style.fontSize;
  const count = Math.max(1, wrapText(m.text || '', size, Math.max(1, x2 - x1 - TEXT_PADDING * 2)).length);
  return count * size * LINE_HEIGHT + TEXT_PADDING * 2;
}

const STAMP_SIZE = 16;
const STAMP_SUB_SIZE = 7;
const STAMP_PAD_X = 10;
const STAMP_PAD_Y = 6;

function stampLines(m) {
  const [x1, y1, x2, y2] = boxOf(m);
  const cx = (x1 + x2) / 2;
  const lines = [
    { text: m.text, size: STAMP_SIZE, bold: true },
    { text: m.subtext || '', size: STAMP_SUB_SIZE, bold: false },
  ];
  const top = y2 - STAMP_PAD_Y;
  return lines.map((l, i) => ({
    ...l,
    x: cx - textWidth(l.text, l.size, l.bold) / 2,
    y: i === 0 ? top - STAMP_SIZE * 0.8 : y1 + STAMP_PAD_Y + 1,
  }));
}

/** Box for a stamp with this text, centred on a point. */
export function stampBox(text, subtext, [cx, cy]) {
  const w = Math.max(textWidth(text, STAMP_SIZE, true), textWidth(subtext, STAMP_SUB_SIZE, false)) + STAMP_PAD_X * 2;
  const h = STAMP_SIZE + STAMP_SUB_SIZE + STAMP_PAD_Y * 2 + 4;
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
  ];
}

export function translate(m, dx, dy) {
  return { ...m, points: m.points.map(([x, y]) => [x + dx, y + dy]) };
}
