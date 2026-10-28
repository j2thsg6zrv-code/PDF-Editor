import { DocumentTab } from './document-tab.js';
import { MarkupUi } from './markup-ui.js';
import { MarkupsList } from './markups-list.js';
import { PAPER_SCALE } from './markups/measure.js';
import { newId } from './markups/store.js';
import { CompareTab } from './compare.js';

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
const markupsList = new MarkupsList({ activeTab: () => activeTab });
const markupUi = new MarkupUi({
  activeTab: () => activeTab,
  onToolChange: () => applyTool(),
  onSelectionChange: () => markupsList.render(),
});
const NON_DRAW_TOOLS = new Set(['select', 'hand']);

// ---------- Opening documents ----------

async function openFile(file) {
  // Re-opening a file that is already open just switches to it.
  const existing = file.path && tabs.find((t) => t.path === file.path);
  if (existing) {
    activateTab(existing);
    return existing;
  }

  const tab = new DocumentTab({ ...file, viewersEl: els.viewers, sidebarEl: els.sidebar, markupUi });
  tabs.push(tab);
  wireTabEvents(tab);
  activateTab(tab);
  try {
    await tab.load();
  } catch (err) {
    closeTab(tab, { force: true });
    window.desktop.showError('Could not open file', `${file.name}\n\n${err.message}`);
    return null;
  }
  tab.store.onChange((_pages, { scales }) => {
    renderTabbar();
    updateUndoButtons();
    if (tab !== activeTab) return;
    markupsList.render();
    if (scales) {
      updateScaleStatus();
      markupUi.refresh();
    }
  });
  if (tab === activeTab) {
    updateToolbar();
    markupUi.refresh();
    if (!els.findbar.hidden && els.findInput.value) runFind('');
  }
  return tab;
}

// ---------- Saving ----------

async function save(tab, { saveAs = false } = {}) {
  if (!tab?.pdf) return false;
  let target = tab.path;
  if (saveAs || !target) {
    target = await window.desktop.saveAsDialog(tab.path || tab.name);
    if (!target) return false;
  }
  try {
    await tab.save(target);
  } catch (err) {
    await window.desktop.showError('Could not save', `${tab.name}\n\n${err.message}`);
    return false;
  }
  renderTabbar();
  updateToolbar();
  return true;
}

