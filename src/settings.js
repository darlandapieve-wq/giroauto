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
  const legacy = { catalog_management: 'catalogo', instagram_basic: 'instagram' }; // nomes da v1.6.1
  const v = read('meta_extra_scopes') || '';
  config.meta.extraScopes = [...new Set(v.split(',').map((x) => legacy[x] || x).filter((x) => x && config.meta.optionalScopes[x]))];
}

function saveExtraScopes(list) {
  const legacy = { catalog_management: 'catalogo', instagram_basic: 'instagram' };
  const clean = [...new Set((list || []).map((x) => legacy[x] || x).filter((x) => config.meta.optionalScopes[x]))];
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

/* IA de imagens: 'manual' (ChatGPT/Gemini à mão, grátis), 'pollinations' (cota grátis diária) ou 'gemini' (pago) */
function secret(name, envName) {
  const enc = read(name);
  let key = '';
  try { key = enc ? decrypt(enc) : ''; } catch { key = ''; }
  return { key: key || process.env[envName] || '', source: key ? 'painel' : (process.env[envName] ? 'env' : '') };
}
function ai() {
  const gemini = { ...secret('gemini_key_enc', 'GEMINI_API_KEY'), model: read('gemini_model') || process.env.GEMINI_MODEL || '' };
  const pollinations = { ...secret('pollinations_key_enc', 'POLLINATIONS_API_KEY'), model: read('pollinations_model') || '' };
  let provider = read('ai_provider') || '';
  if (!provider) provider = gemini.key ? 'gemini' : pollinations.key ? 'pollinations' : 'manual'; // instalações da v1.7
  return { provider, auto: read('gemini_auto') !== '0', gemini, pollinations };
}
// Compatibilidade com a v1.7.
function gemini() {
  const a = ai();
  const cur = a.provider === 'gemini' ? a.gemini : a.provider === 'pollinations' ? a.pollinations : { key: '', source: '', model: '' };
  return { ...cur, provider: a.provider, auto: a.auto };
}
function saveAi({ provider, geminiKey, geminiModel, pollinationsKey, pollinationsModel, auto }) {
  if (provider !== undefined) write('ai_provider', provider);
  if (geminiKey !== undefined) write('gemini_key_enc', geminiKey ? encrypt(geminiKey) : '');
  if (geminiModel !== undefined) write('gemini_model', geminiModel || '');
  if (pollinationsKey !== undefined) write('pollinations_key_enc', pollinationsKey ? encrypt(pollinationsKey) : '');
  if (pollinationsModel !== undefined) write('pollinations_model', pollinationsModel || '');
  if (auto !== undefined) write('gemini_auto', auto ? '1' : '0');
}

applyMetaApp();
applyScopes();

module.exports = { applyMetaApp, saveMetaApp, clearMetaApp, saveExtraScopes, applyScopes, gemini, ai, saveAi };
