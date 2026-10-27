import { DocumentTab } from './document-tab.js';

const $ = (id) => document.getElementById(id);

const els = {
  viewers: $('viewers'),
  sidebar: $('sidebar'),
  tabbar: $('tabbar'),
  welcome: $('welcome'),
  pageNumber: $('page-number'),
  pageCount: $('page-count'),
  zoomSelect: $('zoom-select'),
  findbar: $('findbar'),
  findInput: $('find-input'),
  findCase: $('find-case'),
  findWord: $('find-word'),
  findStatus: $('find-status'),
  statusFile: $('status-file'),
  statusSize: $('status-size'),
};

const tabs = [];
let activeTab = null;
let tool = 'select';

// ---------- Opening documents ----------

async function openFile(file) {
  // Re-opening a file that is already open just switches to it.
  const existing = file.path && tabs.find((t) => t.path === file.path);
  if (existing) {
    activateTab(existing);
    return;
  }

  const tab = new DocumentTab({ ...file, viewersEl: els.viewers, sidebarEl: els.sidebar });
  tabs.push(tab);
  wireTabEvents(tab);
  activateTab(tab);
  try {
    await tab.load();
  } catch (err) {
    closeTab(tab);
    alert(`Could not open ${file.name}.\n\n${err.message}`);
    return;
  }
  if (tab === activeTab) updateToolbar();
window.desktop.ready();
}

function wireTabEvents(tab) {
  tab.eventBus.on('pagechanging', () => tab === activeTab && updatePageControls());
  tab.eventBus.on('pagesinit', () => tab === activeTab && updateToolbar());
  tab.eventBus.on('scalechanging', () => tab === activeTab && updateZoomControl());
  tab.eventBus.on('updatefindmatchescount', ({ matchesCount }) => tab === activeTab && showFindCount(matchesCount));
  tab.eventBus.on('updatefindcontrolstate', ({ state, matchesCount }) => tab === activeTab && showFindState(state, matchesCount));
  wireViewerInput(tab);
}

// ---------- Tabs ----------

function activateTab(tab) {
  activeTab = tab;
  for (const t of tabs) t.show(t === tab);
  renderTabbar();
  updateToolbar();
window.desktop.ready();
  applyTool();
  els.findStatus.textContent = '';
  if (tab) {
    tab.container.focus({ preventScroll: true });
    if (!els.findbar.hidden && els.findInput.value) runFind('');
  }
}

async function closeTab(tab) {
  const index = tabs.indexOf(tab);
  if (index === -1) return;
  tabs.splice(index, 1);
  if (tab === activeTab) activateTab(tabs[Math.min(index, tabs.length - 1)] ?? null);
  else renderTabbar();
  await tab.destroy();
}

function renderTabbar() {
  els.tabbar.replaceChildren(
    ...tabs.map((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab === activeTab ? ' active' : '');
      el.title = tab.path || tab.name;
      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.name;
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = 'Close tab (⌘W)';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab);
      });
      el.append(name, close);
      el.addEventListener('mousedown', (e) => {
        if (e.button === 0 && e.target !== close && tab !== activeTab) activateTab(tab);
      });
      el.addEventListener('auxclick', (e) => e.button === 1 && closeTab(tab));
      return el;
    }),
  );
}

function cycleTab(delta) {
  if (tabs.length < 2) return;
  const index = (tabs.indexOf(activeTab) + delta + tabs.length) % tabs.length;
  activateTab(tabs[index]);
}

// ---------- Toolbar state ----------

function updateToolbar() {
  const hasDoc = !!activeTab?.pdf;
  document.body.classList.toggle('no-doc', !hasDoc);
  els.welcome.hidden = tabs.length > 0;
  document.title = activeTab ? `${activeTab.name} — PDF Editor` : 'PDF Editor';
  els.statusFile.textContent = activeTab ? activeTab.path || activeTab.name : '';
  els.statusSize.textContent = activeTab ? formatBytes(activeTab.size) : '';
  updatePageControls();
  updateZoomControl();
}

function updatePageControls() {
  const count = activeTab?.pageCount ?? 0;
  els.pageNumber.max = String(Math.max(count, 1));
  els.pageNumber.value = String(count ? activeTab.viewer.currentPageNumber : 1);
  els.pageCount.textContent = `/ ${count}`;
}

function updateZoomControl() {
  if (!activeTab?.pdf) return;
  const { currentScaleValue, currentScale } = activeTab.viewer;
  const preset = [...els.zoomSelect.options].find((o) => !o.hidden && o.value === String(currentScaleValue));
  if (preset) {
    els.zoomSelect.value = preset.value;
  } else {
    const custom = els.zoomSelect.querySelector('option[value="custom"]');
    custom.textContent = `${Math.round(currentScale * 100)}%`;
    els.zoomSelect.value = 'custom';
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- Navigation and zoom ----------

function goToPage(n) {
  if (!activeTab?.pdf) return;
  const page = Math.min(Math.max(1, Math.round(n) || 1), activeTab.pageCount);
  activeTab.viewer.currentPageNumber = page;
  updatePageControls();
}

function setZoom(value) {
  if (!activeTab?.pdf) return;
  activeTab.viewer.currentScaleValue = value;
}

function zoomBy(steps) {
  if (!activeTab?.pdf) return;
  if (steps > 0) activeTab.viewer.increaseScale();
  else activeTab.viewer.decreaseScale();
}

// ---------- Tools: select text and pan ----------

function setTool(name) {
  tool = name;
  applyTool();
}

function applyTool() {
  $('btn-tool-select').classList.toggle('active', tool === 'select');
  $('btn-tool-hand').classList.toggle('active', tool === 'hand');
  for (const t of tabs) t.container.classList.toggle('hand', tool === 'hand' || spaceHeld);
}

let spaceHeld = false;

function wireViewerInput(tab) {
  const c = tab.container;
  let pan = null;

  c.addEventListener('mousedown', (e) => {
    const panning = (tool === 'hand' || spaceHeld) && e.button === 0;
    if (!panning && e.button !== 1) return; // middle button always pans
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY, left: c.scrollLeft, top: c.scrollTop };
    c.classList.add('panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!pan) return;
    c.scrollLeft = pan.left - (e.clientX - pan.x);
    c.scrollTop = pan.top - (e.clientY - pan.y);
  });
  window.addEventListener('mouseup', () => {
    if (!pan) return;
    pan = null;
    c.classList.remove('panning');
  });

  // Pinch on a trackpad (reported as ctrl+wheel) or ⌘/ctrl+scroll zooms around the pointer.
  c.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      tab.viewer.updateScale({ scaleFactor: factor, origin: [e.clientX, e.clientY], drawingDelay: 300 });
    },
    { passive: false },
  );
}

