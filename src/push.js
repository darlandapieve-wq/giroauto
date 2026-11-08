// Avisos no celular (Web Push) — v2.19. Lead novo chega como notificação no aparelho de quem ativou
// (no CRM: "Ativar avisos neste aparelho"). No iPhone, só com o GiroAuto instalado na tela de início.
// As chaves VAPID são geradas uma vez e guardadas nas configurações do banco (nada para configurar no Render).
const webpush = require('web-push');
const config = require('./config');
const auth = require('./auth');
const { db, get, all, run } = require('./db');
const lerCfg = (k) => get('SELECT value FROM settings WHERE key = ?', k)?.value ?? null;
const gravarCfg = (k, v) => run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, k, v);

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  aparelho TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

let chaves = null;
function vapid() {
  if (chaves) return chaves;
  let k = null;
  try { k = JSON.parse(lerCfg('push_vapid') || 'null'); } catch { k = null; }
  if (!k?.publicKey) { k = webpush.generateVAPIDKeys(); gravarCfg('push_vapid', JSON.stringify(k)); }
  const contato = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:avisos@giroauto.app';
  webpush.setVapidDetails(contato, k.publicKey, k.privateKey);
  chaves = k;
  return k;
}

async function enviar(sub, dados) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(dados), { TTL: 3600 });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subs WHERE id = ?', sub.id); // aparelho saiu
    else console.error('Push:', e.statusCode || '', e.message);
    return false;
  }
}

async function paraUsuarios(storeId, userIds, dados) {
  vapid();
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  if (!ids.length) return 0;
  const subs = all(`SELECT * FROM push_subs WHERE store_id = ? AND user_id IN (${ids.map(() => '?').join(',')})`, storeId, ...ids);
  let n = 0;
  for (const s of subs) if (await enviar(s, dados)) n++;
  return n;
}

// Lead novo (que não foi digitado por alguém da equipe): vendedor responsável + donos da loja.
async function avisarLead(storeId, leadId) {
  const l = get('SELECT l.*, v.marca, v.modelo FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id WHERE l.id = ? AND l.store_id = ?', leadId, storeId);
  if (!l) return 0;
  const donos = all("SELECT id FROM users WHERE store_id = ? AND role = 'admin'", storeId).map((u) => u.id);
  const carro = l.marca ? ` · ${l.marca} ${l.modelo}` : '';
  return paraUsuarios(storeId, [l.vendedor_id, ...donos], {
    title: '🔔 Lead novo', body: `${l.nome || l.telefone || l.email || 'Cliente'}${carro}`, url: '/#crm', tag: `lead-${l.id}`,
  });
}

function register(app) {
  app.get('/api/push/chave', auth.requireUser, (req, res) => {
    const n = get('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?', req.user.id).n;
    res.json({ publicKey: vapid().publicKey, aparelhos: n });
  });
  app.post('/api/push/assinar', auth.requireUser, (req, res) => {
    const s = req.body?.subscription || {};
    if (!/^https:\/\//.test(String(s.endpoint || '')) || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ error: 'Inscrição inválida.' });
    run(`INSERT INTO push_subs (store_id, user_id, endpoint, p256dh, auth, aparelho) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET store_id = excluded.store_id, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    req.user.storeId, req.user.id, String(s.endpoint).slice(0, 1000), String(s.keys.p256dh).slice(0, 200), String(s.keys.auth).slice(0, 100), String(req.get('user-agent') || '').slice(0, 160));
    res.json({ ok: true });
  });
  app.post('/api/push/sair', auth.requireUser, (req, res) => {
    run('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?', req.user.id, String(req.body?.endpoint || ''));
    res.json({ ok: true });
  });
  app.post('/api/push/teste', auth.requireUser, async (req, res) => {
    const n = await paraUsuarios(req.user.storeId, [req.user.id], { title: 'GiroAuto', body: 'Avisos ativados neste aparelho. ✅', url: '/#crm', tag: 'teste' });
    res.json({ enviados: n });
  });
}

module.exports = { register, avisarLead, vapid };
