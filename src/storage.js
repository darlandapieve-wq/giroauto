// Armazenamento permanente no Supabase Storage (plano gratuito).
// - O banco SQLite é copiado para o Supabase alguns segundos depois de cada alteração e ao desligar o servidor.
// - Ao iniciar, o servidor baixa a última cópia antes de abrir o banco.
// - As fotos ficam no Supabase; o servidor guarda uma cópia local como cache.
// Sem SUPABASE_URL e SUPABASE_SECRET_KEY, tudo continua só no disco local (como antes).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const config = require('./config');

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET_DATA = process.env.SUPABASE_BUCKET_DADOS || 'giroauto-dados';
const BUCKET_MEDIA = process.env.SUPABASE_BUCKET_FOTOS || 'giroauto-fotos';
const DB_OBJECT = 'giroauto.db';

const enabled = () => !!(URL_ && KEY);
const state = { lastBackupAt: null, lastError: '', restoredFrom: null, dirty: false, timer: null, firstDirtyAt: 0, lastDaily: '' };

function headers(extra = {}) {
  // Chaves novas (sb_secret_...) vão só no cabeçalho apikey; chaves antigas (JWT) também no Authorization.
  const h = { apikey: KEY, ...extra };
  if (!KEY.startsWith('sb_')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function req(method, p, { body, contentType, upsert } = {}) {
  const extra = {};
  if (contentType) extra['Content-Type'] = contentType;
  if (upsert) extra['x-upsert'] = 'true';
  const res = await fetch(`${URL_}/storage/v1${p}`, { method, headers: headers(extra), body });
  return res;
}

async function ensureBuckets() {
  for (const id of [BUCKET_DATA, BUCKET_MEDIA]) {
    const r = await req('POST', '/bucket', { body: JSON.stringify({ id, name: id, public: false }), contentType: 'application/json' });
    if (!r.ok && r.status !== 409) {
      const t = await r.text();
      if (!/already exists|Duplicate/i.test(t)) throw new Error(`Supabase recusou criar o bucket ${id} (${r.status}): ${t.slice(0, 200)}`);
    }
  }
}

async function upload(bucket, name, data, contentType = 'application/octet-stream') {
  const r = await req('POST', `/object/${bucket}/${encodeURIComponent(name)}`, { body: data, contentType, upsert: true });
  if (!r.ok) throw new Error(`Falha ao enviar ${name} ao Supabase (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

async function download(bucket, name) {
  const r = await req('GET', `/object/${bucket}/${encodeURIComponent(name)}`);
  if (r.ok) return Buffer.from(await r.arrayBuffer());
  const t = await r.text();
  if (r.status === 404 || r.status === 400 && /not.?found/i.test(t)) return null;
  throw new Error(`Falha ao baixar ${name} do Supabase (${r.status}): ${t.slice(0, 200)}`);
}

async function remove(bucket, names) {
  if (!names.length) return;
  const r = await req('DELETE', `/object/${bucket}`, { body: JSON.stringify({ prefixes: names }), contentType: 'application/json' });
  if (!r.ok) console.warn('Supabase: falha ao apagar', names.join(', '), r.status);
}

/* ---------------- Banco ---------------- */

const dbPath = () => process.env.GIROAUTO_DB || path.join(config.dataDir, 'giroauto.db');

// Chamado antes de abrir o banco.
async function restore() {
  if (!enabled()) return { restored: false, reason: 'desativado' };
  await ensureBuckets();
  const snap = await download(BUCKET_DATA, DB_OBJECT);
  if (!snap) return { restored: false, reason: 'sem cópia no Supabase' };
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(dbPath() + ext, { force: true });
  fs.writeFileSync(dbPath(), snap);
  state.restoredFrom = new Date().toISOString();
  return { restored: true, bytes: snap.length };
}

function markDirty() {
  if (!enabled()) return;
  state.dirty = true;
  if (!state.firstDirtyAt) state.firstDirtyAt = Date.now();
  clearTimeout(state.timer);
  // Espera 3 s sem alterações (no máximo 15 s) para juntar várias gravações numa cópia só.
  const wait = Math.max(0, Math.min(3000, 15000 - (Date.now() - state.firstDirtyAt)));
  state.timer = setTimeout(() => { flush().catch(() => {}); }, wait);
}

let flushing = null;
async function flush() {
  if (!enabled()) return;
  if (flushing) await flushing;
  if (!state.dirty) return;
  flushing = (async () => {
    state.dirty = false; state.firstDirtyAt = 0; clearTimeout(state.timer);
    const { db } = require('./db');
    const tmp = path.join(os.tmpdir(), `giro-snap-${process.pid}-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const data = fs.readFileSync(tmp);
      await upload(BUCKET_DATA, DB_OBJECT, data);
      const day = new Date().toISOString().slice(0, 10);
      if (state.lastDaily !== day) { await upload(BUCKET_DATA, `copias/giroauto-${day}.db`, data); state.lastDaily = day; }
      state.lastBackupAt = new Date().toISOString();
      state.lastError = '';
    } catch (e) {
      state.lastError = e.message;
      state.dirty = true; // tenta de novo
      console.error('Backup no Supabase falhou:', e.message);
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { flush().catch(() => {}); }, 30000);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  })();
  try { await flushing; } finally { flushing = null; }
}

/* ---------------- Fotos ---------------- */

const mediaDir = () => path.join(config.dataDir, 'media');
const SAFE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function saveMedia(filename) {
  if (!enabled()) return;
  const file = path.join(mediaDir(), filename);
  await upload(BUCKET_MEDIA, filename, fs.readFileSync(file), MIME[path.extname(filename)] || 'image/jpeg');
}

// Garante a foto no disco local (baixa do Supabase se o servidor for novo). Devolve o caminho ou null.
async function ensureLocal(filename) {
  if (!SAFE.test(filename)) return null;
  const file = path.join(mediaDir(), filename);
  if (fs.existsSync(file)) return file;
  if (!enabled()) return null;
  const data = await download(BUCKET_MEDIA, filename);
  if (!data) return null;
  fs.mkdirSync(mediaDir(), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

async function removeMedia(filenames) {
  if (enabled()) await remove(BUCKET_MEDIA, filenames.filter((f) => SAFE.test(f)));
}

function status() {
  return {
    enabled: enabled(),
    provider: enabled() ? 'Supabase' : 'disco local',
    last_backup_at: state.lastBackupAt,
    restored_at: state.restoredFrom,
    pending: state.dirty,
    last_error: state.lastError,
  };
}

module.exports = { enabled, restore, markDirty, flush, saveMedia, ensureLocal, removeMedia, status, ensureBuckets, MIME, SAFE };
