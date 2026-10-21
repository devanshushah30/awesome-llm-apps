/* Excaliflow Cloud — API client for the Supabase-backed /api/* endpoints.
 *
 * Zero dependencies. Loaded via <script src="cloud.js"></script>.
 * Exposes window.ExcaliflowCloud, used by projects.js (Projects panel UI).
 *
 * Auth: the API is gated by an optional CLOUD_PASSWORD (set as a Vercel env
 * var). The password is asked once per browser session and kept in
 * sessionStorage — never in the repo, never in localStorage.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var PW_KEY = 'excaliflow_cloud_pw';

  function getPassword() {
    try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; }
  }
  function setPassword(pw) {
    try { pw ? sessionStorage.setItem(PW_KEY, pw) : sessionStorage.removeItem(PW_KEY); } catch (e) {}
  }
  function hasPassword() { return !!getPassword(); }
  function askPassword() {
    var pw = (window.prompt('Enter your Excaliflow Cloud password:') || '').trim();
    if (pw) setPassword(pw);
    return pw;
  }

  // call(path, { method, body }) → parsed JSON. Throws Error with .status.
  async function call(path, opts) {
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
    var out = await attempt(getPassword());
    if (out.res.status === 401) {
      // Password missing or wrong → ask once and retry.
      setPassword('');
      var pw = askPassword();
      if (!pw) {
        var need = new Error('Cloud password required.');
        need.status = 401;
        throw need;
      }
      out = await attempt(pw);
      if (out.res.status === 401) {
        setPassword('');
        var wrong = new Error('Wrong cloud password.');
        wrong.status = 401;
        throw wrong;
      }
    }
    if (!out.res.ok) {
      var err = new Error((out.data && out.data.error) || ('Request failed (' + out.res.status + ')'));
      err.status = out.res.status;
      throw err;
    }
    return out.data;
  }

  window.ExcaliflowCloud = {
    call: call,
    getPassword: getPassword,
    setPassword: setPassword,
    hasPassword: hasPassword,
    askPassword: askPassword,
  };
})();
