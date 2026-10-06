// Imitação mínima do Supabase Storage (buckets e objetos em memória) para testes.
const http = require('node:http');

function createMockSupabase({ key = 'sb_secret_teste' } = {}) {
  const buckets = new Map();
  const log = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    log.push({ method: req.method, path: url.pathname, headers: req.headers });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.apikey !== key) return send(401, { message: 'Invalid API key' });
    if (req.headers.authorization) return send(400, { message: 'Invalid Compact JWS' }); // chaves novas não usam Authorization
    const p = url.pathname.replace(/^\/storage\/v1/, '');
    if (req.method === 'POST' && p === '/bucket') {
      const { id } = JSON.parse(body.toString());
      if (buckets.has(id)) return send(409, { message: 'The resource already exists' });
      buckets.set(id, new Map()); return send(200, { name: id });
    }
    const m = /^\/object\/([^/]+)(?:\/(.+))?$/.exec(p);
    if (!m) return send(404, { message: 'not found' });
    const b = buckets.get(m[1]);
    if (!b) return send(404, { message: 'Bucket not found' });
    const name = m[2] && decodeURIComponent(m[2]);
    if (req.method === 'POST' && name) { b.set(name, { data: body, type: req.headers['content-type'] }); return send(200, { Key: `${m[1]}/${name}` }); }
    if (req.method === 'GET' && name) {
      const o = b.get(name);
      if (!o) return send(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'Content-Type': o.type || 'application/octet-stream' }); return res.end(o.data);
    }
    if (req.method === 'DELETE' && !name) { JSON.parse(body.toString()).prefixes.forEach((n) => b.delete(n)); return send(200, []); }
    return send(404, { message: 'not found' });
  });
  return { server, buckets, log };
}

module.exports = { createMockSupabase };