// ---------- Find ----------

function openFind() {
  if (!activeTab?.pdf) return;
  els.findbar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
}

function closeFind() {
  els.findbar.hidden = true;
  els.findStatus.textContent = '';
  for (const t of tabs) t.eventBus.dispatch('findbarclose', { source: null });
  activeTab?.container.focus({ preventScroll: true });
}

function runFind(type, findPrevious = false) {
  if (!activeTab?.pdf) return;
  activeTab.eventBus.dispatch('find', {
    source: null,
    type,
    query: els.findInput.value,
    caseSensitive: els.findCase.checked,
    entireWord: els.findWord.checked,
    highlightAll: true,
    findPrevious,
    matchDiacritics: false,
  });
}

function showFindCount({ current, total }) {
  if (!els.findInput.value) els.findStatus.textContent = '';
  else if (total) els.findStatus.textContent = `${current} of ${total}`;
}

function showFindState(state, matchesCount) {
  // FindState: 0 found, 1 not found, 2 wrapped, 3 pending
  if (!els.findInput.value) els.findStatus.textContent = '';
  else if (state === 1) els.findStatus.textContent = 'No matches';
  else if (state === 3) els.findStatus.textContent = 'Searching…';
  else showFindCount(matchesCount);
}

// ---------- Wiring ----------

$('btn-open').addEventListener('click', () => window.desktop.openDialog());
$('btn-open-welcome').addEventListener('click', () => window.desktop.openDialog());
$('btn-sidebar').addEventListener('click', toggleSidebar);
$('btn-tool-select').addEventListener('click', () => setTool('select'));
$('btn-tool-hand').addEventListener('click', () => setTool('hand'));
$('btn-prev-page').addEventListener('click', () => activeTab?.viewer.previousPage());
$('btn-next-page').addEventListener('click', () => activeTab?.viewer.nextPage());
$('btn-zoom-in').addEventListener('click', () => zoomBy(1));
$('btn-zoom-out').addEventListener('click', () => zoomBy(-1));
$('btn-find').addEventListener('click', openFind);

els.pageNumber.addEventListener('change', () => goToPage(Number(els.pageNumber.value)));
els.pageNumber.addEventListener('keydown', (e) => e.key === 'Enter' && els.pageNumber.blur());
els.zoomSelect.addEventListener('change', () => {
  if (els.zoomSelect.value !== 'custom') setZoom(els.zoomSelect.value);
});

els.findInput.addEventListener('input', () => runFind(''));
els.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runFind('again', e.shiftKey);
  } else if (e.key === 'Escape') {
    closeFind();
  }
});
$('find-next').addEventListener('click', () => runFind('again'));
$('find-prev').addEventListener('click', () => runFind('again', true));
$('find-close').addEventListener('click', closeFind);
els.findCase.addEventListener('change', () => runFind('casesensitivitychange'));
els.findWord.addEventListener('change', () => runFind('entirewordchange'));

function toggleSidebar() {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  $('btn-sidebar').setAttribute('aria-pressed', String(!hidden));
}

function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !spaceHeld) {
    spaceHeld = true;
    applyTool();
    e.preventDefault();
  } else if (e.key === 'h' || e.key === 'H') {
    setTool('hand');
  } else if (e.key === 'v' || e.key === 'V') {
    setTool('select');
  } else if (e.key === 'Escape' && !els.findbar.hidden) {
    closeFind();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    applyTool();
  }
});
window.addEventListener('blur', () => {
  spaceHeld = false;
  applyTool();
});

window.desktop.onFileOpened(openFile);
window.desktop.onMenuCommand((command) => {
  switch (command) {
    case 'zoom-in': return zoomBy(1);
    case 'zoom-out': return zoomBy(-1);
    case 'zoom-actual': return setZoom('1');
    case 'zoom-fit-width': return setZoom('page-width');
    case 'zoom-fit-page': return setZoom('page-fit');
    case 'toggle-sidebar': return toggleSidebar();
    case 'find': return openFind();
    case 'close-tab': return activeTab && closeTab(activeTab);
    case 'next-tab': return cycleTab(1);
    case 'prev-tab': return cycleTab(-1);
  }
});

// Drag and drop PDFs from Finder onto the window.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  for (const file of e.dataTransfer.files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    const path = window.desktop.pathForFile(file);
    if (path) openFile(await window.desktop.readFile(path));
    else openFile({ name: file.name, path: '', data: new Uint8Array(await file.arrayBuffer()) });
  }
});

updateToolbar();
window.desktop.ready();
