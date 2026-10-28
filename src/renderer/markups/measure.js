// Page scales and measurement values.
//
// A scale is { metersPerPoint, system: 'imperial' | 'metric', label }: how many
// real-world meters one PDF point (1/72 inch on paper) stands for.

const INCH = 0.0254;
const POINTS_PER_INCH = 72;

/** Scale where 'paperInches' on the sheet represent 'realFeet' on site, e.g. 1/4" = 1'-0". */
function architectural(label, paperInches, realFeet = 1) {
  return { label, system: 'imperial', metersPerPoint: (realFeet * 12 * INCH) / (paperInches * POINTS_PER_INCH) };
}

function engineering(feetPerInch) {
  return { label: `1" = ${feetPerInch}'`, system: 'imperial', metersPerPoint: (feetPerInch * 12 * INCH) / POINTS_PER_INCH };
}

function metric(ratio) {
  return { label: `1:${ratio}`, system: 'metric', metersPerPoint: (ratio * INCH) / POINTS_PER_INCH };
}

export const PRESET_SCALES = [
  architectural('1/32" = 1\'-0"', 1 / 32),
  architectural('1/16" = 1\'-0"', 1 / 16),
  architectural('3/32" = 1\'-0"', 3 / 32),
  architectural('1/8" = 1\'-0"', 1 / 8),
  architectural('3/16" = 1\'-0"', 3 / 16),
  architectural('1/4" = 1\'-0"', 1 / 4),
  architectural('3/8" = 1\'-0"', 3 / 8),
  architectural('1/2" = 1\'-0"', 1 / 2),
  architectural('3/4" = 1\'-0"', 3 / 4),
  architectural('1" = 1\'-0"', 1),
  architectural('1 1/2" = 1\'-0"', 1.5),
  architectural('3" = 1\'-0"', 3),
  engineering(10),
  engineering(20),
  engineering(30),
  engineering(40),
  engineering(50),
  engineering(60),
  engineering(100),
  metric(1),
  metric(5),
  metric(10),
  metric(20),
  metric(50),
  metric(100),
  metric(200),
  metric(500),
  metric(1000),
];

/** Unscaled pages measure real paper size. */
export const PAPER_SCALE = { label: 'Not set (paper size)', system: 'imperial', metersPerPoint: INCH / POINTS_PER_INCH };

export const UNITS = {
  ft: { label: 'feet', meters: 0.3048, system: 'imperial' },
  in: { label: 'inches', meters: INCH, system: 'imperial' },
  m: { label: 'meters', meters: 1, system: 'metric' },
  cm: { label: 'centimeters', meters: 0.01, system: 'metric' },
  mm: { label: 'millimeters', meters: 0.001, system: 'metric' },
};

/** Scale from calibration: a line of 'points' on the page is 'length' 'unit' long in reality. */
export function calibratedScale(points, length, unit) {
  const u = UNITS[unit];
  const metersPerPoint = (length * u.meters) / points;
  return { label: `Calibrated (${formatLength(length * u.meters, u.system)} = ${(points / POINTS_PER_INCH).toFixed(2)}" on sheet)`, system: u.system, metersPerPoint };
}

export const MEASURE_TYPES = new Set(['length', 'polylength', 'area', 'perimeter', 'count']);

function polylineLength(points, closed = false) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 2) {
    const a = points[points.length - 1];
    total += Math.hypot(points[0][0] - a[0], points[0][1] - a[1]);
  }
  return total;
}

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** { value, unit, text } for a measurement markup at a page scale; null for other markups. */
export function measurement(m, scale) {
  if (!MEASURE_TYPES.has(m.type)) return null;
  const s = scale || PAPER_SCALE;
  switch (m.type) {
    case 'length':
    case 'polylength':
      return lengthResult(polylineLength(m.points) * s.metersPerPoint, s.system);
    case 'perimeter':
      return lengthResult(polylineLength(m.points, true) * s.metersPerPoint, s.system);
    case 'area': {
      const sqm = polygonArea(m.points) * s.metersPerPoint ** 2;
      if (s.system === 'imperial') {
        const sqft = sqm / 0.3048 ** 2;
        return { value: sqft, unit: 'sq ft', text: `${formatNumber(sqft)} sq ft` };
      }
      return { value: sqm, unit: 'm²', text: `${formatNumber(sqm)} m²` };
    }
    case 'count':
      return { value: m.points.length, unit: 'ea', text: `${m.points.length}` };
  }
  return null;
}

function lengthResult(meters, system) {
  if (system === 'imperial') {
    const feet = meters / 0.3048;
    return { value: feet, unit: 'ft', text: formatLength(meters, system) };
  }
  return { value: meters, unit: 'm', text: formatLength(meters, system) };
}

/** 12'-6 1/4" for imperial (to the nearest 1/16"), 3.25 m for metric. */
export function formatLength(meters, system) {
  if (system === 'metric') return meters < 1 ? `${Math.round(meters * 1000)} mm` : `${formatNumber(meters)} m`;
  const sixteenths = Math.round((meters / INCH) * 16);
  const feet = Math.floor(sixteenths / (12 * 16));
  const rem = sixteenths - feet * 12 * 16;
  const inches = Math.floor(rem / 16);
  let frac = rem % 16;
  let fracText = '';
  if (frac) {
    let den = 16;
    while (frac % 2 === 0) {
      frac /= 2;
      den /= 2;
    }
    fracText = ` ${frac}/${den}`;
  }
  const inchText = `${inches}${fracText}"`;
  return feet ? `${feet}'-${inchText}` : inchText;
}

function formatNumber(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n < 100 ? 2 : 0 });
}
