// Pacote de imagens de cada veículo, gerado em segundo plano:
//   slot 1    = arte com marca, modelo, preço, itens e três fotos menores (feita no servidor);
//   slots 2-5 = o carro num estacionamento vazio (IA de imagens do Google).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const storage = require('../storage');
const settings = require('../settings');
const { get, all, run } = require('../db');
const card = require('./card');
const gemini = require('./gemini');
const pollinations = require('./pollinations');

const SLOTS = [1, 2, 3, 4, 5];
const PARKING = [2, 3, 4, 5];
const mediaDir = () => path.join(config.dataDir, 'media');
const mediaUrl = (f) => `${config.publicUrl}/media/${f}`;
const hash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

function rowsOf(vehicleId) {
  const map = new Map(all('SELECT * FROM arts WHERE vehicle_id = ?', vehicleId).map((r) => [r.slot, r]));
  return SLOTS.map((slot) => map.get(slot) || { vehicle_id: vehicleId, slot, filename: '', status: 'pendente', error: '', source_key: '', photo_id: null });
}

function upsert(vehicleId, slot, fields) {
  const cur = get('SELECT 1 FROM arts WHERE vehicle_id = ? AND slot = ?', vehicleId, slot);
  const cols = Object.keys(fields);
  if (cur) run(`UPDATE arts SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE vehicle_id=? AND slot=?`, ...cols.map((c) => fields[c]), vehicleId, slot);
  else run(`INSERT INTO arts (vehicle_id, slot, ${cols.join(',')}) VALUES (?, ?, ${cols.map(() => '?').join(',')})`, vehicleId, slot, ...cols.map((c) => fields[c]));
}

function photosOf(vehicleId) {
  return all('SELECT id, filename, mime FROM photos WHERE vehicle_id = ? ORDER BY position, id', vehicleId);
}

// Foto de origem de cada imagem do estacionamento: a escolhida pela loja ou, por padrão, as primeiras fotos.
function sourcePhoto(row, photos) {
  if (row.photo_id) { const p = photos.find((x) => x.id === row.photo_id); if (p) return p; }
  return photos[(row.slot - 2) % Math.min(photos.length, 4)];
}

function cardKey(v, photos, store) {
  return hash([v.marca, v.modelo, v.versao, v.ano_fab, v.ano_modelo, v.km, v.preco, v.preco_oferta, v.destaques, v.cambio, v.combustivel, v.cor, v.carroceria,
    photos.slice(0, 4).map((p) => p.filename), store.name, store.whatsapp, store.phone, store.city, 'v2']);
}

async function writeMedia(buffer) {
  const name = crypto.randomBytes(16).toString('hex') + '.jpg';
  fs.mkdirSync(mediaDir(), { recursive: true });
  fs.writeFileSync(path.join(mediaDir(), name), buffer);
  await storage.saveMedia(name);
  return name;
}

function dropFile(name) {
  if (!name) return;
  fs.rm(path.join(mediaDir(), name), () => {});
  storage.removeMedia([name]).catch(() => {});
}

/* ---------------- Fila em segundo plano ---------------- */

const pending = new Map(); // vehicleId -> { force: Set<slot>, timer }
const queue = [];
let busy = false;
let current = null;

function schedule(vehicleId, { force = [], delay = 2500 } = {}) {
  const id = Number(vehicleId);
  const p = pending.get(id) || { force: new Set() };
  force.forEach((s) => p.force.add(Number(s)));
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { pending.delete(id); enqueue(id, [...p.force]); }, delay);
  if (p.timer.unref) p.timer.unref();
  pending.set(id, p);
}

function enqueue(id, force) {
  const q = queue.find((x) => x.id === id);
  if (q) force.forEach((s) => q.force.includes(s) || q.force.push(s));
  else queue.push({ id, force });
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    current = queue.shift();
    try { await processVehicle(current.id, current.force); }
    catch (e) { console.error(`Imagens do veículo ${current.id}:`, e.message); }
  }
  current = null;
  busy = false;
}

