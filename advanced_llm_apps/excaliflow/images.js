/* Excaliflow v3 — Canvas images.
 *
 * Attach images to the canvas and annotate on top of them (text, freedraw,
 * shapes and arrows all render above/below by z-order, like any element).
 *
 * Insert via: the 🖼 button in the tool dock, pasting (Ctrl+V), or dropping
 * an image file onto the canvas. Images are downscaled (max 1600px) and
 * stored as data URLs inside the diagram, so they save to the cloud with
 * the project. Right-click an image for Send to back / Bring to front
 * (wired up in selection-export.js).
 *
 * The app core (index.html) draws image elements by delegating to
 * window.ExcaliflowImages.draw(ctx, el).
 */
(function (global) {
  'use strict';

  var MAX_DIM = 1600;          // stored images are capped at this size
  var DISPLAY_MAX_W = 520;     // on-canvas width when inserted
  var KEEP_ORIGINAL_BYTES = 600 * 1024; // small files are stored untouched

  // ------------------------------------------------------------ pure helpers
  function fitDimensions(w, h, maxDim) {
    maxDim = maxDim || MAX_DIM;
    w = Number(w) || 0;
    h = Number(h) || 0;
    if (w <= 0 || h <= 0) return { width: 320, height: 240 };
    var scale = Math.min(1, maxDim / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }

  function displaySize(w, h, maxW) {
    maxW = maxW || DISPLAY_MAX_W;
    w = Number(w) || 0;
    h = Number(h) || 0;
    if (w <= 0 || h <= 0) return { width: 320, height: 240 };
    var scale = Math.min(1, maxW / w);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }

  var pure = { fitDimensions: fitDimensions, displaySize: displaySize };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function toast(msg) { try { global.showToast(msg); } catch (e) {} }

  // ------------------------------------------------------------ bitmap cache
  var cache = new Map(); // src -> HTMLImageElement
  function getImg(src) {
    var im = cache.get(src);
    if (!im) {
      im = new Image();
      im.src = src;
      cache.set(src, im);
    }
    return im;
  }

  // Called by the app's drawStaticElement for every image element, every
  // frame — must be cheap. Unloaded images show a light placeholder and
  // pop in on a later frame (the render loop is continuous).
  function draw(ctx, el) {
    var w = el.width || 0;
    var h = el.height || 0;
    if (w <= 0 || h <= 0) return;
    if (el.src) {
      var im = getImg(el.src);
      if (im.complete && im.naturalWidth > 0) {
        ctx.drawImage(im, el.x, el.y, w, h);
        return;
      }
    }
    ctx.save();
    ctx.fillStyle = 'rgba(128, 128, 128, 0.14)';
    ctx.fillRect(el.x, el.y, w, h);
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(el.x, el.y, w, h);
    ctx.fillStyle = 'rgba(128, 128, 128, 0.8)';
    ctx.font = '13px sans-serif';
    ctx.fillText('🖼 image', el.x + 10, el.y + 22);
    ctx.restore();
  }

  // ------------------------------------------------------------ file → data URL
  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('Could not read that file.')); };
      r.readAsDataURL(file);
    });
  }

  function encode(img, w, h, jpeg) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var cx = canvas.getContext('2d');
    if (jpeg) {
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, w, h);
    }
    cx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.85);
  }

  // Downscale + re-encode so cloud projects stay well under the 10 MB cap.
  function processFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var natW = img.naturalWidth;
          var natH = img.naturalHeight;
          var target = fitDimensions(natW, natH);
          var untouched = file.size <= KEEP_ORIGINAL_BYTES && target.width === natW && target.height === natH;
          if (untouched) {
            readAsDataUrl(file).then(function (du) {
              URL.revokeObjectURL(url);
              resolve({ src: du, width: natW, height: natH });
            }, reject);
            return;
          }
          var isJpeg = /image\/jpe?g/i.test(file.type || '');
          var src;
          if (isJpeg) {
            src = encode(img, target.width, target.height, true);
          } else {
            src = encode(img, target.width, target.height, false);
            if (src.length > 1600 * 1024) src = encode(img, target.width, target.height, true);
          }
          URL.revokeObjectURL(url);
          resolve({ src: src, width: natW, height: natH });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image.'));
      };
      img.src = url;
    });
  }

  // ------------------------------------------------------------ insertion
  function insertImage(result, worldPoint) {
    var S = global.state;
    if (!S) return null;
    var size = displaySize(result.width, result.height);
    var cx, cy;
    if (worldPoint) { cx = worldPoint.x; cy = worldPoint.y; }
    else {
      var c = global.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      cx = c.x; cy = c.y;
    }
    global.pushHistory();
    var el = global.createElement('image', {
      x: Math.round(cx - size.width / 2),
      y: Math.round(cy - size.height / 2),
      width: size.width,
      height: size.height,
      text: '',
      src: result.src,
    });
    S.elements.push(el);
    S.selectedIds.clear();
    S.selectedIds.add(el.id);
    global.syncUIWithSelection();
    global.saveWorkspaceToStorage();
    toast('Image added — type, draw or stick notes on top to annotate');
    return el;
  }

  async function addImageFile(file, worldPoint) {
    if (!file || !/^image\//i.test(file.type || '')) return false;
    try {
      var result = await processFile(file);
      insertImage(result, worldPoint);
      return true;
    } catch (e) {
      toast('Image failed: ' + (e.message || e));
      return false;
    }
  }

  // ------------------------------------------------------------ z-order
  function reorder(el, toBack) {
    var S = global.state;
    if (!S || !el) return;
    var i = S.elements.indexOf(el);
    if (i < 0) return;
    global.pushHistory();
    S.elements.splice(i, 1);
    if (toBack) S.elements.unshift(el);
    else S.elements.push(el);
    global.syncUIWithSelection();
    global.saveWorkspaceToStorage();
  }

  // ------------------------------------------------------------ wiring
  function init() {
    var dock = document.getElementById('bottomToolDock');
    if (!dock || !global.state) { setTimeout(init, 300); return; }
    if (document.getElementById('imgToolBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'imgToolBtn';
    btn.className = 'dock-tool-btn';
    btn.type = 'button';
    btn.title = 'Insert Image — or paste (Ctrl+V) / drop an image file';
    btn.innerHTML = '<span style="font-size:15px;line-height:1">🖼</span>';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) addImageFile(f);
      input.value = '';
    });
    dock.appendChild(btn);
    dock.appendChild(input);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('paste', function (e) {
    var S = global.state;
    if (!S || S.editingId) return;
    var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) {
          e.preventDefault();
          addImageFile(f);
          return;
        }
      }
    }
  });

  // Capture phase: image drops are ours; everything else falls through to
  // the app's own drop handler (.excaliflow JSON import).
  window.addEventListener('drop', function (e) {
    var files = (e.dataTransfer && e.dataTransfer.files) || [];
    for (var i = 0; i < files.length; i++) {
      if (/^image\//i.test(files[i].type || '')) {
        e.preventDefault();
        e.stopPropagation();
        var pt = null;
        try { pt = global.screenToWorld(e.clientX, e.clientY); } catch (err) {}
        addImageFile(files[i], pt);
        return;
      }
    }
  }, true);

  global.ExcaliflowImages = {
    draw: draw,
    addImageFile: addImageFile,
    insertImage: insertImage,
    reorder: reorder,
    fitDimensions: fitDimensions,
    displaySize: displaySize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
