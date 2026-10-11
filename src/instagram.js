// Conexão direta com o Instagram ("API do Instagram com login do Instagram").
// Alternativa ao caminho pelo Facebook: a loja entra com a conta do Instagram e o GiroAuto
// recebe instagram_business_basic + instagram_business_content_publish.
const config = require('./config');
const settings = require('./settings');
const { get, run, logEvent } = require('./db');
const { encrypt, decrypt } = require('./crypto');

const AUTH_URL = () => (process.env.INSTAGRAM_AUTH_URL || 'https://www.instagram.com/oauth/authorize');
const API_URL = () => (process.env.INSTAGRAM_API_URL || 'https://api.instagram.com').replace(/\/+$/, '');
const GRAPH_URL = () => (process.env.INSTAGRAM_GRAPH_URL || 'https://graph.instagram.com').replace(/\/+$/, '');
const VERSION = process.env.INSTAGRAM_API_VERSION || 'v24.0';
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const REDIRECT_PATH = '/api/instagram/callback';
const redirectUri = () => `${config.publicUrl}${REDIRECT_PATH}`;

class IgError extends Error {
  constructor(err, status) {
    super(err?.error_user_msg || err?.message || err?.error_message || 'Erro desconhecido do Instagram');
    this.status = status; this.code = err?.code; this.title = err?.error_user_title || '';
  }
}

async function parse(r) {
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: { message: text.slice(0, 300) } }; }
  if (!r.ok || data.error || data.error_type) throw new IgError(data.error || data, r.status);
  return data;
}

function app() {
  const a = settings.instagramApp();
  return { id: a.id, secret: a.secret, configured: !!(a.id && a.secret) };
}

function connectUrl(state) {
  const u = new URL(AUTH_URL());
  u.searchParams.set('client_id', app().id);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('state', state);
  u.searchParams.set('force_reauth', 'true');
  return u.toString();
}

async function exchangeCode(code) {
  const a = app();
  const body = new URLSearchParams({ client_id: a.id, client_secret: a.secret, grant_type: 'authorization_code', redirect_uri: redirectUri(), code: String(code).replace(/#_$/, '') });
  const short = await parse(await fetch(`${API_URL()}/oauth/access_token`, { method: 'POST', body }));
  const tok = short.data?.[0] || short; // a API já devolveu nos dois formatos
  const longUrl = new URL(`${GRAPH_URL()}/access_token`);
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', a.secret);
  longUrl.searchParams.set('access_token', tok.access_token);
  let token = tok.access_token; let expiresIn = 3600;
  try { const l = await parse(await fetch(longUrl)); token = l.access_token || token; expiresIn = Number(l.expires_in || expiresIn); }
  catch (e) { console.error('Instagram: troca por token longo falhou:', e.message); }
  const me = await call('GET', '/me', token, { fields: 'user_id,username,account_type' });
  return { token, expiresAt: Date.now() + expiresIn * 1000, igUserId: String(me.user_id || me.id || tok.user_id), username: me.username || '', permissions: tok.permissions || [] };
}

function saveConnection(storeId, c) {
  run(`INSERT INTO ig_connections (store_id, ig_user_id, username, token_enc, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(store_id) DO UPDATE SET ig_user_id=excluded.ig_user_id, username=excluded.username, token_enc=excluded.token_enc, expires_at=excluded.expires_at, updated_at=datetime('now')`,
  storeId, c.igUserId, c.username, encrypt(c.token), c.expiresAt);
  logEvent(storeId, `Instagram @${c.username || c.igUserId} conectado (login do Instagram)`);
}

function connection(storeId) {
  return get('SELECT * FROM ig_connections WHERE store_id = ?', storeId);
}

// Token da loja; renova sozinho quando faltam menos de 15 dias para vencer.
async function tokenFor(storeId) {
  const c = connection(storeId);
  if (!c?.token_enc) return null;
  let token = decrypt(c.token_enc);
  const left = Number(c.expires_at || 0) - Date.now();
  if (left <= 0) throw new IgError({ message: 'A conexão com o Instagram venceu. Clique em Conectar Instagram de novo.' }, 401);
  if (left < 15 * 864e5) {
    try {
      const u = new URL(`${GRAPH_URL()}/refresh_access_token`);
      u.searchParams.set('grant_type', 'ig_refresh_token'); u.searchParams.set('access_token', token);
      const r = await parse(await fetch(u));
      token = r.access_token || token;
      run(`UPDATE ig_connections SET token_enc=?, expires_at=?, updated_at=datetime('now') WHERE store_id=?`, encrypt(token), Date.now() + Number(r.expires_in || 5184000) * 1000, storeId);
    } catch (e) { console.error('Instagram: renovação do token falhou:', e.message); }
  }
  return { token, igUserId: c.ig_user_id, username: c.username };
}

async function call(method, path, token, params = {}) {
  const url = new URL(`${GRAPH_URL()}/${VERSION}${path.startsWith('/') ? path : '/' + path}`);
  const all = { ...params, access_token: token };
  const opts = { method };
  if (method === 'GET') for (const [k, v] of Object.entries(all)) url.searchParams.set(k, String(v));
  else opts.body = new URLSearchParams(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, String(v)])));
  return parse(await fetch(url, opts));
}

function status(storeId) {
  const c = connection(storeId);
  return { app_configured: app().configured, connected: !!c?.token_enc, ig_user_id: c?.ig_user_id || '', username: c?.username || '', expires_at: c?.expires_at || null, redirect_uri: redirectUri() };
}

function disconnect(storeId) {
  run('DELETE FROM ig_connections WHERE store_id = ?', storeId);
  logEvent(storeId, 'Instagram desconectado');
}

module.exports = { IgError, connectUrl, exchangeCode, saveConnection, tokenFor, call, status, disconnect, redirectUri, SCOPES, app };
