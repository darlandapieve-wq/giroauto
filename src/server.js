const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { all, get, run, tx, logEvent } = require('./db');
const { hashPassword, verifyPassword, randomToken, sha256 } = require('./crypto');
const auth = require('./auth');
const V = require('./vehicles');
const feed = require('./feed');
const meta = require('./meta/service');
const { MetaError } = require('./meta/graph');
const pages = require('./pages');
const settings = require('./settings');
const storage = require('./storage');
const arts = require('./arts');
const channels = require('./channels');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(auth.loadUser);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------------ */
/* Arquivos públicos                                                  */
/* ------------------------------------------------------------------ */

// Fotos: nomes aleatórios, públicas (a Meta e a extensão precisam baixá-las).
// Fotos: nomes aleatórios, públicas (a Meta e o preenchimento precisam baixá-las).
// Se o servidor for novo, a foto é buscada no Supabase e guardada no disco como cache.
app.get('/media/:file', wrap(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const file = await storage.ensureLocal(req.params.file).catch(() => null);
  if (!file) return res.status(404).send('Foto não encontrada');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.type(storage.MIME[path.extname(file)] || 'image/jpeg').sendFile(file);
}));

app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

const VERSION = require('../package.json').version;
const EXT_DIR = path.join(__dirname, '..', 'extension');
let EXTENSION_ID = ''; let EXTENSION_VERSION = '';
try {
  const m = JSON.parse(require('node:fs').readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  EXTENSION_VERSION = m.version;
  if (m.key) {
    const der = Buffer.from(m.key, 'base64');
    EXTENSION_ID = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32).split('').map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
  }
} catch { /* extensão não incluída no servidor */ }

