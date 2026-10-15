// Rotas da v2.4: painel do administrador, contatos (histórico e mensagens em massa) e contas a pagar.
const team = require('./team');
const auth = require('./auth');
const G = require('./gestao');
const C = require('./contatos');
const { painel } = require('./painel');
const { get } = require('./db');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function register(app) {
  /* ---------------- Sugestões e erros (todos os usuários) e acesso do desenvolvedor (v2.7) ---------------- */
  const DEV = require('./dev');
  app.post('/api/feedback', auth.requireUser, (req, res) => res.status(201).json({ id: Number(DEV.createFeedback(req.user, req.body || {})) }));
  app.get('/api/feedback', auth.requireUser, (req, res) => res.json({ itens: DEV.myFeedback(req.user), tipos: DEV.TIPOS }));
  app.get('/api/dev/overview', DEV.requireDev, (req, res) => res.json(DEV.overview()));
  app.get('/api/dev/stores/:sid', DEV.requireDev, (req, res) => res.json(DEV.storeDetail(req.params.sid)));
  app.get('/api/dev/feedback', DEV.requireDev, (req, res) => res.json({ itens: DEV.feedbackList(), tipos: DEV.TIPOS, status: DEV.STATUS, prioridades: DEV.PRIORIDADES }));
  app.put('/api/dev/feedback/:fid', DEV.requireDev, (req, res) => { DEV.updateFeedback(req.params.fid, req.body || {}); res.json({ ok: true }); });

  /* ---------------- Contratos (v2.8) ---------------- */
  const K = require('./contratos');
  const emite = team.canAny('vender', 'cadastrar', 'gestao');
  app.get('/api/contracts/models', emite, (req, res) => res.json({ modelos: K.models(req.user.storeId), loja: K.lojaDados(req.user.storeId) }));
  app.put('/api/contracts/models/:key', team.can('config'), (req, res) => res.json(K.saveModel(req.user.storeId, req.params.key, req.body || {})));
  app.post('/api/contracts/models/:key/duplicate', team.can('config'), (req, res) => res.status(201).json(K.duplicateModel(req.user.storeId, req.params.key, req.body?.nome)));
  app.delete('/api/contracts/models/:key', team.can('config'), (req, res) => { K.resetModel(req.user.storeId, req.params.key); res.json({ ok: true }); });
  app.post('/api/contracts/prefill', emite, (req, res) => res.json(K.prefill(req.user.storeId, req.body || {})));
  app.post('/api/contracts/preview', emite, (req, res) => res.json(K.preview(req.user.storeId, req.body || {})));
  app.get('/api/contracts', emite, (req, res) => res.json(K.list(req.user.storeId, req.query)));
  app.post('/api/contracts', emite, (req, res) => { const id = K.save(req.user.storeId, null, req.body || {}, req.user.id); res.status(201).json(K.serialize(K.find(req.user.storeId, id))); });
  app.get('/api/contracts/:cid', emite, (req, res) => res.json(K.serialize(K.find(req.user.storeId, req.params.cid))));
  app.put('/api/contracts/:cid', emite, (req, res) => { K.save(req.user.storeId, req.params.cid, req.body || {}, req.user.id); res.json(K.serialize(K.find(req.user.storeId, req.params.cid))); });
  app.delete('/api/contracts/:cid', team.canAny('excluir', 'gestao'), (req, res) => { K.remove(req.user.storeId, req.params.cid); res.json({ ok: true }); });
  app.get('/contratos/:cid/imprimir', auth.requireUser, (req, res) => {
    let c; try { c = K.find(req.user.storeId, req.params.cid); } catch { return res.status(404).send('Contrato não encontrado'); }
    res.send(K.printPage(req.user.storeId, c));
  });

  /* ---------------- Painel ---------------- */
  app.get('/api/painel', team.can('gestao'), (req, res) => res.json(painel(req.user.storeId, req.query, req.user.perms.has('financeiro'))));

  /* ---------------- Contas a pagar ---------------- */
  app.put('/api/expenses/:eid/pago', team.can('financeiro'), (req, res) => { G.payExpense(req.user.storeId, req.params.eid, req.body?.pago !== false); res.json({ ok: true }); });

  /* ---------------- Contatos ---------------- */
  // Contatos e mensagens: quem vende (vender) ou administra (gestao) usa.
  const pode = team.canAny('vender', 'gestao');
  app.get('/api/contacts', pode, (req, res) => res.json({ contatos: C.list(req.user.storeId), papeis: C.PAPEIS, tipos_nota: C.NOTA_TIPOS, cloud: C.cloudPublic(get('SELECT wa_cloud FROM stores WHERE id = ?', req.user.storeId)) }));
  app.post('/api/contacts', pode, (req, res) => res.status(201).json({ id: Number(C.save(req.user.storeId, null, req.body || {})) }));
  app.put('/api/contacts/:cid', pode, (req, res) => { C.save(req.user.storeId, req.params.cid, req.body || {}); res.json({ ok: true }); });
  app.get('/api/contacts/:cid', pode, (req, res) => {
    C.sync(req.user.storeId);
    const c = C.find(req.user.storeId, req.params.cid);
    res.json({ contato: C.serialize(req.user.storeId, c), historico: C.historico(req.user.storeId, c) });
  });
  app.post('/api/contacts/:cid/notes', pode, (req, res) => { C.addNote(req.user.storeId, req.params.cid, req.body || {}, req.user.id); res.status(201).json({ ok: true }); });

  /* ---------------- Mensagens em massa ---------------- */
  app.get('/api/wa/campaigns', pode, (req, res) => res.json(C.campaigns(req.user.storeId)));
  app.post('/api/wa/campaigns', pode, (req, res) => res.status(201).json({ id: Number(C.createCampaign(req.user.storeId, req.body || {}, req.user.id)) }));
  app.get('/api/wa/campaigns/:wid', pode, (req, res) => res.json(C.campaign(req.user.storeId, req.params.wid)));
  app.put('/api/wa/campaigns/:wid/sends/:sid', pode, (req, res) => { C.markSend(req.user.storeId, req.params.wid, req.params.sid, req.body?.status, req.user.id); res.json(C.campaign(req.user.storeId, req.params.wid)); });
  app.get('/api/wa/config', team.can('config'), (req, res) => res.json(C.cloudPublic(get('SELECT wa_cloud FROM stores WHERE id = ?', req.user.storeId))));
  app.put('/api/wa/config', team.can('config'), (req, res) => { C.saveCloud(req.user.storeId, req.body || {}); res.json(C.cloudPublic(get('SELECT wa_cloud FROM stores WHERE id = ?', req.user.storeId))); });
}

module.exports = { register, wrap, auth };
