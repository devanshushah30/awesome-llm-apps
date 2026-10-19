// /api/diagrams/:id
//   GET    → fetch one diagram (with its data payload)
//   PATCH  → update name and/or data (used by "update cloud copy")
//   DELETE → delete a diagram
'use strict';

const { checkAuth, readJsonBody, supabase, send, handleError } = require('../_lib');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per diagram

module.exports = async (req, res) => {
  try {
    checkAuth(req);
    const id = req.query && req.query.id;
    if (!id || !UUID_RE.test(String(id))) {
      return send(res, 400, { error: 'Invalid diagram id.' });
    }
    const filter = `?id=eq.${id}`;

    if (req.method === 'GET') {
      const rows = await supabase('/diagrams', {
        query: `${filter}&select=id,name,data,created_at,updated_at`,
      });
      const row = rows && rows[0];
      if (!row) return send(res, 404, { error: 'Diagram not found.' });
      return send(res, 200, { diagram: row });
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = await readJsonBody(req);
      const patch = { updated_at: new Date().toISOString() };
      if (typeof body.name === 'string' && body.name.trim()) {
        patch.name = body.name.trim().slice(0, 120);
      }
      if (body.data && typeof body.data === 'object') {
        if (Buffer.byteLength(JSON.stringify(body.data), 'utf8') > MAX_BYTES) {
          return send(res, 413, { error: 'Diagram too large (10 MB max).' });
        }
        patch.data = body.data;
      }
      const rows = await supabase('/diagrams', { method: 'PATCH', query: filter, body: patch });
      const updated = rows && rows[0];
      if (!updated) return send(res, 404, { error: 'Diagram not found.' });
      return send(res, 200, {
        diagram: {
          id: updated.id,
          name: updated.name,
          created_at: updated.created_at,
          updated_at: updated.updated_at,
        },
      });
    }

    if (req.method === 'DELETE') {
      await supabase('/diagrams', { method: 'DELETE', query: filter });
      return send(res, 200, { deleted: true, id });
    }

    return send(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    handleError(res, err);
  }
};
