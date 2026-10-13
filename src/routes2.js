// Rotas da v2.0: equipe, proprietário/procuração, gestão (custos, venda, parceiros, localização) e resultados.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');
const storage = require('./storage');
const V = require('./vehicles');
const G = require('./gestao');
const team = require('./team');
const auth = require('./auth');
const { get, all, run, logEvent } = require('./db');
const { hashPassword } = require('./crypto');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const own = (req) => {
  const v = V.findVehicle(req.user.storeId, req.params.id);
  if (!v) throw fail(404, 'Veículo não encontrado.');
  return v;
};

const FIN_KEYS = ['compra_valor', 'compra_data', 'compra_de', 'consig_repasse', 'venda_valor', 'venda_comprador', 'venda_pagamento', 'venda_comissao', 'financeiro'];

// Quem não tem a permissão "financeiro" não recebe valores de compra, custos e margem.
function stripFinance(req, res, next) {
  if (!req.user || req.user.perms?.has('financeiro')) return next();
  const json = res.json.bind(res);
  const clean = (x) => {
    if (Array.isArray(x)) return x.map(clean);
    if (x && typeof x === 'object' && 'marca' in x && 'compra_valor' in x) {
      const o = { ...x };
      FIN_KEYS.forEach((k) => delete o[k]);
      return o;
    }
    return x;
  };
  res.json = (body) => json(clean(body));
  next();
}

