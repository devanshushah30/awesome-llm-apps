/* Excaliflow v2 — Selection export via right-click.
 *
 * Right-clicking the canvas opens a custom context menu:
 *  - on a shape (or with a selection): download just the selected components
 *    as PNG (2x) or JSON, or copy the selection PNG to the clipboard.
 *  - on empty canvas: download the whole canvas as PNG / JSON.
 *
 * The app has no context menu and does not use the right mouse button, so
 * this is conflict-free; the right-button pointerdown on canvas is swallowed
 * (capture phase) so it can't start a stray drag in the app.
 * Menu rendering is shared with projects.js (ExcaliflowProjects).
 */
(function (global) {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function toast(msg) { try { global.showToast(msg); } catch (e) {} }
  function P() { return global.ExcaliflowProjects; }
  function isCanvasTarget(t) { return !!t && t.tagName === 'CANVAS'; }

  document.addEventListener('pointerdown', function (e) {
    if (e.button === 2 && isCanvasTarget(e.target)) e.stopPropagation();
  }, true);

  function subset() {
    return P().selectExportSubset(global.state.elements || [], global.state.selectedIds);
  }

  function activeCanvasName() {
    var S = global.state;
    var tab = (S.tabs || []).find(function (t) { return t.id === S.activeTabId; });
    return tab ? tab.name : 'canvas';
  }

  function downloadSelectionPng() {
    var els = subset();
    if (!els.length) { toast('Nothing selected'); return; }
    var c = P().renderElementsToCanvas(els, global.state.canvasBg, 2);
    c.toBlob(function (blob) {
      if (!blob) { toast('PNG export failed'); return; }
      global.downloadBlob(blob, P().slugify(activeCanvasName(), 'canvas') + '-selection.png');
      toast('Selection downloaded as PNG');
    }, 'image/png');
  }

  function copySelectionPng() {
    var els = subset();
    if (!els.length) { toast('Nothing selected'); return; }
    var c = P().renderElementsToCanvas(els, global.state.canvasBg, 2);
    c.toBlob(async function (blob) {
      if (!blob) { toast('PNG export failed'); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Selection copied as PNG');
      } catch (e) {
        toast('Clipboard unavailable here — use Download PNG');
      }
    }, 'image/png');
  }

  function downloadSelectionJson() {
    var els = subset();
    if (!els.length) { toast('Nothing selected'); return; }
    var payload = {
      type: 'excaliflow', version: 2, source: 'Excaliflow selection',
      elements: els,
      appState: { viewBackgroundColor: global.state.canvasBg },
    };
    global.downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      P().slugify(activeCanvasName(), 'canvas') + '-selection.excaliflow'
    );
    toast('Selection downloaded (.excaliflow)');
  }

  document.addEventListener('contextmenu', function (e) {
    if (!isCanvasTarget(e.target)) return;
    if (!P() || !global.state) return;
    e.preventDefault();
    var S = global.state;
    var hit = null;
    try {
      var pt = global.screenToWorld(e.clientX, e.clientY);
      hit = global.hitTestElement(pt.x, pt.y);
    } catch (err) { /* fall through with no hit */ }
    if (hit && !S.selectedIds.has(hit.id)) {
      S.selectedIds.clear();
      S.selectedIds.add(hit.id);
      try { global.syncUIWithSelection(); } catch (err) {}
    }
    var items;
    if (S.selectedIds.size > 0) {
      var n = S.selectedIds.size;
      items = [
        { label: 'Download selection (' + n + ') as PNG 2x', fn: downloadSelectionPng },
        { label: 'Copy selection as PNG', fn: copySelectionPng },
        { label: 'Download selection as JSON', fn: downloadSelectionJson },
      ];
      if (n === 1 && global.ExcaliflowImages) {
        var sel = (S.elements || []).find(function (x) { return S.selectedIds.has(x.id); });
        if (sel && sel.type === 'image') {
          items.push({ sep: true });
          items.push({ label: 'Send image to back', fn: function () { global.ExcaliflowImages.reorder(sel, true); } });
          items.push({ label: 'Bring image to front', fn: function () { global.ExcaliflowImages.reorder(sel, false); } });
        }
      }
    } else {
      items = [
        { label: 'Download canvas as PNG 2x', fn: function () { global.save2xPng(); } },
        { label: 'Download canvas as JSON', fn: function () {
            var tab = (S.tabs || []).find(function (t) { return t.id === S.activeTabId; });
            if (!tab) return;
            var payload = P().buildSingleCanvasPayload({
              id: tab.id, name: tab.name, elements: S.elements,
              scrollX: S.scrollX, scrollY: S.scrollY, zoom: S.zoom,
              canvasBg: S.canvasBg, flowEnabled: S.flowEnabled,
              flowMode: S.flowMode, flowSpeed: S.flowSpeed,
            });
            global.downloadBlob(
              new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
              P().slugify(tab.name, 'canvas') + '.excaliflow'
            );
          } },
      ];
    }
    P().showContextMenu(e.clientX, e.clientY, items);
  });
})(typeof window !== 'undefined' ? window : globalThis);
