// Configurações da plataforma guardadas no banco (app da Meta), com a chave secreta criptografada.
const config = require('./config');
const { get, run } = require('./db');
const { encrypt, decrypt } = require('./crypto');

const ENV_APP_ID = config.meta.appId;
const ENV_APP_SECRET = config.meta.appSecret;

function read(key) { return get('SELECT value FROM settings WHERE key = ?', key)?.value ?? null; }
function write(key, value) {
  run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, key, value);
}

// Aplica no objeto de configuração em memória. O que foi salvo no painel tem prioridade sobre o .env.
function applyMetaApp() {
  const id = read('meta_app_id');
  const sec = read('meta_app_secret_enc');
  let secret = null;
  try { secret = sec ? decrypt(sec) : null; } catch { secret = null; }
  config.meta.appId = id || ENV_APP_ID;
  config.meta.appSecret = (id && secret) ? secret : ENV_APP_SECRET;
  config.meta.source = id && secret ? 'painel' : (ENV_APP_ID && ENV_APP_SECRET ? 'env' : '');
}

function applyScopes() {
  const v = read('meta_extra_scopes') || '';
  config.meta.extraScopes = v.split(',').filter((x) => x && config.meta.optionalScopes[x]);
}

function saveExtraScopes(list) {
  const clean = [...new Set((list || []).filter((x) => config.meta.optionalScopes[x]))];
  write('meta_extra_scopes', clean.join(','));
  applyScopes();
}

function saveMetaApp(appId, appSecret) {
  write('meta_app_id', appId);
  write('meta_app_secret_enc', encrypt(appSecret));
  applyMetaApp();
}

function clearMetaApp() {
  run("DELETE FROM settings WHERE key IN ('meta_app_id','meta_app_secret_enc')");
  applyMetaApp();
}

applyMetaApp();
applyScopes();

module.exports = { applyMetaApp, saveMetaApp, clearMetaApp, saveExtraScopes, applyScopes };
