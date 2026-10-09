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

  /* IA de imagens do Google (Gemini) */
  app.use(express.json({ limit: '30mb' }));
  state.geminiCalls = [];
  app.get('/v1beta/models', (req, res) => {
    if (req.get('x-goog-api-key') !== 'AIzaTESTKEY1234567890123456789012345') return res.status(400).json({ error: { message: 'API key not valid.' } });
    res.json({ models: [{ name: 'models/gemini-nano-banana-2.1' }] });
  });
  app.post(/^\/(v1|v1beta)\/models\/([^/:]+):generateContent$/, async (req, res) => {
    state.geminiCalls.push({ version: req.params[0], model: req.params[1], body: req.body });
    if (state.geminiFail) return res.status(429).json({ error: { message: 'Resource has been exhausted (e.g. check quota).' } });
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const c = createCanvas(864, 1080); const ctx = c.getContext('2d'); ctx.fillStyle = '#556677'; ctx.fillRect(0, 0, 864, 1080);
    // Devolve a própria foto enviada (recortada em 4:5) com um tom azulado, para parecer uma edição.
    try {
      const part = req.body.contents[0].parts.find((p) => p.inline_data || p.inlineData);
      const img = await loadImage(Buffer.from((part.inline_data || part.inlineData).data, 'base64'));
      const sc = Math.max(864 / img.width, 1080 / img.height);
      ctx.drawImage(img, (864 - img.width * sc) / 2, (1080 - img.height * sc) / 2, img.width * sc, img.height * sc);
      ctx.fillStyle = 'rgba(40,90,160,0.25)'; ctx.fillRect(0, 0, 864, 1080);
    } catch { /* imagem inválida: fica o fundo cinza */ }
    const png = await c.encode('png');
    res.json({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] });
  });

  /* Pollinations (edição de imagem compatível com a OpenAI) */
  const multer = require('multer');
  app.post('/v1/images/edits', multer({ storage: multer.memoryStorage() }).single('image'), async (req, res) => {
    (state.pollCalls ||= []).push({ auth: req.get('authorization'), model: req.body.model, prompt: req.body.prompt, size: req.file?.size });
    if (state.pollFail) return res.status(state.pollFail).json({ error: { message: 'Insufficient pollen balance' } });
    const { createCanvas } = require('@napi-rs/canvas');
    const c = createCanvas(800, 1000); const ctx = c.getContext('2d'); ctx.fillStyle = '#668855'; ctx.fillRect(0, 0, 800, 1000);
    res.json({ data: [{ b64_json: (await c.encode('png')).toString('base64') }] });
  });

  app.get('/:v/oauth/access_token', (req, res) => res.json({ access_token: req.p.grant_type ? 'long-token' : 'short-token', expires_in: 5184000 }));
  app.get('/:v/me', (req, res) => res.json({ id: '9001', name: 'Darlan Teste' }));
  app.get('/:v/me/adaccounts', (req, res) => res.json({ data: [{ id: 'act_111', name: 'Loja Ads', currency: 'BRL', account_status: 1 }] }));
  app.get('/:v/me/accounts', (req, res) => res.json({ data: [{ id: 'page_1', name: 'Autos Teste', instagram_business_account: { id: 'ig_1', username: 'autosteste' } }] }));
  app.get('/:v/me/businesses', (req, res) => res.json({ data: [{ id: 'biz_1', name: 'Autos Teste Ltda' }] }));
  app.get('/:v/search', (req, res) => {
    if (req.p.type === 'adinterest') return res.json({ data: [{ id: '6003176678152', name: 'Automóveis', audience_size_upper_bound: 98000000, path: ['Interesses', 'Automóveis'] }, { id: '6003304473660', name: 'Carros usados', audience_size: 21000000 }] });
    return res.json({ data: [{ key: '242789', name: 'Assis Chateaubriand', region: 'Paraná' }] });
  });
  app.get('/:v/:act/reachestimate', (req, res) => res.json({ data: { users_lower_bound: 38000, users_upper_bound: 44700, estimate_ready: true } }));
  app.post('/:v/:act/adimages', (req, res) => res.json({ images: { bytes: { hash: 'hash_' + id(), url: 'https://x' } } }));
  app.post('/:v/:node/:edge', (req, res) => res.json({ id: id() }));
  app.post('/:v/:node', (req, res) => res.json({ success: true }));
  app.get('/:v/:node/insights', (req, res) => res.json({ data: [{ impressions: '1200', reach: '900', clicks: '45', spend: '31.50', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '7' }] }] }));
  app.get('/:v/:node', (req, res) => {
    const f = String(req.p.fields || '');
    if (f.includes('status_code')) return res.json({ id: req.params.node, status_code: 'FINISHED' });
    if (f.includes('permalink')) return res.json({ id: req.params.node, permalink: 'https://www.instagram.com/p/TESTE123/' });
    res.json({ id: req.params.node, effective_status: 'ACTIVE' });
  });
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
