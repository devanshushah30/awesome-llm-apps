/* Excaliflow Cloud — Supabase-backed save / load / update / download / delete.
 *
 * Zero dependencies. Loaded via <script src="cloud.js"></script> at the end
 * of index.html. Injects a "Cloud" button into the top header and talks to
 * the /api/* backend (Vercel functions in production, dev-server.js locally).
 *
 * Auth: the API is gated by an optional CLOUD_PASSWORD. The password is asked
 * once per browser session and kept in sessionStorage (never in the repo).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var PW_KEY = 'excaliflow_cloud_pw';

  function getPw() {
    try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; }
  }
  function setPw(pw) {
    try { pw ? sessionStorage.setItem(PW_KEY, pw) : sessionStorage.removeItem(PW_KEY); } catch (e) {}
  }
  function askPw() {
    var pw = (window.prompt('Enter your Excaliflow Cloud password:') || '').trim();
    if (pw) setPw(pw);
    return pw;
  }
  function toast(msg) {
    try { showToast(msg); } catch (e) { /* showToast is global in index.html */ }
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
  }

  // ---- API client -----------------------------------------------------------
  async function callApi(path, opts) {
    opts = opts || {};
    async function attempt(pw) {
      var headers = {};
      if (pw) headers['x-cloud-password'] = pw;
      var body;
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      var res = await fetch(path, { method: opts.method || 'GET', headers: headers, body: body });
      var data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON */ }
      return { res: res, data: data };
    }
    var out = await attempt(getPw());
    if (out.res.status === 401) {
      // Password missing or wrong → ask once and retry.
      setPw('');
      var pw = askPw();
      if (!pw) throw new Error('Cloud password required.');
      out = await attempt(pw);
      if (out.res.status === 401) {
        setPw('');
        throw new Error('Wrong cloud password.');
      }
    }
    if (!out.res.ok) {
      throw new Error((out.data && out.data.error) || ('Request failed (' + out.res.status + ')'));
    }
    return out.data;
  }

  // ---- Canvas bridge (globals from index.html) -------------------------------
  function currentData() {
    try {
      if (typeof serializeWorkspace !== 'function') return null;
      return serializeWorkspace();
    } catch (e) { return null; }
  }
  function defaultSaveName() {
    try {
      var d = new Date();
      return 'Diagram ' + d.toLocaleDateString() + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return 'Untitled diagram'; }
  }

  // ---- Actions ----------------------------------------------------------------
  function saveDiagram() {
    var data = currentData();
    if (!data) { toast('Could not read the canvas.'); return; }
    var name = (window.prompt('Name this cloud save:', defaultSaveName()) || '')
      .trim().slice(0, 120) || defaultSaveName();
    toast('Saving to cloud…');
    callApi('/api/diagrams', { method: 'POST', body: { name: name, data: data } })
      .then(function (res) {
        toast('Saved to cloud: ' + ((res.diagram && res.diagram.name) || name));
        refreshList();
      })
      .catch(function (err) { toast('Cloud save failed: ' + err.message); });
  }

  function loadDiagram(id, name) {
    toast('Loading from cloud…');
    callApi('/api/diagrams/' + encodeURIComponent(id))
      .then(function (res) {
        var ok = false;
        try {
          ok = (typeof restoreWorkspaceData === 'function') &&
            !!restoreWorkspaceData(res.diagram.data);
        } catch (e) { ok = false; }
        if (!ok) throw new Error('Could not restore the diagram.');
        try { if (typeof saveWorkspaceToStorage === 'function') saveWorkspaceToStorage(); } catch (e) {}
        try { closeAllDropdowns(); } catch (e) {}
        toast('Loaded from cloud: ' + name);
      })
      .catch(function (err) { toast('Cloud load failed: ' + err.message); });
  }

  function updateDiagram(id, name) {
    var data = currentData();
    if (!data) { toast('Could not read the canvas.'); return; }
    if (!window.confirm('Overwrite "' + name + '" in the cloud with the current canvas?')) return;
    toast('Updating cloud copy…');
    callApi('/api/diagrams/' + encodeURIComponent(id), { method: 'PATCH', body: { data: data } })
      .then(function () { toast('Cloud copy updated.'); refreshList(); })
      .catch(function (err) { toast('Update failed: ' + err.message); });
  }

  function downloadDiagram(id, name) {
    callApi('/api/diagrams/' + encodeURIComponent(id))
      .then(function (res) {
        var blob = new Blob([JSON.stringify(res.diagram.data, null, 2)], { type: 'application/json' });
        var safe = String(name || 'diagram').replace(/[^\w\- ]+/g, '').trim()
          .replace(/\s+/g, '-').toLowerCase() || 'diagram';
        var filename = safe + '.excaliflow.json';
        var done = false;
        try { downloadBlob(blob, filename); done = true; } catch (e) { done = false; }
        if (!done) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        }
        toast('Downloaded ' + filename);
      })
      .catch(function (err) { toast('Download failed: ' + err.message); });
  }

  function deleteDiagram(id, name) {
    if (!window.confirm('Delete "' + name + '" from the cloud? This cannot be undone.')) return;
    callApi('/api/diagrams/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () { toast('Deleted from cloud.'); refreshList(); })
      .catch(function (err) { toast('Delete failed: ' + err.message); });
  }

  // ---- List UI -----------------------------------------------------------------
  function smallBtn(label, title) {
    var b = document.createElement('button');
    b.className = 'ui-btn';
    b.textContent = label;
    b.title = title || label;
    b.style.cssText = 'padding:3px 8px;font-size:11px;flex:none;';
    return b;
  }

  function renderList(listEl, items) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 10px;font-size:12px;opacity:0.6;';
      empty.textContent = 'No cloud saves yet — use “Save current to cloud”.';
      listEl.appendChild(empty);
      return;
    }
    items.forEach(function (d) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:8px;';
      var name = document.createElement('span');
      name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;';
      name.textContent = d.name || 'Untitled';
      name.title = (d.name || 'Untitled') + ' · saved ' + fmtDate(d.updated_at);
      row.appendChild(name);
      var openB = smallBtn('Open', 'Load this diagram onto the canvas');
      openB.addEventListener('click', function (e) { e.stopPropagation(); loadDiagram(d.id, d.name); });
      var updB = smallBtn('⟳', 'Overwrite this cloud copy with the current canvas');
      updB.addEventListener('click', function (e) { e.stopPropagation(); updateDiagram(d.id, d.name); });
      var dlB = smallBtn('⬇', 'Download as .excaliflow.json');
      dlB.addEventListener('click', function (e) { e.stopPropagation(); downloadDiagram(d.id, d.name); });
      var delB = smallBtn('🗑', 'Delete from cloud');
      delB.addEventListener('click', function (e) { e.stopPropagation(); deleteDiagram(d.id, d.name); });
      row.appendChild(openB);
      row.appendChild(updB);
      row.appendChild(dlB);
      row.appendChild(delB);
      listEl.appendChild(row);
    });
  }

  function refreshList() {
    var statusEl = document.getElementById('cloudStatus');
    var listEl = document.getElementById('cloudList');
    if (statusEl) statusEl.textContent = 'Loading…';
    callApi('/api/diagrams')
      .then(function (payload) {
        var items = (payload && payload.diagrams) || [];
        if (statusEl) statusEl.textContent = '● Connected — ' + items.length + ' saved';
        renderList(listEl, items);
      })
      .catch(function (err) {
        if (statusEl) statusEl.textContent = '○ Not connected — ' + err.message;
        if (listEl) listEl.innerHTML = '';
      });
  }

  // ---- Header injection ----------------------------------------------------------
  function injectUI() {
    var anchor = document.getElementById('btnSavePng');
    var group = anchor && anchor.closest ? anchor.closest('.header-group') : null;
    if (!group || document.getElementById('cloudMenuBtn')) return;

    var divider = document.createElement('div');
    divider.className = 'v-divider';
    var wrap = document.createElement('div');
    wrap.className = 'dropdown-wrap';
    wrap.innerHTML =
      '<button id="cloudMenuBtn" class="ui-btn" title="Cloud save & load — Supabase backend">☁️ Cloud</button>' +
      '<div id="cloudDropdown" class="dropdown-menu glass-panel" style="min-width:300px;max-width:360px">' +
        '<div id="cloudStatus" style="padding:8px 10px;font-size:12px;opacity:0.75;">Cloud backend</div>' +
        '<div class="menu-sep"></div>' +
        '<button id="cloudSaveBtn" class="ui-btn menu-item"><span>💾 Save current to cloud</span><span></span></button>' +
        '<button id="cloudRefreshBtn" class="ui-btn menu-item"><span>↻ Refresh list</span><span></span></button>' +
        '<div class="menu-sep"></div>' +
        '<div id="cloudList" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;"></div>' +
        '<div class="menu-sep"></div>' +
        '<button id="cloudPwBtn" class="ui-btn menu-item"><span>🔑 ' +
          (getPw() ? 'Forget cloud password' : 'Set cloud password') +
          '</span><span></span></button>' +
      '</div>';
    group.appendChild(divider);
    group.appendChild(wrap);

    document.getElementById('cloudMenuBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById('cloudDropdown');
      var wasOpen = menu.classList.contains('open');
      try { closeAllDropdowns(); } catch (err) {}
      if (!wasOpen) { menu.classList.add('open'); refreshList(); }
    });
    document.getElementById('cloudSaveBtn').addEventListener('click', function (e) {
      e.stopPropagation(); saveDiagram();
    });
    document.getElementById('cloudRefreshBtn').addEventListener('click', function (e) {
      e.stopPropagation(); refreshList();
    });
    document.getElementById('cloudPwBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (getPw()) { setPw(''); toast('Cloud password forgotten for this session.'); }
      else if (askPw()) { toast('Cloud password set for this session.'); refreshList(); }
      var label = e.currentTarget.querySelector('span');
      if (label) label.textContent = '🔑 ' + (getPw() ? 'Forget cloud password' : 'Set cloud password');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
