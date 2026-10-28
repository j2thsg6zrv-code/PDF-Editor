// The ribbon across the top of the window: tabs of large, labeled buttons in
// named groups, laid out like Bluebeam Revu's. Tool buttons carry data-tool
// (wired by MarkupUi); everything else carries data-command (wired by the app).
import { TOOLS } from './markup-ui.js';

const ICON = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  open: ICON('<path d="M1.5 4.5v8.5h11l2-6H4l-2 6"/><path d="M1.5 4.5V3h4l1.5 1.5h5V7"/>'),
  save: ICON('<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5v3.5h5.5V2.5M4.5 13.5V9h7v4.5"/>'),
  saveAs: ICON('<path d="M2.5 2.5h9l2 2v4M8 13.5H2.5v-11"/><path d="M5 2.5v3.5h5.5V2.5"/><path d="M10 14l.5-2 3-3 1.5 1.5-3 3z"/>'),
  undo: ICON('<path d="M5 3.5L2 6.5l3 3"/><path d="M2 6.5h7.5a4 4 0 010 8H6"/>'),
  redo: ICON('<path d="M11 3.5l3 3-3 3"/><path d="M14 6.5H6.5a4 4 0 000 8H10"/>'),
  thumbnails: ICON('<rect x="1.5" y="2" width="4" height="5"/><rect x="1.5" y="9" width="4" height="5"/><path d="M8 2.5h6.5v11H8z"/>'),
  list: ICON('<path d="M5.5 4h9M5.5 8h9M5.5 12h9"/><circle cx="2.5" cy="4" r=".7" fill="currentColor"/><circle cx="2.5" cy="8" r=".7" fill="currentColor"/><circle cx="2.5" cy="12" r=".7" fill="currentColor"/>'),
  find: ICON('<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5"/>'),
  zoomIn: ICON('<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4"/>'),
  zoomOut: ICON('<circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4.5 4.5M4.5 6.5h4"/>'),
  fitWidth: ICON('<rect x="3" y="2" width="10" height="12"/><path d="M1 8h14M3 8l1.5-1.5M3 8l1.5 1.5M13 8l-1.5-1.5M13 8l-1.5 1.5"/>'),
  fitPage: ICON('<rect x="4" y="2.5" width="8" height="11"/><path d="M1.5 1.5v3M1.5 1.5h3M14.5 1.5v3M14.5 1.5h-3M1.5 14.5v-3M1.5 14.5h3M14.5 14.5v-3M14.5 14.5h-3"/>'),
  actual: ICON('<rect x="2.5" y="2.5" width="11" height="11"/><path d="M5.5 6l1-1v6M9 6l1-1v6"/>'),
  rotateCcw: ICON('<path d="M3 3v3.5h3.5"/><path d="M3.3 6.3A5.5 5.5 0 1 1 3 9.5"/>'),
  rotateCw: ICON('<path d="M13 3v3.5H9.5"/><path d="M12.7 6.3A5.5 5.5 0 1 0 13 9.5"/>'),
  insert: ICON('<path d="M3 1.5h6.5l3 3V14.5H3z"/><path d="M7.75 6.5v6M4.75 9.5h6"/>'),
  extract: ICON('<path d="M9 14.5H3V1.5h6.5l3 3V8"/><path d="M10 11.5h5M13 9.5l2 2-2 2"/>'),
  trash: ICON('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 10h6.4L12 4M6.8 6.5v5M9.2 6.5v5"/>'),
  compare: ICON('<rect x="1.5" y="2.5" width="7" height="9" stroke="#f87171"/><rect x="7.5" y="4.5" width="7" height="9" stroke="#60a5fa"/>'),
  csv: ICON('<path d="M3 1.5h6.5l3 3V14.5H3z"/><path d="M5 7.5h5.5M5 10h5.5M5 12.5h5.5M7.7 7.5v5"/>'),
};

const tool = (id) => ({ tool: id });
const cmd = (command, label, icon, title, extra = {}) => ({ command, label, icon, title, ...extra });