/** Asks about unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(tab) {
  if (!tab.dirty) return true;
  activateTab(tab);
  const answer = await window.desktop.askUnsaved(tab.name);
  if (answer === 'save') return save(tab);
  return answer === 'discard';
}

window.desktop.onRequestClose(async () => {
  for (const tab of [...tabs]) {
    if (!(await confirmDiscard(tab))) {
      window.desktop.cancelClose();
      return;
    }
  }
  window.desktop.confirmClose();
});

// ---------- Undo ----------

function undo(redo = false) {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'range')) {
    document.execCommand(redo ? 'redo' : 'undo');
    return;
  }
  const store = activeTab?.store;
  if (!store) return;
  activeTab.markups.commitEditing();
  if (redo) store.redo();
  else store.undo();
}

function updateUndoButtons() {
  $('btn-undo').disabled = !activeTab?.store?.canUndo;
  $('btn-redo').disabled = !activeTab?.store?.canRedo;
}

function wireTabEvents(tab) {
  tab.eventBus.on('pagechanging', () => {
    if (tab !== activeTab) return;
    updatePageControls();
    updateScaleStatus();
    markupUi.refresh();
    if (document.getElementById('ml-page-only').checked) markupsList.render();
  });
  tab.eventBus.on('pagesinit', () => tab === activeTab && updateToolbar());
  tab.eventBus.on('documentreloaded', () => tab === activeTab && updateToolbar());
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
  applyTool();
  markupUi.refresh();
  markupsList.render();
  els.findStatus.textContent = '';
  if (tab) {
    tab.container.focus({ preventScroll: true });
    if (!els.findbar.hidden && els.findInput.value) runFind('');
  }
}

async function closeTab(tab, { force = false } = {}) {
  if (!tabs.includes(tab)) return;
  if (!force && !(await confirmDiscard(tab))) return;
  const index = tabs.indexOf(tab);
  if (index === -1) return;
  tabs.splice(index, 1);
  if (tab === activeTab) activateTab(tabs[Math.min(index, tabs.length - 1)] ?? null);
  else renderTabbar();
  await tab.destroy();
  // A comparison can't outlive either of its documents.
  for (const t of tabs.filter((t) => t.kind === 'compare' && t.uses(tab))) closeTab(t, { force: true });
}

function renderTabbar() {
  els.tabbar.replaceChildren(
    ...tabs.map((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab === activeTab ? ' active' : '');
      el.title = tab.path || tab.name;
      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = (tab.dirty ? '● ' : '') + tab.name;
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
  document.title = activeTab ? `${activeTab.name} — Redline PDF Editor` : 'Redline PDF Editor';
  els.statusFile.textContent = activeTab ? activeTab.path || activeTab.name : '';
  els.statusSize.textContent = activeTab?.size != null ? formatBytes(activeTab.size) : '';
  updatePageControls();
  updateZoomControl();
  updateUndoButtons();
  updateScaleStatus();
}

function updateScaleStatus() {
  const el = document.getElementById('status-scale');
  if (!activeTab?.store) {
    el.textContent = '';
    return;
  }
  const scale = activeTab.store.scaleFor(activeTab.currentPageIndex);
  el.textContent = `Scale: ${(scale ?? PAPER_SCALE).label}`;
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

// ---------- Tools ----------

function applyTool() {
  const tool = markupUi.tool();
  const panning = tool === 'hand' || spaceHeld;
  for (const t of tabs) {
    t.container.classList.toggle('hand', panning);
    t.container.classList.toggle('drawing', !panning && !NON_DRAW_TOOLS.has(tool));
  }
}

let spaceHeld = false;

function wireViewerInput(tab) {
  const c = tab.container;
  let pan = null;

  c.addEventListener('mousedown', (e) => {
    const panning = (markupUi.tool() === 'hand' || spaceHeld) && e.button === 0;
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

// ---------- Page tools ----------

let pageOpBusy = false;

/** Runs a page tool on the active document's selected pages (or the page in view). */
async function pageCommand(command) {
  const tab = activeTab;
  if (!tab?.pdf || pageOpBusy) return;
  if (!tab.editable) {
    window.desktop.showError('Pages cannot be changed', `${tab.name} is encrypted, so its pages cannot be changed.`);
    return;
  }
  pageOpBusy = true;
  document.body.classList.add('busy');
  try {
    const pages = tab.targetPages;
    switch (command) {
      case 'rotate-cw':
        await tab.rotatePages(90, pages);
        break;
      case 'rotate-ccw':
        await tab.rotatePages(-90, pages);
        break;
      case 'delete-pages': {
        if (pages.length >= tab.pageCount) {
          window.desktop.showError('Cannot delete every page', 'A PDF needs at least one page. Select fewer pages in the thumbnails.');
          break;
        }
        const ok = await window.desktop.confirm(
          `Delete ${describePages(pages)}?`,
          'Markups on those pages are deleted too, and this can’t be undone with Undo. Nothing changes on disk until you save.',
          'Delete',
        );
        if (ok) await tab.deletePages(pages);
        break;
      }
      case 'insert-pages': {
        const files = await window.desktop.pickPdfs('Insert Pages');
        // Inserted after the page in view, in the order picked.
        for (const file of [...files].reverse()) await tab.insertFile(file.data, tab.currentPageIndex + 1);
        break;
      }
      case 'extract-pages': {
        const bytes = await tab.extractPages(pages);
        const base = tab.name.replace(/\.pdf$/i, '');
        const target = await window.desktop.saveAsDialog(`${base} (${describePages(pages)}).pdf`);
        if (target) await window.desktop.saveFile(target, bytes);
        break;
      }
    }
  } catch (err) {
    window.desktop.showError('Could not change pages', err.message);
  } finally {
    pageOpBusy = false;
    document.body.classList.remove('busy');
    if (tab === activeTab) updateToolbar();
  }
}

