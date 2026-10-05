// Servidor que imita a Graph API da Meta para testes automatizados.
const express = require('express');

function parse(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function createMock() {
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '20mb' }));
  const calls = [];
  const state = { failOn: null, seq: 1000 };
  const id = () => String(state.seq++);

  app.use((req, res, next) => {
    const params = Object.fromEntries(Object.entries({ ...req.query, ...req.body }).map(([k, v]) => [k, parse(v)]));
    const path = req.path.replace(/^\/v\d+\.\d+/, '');
    calls.push({ method: req.method, path, params });
    req.p = params; req.gpath = path;
    if (state.failOn && state.failOn.method === req.method && state.failOn.re.test(path)) {
      return res.status(400).json({ error: { message: 'Invalid parameter', error_user_title: 'Público pequeno demais', error_user_msg: 'Amplie o raio.', code: 100, fbtrace_id: 'XYZ' } });
    }
    next();
  });

  app.get('/:v/oauth/access_token', (req, res) => res.json({ access_token: req.p.grant_type ? 'long-token' : 'short-token', expires_in: 5184000 }));
  app.get('/:v/me', (req, res) => res.json({ id: '9001', name: 'Darlan Teste' }));
  app.get('/:v/me/adaccounts', (req, res) => res.json({ data: [{ id: 'act_111', name: 'Loja Ads', currency: 'BRL', account_status: 1 }] }));
  app.get('/:v/me/accounts', (req, res) => res.json({ data: [{ id: 'page_1', name: 'Autos Teste', instagram_business_account: { id: 'ig_1', username: 'autosteste' } }] }));
  app.get('/:v/me/businesses', (req, res) => res.json({ data: [{ id: 'biz_1', name: 'Autos Teste Ltda' }] }));
  app.get('/:v/search', (req, res) => res.json({ data: [{ key: '242789', name: 'Assis Chateaubriand', region: 'Paraná' }] }));
  app.post('/:v/:act/adimages', (req, res) => res.json({ images: { bytes: { hash: 'hash_' + id(), url: 'https://x' } } }));
  app.post('/:v/:node/:edge', (req, res) => res.json({ id: id() }));
  app.post('/:v/:node', (req, res) => res.json({ success: true }));
  app.get('/:v/:node/insights', (req, res) => res.json({ data: [{ impressions: '1200', reach: '900', clicks: '45', spend: '31.50', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '7' }] }] }));
  app.get('/:v/:node', (req, res) => res.json({ id: req.params.node, effective_status: 'ACTIVE' }));
  app.delete('/:v/:node', (req, res) => res.json({ success: true }));

  return { app, calls, state };
}

module.exports = { createMock };

// Diálogo de login simulado: devolve imediatamente para o redirect_uri.
function addDialog(app) {
  app.get('/:v/dialog/oauth', (req, res) => {
    const u = new URL(req.query.redirect_uri);
    u.searchParams.set('code', 'code-e2e');
    u.searchParams.set('state', req.query.state);
    res.redirect(u.toString());
  });
}
module.exports.addDialog = addDialog;
