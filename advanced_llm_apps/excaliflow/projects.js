/* Excaliflow v2 — Projects panel.
 *
 * Claude-Code-style organization: a PROJECT (a cloud-saved workspace in the
 * existing Supabase `diagrams` table) contains many CANVASES (the app's tabs).
 * Adds an icon rail (✎ Tools / 📁 Projects) to the left sidebar, a projects
 * tree with per-canvas kebab menus (rename, duplicate, PNG/JSON downloads,
 * delete), project CRUD, a save/dirty model, and .excaliflow import.
 *
 * Pure helpers are exported for Node tests (module.exports guard).
 * Zero dependencies.
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------ pure helpers
  function slugify(name, fallback) {
    var s = String(name == null ? '' : name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || fallback || 'canvas';
  }

  // Elements to export for a selection: the selected elements, plus any arrow
  // whose BOTH bound shapes are selected (keeps connected flows coherent).
  function selectExportSubset(elements, selectedIds) {
    var has = selectedIds && typeof selectedIds.has === 'function'
      ? function (id) { return selectedIds.has(id); }
      : function (id) { return selectedIds.indexOf(id) >= 0; };
    var inSet = new Set();
    (elements || []).forEach(function (e) { if (has(e.id)) inSet.add(e.id); });
    (elements || []).forEach(function (e) {
      if (e.type !== 'arrow' || inSet.has(e.id)) return;
      var s = e.startBinding && e.startBinding.elementId;
      var t = e.endBinding && e.endBinding.elementId;
      if (s && t && has(s) && has(t)) inSet.add(e.id);
    });
    return (elements || []).filter(function (e) { return inSet.has(e.id); });
  }

  // A one-canvas workspace payload (importable by the app's loader).
  function buildSingleCanvasPayload(tab) {
    var clean = {
      id: tab.id, name: tab.name,
      elements: tab.elements || [],
      scrollX: tab.scrollX || 0, scrollY: tab.scrollY || 0,
      zoom: tab.zoom || 1,
      canvasBg: tab.canvasBg || '#ffffff',
      flowEnabled: tab.flowEnabled !== false,
      flowMode: tab.flowMode, flowSpeed: tab.flowSpeed,
    };
    return {
      type: 'excaliflow', version: 2,
      source: 'Excaliflow — hand-drawn diagramming & live causal flow',
      activeTabId: tab.id,
      elements: clean.elements,
      appState: {
        viewBackgroundColor: clean.canvasBg,
        flowEnabled: clean.flowEnabled,
        flowMode: clean.flowMode, flowSpeed: clean.flowSpeed,
      },
      tabs: [clean],
    };
  }

  // Bounds of an arbitrary element list (mirrors the app's export bounds).
  function computeBoundsFor(elements, padding) {
    padding = padding == null ? 48 : padding;
    if (!elements || !elements.length) return { x: 0, y: 0, width: 800, height: 500 };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var map = null;
    try { if (typeof global.getElementMap === 'function') map = global.getElementMap(elements); } catch (e) {}
    elements.forEach(function (el) {
      if (el.type === 'arrow') {
        var pts = null;
        if (map && typeof global.getArrowGeometry === 'function') {
          try { pts = global.getArrowGeometry(el, map).samples; } catch (e) { pts = null; }
        }
        if (!pts || !pts.length) pts = [{ x: el.x, y: el.y }, { x: el.x2 != null ? el.x2 : el.x, y: el.y2 != null ? el.y2 : el.y }];
        pts.forEach(function (pt) {
          minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        });
      } else if (el.type === 'freedraw') {
        (el.points || [[0, 0]]).forEach(function (p) {
          minX = Math.min(minX, el.x + p[0]); minY = Math.min(minY, el.y + p[1]);
          maxX = Math.max(maxX, el.x + p[0]); maxY = Math.max(maxY, el.y + p[1]);
        });
      } else {
        minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + (el.width || 0)); maxY = Math.max(maxY, el.y + (el.height || 0));
      }
    });
    if (!isFinite(minX)) return { x: 0, y: 0, width: 800, height: 500 };
    return {
      x: minX - padding, y: minY - padding,
      width: (maxX - minX) + padding * 2, height: (maxY - minY) + padding * 2,
    };
  }

  var pure = {
    slugify: slugify,
    selectExportSubset: selectExportSubset,
    buildSingleCanvasPayload: buildSingleCanvasPayload,
    computeBoundsFor: computeBoundsFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;

  // ------------------------------------------------------------ browser only
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var LS_KEY = 'excaliflow.currentProjectId';
  var ui = {
    mode: 'tools',
    projects: [],
    listError: '',
    expandedId: null,
    preview: null, // { id, tabs }
    currentProjectId: null,
    currentProjectName: null,
    lastHash: null,
    busy: false,
  };

  function $(id) { return document.getElementById(id); }
  function app() { return global.state; }
  function C() { return global.ExcaliflowCloud; }
  function toast(msg) { try { global.showToast(msg); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }
  function syncActiveQuiet() {
    try { if (typeof global.syncActiveTabFromState === 'function') global.syncActiveTabFromState(); } catch (e) {}
  }
  function workspaceHash() {
    try { return hashStr(JSON.stringify(global.serializeWorkspace())); } catch (e) { return ''; }
  }
  function workspaceHasContent() {
    syncActiveQuiet();
    var S = app();
    if (!S) return false;
    if ((S.elements || []).length > 0) return true;
    return (S.tabs || []).some(function (t) { return (t.elements || []).length > 0; });
  }
  function isDirty() {
    if (!ui.currentProjectId) return false;
    if (ui.lastHash == null) return true;
    return workspaceHash() !== ui.lastHash;
  }

  // ------------------------------------------------------------ rendering
  function renderStatus() {
    var dot = $('pxDot'), txt = $('pxStatusText');
    if (!dot || !txt) return;
    var ready = !!(C() && C().hasPassword());
    dot.classList.toggle('on', ready);
    txt.textContent = ready ? 'Cloud ready (password set)' : 'Cloud — password asked on first use';
  }

  function saveStateText() {
    if (!ui.currentProjectId) return 'Local only — Save creates a cloud project.';
    return isDirty() ? 'Unsaved changes' : 'All changes saved ✓';
  }

  function renderCurrent() {
    var card = $('pxCurrent');
    if (!card) return;
    var S = app();
    if (!S) { card.innerHTML = '<div class="px-empty">Loading…</div>'; return; }
    syncActiveQuiet();
    var name = ui.currentProjectId ? (ui.currentProjectName || 'Project') : 'Untitled workspace';
    var rows = (S.tabs || []).map(function (t) {
      var active = t.id === S.activeTabId;
      return '<div class="px-row' + (active ? ' active' : '') + '" data-tab-row="' + esc(t.id) + '">' +
        '<span class="px-row-name" data-action="canvas-open" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '">' +
          (active ? '▸ ' : '') + esc(t.name) + '</span>' +
        '<span class="px-row-meta">' + ((t.elements || []).length) + ' el</span>' +
        '<button class="px-kebab" data-action="canvas-kebab" data-id="' + esc(t.id) + '" title="Canvas actions">⋯</button>' +
      '</div>';
    }).join('');
    card.innerHTML =
      '<div class="px-card-name"><span class="px-dirty' + (isDirty() ? ' show' : '') + '"></span><span>' + esc(name) + '</span></div>' +
      '<div class="px-save-state" id="pxSaveState">' + esc(saveStateText()) + '</div>' +
      '<div class="px-btn-row">' +
        '<button class="px-btn primary" data-action="save"' + (ui.busy ? ' disabled' : '') + '>Save</button>' +
        '<button class="px-btn" data-action="save-as"' + (ui.busy ? ' disabled' : '') + '>Save as new</button>' +
        (ui.currentProjectId ? '<button class="px-btn" data-action="rename-current">Rename</button>' : '') +
      '</div>' +
      '<div class="px-section-title">Canvases</div>' +
      '<div class="px-list">' + rows + '</div>' +
      '<button class="px-add-row" data-action="add-canvas">＋ Add canvas</button>';
  }

  function previewHtml(pid) {
    if (!ui.preview || ui.preview.id !== pid) return '<div class="px-empty">Loading canvases…</div>';
    if (!ui.preview.tabs.length) return '<div class="px-empty">No canvases in this project.</div>';
    return ui.preview.tabs.map(function (t) {
      return '<div class="px-row">' +
        '<span class="px-row-name" data-action="preview-open" data-pid="' + esc(pid) + '" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<span class="px-row-meta">' + ((t.elements || []).length) + ' el</span>' +
        '<button class="px-kebab" data-action="preview-kebab" data-pid="' + esc(pid) + '" data-id="' + esc(t.id) + '" title="Canvas actions">⋯</button>' +
      '</div>';
    }).join('');
  }

  function renderTree() {
    var tree = $('pxTree');
    if (!tree) return;
    if (ui.listError) {
      tree.innerHTML = '<div class="px-empty">Could not load projects: ' + esc(ui.listError) + '</div>';
      return;
    }
    if (!ui.projects.length) {
      tree.innerHTML = '<div class="px-empty">No cloud projects yet.<br>Save this workspace or start a new project.</div>';
      return;
    }
    tree.innerHTML = ui.projects.map(function (p) {
      var isCurrent = p.id === ui.currentProjectId;
      var expanded = ui.expandedId === p.id;
      var html = '<div class="px-row' + (isCurrent ? ' active' : '') + '">' +
        '<button class="px-caret" data-action="toggle-project" data-id="' + esc(p.id) + '" title="' + (isCurrent ? 'Currently open' : 'Show canvases') + '">' +
          (isCurrent ? '●' : (expanded ? '▾' : '▸')) + '</button>' +
        '<span class="px-row-name" data-action="open-project" data-id="' + esc(p.id) + '" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
        '<button class="px-kebab" data-action="project-kebab" data-id="' + esc(p.id) + '" title="Project actions">⋯</button>' +
      '</div>';
      if (expanded && !isCurrent) {
        html += '<div class="px-indent px-list">' + previewHtml(p.id) + '</div>';
      }
      return html;
    }).join('');
  }

  function renderAll() { renderStatus(); renderCurrent(); renderTree(); }

  // ------------------------------------------------------------ menus
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function showContextMenu(x, y, items) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'px-menu glass-panel';
    items.forEach(function (it) {
      if (it.sep) {
        var s = document.createElement('div');
        s.className = 'px-menu-sep';
        menuEl.appendChild(s);
        return;
      }
      var b = document.createElement('button');
      b.className = 'px-menu-item' + (it.danger ? ' danger' : '');
      b.textContent = it.label;
      b.addEventListener('click', function () {
        closeMenu();
        Promise.resolve().then(function () { return it.fn ? it.fn() : null; })
          .catch(function (e) { toast('Error: ' + (e.message || e)); });
      });
      menuEl.appendChild(b);
    });
    document.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menuEl.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    return menuEl;
  }
  function openMenuFor(anchorEl, items) {
    var r = anchorEl.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, items);
  }
  document.addEventListener('pointerdown', function (e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  // ------------------------------------------------------------ downloads
  function renderElementsToCanvas(elements, bg, scale) {
    scale = scale || 2;
    var bounds = computeBoundsFor(elements, 48);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bounds.width * scale));
    c.height = Math.max(1, Math.round(bounds.height * scale));
    var ctx = c.getContext('2d');
    ctx.save();
    ctx.fillStyle = bg || '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(scale, scale);
    ctx.translate(-bounds.x, -bounds.y);
    global.renderScenePasses(ctx, performance.now() / 1000, {
      elements: elements, canvasBg: bg || '#ffffff', forExport: true,
    });
    ctx.restore();
    return c;
  }

  function canvasPngSource(tab) {
    var S = app();
    if (S && tab.id === S.activeTabId) {
      syncActiveQuiet();
      return { elements: S.elements || [], bg: S.canvasBg || '#ffffff' };
    }
    return { elements: tab.elements || [], bg: tab.canvasBg || '#ffffff' };
  }

  function downloadCanvasPng(tab) {
    var src = canvasPngSource(tab);
    var c = renderElementsToCanvas(src.elements, src.bg, 2);
    c.toBlob(function (blob) {
      if (!blob) { toast('PNG export failed'); return; }
      global.downloadBlob(blob, slugify(tab.name, 'canvas') + '.png');
      toast('Downloaded PNG — "' + tab.name + '"');
    }, 'image/png');
  }

  function downloadCanvasJson(tab) {
    var payload = buildSingleCanvasPayload(tab);
    global.downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      slugify(tab.name, 'canvas') + '.excaliflow'
    );
    toast('Downloaded "' + tab.name + '" (.excaliflow)');
  }

  function copyCanvasPng(tab) {
    var src = canvasPngSource(tab);
    var c = renderElementsToCanvas(src.elements, src.bg, 2);
    c.toBlob(async function (blob) {
      if (!blob) { toast('PNG export failed'); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Copied PNG to clipboard');
      } catch (e) {
        toast('Clipboard unavailable here — use Download PNG');
      }
    }, 'image/png');
  }

  // ------------------------------------------------------------ canvas ops
  function findTab(id) {
    var S = app();
    return (S.tabs || []).find(function (t) { return t.id === id; }) || null;
  }
  function findPreviewTab(pid, id) {
    if (!ui.preview || ui.preview.id !== pid) return null;
    return ui.preview.tabs.find(function (t) { return t.id === id; }) || null;
  }
  function findProject(id) {
    return ui.projects.find(function (p) { return p.id === id; }) || null;
  }

  function startRenameCanvas(tab) {
    var row = document.querySelector('[data-tab-row="' + tab.id + '"]');
    if (!row) return;
    var nameEl = row.querySelector('.px-row-name');
    if (!nameEl) return;
    var input = document.createElement('input');
    input.className = 'px-rename-input';
    input.type = 'text';
    input.value = tab.name;
    input.maxLength = 48;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      var v = input.value.trim().slice(0, 48);
      if (save && v && v !== tab.name) {
        global.renameCanvasTab(tab.id, v);
        toast('Canvas renamed to "' + v + '"');
      }
      renderCurrent();
    }
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('blur', function () { commit(true); });
  }

  function deleteCanvas(tab) {
    if ((app().tabs || []).length <= 1) { toast('A project needs at least one canvas.'); return; }
    if (!window.confirm('Delete canvas "' + tab.name + '"? This cannot be undone.')) return;
    global.closeCanvasTab(tab.id);
    renderCurrent();
  }

  function clearActiveCanvas() {
    if (!window.confirm('Clear the current canvas? (Undo can bring it back)')) return;
    global.pushHistory();
    app().elements = [];
    app().selectedIds.clear();
    if (global.ShapeCache) global.ShapeCache.clear();
    global.syncUIWithSelection();
    renderCurrent();
  }

  function canvasMenu(tab, anchorEl) {
    var isActive = app() && tab.id === app().activeTabId;
    var items = [
      { label: 'Open canvas', fn: function () { global.switchCanvasTab(tab.id); renderCurrent(); } },
      { label: 'Rename', fn: function () { startRenameCanvas(tab); } },
      { label: 'Duplicate', fn: function () { global.duplicateCanvasTab(tab.id); renderCurrent(); } },
      { sep: true },
      { label: 'Download PNG (2x)', fn: function () { downloadCanvasPng(tab); } },
      { label: 'Download .excaliflow (JSON)', fn: function () { downloadCanvasJson(tab); } },
    ];
    if (isActive) {
      items.push({ label: 'Copy PNG to clipboard', fn: function () { copyCanvasPng(tab); } });
      items.push({ label: 'Record 60fps video (.webm)', fn: function () { global.recordWebmVideo(); } });
      items.push({ sep: true });
      items.push({ label: 'Clear canvas', danger: true, fn: function () { clearActiveCanvas(); } });
    }
    items.push({ sep: true });
    items.push({ label: 'Delete canvas', danger: true, fn: function () { deleteCanvas(tab); } });
    openMenuFor(anchorEl, items);
  }

  function previewMenu(pid, tab, anchorEl) {
    openMenuFor(anchorEl, [
      { label: 'Open project at this canvas', fn: function () { return actOpen(pid, tab.id); } },
      { sep: true },
      { label: 'Download PNG (2x)', fn: function () { downloadCanvasPng(tab); } },
      { label: 'Download .excaliflow (JSON)', fn: function () { downloadCanvasJson(tab); } },
    ]);
  }

  function projectMenu(p, anchorEl) {
    var items = [];
    if (p.id !== ui.currentProjectId) {
      items.push({ label: 'Open project', fn: function () { return actOpen(p.id); } });
    }
    items.push({ label: 'Rename project', fn: function () { return actRenameProject(p); } });
    items.push({
      label: 'Add canvas', fn: async function () {
        if (p.id === ui.currentProjectId) { global.createCanvasTab({}); renderCurrent(); }
        else { await doOpenProject(p.id); global.createCanvasTab({}); renderCurrent(); }
      },
    });
    items.push({ label: 'Download project (.excaliflow)', fn: function () { return downloadProjectJson(p); } });
    items.push({ sep: true });
    items.push({ label: 'Delete project', danger: true, fn: function () { return actDeleteProject(p); } });
    openMenuFor(anchorEl, items);
  }

  // ------------------------------------------------------------ cloud ops
  function blankWorkspace() {
    var tab = {
      id: 'tab_main', name: 'Canvas 1', elements: [],
      scrollX: 0, scrollY: 0, zoom: 1, canvasBg: '#ffffff',
      flowEnabled: true, flowMode: 'comets', flowSpeed: 1,
    };
    return {
      type: 'excaliflow', version: 2,
      source: 'Excaliflow — hand-drawn diagramming & live causal flow',
      activeTabId: 'tab_main', elements: [],
      appState: { viewBackgroundColor: '#ffffff', flowEnabled: true, flowMode: 'comets', flowSpeed: 1 },
      tabs: [tab],
    };
  }

  async function doSaveCurrent() {
    syncActiveQuiet();
    var payload = global.serializeWorkspace();
    await C().call('/api/diagrams/' + encodeURIComponent(ui.currentProjectId), {
      method: 'PATCH', body: { data: payload },
    });
    ui.lastHash = workspaceHash();
  }

  async function doCreateProject(name) {
    syncActiveQuiet();
    var payload = global.serializeWorkspace();
    var out = await C().call('/api/diagrams', { method: 'POST', body: { name: name, data: payload } });
    ui.currentProjectId = out.diagram.id;
    ui.currentProjectName = name;
    try { localStorage.setItem(LS_KEY, ui.currentProjectId); } catch (e) {}
    ui.lastHash = workspaceHash();
    ui.expandedId = ui.currentProjectId;
    toast('Project "' + name + '" saved to the cloud');
    return true;
  }

  async function ensureSafeToReplace() {
    if (ui.currentProjectId) {
      if (isDirty()) await doSaveCurrent();
      return true;
    }
    if (!workspaceHasContent()) return true;
    if (window.confirm('Your current workspace is not saved to a project yet.\n\nSave it as a new project before switching?')) {
      var name = (window.prompt('Project name:', 'My Project') || '').trim().slice(0, 120);
      if (!name) return false;
      await doCreateProject(name);
      return true;
    }
    return window.confirm('Discard the current unsaved workspace and switch?');
  }

  async function doOpenProject(id, thenTabId) {
    if (id === ui.currentProjectId) {
      if (thenTabId && findTab(thenTabId)) { global.switchCanvasTab(thenTabId); renderCurrent(); }
      return;
    }
    if (!(await ensureSafeToReplace())) return;
    var out = await C().call('/api/diagrams/' + encodeURIComponent(id));
    var d = out && out.diagram;
    if (!d || !d.data || !Array.isArray(d.data.tabs) || !d.data.tabs.length) {
      toast('That project could not be opened (missing or corrupt data).');
      return;
    }
    if (!global.restoreWorkspaceData(d.data)) {
      toast('That project could not be opened.');
      return;
    }
    ui.currentProjectId = d.id;
    ui.currentProjectName = d.name;
    try { localStorage.setItem(LS_KEY, d.id); } catch (e) {}
    ui.lastHash = workspaceHash();
    ui.expandedId = d.id;
    ui.preview = null;
    if (thenTabId && findTab(thenTabId)) global.switchCanvasTab(thenTabId);
    toast('Opened "' + d.name + '"');
    await refreshList();
  }

  async function downloadProjectJson(p) {
    var data;
    if (p.id === ui.currentProjectId) {
      syncActiveQuiet();
      data = global.serializeWorkspace();
    } else {
      var out = await C().call('/api/diagrams/' + encodeURIComponent(p.id));
      data = out.diagram.data;
    }
    global.downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      slugify(p.name, 'project') + '.excaliflow'
    );
    toast('Downloaded project "' + p.name + '"');
  }

  async function refreshList() {
    try {
      var out = await C().call('/api/diagrams');
      ui.projects = out.diagrams || [];
      ui.listError = '';
      if (ui.currentProjectId) {
        var cur = findProject(ui.currentProjectId);
        if (cur) ui.currentProjectName = cur.name;
        else {
          ui.currentProjectId = null;
          ui.currentProjectName = null;
          ui.lastHash = null;
          try { localStorage.removeItem(LS_KEY); } catch (e) {}
        }
      }
    } catch (e) {
      ui.listError = e.message || 'load failed';
    }
    renderAll();
  }

  async function toggleExpand(id) {
    if (id === ui.currentProjectId) return; // its canvases live in the Current card
    if (ui.expandedId === id) {
      ui.expandedId = null;
      ui.preview = null;
      renderTree();
      return;
    }
    ui.expandedId = id;
    ui.preview = null;
    renderTree();
    try {
      var out = await C().call('/api/diagrams/' + encodeURIComponent(id));
      if (ui.expandedId !== id) return; // user moved on
      ui.preview = { id: id, tabs: (out.diagram.data && out.diagram.data.tabs) || [] };
    } catch (e) {
      if (ui.expandedId === id) {
        ui.preview = { id: id, tabs: [] };
        toast('Could not load canvases: ' + (e.message || e));
      }
    }
    renderTree();
  }

  // Guarded public actions (busy flag + error toasts + re-render).
  function guard(fn) {
    return async function () {
      if (ui.busy) return;
      ui.busy = true;
      renderCurrent();
      try {
        return await fn.apply(null, arguments);
      } catch (e) {
        toast('Error: ' + (e.message || e));
      } finally {
        ui.busy = false;
        renderAll();
      }
    };
  }

  var actSave = guard(async function () {
    if (ui.currentProjectId) {
      await doSaveCurrent();
      toast('Saved "' + (ui.currentProjectName || 'project') + '"');
      await refreshList();
    } else {
      var name = (window.prompt('Save this workspace as project:', 'My Project') || '').trim().slice(0, 120);
      if (!name) return;
      await doCreateProject(name);
      await refreshList();
    }
  });

  var actSaveAs = guard(async function () {
    var name = (window.prompt('Save as new project:', ui.currentProjectName || 'My Project') || '').trim().slice(0, 120);
    if (!name) return;
    await doCreateProject(name);
    await refreshList();
  });

  var actNew = guard(async function () {
    var name = (window.prompt('Name your new project:', 'Untitled Project') || '').trim().slice(0, 120);
    if (!name) return;
    if (!(await ensureSafeToReplace())) return;
    global.restoreWorkspaceData(blankWorkspace());
    ui.currentProjectId = null;
    ui.currentProjectName = null;
    ui.lastHash = null;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    await doCreateProject(name);
    await refreshList();
  });

  var actOpen = guard(function (id, thenTabId) { return doOpenProject(id, thenTabId); });

  var actRenameProject = guard(async function (p) {
    var name = (window.prompt('Rename project:', p.name) || '').trim().slice(0, 120);
    if (!name || name === p.name) return;
    await C().call('/api/diagrams/' + encodeURIComponent(p.id), { method: 'PATCH', body: { name: name } });
    p.name = name;
    if (ui.currentProjectId === p.id) ui.currentProjectName = name;
    toast('Renamed to "' + name + '"');
    renderTree();
    renderCurrent();
  });

  var actDeleteProject = guard(async function (p) {
    if (!window.confirm('Delete project "' + p.name + '" from the cloud? This cannot be undone.')) return;
    await C().call('/api/diagrams/' + encodeURIComponent(p.id), { method: 'DELETE' });
    if (ui.currentProjectId === p.id) {
      ui.currentProjectId = null;
      ui.currentProjectName = null;
      ui.lastHash = null;
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
    }
    if (ui.expandedId === p.id) { ui.expandedId = null; ui.preview = null; }
    toast('Deleted "' + p.name + '"');
    await refreshList();
  });

  // ------------------------------------------------------------ modes / init
  function setMode(m) {
    ui.mode = m;
    var railBtns = document.querySelectorAll('#pxRail .px-rail-btn');
    railBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === m); });
    document.querySelectorAll('#leftSidebar > .sidebar-section').forEach(function (s) {
      s.style.display = m === 'tools' ? '' : 'none';
    });
    var panel = $('projectsPanel');
    if (panel) panel.style.display = m === 'projects' ? '' : 'none';
    var sb = $('leftSidebar');
    if (sb && sb.classList.contains('collapsed')) sb.classList.remove('collapsed');
    if (m === 'projects') {
      renderAll();
      refreshList();
    }
  }

  function init() {
    var sidebar = $('leftSidebar');
    if (!sidebar || !C() || !app()) {
      setTimeout(init, 250);
      return;
    }
    if ($('projectsPanel')) return;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'projects.css';
    document.head.appendChild(link);

    var rail = document.createElement('div');
    rail.id = 'pxRail';
    rail.className = 'glass-panel';
    rail.innerHTML =
      '<button class="px-rail-btn active" data-mode="tools" title="Tools &amp; properties">✎</button>' +
      '<button class="px-rail-btn" data-mode="projects" title="Projects &amp; canvases">📁</button>';
    document.body.appendChild(rail);
    rail.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (b) setMode(b.getAttribute('data-mode'));
    });

    var panel = document.createElement('div');
    panel.id = 'projectsPanel';
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="px-head">' +
        '<span class="px-title">Projects</span>' +
        '<button class="px-icon-btn" id="pxBtnMermaid" title="Import Mermaid flowchart">⇩</button>' +
        '<button class="px-icon-btn" id="pxBtnNew" title="New project">＋</button>' +
      '</div>' +
      '<div class="px-status">' +
        '<span class="px-dot" id="pxDot"></span>' +
        '<span class="px-status-text" id="pxStatusText">Cloud</span>' +
        '<button class="px-icon-btn" id="pxBtnKey" title="Set / change cloud password">🔑</button>' +
      '</div>' +
      '<div class="px-card" id="pxCurrent"></div>' +
      '<div class="px-section-title">All projects' +
        '<button class="px-icon-btn" id="pxBtnRefresh" title="Refresh project list">⟳</button>' +
      '</div>' +
      '<div class="px-list" id="pxTree"></div>' +
      '<div class="px-btn-row">' +
        '<button class="px-btn" id="pxBtnImportFile">Import .excaliflow file</button>' +
        '<input type="file" id="pxFileInput" accept=".json,.excaliflow,.excalidraw" hidden />' +
      '</div>';
    sidebar.appendChild(panel);

    ui.currentProjectId = null;
    try { ui.currentProjectId = localStorage.getItem(LS_KEY) || null; } catch (e) {}

    $('pxBtnNew').addEventListener('click', function () { actNew(); });
    $('pxBtnRefresh').addEventListener('click', function () { refreshList(); });
    $('pxBtnKey').addEventListener('click', function () {
      C().askPassword();
      renderStatus();
    });
    $('pxBtnMermaid').addEventListener('click', function () {
      if (global.ExcaliflowMermaid && global.ExcaliflowMermaid.openModal) global.ExcaliflowMermaid.openModal();
      else toast('Mermaid import is still loading…');
    });
    $('pxBtnImportFile').addEventListener('click', function () { $('pxFileInput').click(); });
    $('pxFileInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          if (global.importExcalidrawJson(String(reader.result || ''))) renderCurrent();
        } catch (err) {
          toast('Import failed: ' + (err.message || err));
        }
      };
      reader.readAsText(f);
      e.target.value = '';
    });

    panel.addEventListener('click', function (e) {
      if (e.target.closest('.px-rename-input')) return;
      var el = e.target.closest('[data-action]');
      if (!el) return;
      var action = el.getAttribute('data-action');
      var id = el.getAttribute('data-id');
      var pid = el.getAttribute('data-pid');
      if (action === 'canvas-open') {
        global.switchCanvasTab(id);
        renderCurrent();
      } else if (action === 'canvas-kebab') {
        var tab = findTab(id);
        if (tab) canvasMenu(tab, el);
      } else if (action === 'add-canvas') {
        global.createCanvasTab({});
        renderCurrent();
      } else if (action === 'save') {
        actSave();
      } else if (action === 'save-as') {
        actSaveAs();
      } else if (action === 'rename-current') {
        var p = findProject(ui.currentProjectId) || { id: ui.currentProjectId, name: ui.currentProjectName || '' };
        actRenameProject(p);
      } else if (action === 'toggle-project') {
        toggleExpand(id);
      } else if (action === 'open-project') {
        actOpen(id);
      } else if (action === 'project-kebab') {
        var proj = findProject(id);
        if (proj) projectMenu(proj, el);
      } else if (action === 'preview-open') {
        actOpen(pid, id);
      } else if (action === 'preview-kebab') {
        var ptab = findPreviewTab(pid, id);
        if (ptab) previewMenu(pid, ptab, el);
      }
    });

    panel.addEventListener('dblclick', function (e) {
      var nameEl = e.target.closest('[data-action="canvas-open"]');
      if (!nameEl) return;
      var tab = findTab(nameEl.getAttribute('data-id'));
      if (tab) startRenameCanvas(tab);
    });

    window.addEventListener('focus', function () {
      if (ui.mode === 'projects') renderCurrent();
    });
    setInterval(function () {
      if (ui.mode !== 'projects') return;
      if (document.querySelector('.px-rename-input')) return; // don't disrupt renaming
      renderCurrent(); // keeps canvas list + dirty state fresh
    }, 4000);

    renderStatus();
    renderCurrent();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Shared with selection-export.js
  global.ExcaliflowProjects = {
    showContextMenu: showContextMenu,
    closeContextMenu: closeMenu,
    renderElementsToCanvas: renderElementsToCanvas,
    computeBoundsFor: computeBoundsFor,
    selectExportSubset: selectExportSubset,
    buildSingleCanvasPayload: buildSingleCanvasPayload,
    slugify: slugify,
    openProjectsPanel: function () { setMode('projects'); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
