const { get, run } = require('./db');
const { randomToken, sha256 } = require('./crypto');
const config = require('./config');

const COOKIE = 'giro_sess';
const SESSION_DAYS = 30;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 864e5;
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = get(
      `SELECT u.id, u.name, u.email, u.role, u.store_id, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      sha256(token),
    );
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, name: row.name, email: row.email, role: row.role, storeId: row.store_id };
    }
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  next();
}

// Extensão: token Bearer emitido no pareamento.
function requireExtension(req, res, next) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Extensão não pareada.' });
  const row = get('SELECT store_id FROM ext_tokens WHERE token_hash = ?', sha256(m[1]));
  if (!row) return res.status(401).json({ error: 'Pareamento inválido ou revogado. Pareie a extensão de novo pelo painel.' });
  run("UPDATE ext_tokens SET last_seen = datetime('now') WHERE token_hash = ?", sha256(m[1]));
  req.ext = { storeId: row.store_id };
  next();
}

module.exports = { createSession, destroySession, loadUser, requireUser, requireExtension, parseCookies };