function register(app) {
  app.use('/api', stripFinance);

  /* ---------------- Equipe ---------------- */
  app.get('/api/team', team.requireOwner, (req, res) => res.json({ users: team.list(req.user.storeId), perms: team.PERMS, default_seller: team.DEFAULT_SELLER }));

  app.post('/api/team', team.requireOwner, (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!String(b.name || '').trim() || !/^\S+@\S+\.\S+$/.test(email)) throw fail(400, 'Informe o nome e um e-mail válido do vendedor.');
    if (String(b.senha || '').length < 8) throw fail(400, 'A senha inicial precisa ter ao menos 8 caracteres.');
    if (get('SELECT 1 FROM users WHERE email = ?', email)) throw fail(409, 'Já existe um usuário com este e-mail.');
    const perms = team.cleanPerms(b.permissions ?? team.DEFAULT_SELLER);
    run(`INSERT INTO users (store_id, name, email, pass_hash, role, permissions, is_admin) VALUES (?, ?, ?, ?, 'vendedor', ?, 0)`,
      req.user.storeId, String(b.name).trim().slice(0, 80), email, hashPassword(String(b.senha)), JSON.stringify(perms));
    logEvent(req.user.storeId, `Vendedor ${String(b.name).trim()} adicionado à equipe`);
    res.status(201).json({ users: team.list(req.user.storeId) });
  });

  app.put('/api/team/:uid', team.requireOwner, (req, res) => {
    const u = get('SELECT * FROM users WHERE id = ? AND store_id = ?', Number(req.params.uid), req.user.storeId);
    if (!u) throw fail(404, 'Usuário não encontrado.');
    if (u.role === 'admin') throw fail(400, 'O administrador da loja tem todas as permissões.');
    const b = req.body || {};
    if (b.permissions !== undefined) run('UPDATE users SET permissions = ? WHERE id = ?', JSON.stringify(team.cleanPerms(b.permissions)), u.id);
    if (b.active !== undefined) {
      run('UPDATE users SET active = ? WHERE id = ?', b.active ? 1 : 0, u.id);
      if (!b.active) run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    if (b.name) run('UPDATE users SET name = ? WHERE id = ?', String(b.name).trim().slice(0, 80), u.id);
    if (b.senha) {
      if (String(b.senha).length < 8) throw fail(400, 'A nova senha precisa ter ao menos 8 caracteres.');
      run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(String(b.senha)), u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    res.json({ users: team.list(req.user.storeId) });
  });

  // Lista simples de vendedores (para escolher quem vendeu).
  app.get('/api/team/sellers', auth.requireUser, (req, res) => {
    res.json(all('SELECT id, name FROM users WHERE store_id = ? AND active = 1 ORDER BY name', req.user.storeId));
  });

  // Troca da própria senha.
  app.put('/api/me/password', auth.requireUser, (req, res) => {
    const { verifyPassword } = require('./crypto');
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(req.body?.atual || ''), u.pass_hash)) throw fail(400, 'A senha atual não confere.');
    if (String(req.body?.nova || '').length < 8) throw fail(400, 'A nova senha precisa ter ao menos 8 caracteres.');
    run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(String(req.body.nova)), u.id);
    res.json({ ok: true });
  });

  /* ---------------- Procuração (documento privado) ---------------- */
  const uploadDoc = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, f, cb) => cb(null, ['application/pdf', 'image/jpeg', 'image/png'].includes(f.mimetype)),
  });
  app.post('/api/vehicles/:id/procuracao', team.can('cadastrar'), uploadDoc.single('arquivo'), wrap(async (req, res) => {
    const v = own(req);
    if (!req.file) throw fail(400, 'Envie a procuração em PDF, JPG ou PNG de até 10 MB.');
    const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[req.file.mimetype];
    const name = `doc-${crypto.randomBytes(16).toString('hex')}${ext}`;
    fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, 'media', name), req.file.buffer);
    await storage.saveMedia(name);
    if (v.procuracao_file) { fs.rm(path.join(config.dataDir, 'media', v.procuracao_file), () => {}); storage.removeMedia([v.procuracao_file]).catch(() => {}); }
    run(`UPDATE vehicles SET procuracao_file = ?, updated_at = datetime('now') WHERE id = ?`, name, v.id);
    logEvent(req.user.storeId, `Procuração anexada ao ${v.marca} ${v.modelo}`);
    res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
  }));
  app.get('/api/vehicles/:id/procuracao', auth.requireUser, wrap(async (req, res) => {
    const v = own(req);
    if (!v.procuracao_file) throw fail(404, 'Nenhuma procuração anexada.');
    const file = await storage.ensureLocal(v.procuracao_file);
    if (!file) throw fail(404, 'Arquivo da procuração não encontrado.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="procuracao-${(v.placa || v.id)}${path.extname(file)}"`);
    res.type(storage.MIME[path.extname(file)] || 'application/octet-stream').sendFile(file);
  }));
  app.delete('/api/vehicles/:id/procuracao', team.can('cadastrar'), (req, res) => {
    const v = own(req);
    if (v.procuracao_file) { fs.rm(path.join(config.dataDir, 'media', v.procuracao_file), () => {}); storage.removeMedia([v.procuracao_file]).catch(() => {}); }
    run(`UPDATE vehicles SET procuracao_file = '' WHERE id = ?`, v.id);
    res.json(V.serialize(V.findVehicle(req.user.storeId, v.id)));
  });

  /* ---------------- Financeiro do carro ---------------- */
  app.get('/api/vehicles/:id/finance', team.can('financeiro'), (req, res) => {
    const v = own(req);
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    res.json({ vehicle: V.serialize(v), costs: G.costsOf(v.id).map((c) => ({ ...c, categoria_label: G.COST_CATS[c.categoria] || c.categoria })), finance: G.finance(v, store), categorias: G.COST_CATS, impostos_pct: store.impostos_pct });
  });
  app.put('/api/vehicles/:id/finance', team.can('financeiro'), (req, res) => {
    G.saveFinance(req.user.storeId, own(req).id, req.body || {});
    res.json({ ok: true });
  });
  app.post('/api/vehicles/:id/costs', team.can('financeiro'), (req, res) => {
    G.addCost(req.user.storeId, own(req).id, req.body || {}, req.user.id);
    res.status(201).json({ ok: true });
  });
  app.delete('/api/vehicles/:id/costs/:cid', team.can('financeiro'), (req, res) => {
    G.deleteCost(req.user.storeId, own(req).id, req.params.cid);
    res.json({ ok: true });
  });

  /* ---------------- Parceiros e localização ---------------- */
  app.get('/api/partners', auth.requireUser, (req, res) => res.json({ partners: G.partners(req.user.storeId, req.query.todos === '1'), tipos: G.PARTNER_TYPES, locais: G.LOCAL }));
  app.post('/api/partners', team.can('parceiros'), (req, res) => { G.savePartner(req.user.storeId, null, req.body || {}); res.status(201).json({ partners: G.partners(req.user.storeId) }); });
  app.put('/api/partners/:pid', team.can('parceiros'), (req, res) => { G.savePartner(req.user.storeId, req.params.pid, req.body || {}); res.json({ partners: G.partners(req.user.storeId) }); });
  app.put('/api/vehicles/:id/location', team.can('parceiros'), (req, res) => {
    G.setLocation(req.user.storeId, own(req).id, req.body || {}, req.user.id);
    res.json(V.serialize(V.findVehicle(req.user.storeId, req.params.id)));
  });
  app.get('/api/vehicles/:id/moves', auth.requireUser, (req, res) => res.json(G.moves(own(req).id)));

  /* ---------------- Resultados ---------------- */
  app.get('/api/results', team.can('gestao'), (req, res) => res.json(G.results(req.user.storeId, req.query)));

  /* ---------------- Ajustes da loja para gestão ---------------- */
  app.put('/api/store/gestao', team.can('config'), (req, res) => {
    const b = req.body || {};
    const dias = Math.max(5, Math.min(180, parseInt(b.parado_dias, 10) || 25));
    const imp = Math.max(0, Math.min(50, Number(String(b.impostos_pct ?? '').replace(',', '.')) || 0));
    run('UPDATE stores SET parado_dias = ?, impostos_pct = ? WHERE id = ?', dias, imp, req.user.storeId);
    res.json({ parado_dias: dias, impostos_pct: imp });
  });
}

module.exports = { register, stripFinance };
