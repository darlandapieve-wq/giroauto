const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });

const db = new DatabaseSync(process.env.GIROAUTO_DB || path.join(config.dataDir, 'giroauto.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  feed_key TEXT NOT NULL,
  phone TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  postal_code TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  versao TEXT DEFAULT '',
  ano_fab INTEGER,
  ano_modelo INTEGER,
  km INTEGER DEFAULT 0,
  preco INTEGER DEFAULT 0,
  fipe INTEGER DEFAULT 0,
  placa TEXT DEFAULT '',
  cor TEXT DEFAULT '',
  cambio TEXT DEFAULT '',
  combustivel TEXT DEFAULT '',
  carroceria TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'rascunho',
  organico INTEGER NOT NULL DEFAULT 1,
  catalogo INTEGER NOT NULL DEFAULT 0,
  fb_listing_url TEXT DEFAULT '',
  publicado_em TEXT,
  vendido_em TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS vehicles_store ON vehicles(store_id, status);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ext_tokens (
  token_hash TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS pair_codes (
  code TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ext_jobs (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta_connections (
  store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  fb_user_id TEXT,
  fb_user_name TEXT,
  token_enc TEXT,
  token_expires_at INTEGER,
  business_id TEXT DEFAULT '',
  ad_account_id TEXT DEFAULT '',
  ad_account_name TEXT DEFAULT '',
  currency TEXT DEFAULT 'BRL',
  page_id TEXT DEFAULT '',
  page_name TEXT DEFAULT '',
  ig_user_id TEXT DEFAULT '',
  ig_username TEXT DEFAULT '',
  whatsapp_number TEXT DEFAULT '',
  catalog_id TEXT DEFAULT '',
  feed_id TEXT DEFAULT '',
  catalog_synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'criando',
  daily_budget_cents INTEGER NOT NULL,
  days INTEGER NOT NULL,
  city_key TEXT NOT NULL,
  city_name TEXT NOT NULL,
  radius_km INTEGER NOT NULL,
  age_min INTEGER NOT NULL DEFAULT 18,
  age_max INTEGER NOT NULL DEFAULT 65,
  message TEXT DEFAULT '',
  meta_campaign_id TEXT DEFAULT '',
  meta_adset_id TEXT DEFAULT '',
  meta_creative_id TEXT DEFAULT '',
  meta_ad_id TEXT DEFAULT '',
  meta_product_set_id TEXT DEFAULT '',
  start_time TEXT,
  end_time TEXT,
  error TEXT DEFAULT '',
  stats_json TEXT DEFAULT '',
  stats_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campaign_vehicles (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, vehicle_id)
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

// Migrações simples (colunas adicionadas depois da primeira versão).
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
// Modo de publicação orgânica: 'manual' (assistente no painel, sem instalar nada) ou 'extensao'.
addColumn('stores', 'pub_mode', "TEXT NOT NULL DEFAULT 'manual'");
// Administrador da plataforma (quem configura o app da Meta). O primeiro usuário cadastrado vira administrador.
// Veículo escolhido para o preenchimento automático (favorito no Facebook).
addColumn('stores', 'assist_vehicle_id', 'INTEGER');
addColumn('vehicles', 'cor_interna', "TEXT DEFAULT ''");
addColumn('stores', 'assist_at', 'TEXT');
// Publicação automática pela extensão (v1.5).
addColumn('stores', 'auto_publish', 'INTEGER NOT NULL DEFAULT 1');
addColumn('stores', 'daily_limit', 'INTEGER NOT NULL DEFAULT 15');
addColumn('ext_jobs', 'note', "TEXT DEFAULT ''");
// Público e posicionamentos das campanhas (v1.6).
addColumn('campaigns', 'audience_mode', "TEXT NOT NULL DEFAULT 'manual'");
addColumn('campaigns', 'genders', "TEXT NOT NULL DEFAULT ''");
addColumn('campaigns', 'interests_json', "TEXT NOT NULL DEFAULT '[]'");
addColumn('campaigns', 'placements', "TEXT NOT NULL DEFAULT 'manual'");
addColumn('campaigns', 'positions_json', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
// Imagens geradas para cada veículo (v1.7): 1 = arte com preço e dados, 2 a 5 = estacionamento (IA).
db.exec(`CREATE TABLE IF NOT EXISTS arts (
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  filename TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente',
  error TEXT DEFAULT '',
  source_key TEXT DEFAULT '',
  photo_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (vehicle_id, slot)
)`);
// Publicações em outros canais (v1.7): instagram, webmotors, olx.
db.exec(`CREATE TABLE IF NOT EXISTS listings (
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'publicado',
  url TEXT DEFAULT '',
  external_id TEXT DEFAULT '',
  error TEXT DEFAULT '',
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (vehicle_id, channel)
)`);
// Destaques e preço de oferta (v1.8).
addColumn('vehicles', 'destaques', "TEXT NOT NULL DEFAULT '[]'");
addColumn('vehicles', 'preco_oferta', 'INTEGER NOT NULL DEFAULT 0');
addColumn('vehicles', 'oferta_desde', 'TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
if (!db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get()) {
  db.exec('UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)');
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); markDirty(); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const plain = (row) => (row ? { ...row } : row);
const all = (sql, ...a) => db.prepare(sql).all(...a).map(plain);
const get = (sql, ...a) => plain(db.prepare(sql).get(...a));
const markDirty = () => require('./storage').markDirty();
const run = (sql, ...a) => { const r = db.prepare(sql).run(...a); if (r.changes) markDirty(); return r; };

function logEvent(storeId, message) {
  run('INSERT INTO events (store_id, message) VALUES (?, ?)', storeId, message);
}

module.exports = { db, tx, all, get, run, logEvent };
