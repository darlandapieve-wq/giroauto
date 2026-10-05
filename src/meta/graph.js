// Cliente mínimo da Graph API / API de Marketing da Meta.
const crypto = require('node:crypto');
const config = require('../config');

class MetaError extends Error {
  constructor(err, status) {
    const msg = err?.error_user_msg || err?.message || 'Erro desconhecido da Meta';
    super(msg);
    this.name = 'MetaError';
    this.status = status;
    this.code = err?.code;
    this.subcode = err?.error_subcode;
    this.title = err?.error_user_title || '';
    this.fbtraceId = err?.fbtrace_id;
    this.raw = err;
  }
}

function appsecretProof(token) {
  if (!config.meta.appSecret) return undefined;
  return crypto.createHmac('sha256', config.meta.appSecret).update(token).digest('hex');
}

function encodeParams(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return body;
}

async function call(method, path, token, params = {}) {
  const base = `${config.meta.graphUrl}/${config.meta.apiVersion}`;
  const url = new URL(base + (path.startsWith('/') ? path : `/${path}`));
  const all = { ...params };
  if (token) {
    all.access_token = token;
    const proof = appsecretProof(token);
    if (proof) all.appsecret_proof = proof;
  }
  let res;
  const opts = { method, headers: {} };
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of encodeParams(all)) url.searchParams.append(k, v);
  } else {
    opts.body = encodeParams(all);
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new MetaError({ message: `Sem conexão com a Meta (${e.message}).` }, 0);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 300) } }; }
  if (!res.ok || data.error) throw new MetaError(data.error, res.status);
  return data;
}

// Percorre a paginação (até `max` itens).
async function getAll(path, token, params = {}, max = 200) {
  const out = [];
  let after;
  do {
    const page = await call('GET', path, token, { limit: 100, ...params, ...(after ? { after } : {}) });
    out.push(...(page.data || []));
    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after && out.length < max);
  return out;
}

module.exports = {
  MetaError,
  get: (p, t, q) => call('GET', p, t, q),
  post: (p, t, q) => call('POST', p, t, q),
  del: (p, t, q) => call('DELETE', p, t, q),
  getAll,
};