const OPEN = cmd('open', 'Open', 'open', 'Open a PDF (⌘O)');
const SAVE = cmd('save', 'Save', 'save', 'Save (⌘S)', { needsDoc: true });
const SAVE_AS = cmd('save-as', 'Save As', 'saveAs', 'Save a copy (⇧⌘S)', { needsDoc: true });
const UNDO = cmd('undo', 'Undo', 'undo', 'Undo (⌘Z)', { needsDoc: true, id: 'btn-undo' });
const REDO = cmd('redo', 'Redo', 'redo', 'Redo (⇧⌘Z)', { needsDoc: true, id: 'btn-redo' });
const THUMBS = cmd('toggle-sidebar', 'Thumbnails', 'thumbnails', 'Show or hide page thumbnails (⌘T)', { toggle: true });
const LIST = cmd('toggle-markups-list', 'Markups List', 'list', 'Show or hide the Markups List (⌘L)', { toggle: true });
const FIND = cmd('find', 'Find', 'find', 'Find text (⌘F)', { needsDoc: true });

const QUICK_ACCESS = [OPEN, SAVE, UNDO, REDO];

export const RIBBON = [
  {
    id: 'home',
    label: 'Home',
    groups: [
      { label: 'File', items: [OPEN, SAVE, SAVE_AS] },
      { label: 'Edit', items: [UNDO, REDO] },
      { label: 'Navigate', items: [tool('select'), tool('hand')] },
      { label: 'Markup', items: [tool('pen'), tool('highlight'), tool('text'), tool('callout'), tool('cloud'), tool('stamp')] },
      { label: 'Measure', items: [tool('length'), tool('area'), tool('count')] },
      { label: 'Panels', items: [THUMBS, LIST, FIND] },
    ],
  },
  {
    id: 'markup',
    label: 'Markup',
    groups: [
      { label: 'Navigate', items: [tool('select'), tool('hand')] },
      { label: 'Draw', items: [tool('pen'), tool('highlight'), tool('line'), tool('arrow')] },
      { label: 'Shapes', items: [tool('rect'), tool('ellipse'), tool('cloud')] },
      { label: 'Text', items: [tool('text'), tool('callout')] },
      { label: 'Stamp', items: [tool('stamp')] },
      { label: 'Edit', items: [UNDO, REDO] },
    ],
  },
  {
    id: 'measure',
    label: 'Measure',
    groups: [
      { label: 'Scale', items: [tool('calibrate')] },
      { label: 'Measure', items: [tool('length'), tool('polylength'), tool('area'), tool('perimeter'), tool('count')] },
      { label: 'Takeoff', items: [LIST, cmd('export-csv', 'Export CSV', 'csv', 'Export the Markups List for Excel', { needsDoc: true })] },
    ],
  },
  {
    id: 'document',
    label: 'Document',
    groups: [
      {
        label: 'Pages',
        items: [
          cmd('rotate-ccw', 'Rotate Left', 'rotateCcw', 'Rotate the selected pages counterclockwise (⇧⌘R)', { needsDoc: true }),
          cmd('rotate-cw', 'Rotate Right', 'rotateCw', 'Rotate the selected pages clockwise (⌘R)', { needsDoc: true }),
          cmd('insert-pages', 'Insert', 'insert', 'Insert pages from another PDF after the page in view', { needsDoc: true }),
          cmd('extract-pages', 'Extract', 'extract', 'Save the selected pages as a new PDF', { needsDoc: true }),
          cmd('delete-pages', 'Delete', 'trash', 'Delete the selected pages', { needsDoc: true }),
        ],
      },
      { label: 'Revisions', items: [cmd('compare', 'Compare', 'compare', 'Compare two versions of a document')] },
      { label: 'Panels', items: [THUMBS] },
    ],
  },
  {
    id: 'view',
    label: 'View',
    groups: [
      {
        label: 'Zoom',
        items: [
          cmd('zoom-in', 'Zoom In', 'zoomIn', 'Zoom in (⌘=)', { needsDoc: true }),
          cmd('zoom-out', 'Zoom Out', 'zoomOut', 'Zoom out (⌘−)', { needsDoc: true }),
          cmd('zoom-fit-width', 'Fit Width', 'fitWidth', 'Fit the page width (⌘2)', { needsDoc: true }),
          cmd('zoom-fit-page', 'Fit Page', 'fitPage', 'Fit the whole page (⌘1)', { needsDoc: true }),
          cmd('zoom-actual', 'Actual Size', 'actual', 'Actual size (⌘0)', { needsDoc: true }),
        ],
      },
      { label: 'Panels', items: [THUMBS, LIST, FIND] },
    ],
  },
];

