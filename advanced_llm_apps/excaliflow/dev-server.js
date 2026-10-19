// Excaliflow local dev server: serves static files AND mounts /api/*
// using the same handler modules Vercel runs in production.
// Zero dependencies. Reads .env (gitignored) for SUPABASE_* / CLOUD_PASSWORD.
//
//   cp .env.example .env   # fill in your Supabase project
//   npm run dev            # → http://localhost:3000
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// --- minimal .env loader (no dependencies) ---
(function loadEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || m[1].startsWith('#')) continue;
      let v = m[2].trim();
      if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {
    /* .env is optional */
  }
})();

const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.excaliflow': 'application/json; charset=utf-8',
  '.excalidraw': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

// Map /api/* paths to handler modules, mirroring Vercel's file routing.
function resolveApi(pathname) {
  if (pathname === '/api/health') return { file: 'health.js', params: {} };
  if (pathname === '/api/diagrams') return { file: 'diagrams.js', params: {} };
  const m = pathname.match(/^\/api\/diagrams\/([^/]+)$/);
  if (m) return { file: path.join('diagrams', '[id].js'), params: { id: decodeURIComponent(m[1]) } };
  return null;
}

async function handleApi(req, res, route, url) {
  const handler = require(path.join(ROOT, 'api', route.file));
  // Emulate Vercel: req.query holds route params + querystring values.
  req.query = Object.assign({}, route.params);
  for (const [k, v] of url.searchParams) req.query[k] = v;
  // Emulate Vercel's JSON body parsing.
  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try {
        req.body = JSON.parse(raw);
      } catch {
        req.body = raw;
      }
    } else {
      req.body = {};
    }
  }
  await handler(req, res);
}

function serveStatic(req, res, pathname) {
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safePath = path.resolve(ROOT, relPath);
  if (safePath !== ROOT && !safePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  fs.stat(safePath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    fs.readFile(safePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  const route = resolveApi(url.pathname);
  if (route) {
    try {
      await handleApi(req, res, route, url);
    } catch (err) {
      console.error('[dev-server] api error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Internal server error.' }));
      }
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }
  serveStatic(req, res, url.pathname);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Excaliflow dev server (static + /api) at http://localhost:${PORT}`);
    if (!process.env.SUPABASE_URL) {
      console.log('Note: SUPABASE_URL is not set — /api/* will report misconfiguration until .env is filled in.');
    }
  });
}

module.exports = server;
