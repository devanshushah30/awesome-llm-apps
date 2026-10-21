/* Excaliflow Cloud — API client for the Supabase-backed /api/* endpoints.
 *
 * Zero dependencies. Loaded via <script src="cloud.js"></script>.
 * Exposes window.ExcaliflowCloud, used by projects.js (Projects panel UI).
 *
 * v3: no password anywhere. The API is open for this personal deployment
 * (the CLOUD_PASSWORD env var was removed in Vercel; the backend only
 * enforces it when set, so it can be re-enabled server-side at any time).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // call(path, { method, body }) → parsed JSON. Throws Error with .status.
  async function call(path, opts) {
    opts = opts || {};
    var headers = {};
    var body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    var res = await fetch(path, { method: opts.method || 'GET', headers: headers, body: body });
    var data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      var err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.ExcaliflowCloud = {
    call: call,
    // Legacy no-ops (pre-v3 password API) — kept so nothing else breaks.
    getPassword: function () { return ''; },
    setPassword: function () {},
    hasPassword: function () { return true; },
    askPassword: function () { return ''; },
  };
})();