function describePages(pages) {
  if (pages.length === 1) return `page ${pages[0] + 1}`;
  const contiguous = pages.every((p, i) => !i || p === pages[i - 1] + 1);
  return contiguous ? `pages ${pages[0] + 1}–${pages[pages.length - 1] + 1}` : `${pages.length} pages`;
}

// ---------- Compare ----------

const compareDialog = $('compare-dialog');

function documentTabs() {
  return tabs.filter((t) => t.kind !== 'compare' && t.pdf);
}

function fillCompareSelects(oldTab, newTab) {
  for (const [id, chosen] of [
    ['cmp-old', oldTab],
    ['cmp-new', newTab],
  ]) {
    const select = $(id);
    select.replaceChildren(...documentTabs().map((t) => new Option(t.name, String(t.id), false, t === chosen)));
  }
}

async function openCompare() {
  const docs = documentTabs();
  const newTab = docs.includes(activeTab) ? activeTab : docs[docs.length - 1];
  const oldTab = docs.find((t) => t !== newTab) ?? newTab;
  fillCompareSelects(oldTab, newTab);
  $('cmp-error').textContent = docs.length < 2 ? 'Open both versions, or use Open Another PDF… to add one.' : '';
  compareDialog.returnValue = '';
  compareDialog.showModal();
}

$('cmp-browse').addEventListener('click', async () => {
  const files = await window.desktop.pickPdfs('Open PDF to Compare');
  let opened = null;
  for (const file of files) opened = (await openFile(file)) ?? opened;
  if (!opened) return;
  const docs = documentTabs();
  const byId = (id) => docs.find((t) => String(t.id) === $(id).value);
  // The file just opened is taken as the new version, compared with another open document.
  const other = [byId('cmp-old'), byId('cmp-new'), ...docs].find((t) => t && t !== opened) ?? opened;
  fillCompareSelects(other, opened);
  $('cmp-error').textContent = '';
  if (!compareDialog.open) compareDialog.showModal();
});

compareDialog.addEventListener('close', () => {
  if (compareDialog.returnValue !== 'ok') return;
  const docs = documentTabs();
  const oldTab = docs.find((t) => String(t.id) === $('cmp-old').value);
  const newTab = docs.find((t) => String(t.id) === $('cmp-new').value);
  if (!oldTab || !newTab) return;
  const existing = tabs.find((t) => t.kind === 'compare' && t.oldTab === oldTab && t.newTab === newTab);
  if (existing) return activateTab(existing);
  const tab = new CompareTab({ oldTab, newTab, viewersEl: els.viewers, sidebarEl: els.sidebar, onAddClouds: addCompareClouds });
  tabs.push(tab);
  activateTab(tab);
});
compareDialog.querySelector('form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  if ($('cmp-old').value && $('cmp-old').value === $('cmp-new').value) {
    e.preventDefault();
    $('cmp-error').textContent = 'Pick two different documents.';
  }
});

/** Adds a revision cloud around each change found by a comparison. */
function addCompareClouds(tab, byPage) {
  if (!tabs.includes(tab)) return;
  if (!byPage.length) {
    window.desktop.showError('No changes found', `Nothing to cloud: ${tab.name} looks the same as the old version.`);
    return;
  }
  const now = new Date().toISOString();
  const style = { ...markupUi.styleFor('cloud') };
  const markups = byPage.flatMap(({ page, boxes }) =>
    boxes.map((points) => ({ id: newId(), page, type: 'cloud', style, author: markupUi.author(), created: now, modified: now, points })),
  );
  tab.store.addMany(markups);
  activateTab(tab);
  tab.viewer.currentPageNumber = byPage[0].page + 1;
}

// ---------- Wiring ----------