// Extensão do Chrome para baixar pelo painel (pasta giroauto-extensao dentro do .zip).
app.get('/extensao.zip', (req, res) => {
  const fs = require('node:fs');
  if (!fs.existsSync(EXT_DIR)) return res.status(404).send('Extensão não disponível neste servidor.');
  const files = fs.readdirSync(EXT_DIR).filter((f) => fs.statSync(path.join(EXT_DIR, f)).isFile())
    .map((f) => ({ name: `giroauto-extensao/${f}`, data: fs.readFileSync(path.join(EXT_DIR, f)) }));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="giroauto-extensao-${EXTENSION_VERSION}.zip"`);
  res.send(require('./zip').buildZip(files));
});
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));
app.get('/ponte', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'ponte.html')));
app.get('/privacidade', (req, res) => res.send(pages.privacy()));
app.get('/exclusao-de-dados', (req, res) => res.send(pages.deletion()));
app.get('/termos', (req, res) => res.send(pages.terms()));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'app.html')));

// Feed do catálogo de veículos (lido pela Meta a cada hora).
app.get('/feed/:slug.csv', (req, res) => {
  const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
  if (!store || req.query.k !== store.feed_key) return res.status(404).send('Feed não encontrado');
  res.type('text/csv; charset=utf-8').send(feed.buildCsv(store));
});

// Vitrine pública e página do veículo (destino dos anúncios de catálogo).
app.get('/v/:slug', (req, res) => {
  const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
  if (!store) return res.status(404).send(pages.notFound());
  const vs = all(`SELECT * FROM vehicles WHERE store_id = ? AND status IN ('pronto','publicado') ORDER BY updated_at DESC`, store.id).map(V.serialize);
  res.send(pages.storefront(store, vs));
});
app.get('/v/:slug/:id', (req, res) => {
  const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
  const v = store && V.serialize(V.findVehicle(store.id, req.params.id));
  if (!v || v.status === 'rascunho') return res.status(404).send(pages.notFound());
  res.send(pages.vehiclePage(store, v));
});

/* ------------------------------------------------------------------ */
/* Conta                                                              */
/* ------------------------------------------------------------------ */

function slugify(s) {
  const base = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'loja';
  let slug = base; let i = 2;
  while (get('SELECT 1 FROM stores WHERE slug = ?', slug)) slug = `${base}-${i++}`;
  return slug;
}

app.post('/api/auth/register', (req, res) => {
  const { loja, nome, email, senha } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!loja || !nome || !/^\S+@\S+\.\S+$/.test(em)) throw fail(400, 'Preencha o nome da loja, seu nome e um e-mail válido.');
  if (String(senha || '').length < 8) throw fail(400, 'A senha precisa ter ao menos 8 caracteres.');
  if (get('SELECT 1 FROM users WHERE email = ?', em)) throw fail(409, 'Já existe uma conta com este e-mail.');
  const userId = tx(() => {
    const s = run('INSERT INTO stores (name, slug, feed_key) VALUES (?, ?, ?)', String(loja).trim(), slugify(loja), randomToken(12));
    const firstAdmin = !get('SELECT 1 FROM users WHERE is_admin = 1');
    const u = run('INSERT INTO users (store_id, name, email, pass_hash, is_admin) VALUES (?, ?, ?, ?, ?)', s.lastInsertRowid, String(nome).trim(), em, hashPassword(senha), firstAdmin ? 1 : 0);
    return u.lastInsertRowid;
  });
  auth.createSession(res, userId);
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const em = String(req.body?.email || '').trim().toLowerCase();
  const u = get('SELECT * FROM users WHERE email = ?', em);
  if (!u || !verifyPassword(String(req.body?.senha || ''), u.pass_hash)) throw fail(401, 'E-mail ou senha incorretos.');
  auth.createSession(res, u.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });

app.get('/api/me', auth.requireUser, (req, res) => {
  const store = get('SELECT id, name, slug, phone, whatsapp, address, city, state, postal_code, pub_mode, auto_publish, daily_limit FROM stores WHERE id = ?', req.user.storeId);
  res.json({
    user: { ...req.user, is_admin: !!get('SELECT is_admin FROM users WHERE id = ?', req.user.id)?.is_admin }, store,
    vitrine_url: `${config.publicUrl}/v/${store.slug}`,
    options: { cambios: V.CAMBIOS, combustiveis: V.COMBUSTIVEIS, carrocerias: V.CARROCERIAS, cores: V.CORES },
    republish_days: config.republishDays,
    version: VERSION,
    extension: { id: EXTENSION_ID, version: EXTENSION_VERSION },
  });
});

/* ---- Administração da plataforma: app da Meta ---- */

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  if (!get('SELECT is_admin FROM users WHERE id = ?', req.user.id)?.is_admin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode alterar o app da Meta.' });
  }
  next();
}

function metaAppInfo() {
  const host = new URL(config.publicUrl).host;
  return {
    configured: meta.isConfigured(),
    source: config.meta.source || '',
    app_id: config.meta.appId || '',
    redirect_uri: `${config.publicUrl}/api/meta/callback`,
    app_domain: host,
    site_url: config.publicUrl + '/',
    privacy_url: `${config.publicUrl}/privacidade`,
    deletion_url: `${config.publicUrl}/exclusao-de-dados`,
    terms_url: `${config.publicUrl}/termos`,
    https: config.publicUrl.startsWith('https://'),
    scopes: config.meta.scopes,
    optional_scopes: Object.entries(config.meta.optionalScopes).map(([key, o]) => ({ key, label: o.label, scopes: o.scopes, enabled: config.meta.extraScopes.includes(key) })),
  };
}

app.get('/api/admin/meta-app', requireAdmin, (req, res) => res.json(metaAppInfo()));

app.put('/api/admin/meta-app', requireAdmin, wrap(async (req, res) => {
  const appId = String(req.body?.app_id || '').trim();
  const appSecret = String(req.body?.app_secret || '').trim();
  if (!/^\d{6,20}$/.test(appId)) throw fail(400, 'O ID do app tem só números (em Configurações do app > Básico).');
  if (!/^[a-f0-9]{32}$/i.test(appSecret)) throw fail(400, 'A chave secreta tem 32 caracteres (letras de a a f e números). Clique em "Mostrar" ao lado dela no painel da Meta e copie de novo.');
  // Confere na Meta se o par ID + chave é válido.
  try {
    await require('./meta/graph').get('/oauth/access_token', null, { client_id: appId, client_secret: appSecret, grant_type: 'client_credentials' });
  } catch (e) {
    throw fail(400, `A Meta não aceitou essas credenciais: ${e.message}. Confira o ID e a chave secreta.`);
  }
  settings.saveMetaApp(appId, appSecret);
  logEvent(req.user.storeId, 'App da Meta configurado no painel');
  res.json(metaAppInfo());
}));

/* ---- IA de imagens (Google Gemini) ---- */
function aiInfo() {
  const g = settings.gemini();
  return { configured: !!g.key, source: g.source, model: g.model, default_model: require('./arts/gemini').DEFAULT_MODEL, auto: g.auto };
}
app.get('/api/admin/ai', requireAdmin, (req, res) => res.json(aiInfo()));
app.put('/api/admin/ai', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const key = b.key !== undefined ? String(b.key).trim() : undefined;
  if (key) {
    if (!/^[A-Za-z0-9_.\-]{20,120}$/.test(key)) throw fail(400, 'Essa não parece uma chave da IA do Google. Copie de novo no Google AI Studio (botão "Copiar" ao lado da chave).');
    try { await require('./arts/gemini').checkKey(key); }
    catch (e) { throw fail(400, `O Google não aceitou a chave: ${e.message}`); }
  }
  const model = b.model !== undefined ? String(b.model).trim().replace(/^models\//, '').slice(0, 80) : undefined;
  if (model && !/^[a-z0-9.\-]+$/.test(model)) throw fail(400, 'Nome de modelo inválido.');
  settings.saveGemini({ key, model, auto: b.auto === undefined ? undefined : !!b.auto });
  if (key || b.auto) arts.backfill();
  logEvent(req.user.storeId, 'IA de imagens configurada no painel');
  res.json(aiInfo());
}));

app.get('/api/admin/storage', requireAdmin, (req, res) => res.json(storage.status()));
app.post('/api/admin/storage/backup', requireAdmin, wrap(async (req, res) => {
  if (!storage.enabled()) throw fail(400, 'O armazenamento permanente não está configurado.');
  storage.markDirty(); await storage.flush();
  const st = storage.status();
  if (st.last_error) throw fail(502, `A cópia falhou: ${st.last_error}`);
  res.json(st);
}));

app.put('/api/admin/meta-app/scopes', requireAdmin, (req, res) => {
  settings.saveExtraScopes(Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : []);
  res.json(metaAppInfo());
});

app.delete('/api/admin/meta-app', requireAdmin, (req, res) => { settings.clearMetaApp(); res.json(metaAppInfo()); });

app.put('/api/store', auth.requireUser, (req, res) => {
  const b = req.body || {};
  const s = (x, n = 120) => String(x ?? '').trim().slice(0, n);
  if (!s(b.name)) throw fail(400, 'Informe o nome da loja.');
  run(`UPDATE stores SET name=?, phone=?, whatsapp=?, address=?, city=?, state=?, postal_code=? WHERE id=?`,
    s(b.name), s(b.phone, 20), s(b.whatsapp, 20).replace(/\D/g, ''), s(b.address, 160), s(b.city, 80), s(b.state, 2).toUpperCase(), s(b.postal_code, 9), req.user.storeId);
  res.json({ ok: true });
});

app.put('/api/store/automation', auth.requireUser, (req, res) => {
  const auto = req.body?.auto_publish ? 1 : 0;
  const limit = Math.min(50, Math.max(1, parseInt(req.body?.daily_limit, 10) || 15));
  run('UPDATE stores SET auto_publish = ?, daily_limit = ? WHERE id = ?', auto, limit, req.user.storeId);
  res.json({ ok: true, auto_publish: auto, daily_limit: limit });
});

app.put('/api/store/pub-mode', auth.requireUser, (req, res) => {
  const mode = req.body?.mode;
  if (!['manual', 'extensao'].includes(mode)) throw fail(400, 'Modo inválido.');
  run('UPDATE stores SET pub_mode = ? WHERE id = ?', mode, req.user.storeId);
  if (mode === 'manual') {
    run(`UPDATE ext_jobs SET status='cancelado', updated_at=datetime('now') WHERE store_id=? AND status IN ('pendente','em_andamento')`, req.user.storeId);
  }
  res.json({ ok: true, mode });
});

/* ------------------------------------------------------------------ */
/* Veículos                                                           */
/* ------------------------------------------------------------------ */

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(config.dataDir, 'media'),
    filename: (_req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const own = (req) => {
  const v = V.findVehicle(req.user.storeId, req.params.id);
  if (!v) throw fail(404, 'Veículo não encontrado.');
  return v;
};

app.get('/api/vehicles', auth.requireUser, (req, res) => res.json(V.listVehicles(req.user.storeId)));

app.get('/api/vehicles/:id', auth.requireUser, (req, res) => res.json(V.serialize(own(req))));

app.post('/api/vehicles', auth.requireUser, (req, res) => {
  const d = V.cleanInput(req.body);
  if (!d.marca || !d.modelo) throw fail(400, 'Informe ao menos marca e modelo.');
  const cols = Object.keys(d);
  const r = run(`INSERT INTO vehicles (store_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`,
    req.user.storeId, ...cols.map((k) => d[k]));
  logEvent(req.user.storeId, `${d.marca} ${d.modelo} cadastrado`);
  arts.schedule(r.lastInsertRowid);
  res.status(201).json(V.serialize(V.findVehicle(req.user.storeId, r.lastInsertRowid)));
});

app.put('/api/vehicles/:id', auth.requireUser, (req, res) => {
  const v = own(req);
  const d = V.cleanInput(req.body);
  if (!d.marca || !d.modelo) throw fail(400, 'Informe ao menos marca e modelo.');
  const cols = Object.keys(d);
  run(`UPDATE vehicles SET ${cols.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`, ...cols.map((k) => d[k]), v.id);
  arts.schedule(v.id);
  res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
});

// Exclui o veículo (em estoque, rascunho ou vendido) com fotos e imagens geradas.
// Anúncios que continuam no ar em outros sites são devolvidos para a loja retirar.
app.delete('/api/vehicles/:id', auth.requireUser, wrap(async (req, res) => {
  const v = own(req);
  const remover = v.status === 'vendido' ? [] : channels.manualRemovals(v.id);
  if (v.status === 'publicado') remover.unshift({ channel: 'marketplace', label: 'Facebook Marketplace', url: v.fb_listing_url || 'https://www.facebook.com/marketplace/you/selling' });
  const names = [...all('SELECT filename FROM photos WHERE vehicle_id = ?', v.id).map((p) => p.filename), ...arts.filesOf(v.id)];
  run('DELETE FROM vehicles WHERE id = ?', v.id);
  names.forEach((n) => require('node:fs').rm(path.join(config.dataDir, 'media', n), () => {}));
  await storage.removeMedia(names).catch(() => {});
  logEvent(req.user.storeId, `${v.marca} ${v.modelo} ${v.versao} excluído`);
  res.json({ ok: true, remover });
}));

// Marca como "pronto para publicar" quando o cadastro está completo.
app.post('/api/vehicles/:id/ready', auth.requireUser, (req, res) => {
  const v = own(req);
  const faltam = V.missingForPublish(v, V.photosOf(v.id).length);
  if (faltam.length) throw fail(400, `Para publicar, preencha: ${faltam.join(', ')}.`);
  if (v.status === 'rascunho') run(`UPDATE vehicles SET status='pronto', updated_at=datetime('now') WHERE id=?`, v.id);
  res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
});

app.post('/api/vehicles/:id/photos', auth.requireUser, upload.array('fotos', 20), wrap(async (req, res) => {
  const files = req.files || [];
  const discard = () => files.forEach((f) => require('node:fs').rm(f.path, () => {}));
  let v;
  try { v = own(req); } catch (e) { discard(); throw e; }
  if (!files.length) throw fail(400, 'Envie fotos em JPG, PNG ou WEBP de até 12 MB.');
  const count = get('SELECT COUNT(*) n FROM photos WHERE vehicle_id = ?', v.id).n;
  if (count + files.length > 20) { discard(); throw fail(400, `Limite de 20 fotos. Este veículo já tem ${count}.`); }
  // Guarda no armazenamento permanente antes de registrar no banco.
  try { for (const f of files) await storage.saveMedia(f.filename); }
  catch (e) {
    discard();
    await storage.removeMedia(files.map((f) => f.filename)).catch(() => {});
    console.error(e.message);
    throw fail(502, 'Não foi possível guardar as fotos no armazenamento. Tente de novo em instantes.');
  }
  let pos = (get('SELECT MAX(position) m FROM photos WHERE vehicle_id = ?', v.id).m ?? -1) + 1;
  for (const f of files) run('INSERT INTO photos (vehicle_id, filename, mime, position) VALUES (?, ?, ?, ?)', v.id, f.filename, f.mimetype, pos++);
  run(`UPDATE vehicles SET updated_at=datetime('now') WHERE id=?`, v.id);
  arts.schedule(v.id);
  res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
}));

app.put('/api/vehicles/:id/photos/order', auth.requireUser, (req, res) => {
  const v = own(req);
  const ids = (req.body?.ids || []).map(Number);
  const existing = new Set(V.photosOf(v.id).map((p) => p.id));
  if (ids.length !== existing.size || !ids.every((i) => existing.has(i))) throw fail(400, 'Lista de fotos inválida.');
  tx(() => ids.forEach((pid, i) => run('UPDATE photos SET position = ? WHERE id = ?', i, pid)));
  arts.schedule(v.id);
  res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
});

app.delete('/api/vehicles/:id/photos/:pid', auth.requireUser, (req, res) => {
  const v = own(req);
  const p = get('SELECT * FROM photos WHERE id = ? AND vehicle_id = ?', Number(req.params.pid), v.id);
  if (!p) throw fail(404, 'Foto não encontrada.');
  run('DELETE FROM photos WHERE id = ?', p.id);
  require('node:fs').rm(path.join(config.dataDir, 'media', p.filename), () => {});
  storage.removeMedia([p.filename]).catch(() => {});
  run('UPDATE arts SET photo_id = NULL WHERE vehicle_id = ? AND photo_id = ?', v.id, p.id);
  arts.schedule(v.id);
  res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
});

// Todas as fotos do veículo num .zip (publicação assistida sem extensão).
app.get('/api/vehicles/:id/photos.zip', auth.requireUser, wrap(async (req, res) => {
  const v = own(req);
  const photos = V.photosOf(v.id);
  if (!photos.length) throw fail(404, 'Este veículo não tem fotos.');
  const fs = require('node:fs');
  const files = [];
  // ?artes=1: a arte e as imagens no estacionamento vêm primeiro; ?so=artes: só elas.
  if (req.query.artes === '1' || req.query.so === 'artes') {
    for (const [i, f] of arts.readyFiles(v.id).entries()) {
      const file = await storage.ensureLocal(f);
      if (file) files.push({ name: `${i === 0 ? 'arte' : 'estacionamento'}-${String(i + 1).padStart(2, '0')}.jpg`, data: fs.readFileSync(file) });
    }
  }
  if (req.query.so !== 'artes') for (const [i, p] of photos.entries()) {
    const file = await storage.ensureLocal(p.filename);
    if (file) files.push({ name: `foto-${String(i + 1).padStart(2, '0')}${path.extname(p.filename)}`, data: fs.readFileSync(file) });
  }
  if (!files.length) throw fail(404, 'As fotos deste veículo não foram encontradas.');
  const base = `${v.marca}-${v.modelo}-${v.ano_modelo || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="fotos-${base || v.id}.zip"`);
  res.send(require('./zip').buildZip(files));
}));

// Publicação assistida: a pessoa publicou no Facebook e registra aqui.
app.post('/api/vehicles/:id/mark-published', auth.requireUser, (req, res) => {
  const v = own(req);
  if (v.status === 'vendido') throw fail(409, 'Veículo vendido não pode ser publicado.');
  const url = String(req.body?.listing_url || '').trim();
  if (url && !/^https:\/\/(www\.|web\.|m\.)?facebook\.com\/\S+$/.test(url)) throw fail(400, 'Cole o link do anúncio do Facebook (começa com https://www.facebook.com/).');
  const republicado = v.status === 'publicado';
  run(`UPDATE vehicles SET status='publicado', publicado_em=datetime('now'), fb_listing_url=?, updated_at=datetime('now') WHERE id=?`,
    url ? url.split('?')[0] : (republicado ? '' : v.fb_listing_url || ''), v.id);
  run(`UPDATE ext_jobs SET status='cancelado', updated_at=datetime('now') WHERE vehicle_id=? AND status IN ('pendente','em_andamento')`, v.id);
  const nome = `${v.marca} ${v.modelo} ${v.versao}`.trim();
  logEvent(req.user.storeId, republicado ? `${nome} republicado no Marketplace` : `${nome} publicado no Marketplace`);
  res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
});

// Preenchimento automático: o painel escolhe o veículo; a janela-ponte busca e entrega ao favorito no Facebook.
app.post('/api/assist/start', auth.requireUser, (req, res) => {
  const v = V.findVehicle(req.user.storeId, req.body?.vehicle_id);
  if (!v) throw fail(404, 'Veículo não encontrado.');
  if (v.status === 'vendido') throw fail(409, 'Veículo vendido não pode ser publicado.');
  if (!V.photosOf(v.id).length) throw fail(400, 'Adicione ao menos uma foto antes de publicar.');
  run(`UPDATE stores SET assist_vehicle_id = ?, assist_at = datetime('now') WHERE id = ?`, v.id, req.user.storeId);
  res.json({ ok: true });
});

app.get('/api/assist/current', auth.requireUser, (req, res) => {
  const s = get(`SELECT assist_vehicle_id, assist_at FROM stores WHERE id = ? AND assist_at > datetime('now', '-2 hours')`, req.user.storeId);
  const v = s?.assist_vehicle_id && V.findVehicle(req.user.storeId, s.assist_vehicle_id);
  if (!v || v.status === 'vendido') throw fail(404, 'Nenhum veículo escolhido para publicar agora.');
  res.json({ vehicle: V.serialize(v), version: VERSION });
});

/* ------------------------------------------------------------------ */
/* Publicação orgânica (fila da extensão)                             */
/* ------------------------------------------------------------------ */

function enqueue(storeId, vehicleId, type) {
  const pending = get(`SELECT id FROM ext_jobs WHERE vehicle_id = ? AND status IN ('pendente','em_andamento')`, vehicleId);
  if (pending) throw fail(409, 'Já existe uma tarefa da extensão em andamento para este veículo.');
  run('INSERT INTO ext_jobs (store_id, vehicle_id, type) VALUES (?, ?, ?)', storeId, vehicleId, type);
}

app.post('/api/vehicles/:id/publish', auth.requireUser, (req, res) => {
  const v = own(req);
  if (v.status === 'vendido') throw fail(409, 'Veículo vendido não pode ser publicado.');
  if (v.status === 'publicado') throw fail(409, 'Este veículo já está publicado. Use Republicar.');
  const faltam = V.missingForPublish(v, V.photosOf(v.id).length);
  if (faltam.length) throw fail(400, `Para publicar, preencha: ${faltam.join(', ')}.`);
  if (v.status === 'rascunho') run(`UPDATE vehicles SET status='pronto' WHERE id=?`, v.id);
  enqueue(req.user.storeId, v.id, 'publicar');
  res.json({ ok: true, message: 'Enviado para a extensão. Abra o Chrome com a extensão ativa para concluir.' });
});

app.post('/api/vehicles/:id/republish', auth.requireUser, (req, res) => {
  const v = V.serialize(own(req));
  if (v.status !== 'publicado') throw fail(409, 'Só é possível republicar um anúncio publicado.');
  if (!v.pode_republicar && !req.body?.force) {
    throw fail(409, `Publicado há ${v.dias_publicado} dia(s). Republicar antes de ${config.republishDays} dias aumenta o risco de bloqueio da conta.`);
  }
  enqueue(req.user.storeId, v.id, 'republicar');
  res.json({ ok: true });
});

app.post('/api/vehicles/:id/sold', auth.requireUser, (req, res) => {
  const v = own(req);
  if (v.status === 'vendido') return res.json({ ok: true });
  const wasPublished = v.status === 'publicado';
  const pubMode = get('SELECT pub_mode FROM stores WHERE id = ?', req.user.storeId).pub_mode;
  run(`UPDATE vehicles SET status='vendido', vendido_em=datetime('now'), updated_at=datetime('now') WHERE id=?`, v.id);
  run(`UPDATE ext_jobs SET status='cancelado', updated_at=datetime('now') WHERE vehicle_id=? AND status='pendente'`, v.id);
  if (wasPublished && pubMode === 'extensao') run('INSERT INTO ext_jobs (store_id, vehicle_id, type) VALUES (?, ?, ?)', req.user.storeId, v.id, 'excluir');
  logEvent(req.user.storeId, `${v.marca} ${v.modelo} ${v.versao} marcado como vendido`);
  const campanhas = all(`SELECT c.id, c.name FROM campaigns c JOIN campaign_vehicles cv ON cv.campaign_id = c.id
    WHERE cv.vehicle_id = ? AND c.status IN ('ativa','analise')`, v.id);
  res.json({ ok: true, campanhas_ativas: campanhas, excluir_manual: wasPublished && pubMode !== 'extensao', listing_url: v.fb_listing_url || '', remover: channels.manualRemovals(v.id) });
});

/* ---- Imagens geradas (arte + estacionamento) ---- */

app.get('/api/vehicles/:id/arts', auth.requireUser, (req, res) => res.json(arts.listArts(own(req).id)));

app.post('/api/vehicles/:id/arts/regenerate', auth.requireUser, (req, res) => {
  const v = own(req);
  if (v.status === 'vendido') throw fail(409, 'Veículo vendido: as imagens não são mais geradas.');
  if (!V.photosOf(v.id).length) throw fail(400, 'Cadastre as fotos do veículo primeiro.');
  const slots = (Array.isArray(req.body?.slots) && req.body.slots.length ? req.body.slots : [1, 2, 3, 4, 5]).map(Number).filter((n) => n >= 1 && n <= 5);
  if (slots.some((n) => n > 1) && !settings.gemini().key) {
    if (!slots.includes(1)) throw fail(400, 'Configure a chave da IA do Google em Configurações > Imagens com IA para gerar as fotos no estacionamento.');
  }
  for (const n of slots) run(`UPDATE arts SET status = 'pendente', error = '' WHERE vehicle_id = ? AND slot = ? AND status != 'gerando'`, v.id, n);
  arts.schedule(v.id, { force: slots, delay: 100 });
  res.json(arts.listArts(v.id));
});

app.put('/api/vehicles/:id/arts/:slot/source', auth.requireUser, (req, res) => {
  const v = own(req);
  arts.setSource(v.id, Number(req.params.slot), req.body?.photo_id ? Number(req.body.photo_id) : null);
  res.json(arts.listArts(v.id));
});

/* ---- Outros canais: Instagram, Webmotors e OLX ---- */

app.get('/api/vehicles/:id/channel-data', auth.requireUser, (req, res) => {
  const v = own(req);
  const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
  res.json({ caption: channels.caption(v, store), fields: channels.fields(v, store), listings: channels.listingsOf(v.id), links: Object.fromEntries(Object.entries(channels.CHANNELS).map(([k, c]) => [k, c.url])) });
});

app.post('/api/vehicles/:id/instagram', auth.requireUser, wrap(async (req, res) => {
  const v = own(req);
  res.json(await channels.publishInstagram(req.user.storeId, v.id, { caption: req.body?.caption }));
}));

app.post('/api/vehicles/:id/listings/:channel', auth.requireUser, (req, res) => {
  res.json(channels.markPublished(req.user.storeId, own(req).id, req.params.channel, req.body?.url));
});

app.delete('/api/vehicles/:id/listings/:channel', auth.requireUser, (req, res) => {
  res.json(channels.unmark(req.user.storeId, own(req).id, req.params.channel));
});

app.get('/api/jobs', auth.requireUser, (req, res) => {
  res.json(all(`SELECT j.*, v.marca, v.modelo, v.versao FROM ext_jobs j JOIN vehicles v ON v.id = j.vehicle_id
    WHERE j.store_id = ? ORDER BY j.id DESC LIMIT 50`, req.user.storeId));
});

app.post('/api/jobs/:id/cancel', auth.requireUser, (req, res) => {
  run(`UPDATE ext_jobs SET status='cancelado', updated_at=datetime('now') WHERE id=? AND store_id=? AND status IN ('pendente','em_andamento')`,
    Number(req.params.id), req.user.storeId);
  res.json({ ok: true });
});

app.get('/api/events', auth.requireUser, (req, res) => {
  res.json(all('SELECT message, created_at FROM events WHERE store_id = ? ORDER BY id DESC LIMIT 30', req.user.storeId));
});

/* ---- Pareamento e API da extensão ---- */

app.post('/api/extension/pair-code', auth.requireUser, (req, res) => {
  const code = Array.from(crypto.randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  run('DELETE FROM pair_codes WHERE expires_at < ?', Date.now());
  run('INSERT INTO pair_codes (code, store_id, expires_at) VALUES (?, ?, ?)', code, req.user.storeId, Date.now() + 10 * 60e3);
  res.json({ code, expires_in: 600 });
});

app.get('/api/extension/status', auth.requireUser, (req, res) => {
  res.json(all('SELECT label, created_at, last_seen FROM ext_tokens WHERE store_id = ? ORDER BY last_seen DESC', req.user.storeId));
});

const extRouter = express.Router();
extRouter.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

extRouter.post('/pair', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const row = get('SELECT * FROM pair_codes WHERE code = ? AND expires_at > ?', code, Date.now());
  if (!row) throw fail(400, 'Código inválido ou expirado. Gere outro no painel.');
  run('DELETE FROM pair_codes WHERE code = ?', code);
  const token = randomToken();
  run('INSERT INTO ext_tokens (token_hash, store_id, label, last_seen) VALUES (?, ?, ?, datetime(\'now\'))', sha256(token), row.store_id, String(req.body?.label || 'Chrome').slice(0, 60));
  const store = get('SELECT name FROM stores WHERE id = ?', row.store_id);
  res.json({ token, store: store.name });
});

extRouter.get('/next', auth.requireExtension, (req, res) => {
  // Tarefas "em andamento" há mais de 30 min voltam para a fila.
  run(`UPDATE ext_jobs SET status='pendente' WHERE store_id=? AND status='em_andamento' AND updated_at < datetime('now','-30 minutes')`, req.ext.storeId);
  const st = get('SELECT name, city, state, auto_publish, daily_limit FROM stores WHERE id = ?', req.ext.storeId);
  const job = get(`SELECT * FROM ext_jobs WHERE store_id = ? AND status = 'pendente' ORDER BY id LIMIT 1`, req.ext.storeId);
  const pendentes = get(`SELECT COUNT(*) n FROM ext_jobs WHERE store_id = ? AND status = 'pendente'`, req.ext.storeId).n;
  if (!job) return res.json({ job: null, pendentes: 0 });
  // Limite diário de publicações (protege a conta do Facebook da loja).
  const hoje = get(`SELECT COUNT(*) n FROM ext_jobs WHERE store_id = ? AND status = 'concluido' AND type IN ('publicar','republicar')
    AND date(updated_at, '-3 hours') = date('now', '-3 hours')`, req.ext.storeId).n;
  if (job.type !== 'excluir' && hoje >= st.daily_limit) {
    run(`UPDATE ext_jobs SET note=? WHERE id=?`, `Limite de ${st.daily_limit} publicações por dia atingido. Continua amanhã.`, job.id);
    return res.json({ job: null, pendentes, limit_reached: true });
  }
  run(`UPDATE ext_jobs SET status='em_andamento', note='', updated_at=datetime('now') WHERE id=?`, job.id);
  const v = V.serialize(V.findVehicle(req.ext.storeId, job.vehicle_id));
  res.json({ job: { id: job.id, type: job.type }, vehicle: v, store: { name: st.name, city: st.city, state: st.state }, pendentes,
    settings: { auto_publish: !!st.auto_publish } });
});

extRouter.post('/jobs/:id/note', auth.requireExtension, (req, res) => {
  run(`UPDATE ext_jobs SET note=?, updated_at=datetime('now') WHERE id=? AND store_id=?`, String(req.body?.note || '').slice(0, 300), Number(req.params.id), req.ext.storeId);
  res.json({ ok: true });
});

extRouter.post('/jobs/:id', auth.requireExtension, (req, res) => {
  const job = get('SELECT * FROM ext_jobs WHERE id = ? AND store_id = ?', Number(req.params.id), req.ext.storeId);
  if (!job) throw fail(404, 'Tarefa não encontrada.');
  const status = String(req.body?.status || '');
  if (!['concluido', 'falhou', 'cancelado'].includes(status)) throw fail(400, 'Status inválido.');
  const v = V.findVehicle(req.ext.storeId, job.vehicle_id);
  run(`UPDATE ext_jobs SET status=?, error=?, updated_at=datetime('now') WHERE id=?`, status, String(req.body?.error || '').slice(0, 500), job.id);
  const nome = `${v.marca} ${v.modelo} ${v.versao}`.trim();
  if (status === 'concluido' && (job.type === 'publicar' || job.type === 'republicar')) {
    const url = String(req.body?.listing_url || '');
    run(`UPDATE vehicles SET status='publicado', publicado_em=datetime('now'), fb_listing_url=?, updated_at=datetime('now') WHERE id=?`,
      /^https:\/\/(www\.|web\.|m\.)?facebook\.com\//.test(url) ? url : v.fb_listing_url || '', v.id);
    logEvent(req.ext.storeId, job.type === 'publicar' ? `${nome} publicado no Marketplace` : `${nome} republicado (anúncio antigo excluído)`);
  } else if (status === 'concluido' && job.type === 'excluir') {
    run(`UPDATE vehicles SET fb_listing_url='' WHERE id=?`, v.id);
    logEvent(req.ext.storeId, `Anúncio de ${nome} excluído do Marketplace`);
  } else if (status === 'falhou') {
    logEvent(req.ext.storeId, `Extensão não concluiu (${job.type}) ${nome}: ${req.body?.error || 'sem detalhes'}`);
  }
  res.json({ ok: true });
});

app.use('/api/ext', express.json(), extRouter);

/* ------------------------------------------------------------------ */
/* Meta: conexão, catálogo e campanhas                                */
/* ------------------------------------------------------------------ */

app.get('/api/meta/status', auth.requireUser, (req, res) => {
  const st = meta.publicStatus(req.user.storeId);
  const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
  res.json({ ...st, feed_url: feed.feedUrl(store), feed_items: feed.feedRows(store).length });
});

app.get('/api/meta/connect', auth.requireUser, (req, res) => {
  if (!meta.isConfigured()) throw fail(500, 'Configure META_APP_ID e META_APP_SECRET no .env do servidor.');
  const state = randomToken(16);
  run('INSERT INTO oauth_states (state, store_id, expires_at) VALUES (?, ?, ?)', state, req.user.storeId, Date.now() + 15 * 60e3);
  res.redirect(meta.connectUrl(state));
});

app.get('/api/meta/callback', wrap(async (req, res) => {
  const st = get('SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?', String(req.query.state || ''), Date.now());
  if (!st) return res.redirect('/#config?meta=erro_estado');
  run('DELETE FROM oauth_states WHERE state = ?', st.state);
  if (req.query.error || !req.query.code) return res.redirect('/#config?meta=cancelado');
  try {
    const conn = await meta.exchangeCode(String(req.query.code));
    meta.saveConnection(st.store_id, conn);
    res.redirect('/#config?meta=ok');
  } catch (e) {
    console.error('Meta OAuth:', e.message);
    res.redirect('/#config?meta=erro&msg=' + encodeURIComponent(e.message.slice(0, 200)));
  }
}));

app.post('/api/meta/disconnect', auth.requireUser, (req, res) => {
  run('DELETE FROM meta_connections WHERE store_id = ?', req.user.storeId);
  logEvent(req.user.storeId, 'Conta do Facebook desconectada');
  res.json({ ok: true });
});

app.get('/api/meta/assets', auth.requireUser, wrap(async (req, res) => res.json(await meta.listAssets(req.user.storeId))));
app.put('/api/meta/settings', auth.requireUser, wrap(async (req, res) => res.json(await meta.saveSettings(req.user.storeId, req.body || {}))));
app.get('/api/meta/cities', auth.requireUser, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json(q.length < 2 ? [] : await meta.searchCities(req.user.storeId, q));
}));
app.post('/api/meta/catalog/setup', auth.requireUser, wrap(async (req, res) => res.json(await meta.setupCatalog(req.user.storeId))));
app.post('/api/meta/catalog/sync', auth.requireUser, wrap(async (req, res) => res.json(await meta.syncCatalog(req.user.storeId))));

function campaignOut(c) {
  const parse = (x, f) => { try { return JSON.parse(x); } catch { return f; } };
  return {
    ...c,
    interests: parse(c.interests_json, []),
    positions: parse(c.positions_json, []),
    daily_budget: c.daily_budget_cents / 100,
    stats: c.stats_json ? JSON.parse(c.stats_json) : null,
    vehicle_ids: all('SELECT vehicle_id FROM campaign_vehicles WHERE campaign_id = ?', c.id).map((r) => r.vehicle_id),
    ads_manager_url: c.meta_campaign_id
      ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${(meta.publicStatus(c.store_id).ad_account_id || '').replace('act_', '')}&selected_campaign_ids=${c.meta_campaign_id}`
      : '',
  };
}

app.get('/api/campaigns', auth.requireUser, wrap(async (req, res) => {
  const list = all('SELECT * FROM campaigns WHERE store_id = ? ORDER BY id DESC', req.user.storeId);
  if (req.query.refresh) {
    for (const c of list.filter((x) => x.meta_campaign_id && !['encerrada', 'erro'].includes(x.status))) {
      await meta.refreshStats(req.user.storeId, c.id).catch((e) => console.warn('insights', c.id, e.message));
    }
  }
  res.json(all('SELECT * FROM campaigns WHERE store_id = ? ORDER BY id DESC', req.user.storeId).map(campaignOut));
}));

// Lê e valida público/posicionamentos enviados pelo formulário de campanha.
function audienceFrom(b) {
  const radius = parseInt(b.radius_km, 10);
  const ageMin = Math.min(65, Math.max(18, parseInt(b.age_min ?? 18, 10) || 18));
  const ageMax = Math.min(65, Math.max(ageMin, parseInt(b.age_max ?? 65, 10) || 65));
  const audience = b.audience_mode === 'advantage' ? 'advantage' : 'manual';
  const genders = ['1', '2'].includes(String(b.genders)) ? String(b.genders) : '';
  const interests = (Array.isArray(b.interests) ? b.interests : []).slice(0, 15)
    .filter((i) => i && /^\d+$/.test(String(i.id))).map((i) => ({ id: String(i.id), name: String(i.name || '').slice(0, 80) }));
  const placements = b.placements === 'auto' ? 'auto' : 'manual';
  const positions = (Array.isArray(b.positions) ? b.positions : meta.DEFAULT_POSITIONS).filter((p) => meta.POSITIONS[p]);
  if (placements === 'manual' && !positions.length) throw fail(400, 'Escolha ao menos um lugar onde o anúncio vai aparecer.');
  return {
    city_key: String(b.city_key || ''), city_name: String(b.city_name || '').slice(0, 120), radius_km: radius, age_min: ageMin, age_max: ageMax,
    audience_mode: audience, genders, interests_json: JSON.stringify(interests), placements, positions_json: JSON.stringify(positions),
  };
}

app.get('/api/meta/interests', auth.requireUser, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json(q.length < 2 ? [] : await meta.searchInterests(req.user.storeId, q));
}));

app.post('/api/meta/reach', auth.requireUser, wrap(async (req, res) => {
  const a = audienceFrom(req.body || {});
  if (!a.city_key) throw fail(400, 'Escolha a cidade.');
  if (!(a.radius_km >= 17 && a.radius_km <= 80)) throw fail(400, 'Raio entre 17 e 80 km.');
  res.json(await meta.reachEstimate(req.user.storeId, a));
}));

app.post('/api/campaigns', auth.requireUser, wrap(async (req, res) => {
  const b = req.body || {};
  const aud = audienceFrom(b);
  const storeId = req.user.storeId;
  const name = String(b.name || '').trim().slice(0, 120);
  const mode = String(b.mode || '');
  const daily = Number(String(b.daily_budget ?? '').replace(',', '.'));
  const days = parseInt(b.days, 10);
  const radius = aud.radius_km;
  if (!name) throw fail(400, 'Dê um nome à campanha.');
  if (!meta.MODES[mode]) throw fail(400, 'Escolha o tipo de campanha.');
  if (!(daily >= 6)) throw fail(400, 'O orçamento diário mínimo é R$ 6.');
  if (!(days >= 1 && days <= 90)) throw fail(400, 'A duração deve ser de 1 a 90 dias.');
  if (!(radius >= 17 && radius <= 80)) throw fail(400, 'O raio em torno da cidade deve ficar entre 17 e 80 km (limite da Meta).');
  if (!b.city_key || !b.city_name) throw fail(400, 'Escolha a cidade da campanha.');
  const ids = [...new Set((b.vehicle_ids || []).map(Number))];
  if (!ids.length) throw fail(400, 'Escolha ao menos um veículo.');
  if (mode !== 'catalogo' && ids.length > 10) throw fail(400, 'Campanhas de conversa aceitam até 10 veículos (carrossel).');
  const vs = ids.map((id) => V.findVehicle(storeId, id));
  if (vs.some((v) => !v || v.status === 'vendido' || v.status === 'rascunho')) throw fail(400, 'Há veículos vendidos, em rascunho ou inexistentes na seleção.');
  if (mode === 'catalogo' && vs.some((v) => !v.catalogo)) throw fail(400, 'No modo Catálogo dinâmico, todos os veículos precisam estar marcados para o catálogo.');

  // Início: agora (+5 min) ou numa data escolhida (até 60 dias à frente).
  let start = new Date(Date.now() + 5 * 60e3);
  if (b.start_date) {
    const d = new Date(`${String(b.start_date).slice(0, 10)}T08:00:00-03:00`);
    if (Number.isNaN(d.getTime())) throw fail(400, 'Data de início inválida.');
    if (d.getTime() > Date.now() + 60 * 864e5) throw fail(400, 'A data de início deve ser nos próximos 60 dias.');
    if (d > start) start = d;
  }
  const end = new Date(start.getTime() + days * 864e5);
  const c = tx(() => {
    const r = run(`INSERT INTO campaigns (store_id, name, mode, daily_budget_cents, days, city_key, city_name, radius_km, age_min, age_max, message, start_time, end_time,
      audience_mode, genders, interests_json, placements, positions_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    storeId, name, mode, Math.round(daily * 100), days, aud.city_key, aud.city_name, aud.radius_km, aud.age_min, aud.age_max,
    String(b.message || '').trim().slice(0, 600), start.toISOString(), end.toISOString(),
    aud.audience_mode, aud.genders, aud.interests_json, aud.placements, aud.positions_json);
    ids.forEach((id) => run('INSERT INTO campaign_vehicles (campaign_id, vehicle_id) VALUES (?, ?)', r.lastInsertRowid, id));
    return r.lastInsertRowid;
  });
  try {
    const out = await meta.launchCampaign(storeId, Number(c), { activate: !!b.activate });
    res.status(201).json(campaignOut(out));
  } catch (e) {
    e.campaign = campaignOut(get('SELECT * FROM campaigns WHERE id = ?', Number(c)));
    throw e;
  }
}));

app.post('/api/campaigns/:id/retry', auth.requireUser, wrap(async (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ? AND store_id = ?', Number(req.params.id), req.user.storeId);
  if (!c || c.status !== 'erro') throw fail(409, 'Só campanhas com erro podem ser reenviadas.');
  const start = new Date(Date.now() + 5 * 60e3);
  run(`UPDATE campaigns SET start_time=?, end_time=?, status='criando', error='' WHERE id=?`, start.toISOString(), new Date(start.getTime() + c.days * 864e5).toISOString(), c.id);
  res.json(campaignOut(await meta.launchCampaign(req.user.storeId, c.id, { activate: !!req.body?.activate })));
}));

for (const [action, status] of [['activate', 'ACTIVE'], ['pause', 'PAUSED'], ['end', 'ARCHIVED']]) {
  app.post(`/api/campaigns/:id/${action}`, auth.requireUser, wrap(async (req, res) => {
    res.json(campaignOut(await meta.setCampaignStatus(req.user.storeId, Number(req.params.id), status)));
  }));
}

app.delete('/api/campaigns/:id', auth.requireUser, (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ? AND store_id = ?', Number(req.params.id), req.user.storeId);
  if (!c) throw fail(404, 'Campanha não encontrada.');
  if (c.meta_campaign_id) throw fail(409, 'Esta campanha existe na Meta. Use Encerrar.');
  run('DELETE FROM campaigns WHERE id = ?', c.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Erros                                                              */
/* ------------------------------------------------------------------ */

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars

// Erros da Meta com uma explicação do que fazer.
function metaErrorText(err) {
  const base = `A Meta recusou o pedido: ${err.title && err.title !== err.message ? err.title + ' — ' : ''}${err.message}`;
  const txt = `${err.title || ''} ${err.message || ''}`;
  if (err.subcode === 1885183 || /modo de desenvolvimento|development mode/i.test(txt)) {
    return `${base} O que fazer: o app da Meta ainda está em modo de desenvolvimento. Em developers.facebook.com, abra o app GiroAuto e mude para o modo Ativo (botão "Publicar" no menu da esquerda ou a chave "Modo do app" no alto). Depois clique em "Tentar de novo" na campanha.`;
  }
  return base;
}

app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada foto pode ter no máximo 12 MB.' : 'Envio de fotos inválido.' });
  }
  const isMeta = err instanceof MetaError;
  const status = isMeta ? 502 : err.status || 500;
  if (status >= 500 && !isMeta) console.error(err);
  res.status(status).json({
    error: isMeta ? metaErrorText(err) : (status >= 500 ? 'Erro interno no servidor.' : err.message),
    ...(isMeta ? { meta: { code: err.code, subcode: err.subcode, fbtrace_id: err.fbtraceId } } : {}),
    ...(err.campaign ? { campaign: err.campaign } : {}),
  });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`GiroAuto rodando em ${config.publicUrl} (porta ${config.port})`);
    if (!meta.isConfigured()) console.log('Aviso: META_APP_ID/META_APP_SECRET não configurados. Campanhas ficam indisponíveis.');
  });
}

module.exports = app;
