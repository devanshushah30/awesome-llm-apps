// /api/diagrams
//   GET  → list saved diagrams (id, name, timestamps; newest first)
//   POST → save a new diagram { name, data }
'use strict';

const { checkAuth, readJsonBody, supabase, send, handleError } = require('./_lib');

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per diagram

function summarize(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, created_at: row.created_at, updated_at: row.updated_at };
}

module.exports = async (req, res) => {
  try {
    checkAuth(req);

    if (req.method === 'GET') {
      const rows = await supabase('/diagrams', {
        query: '?select=id,name,created_at,updated_at&order=updated_at.desc&limit=100',
      });
      return send(res, 200, { diagrams: (rows || []).map(summarize) });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : 'Untitled diagram';
      if (!body.data || typeof body.data !== 'object') {
        return send(res, 400, { error: 'Missing diagram data object.' });
      }
      if (Buffer.byteLength(JSON.stringify(body.data), 'utf8') > MAX_BYTES) {
        return send(res, 413, { error: 'Diagram too large (10 MB max).' });
      }
      const rows = await supabase('/diagrams', { method: 'POST', body: { name, data: body.data } });
      const created = Array.isArray(rows) ? rows[0] : rows;
      return send(res, 201, { diagram: summarize(created) });
    }

    return send(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    handleError(res, err);
  }
};
