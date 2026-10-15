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

  /* ---------------- CRM (v2.9) ---------------- */
  const CRM = require('./crm');
  const crm = team.canAny('vender', 'gestao');
  app.get('/api/crm/meta', crm, (req, res) => res.json({
    etapas: CRM.ETAPAS, origens: CRM.ORIGENS, motivos: CRM.MOTIVOS, temperaturas: CRM.TEMPERATURAS, visita_status: CRM.VISITA_STATUS,
    visita_tipos: CRM.VISITA_TIPOS, pagamentos: CRM.PAGAMENTOS, notas: CRM.NOTA, config: CRM.publicConfig(req.user.storeId),
    vendedores: CRM.vendedores(req.user.storeId).map((u) => ({ id: u.id, name: u.name })),
    usuarios: require('./db').all('SELECT id, name FROM users WHERE store_id = ? AND active = 1 ORDER BY name', req.user.storeId),
    resumo: CRM.resumo(req.user),
  }));
  app.get('/api/crm/resumo', crm, (req, res) => res.json(CRM.resumo(req.user)));
  app.put('/api/crm/config', team.can('config'), (req, res) => { CRM.updateConfig(req.user.storeId, req.body || {}); res.json(CRM.publicConfig(req.user.storeId)); });
  app.get('/api/leads', crm, (req, res) => res.json(CRM.list(req.user, req.query)));
  app.post('/api/leads', crm, (req, res) => res.status(201).json(CRM.createLead(req.user.storeId, { ...(req.body || {}), vendedor_id: req.body?.vendedor_id || req.user.id }, { userId: req.user.id })));
  app.get('/api/leads/:lid', crm, (req, res) => res.json({ ...CRM.detail(req.user, req.params.lid), whatsapp: require('./wabot').conversaDoLead(req.user, req.params.lid), wa_api: !!require('./contatos').cloudCfg(get('SELECT wa_cloud FROM stores WHERE id = ?', req.user.storeId)).token }));
  app.put('/api/leads/:lid', crm, (req, res) => { CRM.update(req.user, req.params.lid, req.body || {}); res.json(CRM.detail(req.user, req.params.lid)); });
  app.post('/api/leads/:lid/notes', crm, (req, res) => { CRM.note(req.user, req.params.lid, req.body || {}); res.status(201).json(CRM.detail(req.user, req.params.lid)); });
  app.get('/api/crm/visits', crm, (req, res) => res.json(CRM.visits(req.user, req.query)));
  app.post('/api/crm/visits', crm, (req, res) => res.status(201).json({ id: CRM.addVisit(req.user, req.body || {}) }));
  app.put('/api/crm/visits/:xid', crm, (req, res) => { CRM.updateVisit(req.user, req.params.xid, req.body || {}); res.json({ ok: true }); });
  app.delete('/api/crm/visits/:xid', crm, (req, res) => { CRM.deleteVisit(req.user, req.params.xid); res.json({ ok: true }); });
  app.get('/api/crm/tasks', crm, (req, res) => res.json(CRM.tasks(req.user, req.query)));
  app.post('/api/crm/tasks', crm, (req, res) => res.status(201).json({ id: CRM.addTask(req.user, req.body || {}) }));
  app.put('/api/crm/tasks/:tid', crm, (req, res) => { CRM.doneTask(req.user, req.params.tid, req.body?.feita !== false); res.json({ ok: true }); });
  app.get('/api/crm/stats', crm, (req, res) => res.json(CRM.stats(req.user, req.query)));
  // Captação pública: formulário da vitrine e da página do carro (inclui quem chegou pelo QR code).
  app.post('/api/public/:slug/lead', (req, res) => {
    const store = get('SELECT id, slug FROM stores WHERE slug = ?', req.params.slug);
    if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
    res.json(CRM.publicLead(store, req.body || {}, req.ip));
  });

  /* ---------------- Assistente com IA no site e leads por e-mail (v2.10) ---------------- */
  const BOT = require('./bot');
  const IN = require('./inbound');
  const config = require('./config');
  app.post('/api/public/:slug/chat', wrap(async (req, res) => {
    const store = get('SELECT * FROM stores WHERE slug = ?', req.params.slug);
    if (!store) return res.status(404).json({ error: 'Loja não encontrada.' });
    const r = await BOT.conversar(store, req.body || {}, { ip: req.ip });
    res.json({ sid: r.sid, mensagens: r.mensagens, whatsapp: r.whatsapp || '' });
  }));
  app.get('/api/crm/bot', crm, (req, res) => res.json({ ...BOT.status(req.user.storeId), conversas: BOT.conversas(req.user.storeId) }));
  app.put('/api/crm/bot', team.can('config'), (req, res) => res.json(BOT.saveBotConfig(req.user.storeId, req.body || {})));
  app.post('/api/crm/bot/test', crm, wrap(async (req, res) => {
    const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
    res.json(await BOT.conversar(store, req.body || {}, { teste: true }));
  }));
  app.get('/api/crm/bot/conversas/:sid', crm, (req, res) => res.json(BOT.conversa(req.user.storeId, req.params.sid)));
  app.get('/api/crm/email', team.can('config'), (req, res) => res.json(IN.publicCfg(req.user.storeId, config.publicUrl)));
  app.put('/api/crm/email', team.can('config'), (req, res) => { IN.saveImap(req.user.storeId, req.body || {}); res.json(IN.publicCfg(req.user.storeId, config.publicUrl)); });
  app.post('/api/crm/email/check', team.can('config'), wrap(async (req, res) => res.json(await IN.imapCheck(req.user.storeId, { teste: !!req.body?.teste }))));
  // Colar o e-mail do portal: pré-visualiza (preview) ou cria o lead.
  app.post('/api/crm/email/colar', crm, wrap(async (req, res) => {
    const b = req.body || {};
    const mail = { from: String(b.from || ''), subject: String(b.subject || ''), text: String(b.texto || '') };
    if (b.preview) {
      const store = get('SELECT * FROM stores WHERE id = ?', req.user.storeId);
      const d = IN.parse(mail, store);
      const v = IN.acharVeiculo(req.user.storeId, d, mail.text);
      return res.json({ dados: d, veiculo: v ? { id: v.id, titulo: `${v.marca} ${v.modelo} ${v.ano_modelo || ''}`.trim() } : null });
    }
    res.json(await IN.processar(req.user.storeId, mail));
  }));
  const multipart = require('multer')().none();
  app.post('/api/inbound/email/:token', require('express').urlencoded({ extended: false, limit: '6mb' }), multipart, wrap(async (req, res) => {
    const s = IN.storeByToken(req.params.token);
    if (!s) return res.status(404).json({ error: 'Endereço inválido.' });
    const m = IN.fromWebhook(req.body || {});
    res.json(await IN.processar(s.id, m, { msgId: m.msgId }));
  }));
  IN.startPolling();

  /* ---------------- Assistente no WhatsApp (v2.11) ---------------- */
  const WA = require('./wabot');
  app.get('/api/wa/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WA.verifyToken()) return res.type('text').send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(403);
  });
  app.post('/api/wa/webhook', (req, res) => {
    if (!WA.assinaturaOk(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200);
    WA.processar(req.body).catch((e) => console.error('wa webhook', e.message));
  });
  app.get('/api/wa/bot', team.can('config'), (req, res) => res.json({ ...WA.status(req.user.storeId), ...(require('./db').get('SELECT is_admin FROM users WHERE id = ?', req.user.id)?.is_admin ? { verify_token: WA.verifyToken() } : {}) }));
  app.put('/api/wa/bot', team.can('config'), wrap(async (req, res) => res.json(await WA.salvar(req.user.storeId, req.body || {}))));
  app.post('/api/leads/:lid/wa', crm, wrap(async (req, res) => { await WA.responderComoLoja(req.user, req.params.lid, req.body?.texto); res.json(CRM.detail(req.user, req.params.lid)); }));
  app.put('/api/leads/:lid/wa-bot', crm, (req, res) => res.json(WA.pausar(req.user, req.params.lid, req.body?.pausar !== false)));

  /* ---------------- Contratos (v2.8) ---------------- */
  const K = require('./contratos');
  const emite = team.canAny('vender', 'cadastrar', 'gestao');
  app.get('/api/store/contrato', emite, (req, res) => res.json(K.lojaDados(req.user.storeId)));
  app.put('/api/store/contrato', team.can('config'), (req, res) => { K.saveLoja(req.user.storeId, req.body || {}, req.body?.foro); res.json(K.lojaDados(req.user.storeId)); });
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