$('btn-open').addEventListener('click', () => window.desktop.openDialog());
$('btn-open-welcome').addEventListener('click', () => window.desktop.openDialog());
$('btn-sidebar').addEventListener('click', toggleSidebar);
$('btn-save').addEventListener('click', () => save(activeTab));
$('btn-markups-list').addEventListener('click', () => markupsList.toggle());
$('btn-undo').addEventListener('click', () => undo());
$('btn-redo').addEventListener('click', () => undo(true));
$('btn-prev-page').addEventListener('click', () => activeTab?.viewer.previousPage());
$('btn-next-page').addEventListener('click', () => activeTab?.viewer.nextPage());
$('btn-zoom-in').addEventListener('click', () => zoomBy(1));
$('btn-zoom-out').addEventListener('click', () => zoomBy(-1));
$('btn-find').addEventListener('click', openFind);
$('pt-rotate-cw').addEventListener('click', () => pageCommand('rotate-cw'));
$('pt-rotate-ccw').addEventListener('click', () => pageCommand('rotate-ccw'));
$('pt-insert').addEventListener('click', () => pageCommand('insert-pages'));
$('pt-extract').addEventListener('click', () => pageCommand('extract-pages'));
$('pt-delete').addEventListener('click', () => pageCommand('delete-pages'));

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
  const toolId = e.key.length === 1 && markupUi.toolForKey(e.key);
  const layer = activeTab?.markups;
  if (layer?.drawingPoly && ['Enter', 'Escape', 'Backspace', 'Delete'].includes(e.key)) {
    // Keys for a shape being clicked out point by point.
    e.preventDefault();
    if (e.key === 'Enter') layer.finishPoly();
    else if (e.key === 'Escape') layer.cancelPoly();
    else layer.undoVertex();
    return;
  }
  if (e.code === 'Space') {
    if (!spaceHeld) {
      spaceHeld = true;
      applyTool();
    }
    e.preventDefault();
  } else if (toolId && activeTab?.pdf) {
    markupUi.setTool(toolId);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && activeTab?.markups?.selected) {
    e.preventDefault();
    activeTab.markups.deleteSelected();
  } else if (e.key === 'Escape') {
    if (!els.findbar.hidden) closeFind();
    else if (activeTab?.markups?.selected) activeTab.markups.select(null);
    else markupUi.setTool('select');
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

// Callbacks hand nothing back across the preload bridge, which would try to copy a whole tab.
window.desktop.onFileOpened((file) => void openFile(file));
window.desktop.onMenuCommand((command) => {
  runCommand(command);
});

function runCommand(command) {
  switch (command) {
    case 'zoom-in': return zoomBy(1);
    case 'zoom-out': return zoomBy(-1);
    case 'zoom-actual': return setZoom('1');
    case 'zoom-fit-width': return setZoom('page-width');
    case 'zoom-fit-page': return setZoom('page-fit');
    case 'toggle-sidebar': return toggleSidebar();
    case 'toggle-markups-list': return markupsList.toggle();
    case 'find': return openFind();
    case 'close-tab': return activeTab && closeTab(activeTab);
    case 'save': return save(activeTab);
    case 'save-as': return save(activeTab, { saveAs: true });
    case 'undo': return undo();
    case 'redo': return undo(true);
    case 'next-tab': return cycleTab(1);
    case 'prev-tab': return cycleTab(-1);
    case 'rotate-cw':
    case 'rotate-ccw':
    case 'insert-pages':
    case 'extract-pages':
    case 'delete-pages':
      return pageCommand(command);
    case 'compare': return openCompare();
  }
}

// Drag and drop PDFs from Finder onto the window.
let dragDepth = 0;
const draggingFiles = (e) => e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (!draggingFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (!draggingFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  const handled = e.defaultPrevented; // dropped on the thumbnails, which insert pages instead
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (handled) return;
  for (const file of e.dataTransfer.files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    const path = window.desktop.pathForFile(file);
    if (path) openFile(await window.desktop.readFile(path));
    else openFile({ name: file.name, path: '', data: new Uint8Array(await file.arrayBuffer()) });
  }
});

updateToolbar();
window.desktop.ready();
