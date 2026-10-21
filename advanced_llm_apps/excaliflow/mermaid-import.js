/* Excaliflow — Mermaid Import.
 *
 * Parses Mermaid flowchart code (graph/flowchart), lays it out in layers,
 * and generates a new canvas with the app's own createElement/createCanvasTab
 * (flow animation ON for the new canvas).
 *
 * The parser + layout are pure functions and are exported for Node tests
 * (module.exports guard at the bottom, same pattern as the app itself).
 * Zero dependencies.
 */
(function (global) {
  'use strict';

  var DIRECTIONS = { TD: 'TD', TB: 'TD', BT: 'BT', LR: 'LR', RL: 'RL' };
  var SKIP_LINE = /^(classDef|class|style|linkStyle|click|direction\s+(TD|TB|BT|LR|RL)|%%\{)/i;
  var PALETTE = ['#0070f3', '#7928ca', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#171717'];

  // ------------------------------------------------------------------ labels
  function cleanLabel(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s.length >= 2 &&
        ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
         (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'"))) {
      s = s.slice(1, -1);
    }
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n');
    s = s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
         .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
         .replace(/#quot;/g, '"').replace(/#39;/g, "'").replace(/#semi;/g, ';');
    return s.trim();
  }

  // ------------------------------------------------------------------ nodes
  // Parse "id" + optional shape suffix at the start of str.
  function parseNodeRef(str) {
    // Ids may contain interior hyphens (node-1) but a trailing dash run
    // before ">" belongs to the edge operator (A-->B has id "A").
    var m = /^\s*([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)/.exec(str);
    if (!m) return null;
    var node = { id: m[1] };
    var rest = str.slice(m[0].length);
    function tryShape(re, shape) {
      var mm = re.exec(rest);
      if (!mm) return false;
      node.label = cleanLabel(mm[1]);
      node.shape = shape;
      rest = rest.slice(mm[0].length);
      return true;
    }
    if (tryShape(/^\(\(\s*(.*?)\)\)/, 'ellipse')) { /* circle */ }
    else if (tryShape(/^\[\[\s*(.*?)\]\]/, 'rectangle')) { /* subroutine */ }
    else if (tryShape(/^\[\(\s*(.*?)\)\]/, 'rectangle')) { /* stadium */ }
    else if (tryShape(/^\[\s*(.*?)\]/, 'rectangle')) { /* rect */ }
    else if (tryShape(/^\(\s*(.*?)\)/, 'rectangle')) { /* rounded */ }
    else if (tryShape(/^\{\s*(.*?)\}/, 'diamond')) { /* decision */ }
    else if (tryShape(/^>\s*(.*?)\]/, 'rectangle')) { /* flag */ }
    node.rest = rest;
    return node;
  }

  function registerNode(ctx, ref, lineNo) {
    var existing = ctx.nodes.get(ref.id);
    if (!existing) {
      ctx.nodes.set(ref.id, {
        id: ref.id,
        label: ref.label != null ? ref.label : ref.id,
        shape: ref.shape || 'rectangle',
      });
      ctx.nodeOrder.push(ref.id);
      return;
    }
    if (ref.label != null) {
      if (existing.label !== ref.label && existing.label !== existing.id) {
        ctx.warnings.push('Line ' + lineNo + ': node "' + ref.id + '" redefined — using the latest label.');
      }
      existing.label = ref.label;
      if (ref.shape) existing.shape = ref.shape;
    }
  }

  // ------------------------------------------------------------------ edges
  var EDGE_OPS = [
    { re: /^\s*<-->\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow', both: true },
    { re: /^\s*<---\s*(?:\|([^|]*)\|\s*)?/, kind: 'line', reversed: true },
    { re: /^\s*<--\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow', reversed: true },
    { re: /^\s*-->\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow' },
    { re: /^\s*---\s*(?:\|([^|]*)\|\s*)?/, kind: 'line' },
    { re: /^\s*-\.->\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow', dotted: true },
    { re: /^\s*-\.-\s*(?:\|([^|]*)\|\s*)?/, kind: 'line', dotted: true },
    { re: /^\s*==>\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow', thick: true },
    { re: /^\s*===\s*(?:\|([^|]*)\|\s*)?/, kind: 'line', thick: true },
    { re: /^\s*--x\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow' },
    { re: /^\s*--o\s*(?:\|([^|]*)\|\s*)?/, kind: 'arrow' },
    { re: /^\s*--\s+(.+?)\s*-->\s*/, kind: 'arrow', labeled: true },
    { re: /^\s*--\s+(.+?)\s*---\s*/, kind: 'line', labeled: true },
    { re: /^\s*-\.\s+(.+?)\s*\.->\s*/, kind: 'arrow', dotted: true, labeled: true },
  ];

  function matchEdgeOp(str) {
    for (var i = 0; i < EDGE_OPS.length; i++) {
      var op = EDGE_OPS[i];
      var m = op.re.exec(str);
      if (m) {
        return {
          len: m[0].length,
          kind: op.kind,
          reversed: !!op.reversed,
          both: !!op.both,
          label: m[1] != null ? cleanLabel(m[1]) : '',
        };
      }
    }
    return null;
  }

  function addEdge(ctx, from, to, op) {
    var dupe = ctx.edges.some(function (e) {
      return e.from === from && e.to === to && e.label === op.label && e.kind === op.kind;
    });
    if (dupe) return;
    ctx.edges.push({ from: from, to: to, label: op.label || '', kind: op.kind });
  }

  function parseNodeGroup(str, ctx, lineNo) {
    var ids = [];
    var rest = str;
    while (true) {
      var ref = parseNodeRef(rest);
      if (!ref) {
        ctx.errors.push({ line: lineNo, message: 'Expected a node id near "' + rest.trim().slice(0, 24) + '"' });
        return null;
      }
      registerNode(ctx, ref, lineNo);
      ids.push(ref.id);
      rest = ref.rest;
      var amp = /^\s*&\s*/.exec(rest);
      if (amp) { rest = rest.slice(amp[0].length); continue; }
      break;
    }
    return { ids: ids, rest: rest };
  }

  // Split a line into statements on ';' — but not inside shapes or quotes
  // (labels legitimately contain ';', e.g. the &quot; entity).
  function splitStatements(line) {
    var parts = [], cur = '', depth = 0, quote = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '[' || ch === '{' || ch === '(') depth++;
      else if (ch === ']' || ch === '}' || ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  function parseStatement(stmt, ctx, lineNo) {
    var g = parseNodeGroup(stmt, ctx, lineNo);
    if (!g) return;
    var sources = g.ids;
    var rest = g.rest;
    while (rest.trim().length > 0) {
      var op = matchEdgeOp(rest);
      if (!op || op.len === 0) {
        ctx.errors.push({ line: lineNo, message: 'Unrecognized edge syntax near "' + rest.trim().slice(0, 24) + '"' });
        return;
      }
      rest = rest.slice(op.len);
      var g2 = parseNodeGroup(rest, ctx, lineNo);
      if (!g2) return;
      for (var i = 0; i < sources.length; i++) {
        for (var j = 0; j < g2.ids.length; j++) {
          if (op.both) {
            addEdge(ctx, sources[i], g2.ids[j], op);
            addEdge(ctx, g2.ids[j], sources[i], op);
          } else if (op.reversed) {
            addEdge(ctx, g2.ids[j], sources[i], op);
          } else {
            addEdge(ctx, sources[i], g2.ids[j], op);
          }
        }
      }
      sources = g2.ids;
      rest = g2.rest;
    }
  }

  // ------------------------------------------------------------------ parse
  function parseMermaid(text) {
    var ctx = {
      nodes: new Map(), nodeOrder: [], edges: [],
      warnings: [], errors: [], direction: 'TD',
    };
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var sawDirection = false;
    var subgraphDepth = 0;
    var subgraphWarned = false;

    src.split('\n').forEach(function (rawLine, idx) {
      var lineNo = idx + 1;
      var line = rawLine.replace(/%%.*$/, '').trim();
      if (!line) return;

      if (!sawDirection) {
        var dm = /^(graph|flowchart)\s+(TD|TB|BT|LR|RL)\b/i.exec(line);
        if (dm) {
          ctx.direction = DIRECTIONS[dm[2].toUpperCase()];
          sawDirection = true;
          line = line.slice(dm[0].length).replace(/^;\s*/, '').trim();
          if (!line) return;
        } else if (/^(graph|flowchart)\b/i.test(line)) {
          sawDirection = true;
          line = line.replace(/^(graph|flowchart)\b/i, '').replace(/^;\s*/, '').trim();
          if (!line) return;
        }
      }

      if (/^subgraph\b/i.test(line)) {
        subgraphDepth++;
        if (!subgraphWarned) {
          ctx.warnings.push('Subgraphs are flattened — grouping is not preserved.');
          subgraphWarned = true;
        }
        return;
      }
      if (/^end\s*$/i.test(line) && subgraphDepth > 0) { subgraphDepth--; return; }
      if (SKIP_LINE.test(line)) return;

      splitStatements(line).forEach(function (stmt) {
        if (stmt.trim()) parseStatement(stmt, ctx, lineNo);
      });
    });

    if (ctx.nodes.size === 0 && ctx.errors.length === 0) {
      ctx.errors.push({ line: 1, message: 'No diagram found. Paste a Mermaid flowchart, e.g. "graph TD" then "A --> B".' });
    }
    if (ctx.nodes.size > 200) {
      ctx.warnings.push('Large diagram (' + ctx.nodes.size + ' nodes) — the canvas will be wide.');
    }
    return {
      direction: ctx.direction,
      nodes: ctx.nodeOrder.map(function (id) { return ctx.nodes.get(id); }),
      edges: ctx.edges,
      warnings: ctx.warnings,
      errors: ctx.errors,
    };
  }

  // ------------------------------------------------------------------ layout
  function nodeSize(node) {
    var lines = String(node.label != null ? node.label : node.id).split('\n');
    var maxLen = 1;
    lines.forEach(function (l) { maxLen = Math.max(maxLen, l.length); });
    var w = Math.max(120, Math.min(300, maxLen * 8 + 48));
    var h = 68;
    if (node.shape === 'diamond') { w += 44; h = 96; }
    else if (node.shape === 'ellipse') { w += 24; h = 80; }
    if (lines.length > 1) h += (lines.length - 1) * 12;
    return { width: w, height: h };
  }

  function layoutDiagram(parsed) {
    var nodes = parsed.nodes;
    var edges = parsed.edges;
    var layer = new Map();
    nodes.forEach(function (n) { layer.set(n.id, 0); });

    // Cycle-safe layering: find back edges via DFS, then relax longest paths.
    var adj = new Map();
    nodes.forEach(function (n) { adj.set(n.id, []); });
    var pairSeen = new Set();
    edges.forEach(function (e) {
      if (e.from === e.to) return;
      var k = e.from + '>' + e.to;
      if (pairSeen.has(k)) return;
      pairSeen.add(k);
      if (adj.has(e.from)) adj.get(e.from).push(e.to);
    });
    var backEdges = new Set();
    var color = new Map();
    function dfs(u) {
      color.set(u, 1);
      (adj.get(u) || []).forEach(function (v) {
        var c = color.get(v) || 0;
        if (c === 1) backEdges.add(u + '>' + v);
        else if (c === 0) dfs(v);
      });
      color.set(u, 2);
    }
    nodes.forEach(function (n) { if (!color.get(n.id)) dfs(n.id); });

    for (var iter = 0; iter < nodes.length; iter++) {
      var changed = false;
      edges.forEach(function (e) {
        if (e.from === e.to || backEdges.has(e.from + '>' + e.to)) return;
        if (layer.get(e.to) < layer.get(e.from) + 1) {
          layer.set(e.to, layer.get(e.from) + 1);
          changed = true;
        }
      });
      if (!changed) break;
    }

    // Group into layers (insertion order preserved within a layer).
    var layers = new Map();
    nodes.forEach(function (n) {
      var L = layer.get(n.id);
      if (!layers.has(L)) layers.set(L, []);
      layers.get(L).push(n);
    });
    var layerIdx = Array.from(layers.keys()).sort(function (a, b) { return a - b; });

    var dir = parsed.direction || 'TD';
    var vertical = dir === 'TD' || dir === 'BT';
    var GAP_MAIN = 96, GAP_CROSS = 56, MARGIN = 60;
    var positions = new Map();
    var mainCursor = MARGIN;

    layerIdx.forEach(function (L) {
      var row = layers.get(L);
      var sizes = row.map(nodeSize);
      var crossTotal = sizes.reduce(function (s, z) { return s + (vertical ? z.width : z.height); }, 0) +
        GAP_CROSS * Math.max(0, row.length - 1);
      var mainSize = Math.max.apply(null, sizes.map(function (z) { return vertical ? z.height : z.width; }));
      var crossCursor = -crossTotal / 2;
      row.forEach(function (n, i) {
        var z = sizes[i];
        var crossCenter = crossCursor + (vertical ? z.width : z.height) / 2;
        var mainCenter = mainCursor + mainSize / 2;
        var cx = vertical ? crossCenter : mainCenter;
        var cy = vertical ? mainCenter : crossCenter;
        if (dir === 'BT') cy = -cy;
        if (dir === 'RL') cx = -cx;
        positions.set(n.id, {
          x: cx - z.width / 2, y: cy - z.height / 2,
          width: z.width, height: z.height,
          layer: L, color: PALETTE[L % PALETTE.length],
        });
        crossCursor += (vertical ? z.width : z.height) + GAP_CROSS;
      });
      mainCursor += mainSize + GAP_MAIN;
    });

    // Normalize so the top-left starts at MARGIN.
    var minX = Infinity, minY = Infinity;
    positions.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); });
    positions.forEach(function (p) { p.x += MARGIN - minX; p.y += MARGIN - minY; });

    // Curve offsets: back/self edges arc out; parallel edges fan apart.
    var pairCount = new Map();
    var edgeStyles = edges.map(function (e) {
      var k = e.from + '>' + e.to;
      var n = (pairCount.get(k) || 0) + 1;
      pairCount.set(k, n);
      var co = 0;
      if (e.from === e.to) co = 64;
      else if (backEdges.has(k)) co = (n % 2 === 0 ? -1 : 1) * (48 + 14 * Math.floor(n / 2));
      else if (n > 1) co = (n % 2 === 0 ? -1 : 1) * 22 * Math.ceil(n / 2);
      return { curveOffset: co };
    });

    return { positions: positions, edgeStyles: edgeStyles, backEdges: backEdges };
  }

  // ------------------------------------------------------------------ export
  var api = {
    parseMermaid: parseMermaid,
    layoutDiagram: layoutDiagram,
    cleanLabel: cleanLabel,
    _nodeSize: nodeSize,
  };
  global.ExcaliflowMermaid = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ------------------------------------------------------------------ browser glue
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  function toast(msg) { try { global.showToast(msg); } catch (e) {} }

  function buildAndInsert(parsed, layoutRes, name) {
    var els = [];
    var nodeEls = new Map();
    parsed.nodes.forEach(function (n) {
      var p = layoutRes.positions.get(n.id);
      var type = n.shape === 'diamond' ? 'diamond' : (n.shape === 'ellipse' ? 'ellipse' : 'rectangle');
      var el = global.createElement(type, {
        id: 'mm_' + String(n.id).replace(/[^A-Za-z0-9_-]/g, '_'),
        x: p.x, y: p.y, width: p.width, height: p.height,
        text: n.label != null ? n.label : n.id,
        strokeColor: p.color, fillStyle: 'hachure',
      });
      els.push(el);
      nodeEls.set(n.id, el);
    });
    parsed.edges.forEach(function (e, i) {
      var a = nodeEls.get(e.from);
      var b = nodeEls.get(e.to);
      if (!a || !b) return;
      var fc = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
      var tc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      var co = layoutRes.edgeStyles[i] ? layoutRes.edgeStyles[i].curveOffset : 0;
      var selfLoop = e.from === e.to;
      var angOut = selfLoop ? -Math.PI / 2 : Math.atan2(tc.y - fc.y, tc.x - fc.x);
      var angIn = selfLoop ? 0 : Math.atan2(fc.y - tc.y, fc.x - tc.x);
      var arr = global.createElement('arrow', {
        x: fc.x, y: fc.y,
        x2: selfLoop ? fc.x + 1 : tc.x, y2: selfLoop ? fc.y : tc.y,
        text: '',
        curveOffset: co,
        curveType: Math.abs(co) > 1 ? 'curved' : ((global.state && global.state.defaults && global.state.defaults.curveType) || 'curved'),
        strokeColor: a.strokeColor,
        startBinding: { elementId: a.id, focusAngle: angOut, side: global.angleToSide(angOut), gap: 4 },
        endBinding: { elementId: b.id, focusAngle: angIn, side: global.angleToSide(angIn), gap: 4 },
      });
      els.push(arr);
      if (e.label) {
        var t = global.createElement('text', {
          x: (fc.x + tc.x) / 2, y: (fc.y + tc.y) / 2, text: e.label, fontSize: 13,
        });
        if (t.width) t.x -= t.width / 2;
        if (t.height) t.y -= t.height / 2;
        els.push(t);
      }
    });
    var tab = global.createCanvasTab({
      name: (name || 'Mermaid Diagram').slice(0, 48),
      elements: els,
      flowEnabled: true,
    });
    return tab;
  }

  function importFromText(text, name) {
    var parsed = parseMermaid(text);
    if (parsed.errors.length) return { ok: false, parsed: parsed };
    var layoutRes = layoutDiagram(parsed);
    var tab = buildAndInsert(parsed, layoutRes, name);
    return { ok: true, parsed: parsed, tab: tab };
  }

  // ------------------------------------------------------------------ modal
  var SAMPLE = 'graph TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Stop]\n  C --> E((Done))';

  function ensureModal() {
    var overlay = document.getElementById('mermaidOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'mermaidOverlay';
    overlay.className = 'px-overlay';
    overlay.innerHTML =
      '<div class="px-modal glass-panel">' +
        '<div class="px-modal-title">Import Mermaid flowchart</div>' +
        '<label class="px-field-label">Canvas name</label>' +
        '<input id="mermaidName" class="px-input" type="text" maxlength="48" placeholder="Mermaid Diagram" />' +
        '<label class="px-field-label">Mermaid code</label>' +
        '<textarea id="mermaidCode" class="px-textarea" rows="10" spellcheck="false" placeholder="' + SAMPLE.replace(/"/g, '&quot;') + '"></textarea>' +
        '<div class="px-modal-row">' +
          '<label class="px-file-btn">📂 Upload .mmd / .txt<input id="mermaidFile" type="file" accept=".mmd,.txt,.md,text/plain" hidden /></label>' +
          '<span id="mermaidWarn" class="px-warn"></span>' +
        '</div>' +
        '<div id="mermaidErrors" class="px-errors"></div>' +
        '<div class="px-modal-actions">' +
          '<button id="mermaidCancel" class="ui-btn">Cancel</button>' +
          '<button id="mermaidGenerate" class="ui-btn primary">Generate canvas</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.getElementById('mermaidCancel').addEventListener('click', closeModal);
    document.getElementById('mermaidFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        document.getElementById('mermaidCode').value = String(reader.result || '');
        var nameEl = document.getElementById('mermaidName');
        if (!nameEl.value) nameEl.value = f.name.replace(/\.(mmd|txt|md)$/i, '').slice(0, 48);
      };
      reader.readAsText(f);
      e.target.value = '';
    });
    document.getElementById('mermaidGenerate').addEventListener('click', function () {
      var code = document.getElementById('mermaidCode').value;
      var name = document.getElementById('mermaidName').value.trim();
      var parsed = parseMermaid(code);
      var errBox = document.getElementById('mermaidErrors');
      var warnEl = document.getElementById('mermaidWarn');
      warnEl.textContent = parsed.warnings.join(' ');
      if (parsed.errors.length) {
        errBox.innerHTML = '';
        parsed.errors.slice(0, 6).forEach(function (er) {
          var d = document.createElement('div');
          d.textContent = 'Line ' + er.line + ': ' + er.message;
          errBox.appendChild(d);
        });
        return;
      }
      errBox.innerHTML = '';
      var layoutRes = layoutDiagram(parsed);
      buildAndInsert(parsed, layoutRes, name || 'Mermaid Diagram');
      closeModal();
      toast('Mermaid canvas created: ' + parsed.nodes.length + ' nodes, ' + parsed.edges.length + ' flows');
    });
    return overlay;
  }

  function openModal() {
    var overlay = ensureModal();
    document.getElementById('mermaidErrors').innerHTML = '';
    document.getElementById('mermaidWarn').textContent = '';
    overlay.classList.add('open');
    var ta = document.getElementById('mermaidCode');
    setTimeout(function () { ta.focus(); }, 30);
  }
  function closeModal() {
    var overlay = document.getElementById('mermaidOverlay');
    if (overlay) overlay.classList.remove('open');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  api.openModal = openModal;
  api.importFromText = importFromText;
})(typeof window !== 'undefined' ? window : globalThis);