// Espera a fila esvaziar (usado nos testes).
async function idle(timeout = 30000) {
  const end = Date.now() + timeout;
  while ((busy || queue.length || pending.size) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

async function processVehicle(vehicleId, force = []) {
  const v = get('SELECT * FROM vehicles WHERE id = ?', vehicleId);
  if (!v || v.status === 'vendido') return;
  const photos = photosOf(v.id);
  if (!photos.length) return;
  const store = get('SELECT * FROM stores WHERE id = ?', v.store_id) || {};
  const rows = rowsOf(v.id);

  /* Imagem 1: arte */
  const r1 = rows[0];
  const k1 = cardKey(v, photos, store);
  if (force.includes(1) || r1.source_key !== k1 || r1.status !== 'pronta') {
    upsert(v.id, 1, { status: 'gerando', error: '' });
    try {
      const files = [];
      for (const p of photos.slice(0, 4)) { const f = await storage.ensureLocal(p.filename); if (f) files.push(f); }
      const buf = await card.renderCard(v, files, store);
      const name = await writeMedia(buf);
      if (!get('SELECT 1 FROM vehicles WHERE id = ?', v.id)) { dropFile(name); return; }
      upsert(v.id, 1, { filename: name, status: 'pronta', error: '', source_key: k1 });
      if (r1.filename && r1.filename !== name) dropFile(r1.filename);
    } catch (e) {
      upsert(v.id, 1, { status: 'erro', error: String(e.message).slice(0, 300) });
    }
  }

  /* Imagens 2 a 5: estacionamento (IA ou enviadas pela loja) */
  const a = settings.ai();
  const prov = a.provider === 'gemini' ? a.gemini : a.provider === 'pollinations' ? a.pollinations : null;
  for (const slot of PARKING) {
    const row = rowsOf(v.id)[slot - 1];
    const src = sourcePhoto(row, photos);
    const key = hash([src.filename, slot, 'v1']);
    const forced = force.includes(slot);
    if (!forced && row.source_key === 'manual' && row.status === 'pronta') continue; // enviada pela loja: não substitui
    if (!forced && row.status === 'pronta' && row.source_key === key) continue;
    if (!forced && row.status === 'erro' && row.source_key === key && !retryable(row)) continue; // não insiste sozinho em erro
    if (!prov) { if (row.status !== 'pronta') upsert(v.id, slot, { status: 'manual', error: '', source_key: '' }); continue; }
    if (!prov.key) { upsert(v.id, slot, { status: 'sem_chave', error: '', source_key: '' }); continue; }
    if (!forced && !a.auto) { if (row.status !== 'pronta') upsert(v.id, slot, { status: 'aguardando', error: '' }); continue; }
    upsert(v.id, slot, { status: 'gerando', error: '' });
    try {
      const file = await storage.ensureLocal(src.filename);
      if (!file) throw new Error('Foto de origem não encontrada.');
      const photo = fs.readFileSync(file);
      const { image } = a.provider === 'gemini'
        ? await gemini.parkingShot({ apiKey: prov.key, model: prov.model, photo, mime: src.mime, sceneIndex: slot - 2 })
        : await pollinations.edit({ apiKey: prov.key, model: prov.model, photo, mime: src.mime, prompt: gemini.promptFor(slot - 2), photoUrl: mediaUrl(src.filename) });
      const name = await writeMedia(await card.normalizeJpeg(image));
      if (!get('SELECT 1 FROM vehicles WHERE id = ?', v.id)) { dropFile(name); return; }
      upsert(v.id, slot, { filename: name, status: 'pronta', error: '', source_key: key });
      if (row.filename && row.filename !== name) dropFile(row.filename);
    } catch (e) {
      const msg = a.provider === 'gemini' ? gemini.friendly(e) : pollinations.friendly(e);
      upsert(v.id, slot, { status: 'erro', error: msg, source_key: key });
      if ([401, 402, 403, 429].includes(e.status)) break; // chave ou cota: para as demais
    }
  }
}

// Erro de cota (limite do dia) volta a ser tentado depois de 6 horas.
function retryable(row) {
  if (!/cota|limite/i.test(row.error || '')) return false;
  const t = Date.parse(String(row.updated_at || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) && Date.now() - t > 6 * 3600e3;
}

// Imagem enviada pela loja (feita no ChatGPT, no Gemini ou em outro editor).
async function saveManual(vehicleId, slot, buffer) {
  if (!PARKING.includes(slot)) throw Object.assign(new Error('Envie imagens só para as posições 2 a 5.'), { status: 400 });
  let jpg;
  try { jpg = await card.normalizeJpeg(buffer); } catch { throw Object.assign(new Error('Não foi possível ler a imagem. Envie JPG, PNG ou WEBP.'), { status: 400 }); }
  const row = rowsOf(vehicleId)[slot - 1];
  const name = await writeMedia(jpg);
  upsert(vehicleId, slot, { filename: name, status: 'pronta', error: '', source_key: 'manual' });
  if (row.filename && row.filename !== name) dropFile(row.filename);
}

function manualPrompts(vehicleId) {
  const photos = photosOf(vehicleId);
  return rowsOf(vehicleId).filter((r) => PARKING.includes(r.slot)).map((r) => {
    const src = photos.length ? sourcePhoto(r, photos) : null;
    return { slot: r.slot, prompt: gemini.promptPt(r.slot - 2), source_url: src ? mediaUrl(src.filename) : '' };
  });
}

/* ---------------- Consulta e manutenção ---------------- */

function listArts(vehicleId) {
  const inQueue = pending.has(vehicleId) || queue.some((q) => q.id === vehicleId) || current?.id === vehicleId;
  return rowsOf(vehicleId).map((r) => ({
    slot: r.slot,
    kind: r.slot === 1 ? 'arte' : 'estacionamento',
    status: r.status === 'pendente' && inQueue ? 'na_fila' : r.status,
    manual: r.source_key === 'manual',
    error: r.error || '',
    url: r.filename ? mediaUrl(r.filename) : '',
    filename: r.filename || '',
    photo_id: r.photo_id || null,
  }));
}

// Imagens prontas na ordem: arte primeiro, depois estacionamento.
function readyFiles(vehicleId) {
  return rowsOf(vehicleId).filter((r) => r.filename && r.status !== 'erro').map((r) => r.filename);
}

function setSource(vehicleId, slot, photoId) {
  if (!PARKING.includes(slot)) throw Object.assign(new Error('Só as imagens 2 a 5 usam foto de origem.'), { status: 400 });
  const ok = photoId ? get('SELECT 1 FROM photos WHERE id = ? AND vehicle_id = ?', photoId, vehicleId) : true;
  if (!ok) throw Object.assign(new Error('Foto não encontrada.'), { status: 404 });
  upsert(vehicleId, slot, { photo_id: photoId || null });
  schedule(vehicleId, { force: [slot], delay: 200 });
}

function filesOf(vehicleId) {
  return all('SELECT filename FROM arts WHERE vehicle_id = ? AND filename != ?', vehicleId, '').map((r) => r.filename);
}

// Na inicialização: gera o que falta para os veículos em estoque (sem repetir o que já está pronto).
function backfill() {
  run(`UPDATE arts SET status = 'pendente' WHERE status = 'gerando'`);
  const ids = all(`SELECT v.id FROM vehicles v WHERE v.status != 'vendido' AND EXISTS (SELECT 1 FROM photos p WHERE p.vehicle_id = v.id)`).map((r) => r.id);
  ids.forEach((id, i) => schedule(id, { delay: 5000 + i * 300 }));
  return ids.length;
}

// Confere de 6 em 6 horas (retoma o que parou por cota diária).
let timer;
function startTimer() {
  clearInterval(timer);
  timer = setInterval(() => { try { backfill(); } catch { /* tenta na próxima */ } }, 6 * 3600e3);
  if (timer.unref) timer.unref();
}

module.exports = { schedule, listArts, readyFiles, setSource, filesOf, backfill, startTimer, idle, processVehicle, saveManual, manualPrompts, PARKING };
