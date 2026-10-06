// Imitação mínima do Supabase Storage (buckets e objetos em memória) para testes.
const http = require('node:http');

function createMockSupabase({ key = 'sb_secret_teste', pubKey = 'sb_publishable_teste', token = 'giro_token_teste' } = {}) {
  const files = new Map(); // modo banco: bucket/nome -> { data, parts, type, removido }
  const buckets = new Map();
  const log = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    log.push({ method: req.method, path: url.pathname, headers: req.headers });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    // Modo "banco": funções RPC do PostgREST, como as criadas no projeto real.
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (req.headers.apikey !== pubKey) return send(401, { message: 'Invalid API key' });
      if (req.headers.authorization) return send(401, { message: 'Invalid Compact JWS' });
      const a = JSON.parse(body.toString() || '{}');
      if (a.p_token !== token) return send(403, { code: '42501', message: 'acesso negado' });
      const fn = url.pathname.slice('/rest/v1/rpc/'.length);
      const k = (n) => `${a.p_bucket}/${n}`;
      if (fn === 'giro_stats') return send(200, { files: files.size, bytes: 0 });
      if (fn === 'giro_put_part') {
        const cur = files.get(k(a.p_tmp));
        if (a.p_idx === 0) files.set(k(a.p_tmp), { data: Buffer.from(a.p_data, 'base64'), parts: 1 });
        else if (!cur || cur.parts !== a.p_idx) return send(400, { message: 'parte fora de ordem' });
        else { cur.data = Buffer.concat([cur.data, Buffer.from(a.p_data, 'base64')]); cur.parts++; }
        res.writeHead(204); return res.end();
      }
      if (fn === 'giro_commit') {
        const t = files.get(k(a.p_tmp));
        if (!t || t.parts !== a.p_parts) return send(400, { message: 'envio incompleto' });
        files.set(k(a.p_name), { data: t.data, parts: t.parts, type: a.p_type, removido: false });
        files.set(k(a.p_tmp), { data: Buffer.alloc(0), parts: 0, removido: true });
        res.writeHead(204); return res.end();
      }
      if (fn === 'giro_get_info') {
        const f = files.get(k(a.p_name));
        return send(200, f && !f.removido ? { size: f.data.length, content_type: f.type } : null);
      }
      if (fn === 'giro_get_part') {
        const f = files.get(k(a.p_name));
        return send(200, f && !f.removido ? f.data.subarray(a.p_offset, a.p_offset + a.p_len).toString('base64') : null);
      }
      if (fn === 'giro_remove') { a.p_names.forEach((n) => { const f = files.get(k(n)); if (f) { f.removido = true; f.data = Buffer.alloc(0); } }); res.writeHead(204); return res.end(); }
      return send(404, { message: 'função não encontrada' });
    }
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
  return { server, buckets, files, log };
}

module.exports = { createMockSupabase };
