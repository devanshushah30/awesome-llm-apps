// GET /api/health — liveness probe (no auth required).
'use strict';

const { send } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed.' });
  send(res, 200, { ok: true, service: 'excaliflow-cloud', time: new Date().toISOString() });
};
