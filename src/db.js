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
// v2.0: proprietário/consignação, identificação, FIPE, compra/venda, localização, equipe e gestão.
for (const [col, def] of [
  ['proprietario_tipo', "TEXT NOT NULL DEFAULT 'proprio'"], ['proprietario_nome', "TEXT DEFAULT ''"], ['proprietario_doc', "TEXT DEFAULT ''"],
  ['proprietario_tel', "TEXT DEFAULT ''"], ['proprietario_obs', "TEXT DEFAULT ''"], ['consig_repasse', 'INTEGER NOT NULL DEFAULT 0'],
  ['consig_comissao_pct', 'REAL NOT NULL DEFAULT 0'], ['procuracao_validade', 'TEXT'], ['procuracao_file', "TEXT DEFAULT ''"],
  ['procuracao_nome', "TEXT DEFAULT ''"], ['renavam', "TEXT DEFAULT ''"], ['chassi', "TEXT DEFAULT ''"], ['municipio_placa', "TEXT DEFAULT ''"],
  ['fipe_codigo', "TEXT DEFAULT ''"], ['fipe_ref', "TEXT DEFAULT ''"],
  ['compra_valor', 'INTEGER NOT NULL DEFAULT 0'], ['compra_data', 'TEXT'], ['compra_de', "TEXT DEFAULT ''"],
  ['venda_valor', 'INTEGER NOT NULL DEFAULT 0'], ['venda_comprador', "TEXT DEFAULT ''"], ['venda_pagamento', "TEXT DEFAULT ''"],
  ['venda_comissao', 'INTEGER NOT NULL DEFAULT 0'], ['venda_vendedor_id', 'INTEGER'],
  ['local_status', "TEXT NOT NULL DEFAULT 'patio'"], ['local_parceiro_id', 'INTEGER'], ['local_desde', 'TEXT'], ['local_previsao', 'TEXT'],
  ['local_obs', "TEXT DEFAULT ''"], ['created_by', 'INTEGER'],
]) addColumn('vehicles', col, def);
addColumn('users', 'permissions', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
for (const [col, def] of [
  ['parado_dias', 'INTEGER NOT NULL DEFAULT 25'], ['rep_schedule', "TEXT NOT NULL DEFAULT ''"], ['foto_opts', "TEXT NOT NULL DEFAULT ''"],
  ['logo_file', "TEXT DEFAULT ''"], ['impostos_pct', 'REAL NOT NULL DEFAULT 0'], ['tv_key', "TEXT DEFAULT ''"],
]) addColumn('stores', col, def);
db.exec(`CREATE TABLE IF NOT EXISTS vehicle_costs (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL DEFAULT 'outros',
  descricao TEXT DEFAULT '',
  valor INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  parceiro_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'oficina',
  contato TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  endereco TEXT DEFAULT '',
  obs TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS vehicle_moves (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  parceiro_id INTEGER,
  obs TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS plate_cache (placa TEXT PRIMARY KEY, data_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS rep_runs (store_id INTEGER NOT NULL, slot TEXT NOT NULL, PRIMARY KEY (store_id, slot))`);

// v2.1: documentação separada do proprietário, origem da compra, venda completa e transferência, custos previstos, despesas da loja.
for (const [col, def] of [
  ['doc_tipo', "TEXT NOT NULL DEFAULT 'loja'"], ['compra_origem', "TEXT DEFAULT ''"],
  ['comprador_doc', "TEXT DEFAULT ''"], ['comprador_tel', "TEXT DEFAULT ''"], ['venda_entrada', 'INTEGER NOT NULL DEFAULT 0'],
  ['venda_financeira', "TEXT DEFAULT ''"], ['venda_troca_valor', 'INTEGER NOT NULL DEFAULT 0'], ['venda_troca_desc', "TEXT DEFAULT ''"],
  ['venda_obs', "TEXT DEFAULT ''"], ['doc_status', "TEXT DEFAULT ''"], ['doc_atualizado', 'TEXT'], ['doc_obs', "TEXT DEFAULT ''"], ['doc_entrega', 'TEXT'],
]) addColumn('vehicles', col, def);
addColumn('vehicle_costs', 'status', "TEXT NOT NULL DEFAULT 'realizado'");
// v2.2: margem da loja em valor fixo, preço de repasse, grupos de repasse, comissão lançada como despesa.
for (const [col, def] of [['margem_tipo', "TEXT NOT NULL DEFAULT 'pct'"], ['margem_fixa', 'INTEGER NOT NULL DEFAULT 0'], ['preco_repasse', 'INTEGER NOT NULL DEFAULT 0']]) addColumn('vehicles', col, def);
addColumn('stores', 'repasse_grupos', "TEXT NOT NULL DEFAULT '[]'");
db.exec(`CREATE TABLE IF NOT EXISTS repasse_posts (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  grupo TEXT NOT NULL,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS store_expenses (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'outros',
  descricao TEXT DEFAULT '',
  valor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS doc_moves (
  id INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  obs TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

addColumn('store_expenses', 'vendedor_id', 'INTEGER');
addColumn('store_expenses', 'vehicle_id', 'INTEGER');
// Conexão direta com o Instagram (v1.9).
db.exec(`CREATE TABLE IF NOT EXISTS ig_connections (
  store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL,
  username TEXT DEFAULT '',
  token_enc TEXT NOT NULL,
  expires_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
// v1.10: tira das descrições a frase final da loja ("… Chame para agendar uma visita ou test drive.").
// Agora ela é opcional, pela caixa "Convite para visita" no cadastro.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'mig_v110_rodape'").get()) {
  const re = /\n*[^\n]*Chame para agendar uma visita ou test drive\.?[ \t]*$/;
  for (const r of db.prepare('SELECT id, descricao FROM vehicles').all()) {
    if (r.descricao && re.test(r.descricao)) db.prepare('UPDATE vehicles SET descricao = ? WHERE id = ?').run(r.descricao.replace(re, '').trimEnd(), r.id);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('mig_v110_rodape', '1')").run();
}
// v2.1: "procuração" deixa de ser tipo de proprietário e passa a ser tipo de documentação.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'mig_v21_doc'").get()) {
  db.exec("UPDATE vehicles SET proprietario_tipo = 'consignado', doc_tipo = 'procuracao' WHERE proprietario_tipo = 'procuracao'");
  db.exec("UPDATE vehicles SET doc_status = 'pendente' WHERE status = 'vendido' AND (doc_status IS NULL OR doc_status = '')");
  db.prepare("INSERT INTO settings (key, value) VALUES ('mig_v21_doc', '1')").run();
}
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
