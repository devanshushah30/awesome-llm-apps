// Shared helpers for the Excaliflow Cloud API.
// Runs on Vercel Serverless Functions AND the local dev-server.js.
// Zero dependencies — talks to Supabase via its REST (PostgREST) API using global fetch.
'use strict';

function getConfig() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUD_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error('Server misconfigured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    err.status = 500;
    throw err;
  }
  return {
    SUPABASE_URL: String(SUPABASE_URL).replace(/\/$/, ''),
    SUPABASE_SERVICE_ROLE_KEY,
    CLOUD_PASSWORD: CLOUD_PASSWORD || '',
  };
}

// Simple shared-secret gate. When CLOUD_PASSWORD is unset the API is open
// (handy for local dev); set it in production and the browser sends it as
// the x-cloud-password header (kept in sessionStorage, never in the repo).
function checkAuth(req) {
  const { CLOUD_PASSWORD } = getConfig();
  if (!CLOUD_PASSWORD) return;
  const provided = req.headers['x-cloud-password'] || req.headers['x-cloud-key'] || '';
  if (provided !== CLOUD_PASSWORD) {
    const err = new Error('Unauthorized: invalid or missing cloud password.');
    err.status = 401;
    throw err;
  }
}

// Vercel pre-parses JSON bodies into req.body; the local dev server does too.
// This fallback streams the body for any other host.
async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body || '{}');
      } catch {
        const e = new Error('Invalid JSON body.');
        e.status = 400;
        throw e;
      }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const e = new Error('Invalid JSON body.');
    e.status = 400;
    throw e;
  }
}

// Minimal Supabase REST client (uses the service_role key — server-side only,
// never exposed to the browser).
async function supabase(path, { method = 'GET', body, query = '' } = {}) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getConfig();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `Supabase request failed (HTTP ${res.status}).`);
    err.status = 502;
    throw err;
  }
  return data;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function handleError(res, err) {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[excaliflow-cloud]', err);
  send(res, status, { error: (err && err.message) || 'Internal server error.' });
}

module.exports = { getConfig, checkAuth, readJsonBody, supabase, send, handleError };