const STORE_KEY = 'redline.ribbonTab';

/** Builds the ribbon into its header. onCommand(command) runs a data-command button. */
export function buildRibbon(onCommand) {
  const tabsEl = document.getElementById('ribbon-tabs');
  const panelEl = document.getElementById('ribbon-panel');
  const usedIds = new Set();

  // Quick access: always-visible small buttons, like Revu's quick access toolbar.
  const quick = document.getElementById('quick-access');
  for (const item of QUICK_ACCESS) {
    const b = button(item, usedIds, onCommand);
    b.className = 'qa-btn';
    b.setAttribute('aria-label', item.label);
    quick.append(b);
  }
  let current = RIBBON[0].id;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (RIBBON.some((t) => t.id === saved)) current = saved;
  } catch {
    // No saved tab.
  }

  for (const tab of RIBBON) {
    const tabBtn = document.createElement('button');
    tabBtn.className = 'ribbon-tab';
    tabBtn.dataset.ribbonTab = tab.id;
    tabBtn.textContent = tab.label;
    tabBtn.setAttribute('role', 'tab');
    tabBtn.addEventListener('click', () => show(tab.id));
    tabsEl.append(tabBtn);

    const page = document.createElement('div');
    page.className = 'ribbon-page';
    page.dataset.ribbonPage = tab.id;
    page.setAttribute('role', 'tabpanel');
    for (const group of tab.groups) {
      const g = document.createElement('div');
      g.className = 'ribbon-group';
      const items = document.createElement('div');
      items.className = 'ribbon-items';
      for (const item of group.items) items.append(button(item, usedIds, onCommand));
      const caption = document.createElement('div');
      caption.className = 'ribbon-caption';
      caption.textContent = group.label;
      g.append(items, caption);
      page.append(g);
    }
    panelEl.append(page);
  }

  function show(id) {
    current = id;
    for (const b of tabsEl.querySelectorAll('.ribbon-tab')) b.setAttribute('aria-selected', String(b.dataset.ribbonTab === id));
    for (const p of panelEl.querySelectorAll('.ribbon-page')) p.hidden = p.dataset.ribbonPage !== id;
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      // Not remembered; that's fine.
    }
  }
  show(current);
}

/** Shows a toggle command (thumbnails, Markups List) as on or off everywhere it appears. */
export function setToggle(command, on) {
  for (const b of document.querySelectorAll(`[data-command="${command}"]`)) b.setAttribute('aria-pressed', String(on));
}

function button(item, usedIds, onCommand) {
  const b = document.createElement('button');
  b.className = 'rb-btn';
  if (item.tool) {
    const t = TOOLS.find((x) => x.id === item.tool);
    b.dataset.tool = t.id;
    b.dataset.needsDoc = '';
    b.innerHTML = `${t.icon}<span>${t.ribbonLabel ?? t.label}</span>`;
    return b;
  }
  // An id can only appear once in the page; later copies are found by data-command.
  if (item.id && !usedIds.has(item.id)) {
    b.id = item.id;
    usedIds.add(item.id);
  } else if (item.id) {
    b.dataset.mirror = item.id;
  }
  b.dataset.command = item.command;
  if (item.needsDoc) b.dataset.needsDoc = '';
  if (item.toggle) b.setAttribute('aria-pressed', 'false');
  b.title = item.title;
  b.innerHTML = `${ICONS[item.icon]}<span>${item.label}</span>`;
  b.addEventListener('click', () => onCommand(item.command));
  return b;
}
