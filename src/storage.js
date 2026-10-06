// Armazenamento permanente no Supabase Storage (plano gratuito).
// - O banco SQLite é copiado para o Supabase alguns segundos depois de cada alteração e ao desligar o servidor.
// - Ao iniciar, o servidor baixa a última cópia antes de abrir o banco.
// - As fotos ficam no Supabase; o servidor guarda uma cópia local como cache.
// Dois modos de acesso ao Supabase:
//  - "banco": SUPABASE_URL + SUPABASE_KEY (chave publicável) + GIROAUTO_STORAGE_TOKEN. Os arquivos ficam no
//    Postgres do projeto, num esquema privado, acessado só por funções que exigem a senha do servidor.
//  - "storage": SUPABASE_URL + SUPABASE_SECRET_KEY. Os arquivos ficam no Supabase Storage.
// Sem nenhum dos dois, tudo continua só no disco local (como antes).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const config = require('./config');

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const PUBKEY = process.env.SUPABASE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const TOKEN = process.env.GIROAUTO_STORAGE_TOKEN || '';
const MODE = URL_ && PUBKEY && TOKEN ? 'banco' : (URL_ && SECRET ? 'storage' : '');
const KEY = MODE === 'banco' ? PUBKEY : SECRET;
const PART = 512 * 1024; // tamanho de cada parte enviada ao banco
const BUCKET_DATA = process.env.SUPABASE_BUCKET_DADOS || 'giroauto-dados';
const BUCKET_MEDIA = process.env.SUPABASE_BUCKET_FOTOS || 'giroauto-fotos';
const DB_OBJECT = 'giroauto.db';

const enabled = () => !!MODE;
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

async function rpc(fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ p_token: TOKEN, ...args }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text; try { msg = JSON.parse(text).message || text; } catch { /* texto puro */ }
    throw new Error(`Supabase (${fn}) respondeu ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function ensureBuckets() {
  if (MODE === 'banco') { await rpc('giro_stats', {}); return; } // confere a senha do servidor
  for (const id of [BUCKET_DATA, BUCKET_MEDIA]) {
    const r = await req('POST', '/bucket', { body: JSON.stringify({ id, name: id, public: false }), contentType: 'application/json' });
    if (!r.ok && r.status !== 409) {
      const t = await r.text();
      if (!/already exists|Duplicate/i.test(t)) throw new Error(`Supabase recusou criar o bucket ${id} (${r.status}): ${t.slice(0, 200)}`);
    }
  }
}

async function upload(bucket, name, data, contentType = 'application/octet-stream') {
  if (MODE === 'banco') {
    const tmp = `${name}#tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parts = Math.max(1, Math.ceil(data.length / PART));
    for (let i = 0; i < parts; i++) {
      await rpc('giro_put_part', { p_bucket: bucket, p_tmp: tmp, p_idx: i, p_data: data.subarray(i * PART, (i + 1) * PART).toString('base64') });
    }
    await rpc('giro_commit', { p_bucket: bucket, p_tmp: tmp, p_name: name, p_parts: parts, p_type: contentType });
    return;
  }
  const r = await req('POST', `/object/${bucket}/${encodeURIComponent(name)}`, { body: data, contentType, upsert: true });
  if (!r.ok) throw new Error(`Falha ao enviar ${name} ao Supabase (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

async function download(bucket, name) {
  if (MODE === 'banco') {
    const info = await rpc('giro_get_info', { p_bucket: bucket, p_name: name });
    if (!info || info.size == null) return null;
    const bufs = [];
    for (let off = 0; off < info.size; off += PART) {
      const b64 = await rpc('giro_get_part', { p_bucket: bucket, p_name: name, p_offset: off, p_len: PART });
      bufs.push(Buffer.from(b64 || '', 'base64'));
    }
    const out = Buffer.concat(bufs);
    if (out.length !== Number(info.size)) throw new Error(`Arquivo ${name} veio incompleto do Supabase.`);
    return out;
  }
  const r = await req('GET', `/object/${bucket}/${encodeURIComponent(name)}`);
  if (r.ok) return Buffer.from(await r.arrayBuffer());
  const t = await r.text();
  if (r.status === 404 || r.status === 400 && /not.?found/i.test(t)) return null;
  throw new Error(`Falha ao baixar ${name} do Supabase (${r.status}): ${t.slice(0, 200)}`);
}

async function remove(bucket, names) {
  if (!names.length) return;
  if (MODE === 'banco') { await rpc('giro_remove', { p_bucket: bucket, p_names: names }); return; }
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
    mode: MODE || 'local',
    last_backup_at: state.lastBackupAt,
    restored_at: state.restoredFrom,
    pending: state.dirty,
    last_error: state.lastError,
  };
}

module.exports = { enabled, restore, markDirty, flush, saveMedia, ensureLocal, removeMedia, status, ensureBuckets, MIME, SAFE };
